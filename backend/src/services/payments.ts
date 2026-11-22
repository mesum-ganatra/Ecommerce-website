import mongoose, { type ClientSession, type Types } from 'mongoose';
import { env } from '../config/env';
import { AuditLog, DownloadAccess, Order, Payment, Product, StockMovement, Store } from '../models';
import type { GatewayResult } from '../payments';

type Order = InstanceType<typeof Order>;

/** Puts the stock of a (physical) order back on the shelf and records it. */
async function restoreStock(order: Order, note: string, session: ClientSession) {
  for (const item of order.items) {
    if (item.type !== 'physical') continue;
    const updated = await Product.findOneAndUpdate(
      { _id: item.productId, storeId: order.storeId, 'variants.sku': item.sku },
      { $inc: { 'variants.$.stock': item.quantity } },
      { session, returnDocument: 'after' },
    );
    const balance = updated?.variants.find((v) => v.sku === item.sku)?.stock ?? 0;
    await StockMovement.create([{ storeId: order.storeId, productId: item.productId, sku: item.sku, delta: item.quantity, balanceAfter: balance, reason: 'return', note }], { session });
  }
}

/** One download entitlement per file of every digital product in a paid order (FR-PR-004). */
async function grantDownloads(order: Order, session: ClientSession) {
  const store = await Store.findById(order.storeId).select('settings.downloadDefaults').session(session).lean();
  const defaults = store?.settings?.downloadDefaults;
  for (const item of order.items) {
    if (item.type !== 'digital') continue;
    const p = await Product.findOne({ _id: item.productId, storeId: order.storeId }).select('digitalFiles download').session(session).lean();
    if (!p) continue;
    const days = p.download?.expiryDays ?? defaults?.expiryDays ?? 7;
    const limit = p.download?.downloadLimit ?? defaults?.downloadLimit ?? 5;
    for (const f of p.digitalFiles ?? []) {
      const exists = await DownloadAccess.exists({ orderId: order._id, productId: item.productId, fileId: f._id }).session(session);
      if (exists) continue;
      await DownloadAccess.create([{ storeId: order.storeId, orderId: order._id, productId: item.productId, fileId: f._id, expiresAt: new Date(Date.now() + days * 86_400_000), downloadLimit: limit }], { session });
    }
  }
}

export type Settled = { status: 'paid' | 'failed' | 'cancelled' | 'unknown' | 'mismatch'; orderNumber?: number };

/**
 * Applies a verified gateway result to the payment and its order. Safe to call any number of times for the same
 * result (a customer refreshing the return page, a gateway retrying): the order changes once.
 */
export async function settlePayment(storeId: Types.ObjectId | string, txnRef: string, result: GatewayResult): Promise<Settled> {
  const session = await mongoose.startSession();
  try {
    let out: Settled = { status: 'unknown' };
    await session.withTransaction(async () => {
      out = { status: 'unknown' };
      const payment = await Payment.findOne({ storeId, txnRef }).session(session);
      if (!payment) return;
      const order = await Order.findOne({ _id: payment.orderId, storeId }).session(session);
      if (!order) return;
      out = { status: 'unknown', orderNumber: order.number };

      // never trust a result whose amount differs from what we asked for
      if (result.amountPaisa !== undefined && result.amountPaisa !== payment.amount) {
        await Order.updateOne({ _id: order._id }, { $set: { needsAttention: true } }, { session });
        await AuditLog.create([{ storeId, action: 'payment.amount_mismatch', entity: 'payment', entityId: String(payment._id), after: { expected: payment.amount, got: result.amountPaisa } }], { session });
        out = { status: 'mismatch', orderNumber: order.number };
        return;
      }

      if (result.outcome === 'success') {
        if (payment.status === 'succeeded') {
          out = { status: 'paid', orderNumber: order.number };
          return;
        }
        payment.status = 'succeeded';
        payment.gatewayTxnId = result.gatewayTxnId;
        payment.failureReason = undefined;
        payment.processedCallbacks.push(`success:${result.gatewayTxnId ?? ''}`);
        await payment.save({ session });

        const wasCancelled = order.status === 'cancelled';
        const physical = order.items.some((i) => i.type === 'physical');
        order.paymentStatus = 'paid';
        order.statusHistory.push({ status: 'paid', at: new Date(), note: `Paid online (${payment.gateway})` } as never);
        if (wasCancelled) {
          // the order was closed (and its stock released) before the money arrived: a person must decide what to do
          order.needsAttention = true;
          order.statusHistory.push({ status: 'attention', at: new Date(), note: 'Payment arrived after the order was cancelled' } as never);
        } else {
          await grantDownloads(order, session);
          if (!physical) {
            order.status = 'completed';
            order.statusHistory.push({ status: 'completed', at: new Date(), note: 'Digital order delivered' } as never);
          }
        }
        await order.save({ session });
        out = { status: 'paid', orderNumber: order.number };
        return;
      }

      // failed or cancelled by the customer
      if (payment.status === 'succeeded') {
        out = { status: 'paid', orderNumber: order.number };
        return;
      }
      if (payment.status === 'initiated') {
        payment.status = result.outcome === 'cancelled' ? 'cancelled' : 'failed';
        payment.failureReason = result.message;
        payment.processedCallbacks.push(`${result.outcome}:${result.gatewayTxnId ?? ''}`);
        await payment.save({ session });
        if (order.status === 'pending') {
          order.status = 'cancelled';
          order.statusHistory.push({ status: 'cancelled', at: new Date(), note: `Payment ${payment.status}` } as never);
          await order.save({ session });
          await restoreStock(order, `Order #${order.number}: payment ${payment.status}`, session);
        }
      }
      out = { status: payment.status === 'cancelled' ? 'cancelled' : 'failed', orderNumber: order.number };
    });
    return out;
  } finally {
    await session.endSession();
  }
}

/**
 * Closes online orders whose payment never arrived, so their stock is not held forever. If money does arrive
 * later, settlePayment flags the order "needs attention" instead of silently losing it.
 */
export async function expireStalePayments(now = new Date()): Promise<number> {
  const stale = await Payment.find({ status: 'initiated', gateway: { $ne: 'cod' }, expiresAt: { $lt: now } }).select('storeId txnRef').limit(100).lean();
  let n = 0;
  for (const p of stale) {
    const r = await settlePayment(p.storeId, p.txnRef, { authentic: true, outcome: 'cancelled', message: 'expired' });
    if (r.status !== 'unknown') n++;
  }
  return n;
}

let lastLazyRun = 0;
/** Best-effort cleanup at most once a minute per instance, used where no always-on timer exists. */
export async function maybeExpireStale() {
  if (Date.now() - lastLazyRun < 60_000) return;
  lastLazyRun = Date.now();
  try {
    await expireStalePayments();
  } catch (err) {
    console.error('lazy payment expiry failed', err);
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
export function startPaymentExpiryJob() {
  if (timer) return;
  let running = false;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await expireStalePayments();
    } catch (err) {
      console.error('payment expiry job failed', err);
    } finally {
      running = false;
    }
  }, 60_000);
  timer.unref();
}

/** Where the customer's browser is sent after paying: that store's own storefront. */
export const storefrontOrigin = (subdomain: string) => env.storefrontUrlTemplate.replace('{sub}', subdomain).replace(/\/$/, '');
