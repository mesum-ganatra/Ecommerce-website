import mongoose, { type Types } from 'mongoose';
import crypto from 'node:crypto';
import { env } from '../config/env';
import { Order, Payment, Product, StockMovement, nextOrderNumber } from '../models';
import { AppError, badRequest } from '../utils/errors';
import type { Pricing } from './pricing';

export interface CheckoutInput {
  customer: { name: string; phone: string; email?: string };
  shippingAddress?: { line1: string; line2?: string; city: string; province?: string; postalCode?: string };
  note?: string;
  idempotencyKey: string;
}

interface StoreForOrder {
  _id: Types.ObjectId;
  settings?: {
    couriers?: { code?: string | null; active?: boolean | null }[] | null;
  } | null;
}

/**
 * Places a Cash on Delivery order. One database transaction does everything together:
 * stock is taken with a condition (never below zero, even with simultaneous buyers),
 * the order number is allocated, and the order and payment record are written.
 * If anything fails, nothing is kept. Repeating the same idempotency key returns the same order.
 */
export type PayMethod = 'cod' | 'jazzcash' | 'easypaisa' | 'simulator';

/** Max 20 letters and digits, which every gateway accepts. */
const newTxnRef = (number: number) => `T${Date.now().toString(36).toUpperCase()}${number.toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`.slice(0, 20);

export async function placeOrder(store: StoreForOrder, pricing: Pricing, input: CheckoutInput, method: PayMethod) {
  if (pricing.hasPhysical && !input.shippingAddress) throw badRequest('A delivery address is required.');
  const courier = store.settings?.couriers?.find((c) => c.active)?.code ?? undefined;

  const session = await mongoose.startSession();
  try {
    let result: { order: InstanceType<typeof Order>; payment: InstanceType<typeof Payment> | null; duplicate: boolean } | undefined;

    await session.withTransaction(async () => {
      result = undefined;

      const existing = await Order.findOne({ storeId: store._id, idempotencyKey: input.idempotencyKey }).session(session);
      if (existing) {
        result = { order: existing, payment: await Payment.findOne({ storeId: store._id, orderId: existing._id }).session(session), duplicate: true };
        return;
      }

      // 1. take the stock, with the guard in the update itself
      for (const line of pricing.lines) {
        if (line.type !== 'physical') continue;
        const guard = line.allowBackorder ? {} : { stock: { $gte: line.quantity } };
        const r = await Product.updateOne(
          { _id: line.productId, storeId: store._id, status: 'active', variants: { $elemMatch: { sku: line.sku, active: true, ...guard } } },
          { $inc: { 'variants.$.stock': -line.quantity } },
          { session },
        );
        if (r.modifiedCount !== 1) {
          throw new AppError(409, 'out_of_stock', `"${line.name}" just sold out or changed. Please review your basket.`, [{ sku: line.sku }]);
        }
      }

      // 2. order
      const number = await nextOrderNumber(String(store._id), session);
      const fullName = input.customer.name;
      const address = input.shippingAddress
        ? { ...input.shippingAddress, fullName, phone: input.customer.phone, country: 'PK' }
        : undefined;
      const [order] = await Order.create(
        [
          {
            storeId: store._id,
            number,
            guest: input.customer,
            status: 'pending',
            paymentStatus: 'unpaid',
            paymentMethod: method,
            hasPhysical: pricing.hasPhysical,
            hasDigital: pricing.hasDigital,
            items: pricing.lines.map((l) => ({
              productId: l.productId,
              sku: l.sku,
              name: l.name,
              type: l.type,
              attributes: l.attributes,
              unitPrice: l.unitPrice,
              quantity: l.quantity,
              lineTotal: l.lineTotal,
            })),
            shippingAddress: address,
            billingAddress: address,
            courierCode: pricing.hasPhysical ? courier : undefined,
            totals: { subtotal: pricing.subtotal, discount: 0, shipping: pricing.shipping, tax: pricing.tax, total: pricing.total },
            note: input.note,
            statusHistory: [{ status: 'pending', at: new Date(), note: 'Order placed' }],
            idempotencyKey: input.idempotencyKey,
          },
        ],
        { session },
      );

      // 3. stock history and the payment record
      const movements = pricing.lines
        .filter((l) => l.type === 'physical')
        .map((l) => ({ storeId: store._id, productId: l.productId, sku: l.sku, delta: -l.quantity, reason: 'sale' as const, note: `Order #${number}`, balanceAfter: -1 }));
      if (movements.length) {
        // balanceAfter is read back inside the same transaction so the history is exact
        for (const m of movements) {
          const p = await Product.findOne({ _id: m.productId, storeId: store._id }, { variants: { $elemMatch: { sku: m.sku } } }).session(session).lean();
          m.balanceAfter = p?.variants?.[0]?.stock ?? 0;
        }
        await StockMovement.insertMany(movements, { session });
      }
      const online = method !== 'cod';
      const [payment] = await Payment.create(
        [{
          storeId: store._id, orderId: order._id, gateway: method, mode: 'live',
          txnRef: online ? newTxnRef(number) : `COD-${String(store._id).slice(-6)}-${number}`,
          amount: pricing.total, status: 'initiated',
          expiresAt: online ? new Date(Date.now() + env.paymentExpiryMinutes * 60_000) : undefined,
        }],
        { session },
      );

      result = { order, payment, duplicate: false };
    });

    if (!result) throw new AppError(500, 'server_error', 'Could not place the order');
    return result;
  } finally {
    await session.endSession();
  }
}
