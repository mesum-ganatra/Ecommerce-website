import { Schema, model, type ClientSession } from 'mongoose';
import { addressSchema, baseOptions, hideOnJSON, paisa, sourceFields, storeRef } from './_shared';

// ---- customers (storefront accounts; separate from staff users, FR-AC-005) ----
const customerSchema = new Schema(
  {
    storeId: storeRef,
    name: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, select: false }, // absent for guest and synced customers
    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },
    addresses: [addressSchema],
    status: { type: String, enum: ['active', 'blocked'], default: 'active' },
    ...sourceFields,
  },
  baseOptions,
);
hideOnJSON(customerSchema, 'passwordHash');
// Compound unique indexes use a partial filter: a plain "sparse" compound index would still index
// documents that lack the field (storeId alone is present), so every native record would collide.
// the same person may be a customer of several stores
customerSchema.index({ storeId: 1, email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
customerSchema.index({ storeId: 1, phone: 1 });
customerSchema.index({ storeId: 1, externalId: 1 }, { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } });

// ---- carts ----
const cartSchema = new Schema(
  {
    storeId: storeRef,
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    guestToken: { type: String, index: true },
    items: [
      {
        _id: false,
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
        sku: { type: String, required: true },
        quantity: { type: Number, min: 1, required: true },
      },
    ],
    couponCode: String,
    // abandoned guest carts are removed automatically after 30 days
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 3600 * 1000) },
  },
  baseOptions,
);
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
cartSchema.index({ storeId: 1, customerId: 1 });

// ---- coupons ----
const couponSchema = new Schema(
  {
    storeId: storeRef,
    code: { type: String, required: true, uppercase: true, trim: true },
    type: { type: String, enum: ['percentage', 'fixed', 'free_shipping'], required: true },
    value: { type: Number, min: 0, default: 0 }, // percent, or paisa for fixed
    minOrderAmount: paisa,
    maxDiscount: { type: Number, min: 0 },
    productIds: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    categoryIds: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    usageLimit: Number,
    usedCount: { type: Number, default: 0 },
    validFrom: Date,
    validTo: Date,
    active: { type: Boolean, default: true },
  },
  baseOptions,
);
couponSchema.index({ storeId: 1, code: 1 }, { unique: true });

// ---- orders: items are a price snapshot, so later product edits never change past orders ----
const orderItemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  sku: { type: String, required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['physical', 'digital'], required: true },
  attributes: { type: Map, of: String },
  unitPrice: { ...paisa, required: true },
  quantity: { type: Number, min: 1, required: true },
  lineTotal: { ...paisa, required: true },
});

export const ORDER_STATUSES = [
  'pending', 'paid', 'processing', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded',
] as const;

const orderSchema = new Schema(
  {
    storeId: storeRef,
    number: { type: Number, required: true }, // sequential per store (see Counter)
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', index: true },
    guest: { name: String, email: String, phone: String },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending' },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'partially_refunded', 'refunded', 'failed'],
      default: 'unpaid',
    },
    paymentMethod: { type: String, enum: ['jazzcash', 'easypaisa', 'simulator', 'cod', 'external'] },
    // set when money may have been taken for an order that is no longer open (staff must look at it)
    needsAttention: { type: Boolean, default: false },
    items: { type: [orderItemSchema], validate: (v: unknown[]) => v.length > 0 },
    hasPhysical: { type: Boolean, default: false },
    hasDigital: { type: Boolean, default: false },
    shippingAddress: addressSchema,
    billingAddress: addressSchema,
    courierCode: String,
    totals: {
      subtotal: paisa,
      discount: paisa,
      shipping: paisa,
      tax: paisa,
      total: paisa,
    },
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon' },
    couponCode: String,
    note: String,
    statusHistory: [
      {
        _id: false,
        status: String,
        at: { type: Date, default: Date.now },
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        note: String,
      },
    ],
    // idempotency for checkout retries (SRS 11.2)
    idempotencyKey: String,
    ...sourceFields,
  },
  baseOptions,
);
orderSchema.index({ storeId: 1, number: 1 }, { unique: true });
orderSchema.index({ storeId: 1, status: 1, createdAt: -1 });
orderSchema.index({ storeId: 1, customerId: 1, createdAt: -1 });
orderSchema.index({ storeId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
orderSchema.index({ storeId: 1, externalId: 1 }, { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } });

// ---- payments (separate collection: they grow and are never deleted) ----
const paymentSchema = new Schema(
  {
    storeId: storeRef,
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    gateway: { type: String, enum: ['jazzcash', 'easypaisa', 'simulator', 'cod'], required: true },
    expiresAt: Date,
    mode: { type: String, enum: ['sandbox', 'live'], default: 'live' },
    txnRef: { type: String, required: true }, // our unique reference sent to the gateway
    gatewayTxnId: String,
    amount: { ...paisa, required: true },
    refundedAmount: paisa,
    status: {
      type: String,
      enum: ['initiated', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded'],
      default: 'initiated',
    },
    // callbacks are idempotent: remember which ones we already applied (FR-PY-004)
    processedCallbacks: [String],
    rawCallback: Schema.Types.Mixed,
    failureReason: String,
  },
  baseOptions,
);
paymentSchema.index({ storeId: 1, txnRef: 1 }, { unique: true });
paymentSchema.index({ status: 1, createdAt: 1 }); // job that settles payments stuck in "initiated"

// ---- shipments ----
const shipmentSchema = new Schema(
  {
    storeId: storeRef,
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    courierCode: { type: String, default: 'leopard' },
    trackingNumber: String,
    status: {
      type: String,
      enum: ['pending', 'shipped', 'in_transit', 'delivered', 'returned'],
      default: 'pending',
    },
    shippedAt: Date,
    deliveredAt: Date,
    codAmount: paisa,
    codCollected: { type: Boolean, default: false },
  },
  baseOptions,
);

// ---- download_access: one entitlement per purchased digital file (FR-PR-004) ----
const downloadAccessSchema = new Schema(
  {
    storeId: storeRef,
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    fileId: { type: Schema.Types.ObjectId, required: true },
    expiresAt: { type: Date, required: true },
    downloadLimit: { type: Number, required: true },
    downloadCount: { type: Number, default: 0 },
    log: [{ _id: false, at: Date, ip: String }],
  },
  baseOptions,
);
downloadAccessSchema.index({ storeId: 1, customerId: 1 });

// ---- counters: atomic sequence per store (order numbers) ----
const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });

export const Customer = model('Customer', customerSchema);
export const Cart = model('Cart', cartSchema);
export const Coupon = model('Coupon', couponSchema);
export const Order = model('Order', orderSchema);
export const Payment = model('Payment', paymentSchema);
export const Shipment = model('Shipment', shipmentSchema);
export const DownloadAccess = model('DownloadAccess', downloadAccessSchema, 'download_access');
export const Counter = model('Counter', counterSchema);

/** Next order number for a store, safe under concurrent checkouts. */
export async function nextOrderNumber(storeId: string, session?: ClientSession): Promise<number> {
  const c = await Counter.findOneAndUpdate(
    { _id: `order:${storeId}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', session },
  );
  return c!.seq;
}
