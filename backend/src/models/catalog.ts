import { Schema, model } from 'mongoose';
import { baseOptions, paisa, sourceFields, storeRef } from './_shared';

// ---- categories ----
const categorySchema = new Schema(
  {
    storeId: storeRef,
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    imageUrl: String,
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    ...sourceFields,
  },
  baseOptions,
);
categorySchema.index({ storeId: 1, slug: 1 }, { unique: true });
categorySchema.index({ storeId: 1, externalId: 1 }, { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } });

// ---- products (variants, images and digital files are embedded: always read with the product) ----
const variantSchema = new Schema({
  sku: { type: String, required: true },
  attributes: { type: Map, of: String, default: {} }, // { size: 'L', color: 'Red' }
  price: { ...paisa, required: true },
  compareAtPrice: { type: Number, min: 0 },
  stock: { type: Number, default: 0, min: 0 }, // physical only; ignored for digital
  reservedStock: { type: Number, default: 0, min: 0 },
  barcode: String,
  weightGrams: Number,
  active: { type: Boolean, default: true },
});

const digitalFileSchema = new Schema({
  name: { type: String, required: true },
  storageKey: { type: String, required: true }, // key in the PRIVATE bucket, never a public URL
  sizeBytes: Number,
  version: String,
});

const productSchema = new Schema(
  {
    storeId: storeRef,
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', index: true },
    type: { type: String, enum: ['physical', 'digital'], required: true, default: 'physical' },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    description: String,
    brand: String,
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft', index: true },
    images: [{ _id: false, url: String, alt: String, sortOrder: Number }],
    variants: {
      type: [variantSchema],
      validate: { validator: (v: unknown[]) => v.length > 0, message: 'A product needs at least one variant' },
    },
    digitalFiles: [digitalFileSchema],
    // per-product overrides of the store's download defaults
    download: { expiryDays: Number, downloadLimit: Number },
    allowBackorder: { type: Boolean, default: false },
    seo: { title: String, description: String },
    ratingAverage: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    ...sourceFields,
  },
  baseOptions,
);
productSchema.index({ storeId: 1, slug: 1 }, { unique: true });
productSchema.index({ storeId: 1, externalId: 1 }, { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } });
productSchema.index({ storeId: 1, status: 1, categoryId: 1 });
// a SKU identifies one variant in the whole store
productSchema.index({ storeId: 1, 'variants.sku': 1 }, { unique: true });
// storeId prefix keeps text search inside one store (searches must always include storeId)
productSchema.index({ storeId: 1, name: 'text', description: 'text', brand: 'text' });

// ---- reviews ----
const reviewSchema = new Schema(
  {
    storeId: storeRef,
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    body: String,
    status: { type: String, enum: ['pending', 'published', 'hidden'], default: 'pending' },
    reply: String,
  },
  baseOptions,
);
reviewSchema.index({ storeId: 1, productId: 1, status: 1 });
reviewSchema.index({ productId: 1, customerId: 1 }, { unique: true }); // one review per buyer per product

// ---- stock_movements: history of every manual stock change (FR-AD-003) ----
const stockMovementSchema = new Schema(
  {
    storeId: storeRef,
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true },
    delta: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    reason: { type: String, enum: ['initial', 'restock', 'correction', 'damaged', 'return', 'sale', 'other'], required: true },
    note: String,
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
stockMovementSchema.index({ storeId: 1, productId: 1, createdAt: -1 });

export const Category = model('Category', categorySchema);
export const StockMovement = model('StockMovement', stockMovementSchema, 'stock_movements');
export const Product = model('Product', productSchema);
export const Review = model('Review', reviewSchema);
