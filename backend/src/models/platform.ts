import { Schema, model } from 'mongoose';
import { baseOptions, hideOnJSON, storeRef } from './_shared';

// ---- payment_configs: each store holds its OWN gateway credentials (SRS section 7) ----
const paymentConfigSchema = new Schema(
  {
    storeId: storeRef,
    gateway: { type: String, enum: ['jazzcash', 'easypaisa', 'simulator'], required: true },
    mode: { type: String, enum: ['sandbox', 'live'], default: 'sandbox' },
    enabled: { type: Boolean, default: false },
    // JSON of merchant id, password, integrity salt / store key... encrypted with AES-256-GCM.
    // Never returned by the API in full; the UI shows only `maskedHint`.
    credentials: { type: String, required: true, select: false },
    maskedHint: String, // e.g. "merchant ****1234"
    lastTestedAt: Date,
    lastTestOk: Boolean,
  },
  baseOptions,
);
hideOnJSON(paymentConfigSchema, 'credentials');
paymentConfigSchema.index({ storeId: 1, gateway: 1 }, { unique: true });

// ---- sync_logs: one row per connector run (FR-SY-004) ----
const syncLogSchema = new Schema(
  {
    storeId: storeRef,
    dataType: { type: String, enum: ['products', 'categories', 'customers', 'orders', 'stock', 'order_status'], required: true },
    direction: { type: String, enum: ['pull', 'push', 'webhook'], required: true },
    status: { type: String, enum: ['running', 'success', 'partial', 'failed'], default: 'running' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    counts: {
      created: { type: Number, default: 0 },
      updated: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    // not called "errors": that name is reserved by Mongoose
    failures: [{ _id: false, externalId: String, message: String }],
  },
  baseOptions,
);
syncLogSchema.index({ storeId: 1, startedAt: -1 });

// ---- audit_logs: append-only record of sensitive actions (NFR-011) ----
const auditLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', index: true }, // null for platform-level actions
    action: { type: String, required: true }, // e.g. order.refund, role.update, store.switch
    entity: String,
    entityId: String,
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    ip: String,
    userAgent: String,
    viaStoreSwitch: { type: Boolean, default: false }, // Super Admin acting inside a store (FR-AC-006)
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
auditLogSchema.index({ storeId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

// ---- rate_limits: shared counters for sign-in / checkout limits (see utils/rate-limit-store.ts)
const rateLimitSchema = new Schema({ _id: String, count: Number, resetAt: Date }, { versionKey: false });
rateLimitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 }); // removed automatically when the window ends

export const RateLimit = model('RateLimit', rateLimitSchema, 'rate_limits');
export const PaymentConfig = model('PaymentConfig', paymentConfigSchema, 'payment_configs');
export const SyncLog = model('SyncLog', syncLogSchema, 'sync_logs');
export const AuditLog = model('AuditLog', auditLogSchema, 'audit_logs');
