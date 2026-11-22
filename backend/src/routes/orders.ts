import { Router } from 'express';
import mongoose, { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth';
import { ORDER_STATUSES, Order, Payment, Product, Shipment, StockMovement, Store } from '../models';
import { audit } from '../services/audit';
import { salesAnalytics } from '../services/analytics';
import { badRequest, conflict, notFound } from '../utils/errors';

// Mounted at /api/v1/stores/:storeId (see app.ts).
export const ordersRouter = Router({ mergeParams: true });
const scope = { storeParam: 'storeId' };

const objectId = z.string().refine(isValidObjectId, 'Not a valid id');

/** Allowed moves. Cancelling has its own endpoint (it needs a different permission and restores stock). */
const NEXT: Record<string, string[]> = {
  pending: ['processing'],
  processing: ['shipped'],
  shipped: ['delivered'],
  delivered: ['completed'],
};

function summarize(o: any) {
  return {
    _id: o._id,
    number: o.number,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    customer: o.guest?.name ?? 'Customer',
    phone: o.guest?.phone ?? '',
    city: o.shippingAddress?.city ?? null,
    itemCount: (o.items ?? []).reduce((n: number, i: any) => n + i.quantity, 0),
    total: o.totals?.total ?? 0,
    hasDigital: o.hasDigital,
    needsAttention: Boolean(o.needsAttention),
    createdAt: o.createdAt,
  };
}

ordersRouter.get('/orders', requirePermission('order.read', scope), async (req, res) => {
  const q = z
    .object({
      status: z.enum(ORDER_STATUSES).optional(),
      paymentStatus: z.enum(['unpaid', 'paid', 'partially_refunded', 'refunded', 'failed']).optional(),
      search: z.string().trim().max(80).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .parse(req.query);

  const filter: Record<string, unknown> = { storeId: req.storeId };
  if (q.status) filter.status = q.status;
  if (q.paymentStatus) filter.paymentStatus = q.paymentStatus;
  if (q.search) {
    const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const asNumber = Number(q.search.replace(/^#/, ''));
    filter.$or = [
      ...(Number.isInteger(asNumber) && asNumber > 0 ? [{ number: asNumber }] : []),
      { 'guest.name': rx },
      { 'guest.phone': rx },
      { 'guest.email': rx },
    ];
  }
  const [items, total, pending] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    Order.countDocuments(filter),
    Order.countDocuments({ storeId: req.storeId, status: 'pending' }),
  ]);
  res.json({ items: items.map(summarize), total, page: q.page, limit: q.limit, pendingCount: pending });
});

ordersRouter.get('/orders/:orderId', requirePermission('order.read', scope), async (req, res) => {
  const orderId = objectId.parse(req.params.orderId);
  const order = await Order.findOne({ _id: orderId, storeId: req.storeId }).populate('statusHistory.by', 'name').lean();
  if (!order) throw notFound('Order not found');
  const [shipment, payment, store] = await Promise.all([
    Shipment.findOne({ storeId: req.storeId, orderId }).lean(),
    Payment.findOne({ storeId: req.storeId, orderId }).select('gateway status amount mode txnRef').lean(),
    Store.findById(req.storeId).select('settings.couriers').lean(),
  ]);
  res.json({
    ...order,
    items: order.items.map((i) => ({ ...i, attributes: Object.fromEntries(Object.entries((i.attributes as unknown as Record<string, string>) ?? {})) })),
    shipment,
    payment,
    couriers: (store?.settings?.couriers ?? []).filter((c) => c.active),
    nextStatuses: NEXT[order.status] ?? [],
    canCancel: ['pending', 'processing'].includes(order.status),
    canCollectCod: order.paymentMethod === 'cod' && order.paymentStatus === 'unpaid' && ['delivered', 'completed'].includes(order.status),
  });
});

// ------------------------------------------------------------ move an order forward
const statusBody = z.object({
  status: z.enum(['processing', 'shipped', 'delivered', 'completed']),
  note: z.string().trim().max(300).optional(),
  courierCode: z.string().trim().max(40).optional(),
  trackingNumber: z.string().trim().max(80).optional(),
});

ordersRouter.post('/orders/:orderId/status', requirePermission('order.update', scope), async (req, res) => {
  const orderId = objectId.parse(req.params.orderId);
  const body = statusBody.parse(req.body);
  const order = await Order.findOne({ _id: orderId, storeId: req.storeId });
  if (!order) throw notFound('Order not found');
  if (order.paymentMethod !== 'cod' && order.paymentMethod !== 'external' && order.paymentStatus !== 'paid') {
    throw badRequest('This order is waiting for its online payment. Process it once the payment is confirmed.');
  }
  if (!(NEXT[order.status] ?? []).includes(body.status)) {
    throw badRequest(`An order that is ${order.status} cannot move to ${body.status}.`);
  }

  // The move is applied only if the order is still in the status we read, so two staff members
  // clicking at once cannot both succeed.
  const claimed = await Order.updateOne(
    { _id: order._id, storeId: req.storeId, status: order.status },
    { $set: { status: body.status }, $push: { statusHistory: { status: body.status, at: new Date(), by: req.auth!.userId, note: body.note } } },
  );
  if (claimed.modifiedCount !== 1) throw conflict('Someone else just changed this order. Reload and try again.');

  if (body.status === 'shipped' && order.hasPhysical) {
    await Shipment.findOneAndUpdate(
      { storeId: req.storeId, orderId: order._id },
      {
        $set: {
          courierCode: body.courierCode || order.courierCode || 'leopard',
          trackingNumber: body.trackingNumber || undefined,
          status: 'shipped',
          shippedAt: new Date(),
          codAmount: order.paymentMethod === 'cod' && order.paymentStatus === 'unpaid' ? (order.totals?.total ?? 0) : 0,
        },
      },
      { upsert: true },
    );
  }
  if (body.status === 'delivered') {
    await Shipment.updateOne({ storeId: req.storeId, orderId: order._id }, { $set: { status: 'delivered', deliveredAt: new Date() } });
  }
  await audit(req, { action: 'order.status', entity: 'order', entityId: order._id, before: { status: order.status }, after: { status: body.status, number: order.number } });
  res.json({ ok: true, status: body.status });
});

// ------------------------------------------------------------ cancel (puts the stock back)
ordersRouter.post('/orders/:orderId/cancel', requirePermission('order.cancel', scope), async (req, res) => {
  const orderId = objectId.parse(req.params.orderId);
  const { note } = z.object({ note: z.string().trim().max(300).optional() }).parse(req.body ?? {});
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const claimed = await Order.findOneAndUpdate(
        { _id: orderId, storeId: req.storeId, status: { $in: ['pending', 'processing'] } },
        { $set: { status: 'cancelled' }, $push: { statusHistory: { status: 'cancelled', at: new Date(), by: req.auth!.userId, note: note || 'Cancelled by staff' } } },
        { session, returnDocument: 'before' },
      );
      if (!claimed) {
        const exists = await Order.exists({ _id: orderId, storeId: req.storeId }).session(session);
        if (!exists) throw notFound('Order not found');
        throw badRequest('Only orders that are pending or processing can be cancelled.');
      }
      for (const item of claimed.items) {
        if (item.type !== 'physical') continue;
        const updated = await Product.findOneAndUpdate(
          { _id: item.productId, storeId: req.storeId, 'variants.sku': item.sku },
          { $inc: { 'variants.$.stock': item.quantity } },
          { session, returnDocument: 'after' },
        );
        const balance = updated?.variants.find((v) => v.sku === item.sku)?.stock ?? 0;
        await StockMovement.create([{ storeId: req.storeId, productId: item.productId, sku: item.sku, delta: item.quantity, balanceAfter: balance, reason: 'return', note: `Order #${claimed.number} cancelled`, userId: req.auth!.userId }], { session });
      }
      await Payment.updateOne({ storeId: req.storeId, orderId, status: 'initiated' }, { $set: { status: 'cancelled' } }, { session });
      await audit(req, { action: 'order.cancel', entity: 'order', entityId: orderId, after: { number: claimed.number } });
    });
  } finally {
    await session.endSession();
  }
  res.json({ ok: true });
});

