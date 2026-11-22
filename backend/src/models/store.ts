import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseOptions, hideOnJSON, paisa } from './_shared';

const courierSchema = new Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true },
    trackingUrlTemplate: String, // e.g. https://example.com/track/{trackingNumber}
    active: { type: Boolean, default: true },
  },
  { _id: false },
);

const shippingZoneSchema = new Schema(
  {
    name: { type: String, required: true },
    cities: [String],
    provinces: [String],
    rates: [
      {
        _id: false,
        courierCode: String,
        name: String,
        flat: paisa,
        freeAbove: { type: Number, min: 0 },
      },
    ],
  },
  { _id: false },
);

const taxRuleSchema = new Schema(
  { name: String, ratePercent: { type: Number, min: 0, max: 100 }, inclusive: { type: Boolean, default: false } },
  { _id: false },
);

const storeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // kababjess in kababjess.ecommerce.com (SRS 3.2)
    subdomain: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/,
      validate: {
        validator: (v: string) => !['www', 'admin', 'api', 'app', 'mail', 'static', 'cdn'].includes(v),
        message: '{VALUE} is a reserved subdomain',
      },
    },
    customDomain: { type: String, lowercase: true, trim: true, sparse: true, unique: true },
    logoUrl: String,
    status: { type: String, enum: ['active', 'suspended', 'archived'], default: 'active', index: true },
    type: { type: String, enum: ['native', 'external'], default: 'native', required: true },
    platform: { type: String, enum: ['native', 'woocommerce', 'shopify', 'generic_rest'], default: 'native' },
    currency: { type: String, default: 'PKR' },

    settings: {
      returnWindowDays: { type: Number, default: 7 },
      lowStockThreshold: { type: Number, default: 5 },
      cod: {
        enabled: { type: Boolean, default: true },
        maxOrderAmount: { type: Number, min: 0 }, // paisa
      },
      downloadDefaults: {
        expiryDays: { type: Number, default: 7 },
        downloadLimit: { type: Number, default: 5 },
      },
      // Standard delivery: a flat fee, free above a basket total (both paisa). Zones and live courier rates come later.
      shipping: {
        flatRate: paisa,
        freeAbove: { type: Number, min: 0 },
      },
      stockReservationMinutes: { type: Number, default: 15 },
      // Leopard is the default courier; the list is editable by admins (FR-AD-008).
      couriers: {
        type: [courierSchema],
        default: () => [
          {
            name: 'Leopard Courier',
            code: 'leopard',
            trackingUrlTemplate: '',
            active: true,
          },
        ],
      },
      shippingZones: [shippingZoneSchema],
      taxRules: [taxRuleSchema],
      // storefront look: set by the store owner in Admin > Appearance
      theme: {
        accentColor: { type: String, match: /^#[0-9a-fA-F]{6}$/ },
        tagline: { type: String, maxlength: 120 },
        bannerUrl: String,
      },
    },

    // External stores only (SRS section 10). Encrypted with AES-256-GCM, see utils/crypto.ts.
    apiCredentials: { type: String, select: false },
    syncSettings: {
      enabled: { type: Boolean, default: false },
      intervalMinutes: { type: Number, default: 30 },
      paused: { type: Boolean, default: false },
      dataTypes: { type: [String], default: ['products', 'categories', 'customers', 'orders'] },
    },
    lastSyncAt: Date,
  },
  baseOptions,
);
hideOnJSON(storeSchema, 'apiCredentials');

storeSchema.index({ status: 1, type: 1 });

export type StoreDoc = InferSchemaType<typeof storeSchema>;
export const Store = model('Store', storeSchema);
