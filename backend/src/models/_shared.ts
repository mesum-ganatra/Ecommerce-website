import { Schema } from 'mongoose';

/** Every business document belongs to exactly one store (SRS 3.2). */
export const storeRef = {
  type: Schema.Types.ObjectId,
  ref: 'Store',
  required: true,
  index: true,
} as const;

/** Money is stored as integer paisa (Rs 1 = 100 paisa) to avoid rounding errors. */
export const paisa = {
  type: Number,
  min: 0,
  default: 0,
  validate: { validator: Number.isInteger, message: '{PATH} must be a whole number of paisa' },
} as const;

export const baseOptions = { timestamps: true, versionKey: false } as const;

/** Never leak secrets when a document is serialised to JSON. */
export function hideOnJSON<S extends Schema>(schema: S, ...fields: string[]): S {
  schema.set('toJSON', {
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      for (const f of fields) delete ret[f];
      return ret;
    },
  });
  return schema;
}

export const addressSchema = new Schema(
  {
    label: String,
    fullName: String,
    phone: String,
    line1: { type: String, required: true },
    line2: String,
    city: { type: String, required: true },
    province: String,
    postalCode: String,
    country: { type: String, default: 'PK' },
  },
  { _id: false },
);

/** Set on documents copied from an external site by a connector (SRS section 10). */
export const sourceFields = {
  source: { type: String, enum: ['native', 'external'], default: 'native' },
  platform: String,
  externalId: String,
} as const;