// ------------------------------------------------------------ cash collected by the courier
ordersRouter.post('/orders/:orderId/cod-collected', requirePermission('order.update', scope), async (req, res) => {
  const orderId = objectId.parse(req.params.orderId);
  const claimed = await Order.findOneAndUpdate(
    { _id: orderId, storeId: req.storeId, paymentMethod: 'cod', paymentStatus: 'unpaid', status: { $in: ['delivered', 'completed'] } },
    { $set: { paymentStatus: 'paid' }, $push: { statusHistory: { status: 'paid', at: new Date(), by: req.auth!.userId, note: 'Cash on delivery collected' } } },
    { returnDocument: 'after' },
  );
  if (!claimed) throw badRequest('Cash can be recorded only for a delivered Cash on Delivery order that is still unpaid.');
  await Payment.updateOne({ storeId: req.storeId, orderId }, { $set: { status: 'succeeded' } });
  await Shipment.updateOne({ storeId: req.storeId, orderId }, { $set: { codCollected: true } });
  await audit(req, { action: 'order.cod_collected', entity: 'order', entityId: orderId, after: { number: claimed.number, amount: claimed.totals?.total } });
  res.json({ ok: true });
});

// Sales charts for one store (people who can view reports)
ordersRouter.get('/analytics', requirePermission('report.view', scope), async (req, res) => {
  const { days } = z.object({ days: z.coerce.number().int().refine((n) => [7, 30, 90].includes(n), 'Use 7, 30 or 90').default(30) }).parse(req.query);
  res.json(await salesAnalytics({ storeId: req.storeId }, days, false));
});
