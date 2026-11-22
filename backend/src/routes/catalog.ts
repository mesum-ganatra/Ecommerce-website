import { Router } from 'express';
import multer from 'multer';
import { isValidObjectId, type Model, type Types } from 'mongoose';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth';
import { Category, Product, StockMovement, Store } from '../models';
import { audit } from '../services/audit';
import {
  MAX_DIGITAL_BYTES,
  MAX_IMAGE_BYTES,
  deleteImage,
  deletePrivate,
  isAllowedImage,
  isPrivateKey,
  presignPrivateUpload,
  privateObjectSize,
  saveImage,
  savePrivate,
  usesObjectStorage,
} from '../services/storage';
import { AppError, badRequest, conflict, notFound } from '../utils/errors';

// Mounted at /api/v1/stores/:storeId (see app.ts). Every route is scoped to that store
// through requirePermission, and every query filters by req.storeId.
export const catalogRouter = Router({ mergeParams: true });
const scope = { storeParam: 'storeId' };

const objectId = z.string().refine(isValidObjectId, 'Not a valid id');
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';

/** name -> name, name-2, name-3 ... unique inside the store */
async function uniqueSlug(model: Model<any>, storeId: Types.ObjectId, base: string, excludeId?: unknown) {
  let slug = base;
  for (let i = 2; i < 200; i++) {
    const clash = await model.exists({ storeId, slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
    if (!clash) return slug;
    slug = `${base}-${i}`;
  }
  throw conflict('Could not find a free slug');
}

const upload = (maxBytes: number) => multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1 } });

// ============================================================ categories
const categoryBody = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80).optional(),
  parentId: objectId.nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  active: z.boolean().optional(),
  imageUrl: z.string().url().or(z.literal('')).optional(),
});

async function assertValidParent(storeId: Types.ObjectId, parentId: string | null | undefined, selfId?: string) {
  if (!parentId) return;
  if (selfId && parentId === selfId) throw badRequest('A category cannot be its own parent');
  const parent = await Category.findOne({ _id: parentId, storeId }).select('parentId');
  if (!parent) throw badRequest('Parent category not found in this store');
  // walk up to make sure we do not create a loop
  let cursor = parent.parentId ? String(parent.parentId) : null;
  for (let depth = 0; cursor && depth < 20; depth++) {
    if (selfId && cursor === selfId) throw badRequest('That would make the category its own ancestor');
    const next = await Category.findOne({ _id: cursor, storeId }).select('parentId');
    cursor = next?.parentId ? String(next.parentId) : null;
  }
}

catalogRouter.get('/categories', requirePermission('product.read', scope), async (req, res) => {
  const [items, counts] = await Promise.all([
    Category.find({ storeId: req.storeId }).sort({ sortOrder: 1, name: 1 }).lean(),
    Product.aggregate([
      { $match: { storeId: req.storeId, status: { $ne: 'archived' } } },
      { $group: { _id: '$categoryId', n: { $sum: 1 } } },
    ]),
  ]);
  const byCat = new Map(counts.map((c) => [String(c._id), c.n as number]));
  res.json({ items: items.map((c) => ({ ...c, productCount: byCat.get(String(c._id)) ?? 0 })) });
});

catalogRouter.post('/categories', requirePermission('product.write', scope), async (req, res) => {
  const body = categoryBody.parse(req.body);
  await assertValidParent(req.storeId!, body.parentId);
  const slug = await uniqueSlug(Category, req.storeId!, body.slug ?? slugify(body.name));
  const doc = await Category.create({ ...body, slug, storeId: req.storeId });
  await audit(req, { action: 'category.create', entity: 'category', entityId: doc._id, after: { name: doc.name } });
  res.status(201).json(doc);
});

catalogRouter.patch('/categories/:categoryId', requirePermission('product.write', scope), async (req, res) => {
  const categoryId = objectId.parse(req.params.categoryId);
  const body = categoryBody.partial().strict().parse(req.body);
  await assertValidParent(req.storeId!, body.parentId, categoryId);
  if (body.slug && (await Category.exists({ storeId: req.storeId, slug: body.slug, _id: { $ne: categoryId } }))) {
    throw conflict('That slug is already used by another category');
  }
  const doc = await Category.findOneAndUpdate({ _id: categoryId, storeId: req.storeId }, { $set: body }, { returnDocument: 'after', runValidators: true });
  if (!doc) throw notFound('Category not found');
  await audit(req, { action: 'category.update', entity: 'category', entityId: doc._id, after: body });
  res.json(doc);
});

catalogRouter.delete('/categories/:categoryId', requirePermission('product.write', scope), async (req, res) => {
  const categoryId = objectId.parse(req.params.categoryId);
  const [children, products] = await Promise.all([
    Category.countDocuments({ storeId: req.storeId, parentId: categoryId }),
    Product.countDocuments({ storeId: req.storeId, categoryId }),
  ]);
  if (children) throw conflict('Move or delete the sub-categories first');
  if (products) throw conflict(`${products} product(s) use this category. Move them first.`);
  const doc = await Category.findOneAndDelete({ _id: categoryId, storeId: req.storeId });
  if (!doc) throw notFound('Category not found');
  await audit(req, { action: 'category.delete', entity: 'category', entityId: doc._id, before: { name: doc.name } });
  res.json({ ok: true });
});

// ============================================================ products
const variantBody = z.object({
  sku: z.string().trim().min(1).max(64),
  attributes: z.record(z.string().min(1).max(40), z.string().max(80)).default({}),
  price: z.number().int().min(0).max(100_000_000_00), // paisa
  compareAtPrice: z.number().int().min(0).optional(),
  stock: z.number().int().min(0).max(1_000_000).default(0),
  barcode: z.string().max(64).optional(),
  weightGrams: z.number().min(0).optional(),
  active: z.boolean().default(true),
});

const imageUrl = z.string().refine((u) => /^\/media\/[a-zA-Z0-9_-]+\/[a-f0-9]+\.[a-z]+$/.test(u) || /^https:\/\//.test(u), 'Use an https link or an uploaded image');
const imageBody = z.object({ url: imageUrl, alt: z.string().max(160).optional() });

const productFields = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(100),
  description: z.string().max(20000),
  brand: z.string().trim().max(80),
  categoryId: objectId.nullable(),
  status: z.enum(['draft', 'active', 'archived']),
  variants: z.array(variantBody).min(1).max(100),
  images: z.array(imageBody).max(10),
  allowBackorder: z.boolean(),
  download: z.object({ expiryDays: z.number().int().min(1).max(3650).optional(), downloadLimit: z.number().int().min(1).max(1000).optional() }),
  seo: z.object({ title: z.string().max(120).optional(), description: z.string().max(320).optional() }),
});

const createBody = productFields
  .partial({ slug: true, description: true, brand: true, categoryId: true, status: true, images: true, allowBackorder: true, download: true, seo: true })
  .extend({ type: z.enum(['physical', 'digital']).default('physical') });
const updateBody = productFields.partial().strict();

const noDuplicateSkus = (variants?: { sku: string }[]) => {
  if (!variants) return;
  const skus = variants.map((v) => v.sku.toLowerCase());
  if (new Set(skus).size !== skus.length) throw badRequest('Each variant needs a different SKU');
};

async function assertCategory(storeId: Types.ObjectId, categoryId?: string | null) {
  if (categoryId && !(await Category.exists({ _id: categoryId, storeId }))) throw badRequest('Category not found in this store');
}

function summarize(p: any, threshold: number) {
  const active = (p.variants ?? []).filter((v: any) => v.active);
  const prices: number[] = active.map((v: any) => v.price);
  const stock = (p.variants ?? []).reduce((n: number, v: any) => n + (v.stock ?? 0), 0);
  return {
    _id: p._id,
    name: p.name,
    slug: p.slug,
    type: p.type,
    status: p.status,
    brand: p.brand,
    category: p.categoryId && typeof p.categoryId === 'object' ? { _id: p.categoryId._id, name: p.categoryId.name } : null,
    image: p.images?.[0]?.url ?? null,
    variantCount: p.variants?.length ?? 0,
    priceMin: prices.length ? Math.min(...prices) : 0,
    priceMax: prices.length ? Math.max(...prices) : 0,
    stock: p.type === 'physical' ? stock : null,
    lowStock: p.type === 'physical' && (p.variants ?? []).some((v: any) => v.active && v.stock <= threshold),
    source: p.source,
    updatedAt: p.updatedAt,
  };
}

catalogRouter.get('/products', requirePermission('product.read', scope), async (req, res) => {
  const q = z
    .object({
      search: z.string().trim().max(100).optional(),
      status: z.enum(['draft', 'active', 'archived']).optional(),
      type: z.enum(['physical', 'digital']).optional(),
      categoryId: objectId.optional(),
      lowStock: z.enum(['1']).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .parse(req.query);

  const store = await Store.findById(req.storeId).select('settings.lowStockThreshold');
  const threshold = store?.settings?.lowStockThreshold ?? 5;

  const filter: Record<string, unknown> = { storeId: req.storeId };
  filter.status = q.status ?? { $ne: 'archived' };
  if (q.type) filter.type = q.type;
  if (q.categoryId) filter.categoryId = q.categoryId;
  if (q.lowStock) {
    filter.type = 'physical';
    filter.variants = { $elemMatch: { active: true, stock: { $lte: threshold } } };
  }
  if (q.search) {
    const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { 'variants.sku': rx }, { brand: rx }];
  }

  const [items, total] = await Promise.all([
    Product.find(filter)
      .select('name slug type status brand categoryId images variants.price variants.stock variants.active source updatedAt')
      .populate('categoryId', 'name')
      .sort({ updatedAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Product.countDocuments(filter),
  ]);
  res.json({ items: items.map((p) => summarize(p, threshold)), total, page: q.page, limit: q.limit });
});

catalogRouter.get('/products/:productId', requirePermission('product.read', scope), async (req, res) => {
  const productId = objectId.parse(req.params.productId);
  const p = await Product.findOne({ _id: productId, storeId: req.storeId }).lean();
  if (!p) throw notFound('Product not found');
  // never expose private storage keys to the browser
  res.json({ ...p, digitalFiles: (p.digitalFiles ?? []).map((f: any) => ({ _id: f._id, name: f.name, sizeBytes: f.sizeBytes, version: f.version })) });
});

catalogRouter.post('/products', requirePermission('product.write', scope), async (req, res) => {
  const body = createBody.parse(req.body);
  noDuplicateSkus(body.variants);
  await assertCategory(req.storeId!, body.categoryId);
  if (body.status === 'active' && body.type === 'digital') throw badRequest('Upload a file before making a digital product active');

  const slug = body.slug
    ? (await Product.exists({ storeId: req.storeId, slug: body.slug })) ? (() => { throw conflict('That slug is already used'); })() : body.slug
    : await uniqueSlug(Product, req.storeId!, slugify(body.name));

  const variants = body.variants.map((v) => ({ ...v, stock: body.type === 'digital' ? 0 : v.stock }));
  const doc = await Product.create({ ...body, slug, variants, categoryId: body.categoryId ?? undefined, storeId: req.storeId });

  if (doc.type === 'physical') {
    const initial = doc.variants.filter((v) => (v.stock ?? 0) > 0).map((v) => ({
      storeId: req.storeId, productId: doc._id, sku: v.sku, delta: v.stock, balanceAfter: v.stock, reason: 'initial', userId: req.auth!.userId,
    }));
    if (initial.length) await StockMovement.insertMany(initial);
  }
  await audit(req, { action: 'product.create', entity: 'product', entityId: doc._id, after: { name: doc.name, type: doc.type } });
  res.status(201).json(doc);
});

catalogRouter.patch('/products/:productId', requirePermission('product.write', scope), async (req, res) => {
  const productId = objectId.parse(req.params.productId);
  const body = updateBody.parse(req.body);
  noDuplicateSkus(body.variants);
  await assertCategory(req.storeId!, body.categoryId);

  const p = await Product.findOne({ _id: productId, storeId: req.storeId });
  if (!p) throw notFound('Product not found');

  if (body.slug && body.slug !== p.slug && (await Product.exists({ storeId: req.storeId, slug: body.slug, _id: { $ne: p._id } }))) {
    throw conflict('That slug is already used');
  }

  if (body.variants) {
    // Stock is changed only through the stock endpoint (so it has a history). Existing variants keep
    // their stock and reservations; a brand-new SKU may start with the stock given.
    const bySku = new Map(p.variants.map((v) => [v.sku.toLowerCase(), v]));
    const created: { sku: string; stock: number }[] = [];
    const merged = body.variants.map((v) => {
      const old = bySku.get(v.sku.toLowerCase());
      if (old) return { ...v, _id: old._id, stock: old.stock, reservedStock: old.reservedStock };
      if (p.type === 'physical' && v.stock > 0) created.push({ sku: v.sku, stock: v.stock });
      return { ...v, stock: p.type === 'digital' ? 0 : v.stock };
    });
    const removed = p.variants.filter((v) => !merged.some((m) => m.sku.toLowerCase() === v.sku.toLowerCase()));
    if (removed.some((v) => (v.reservedStock ?? 0) > 0)) throw conflict('A variant with reserved stock cannot be removed right now');
    p.set('variants', merged);
    if (created.length) {
      await StockMovement.insertMany(created.map((c) => ({ storeId: req.storeId, productId: p._id, sku: c.sku, delta: c.stock, balanceAfter: c.stock, reason: 'initial', userId: req.auth!.userId })));
    }
  }

  if (body.images) {
    const keep = new Set(body.images.map((i) => i.url));
    const dropped = p.images.map((i) => i.url).filter((u): u is string => !!u && !keep.has(u));
    p.set('images', body.images.map((img, i) => ({ ...img, sortOrder: i })));
    await Promise.all(dropped.map(deleteImage));
  }

  for (const k of ['name', 'slug', 'description', 'brand', 'status', 'allowBackorder', 'download', 'seo'] as const) {
    if (body[k] !== undefined) p.set(k, body[k]);
  }
  if (body.categoryId !== undefined) p.set('categoryId', body.categoryId ?? undefined);

  if (p.type === 'digital' && p.status === 'active' && p.digitalFiles.length === 0) {
    throw badRequest('Upload a file before making a digital product active');
  }
  await p.save();
  await audit(req, { action: 'product.update', entity: 'product', entityId: p._id, after: { fields: Object.keys(body) } });
  res.json(p);
});

// soft delete: orders keep their price snapshot, and the product can be restored by setting it to draft
catalogRouter.delete('/products/:productId', requirePermission('product.write', scope), async (req, res) => {
  const productId = objectId.parse(req.params.productId);
  const p = await Product.findOneAndUpdate({ _id: productId, storeId: req.storeId }, { $set: { status: 'archived' } }, { returnDocument: 'after' });
  if (!p) throw notFound('Product not found');
  await audit(req, { action: 'product.archive', entity: 'product', entityId: p._id });
  res.json({ ok: true });
});

// ------------------------------------------------------------ images
catalogRouter.post('/products/:productId/images', requirePermission('product.write', scope), upload(MAX_IMAGE_BYTES).single('image'), async (req, res) => {
  const productId = objectId.parse(req.params.productId);
  const file = req.file;
  if (!file) throw badRequest('Choose an image to upload');
  if (!isAllowedImage(file.mimetype, file.buffer)) throw badRequest('Only JPEG, PNG or WebP images are allowed');
  const p = await Product.findOne({ _id: productId, storeId: req.storeId }).select('images');
  if (!p) throw notFound('Product not found');
  if (p.images.length >= 10) throw badRequest('A product can have up to 10 images');

  const url = await saveImage(String(req.storeId), file.mimetype, file.buffer);
  p.images.push({ url, alt: '', sortOrder: p.images.length });
  await p.save();
  res.status(201).json({ url, images: p.images });
});

// ------------------------------------------------------------ digital files (private storage)
catalogRouter.post('/products/:productId/files', requirePermission('product.write', scope), upload(MAX_DIGITAL_BYTES).single('file'), async (req, res) => {
  const productId = objectId.parse(req.params.productId);
  const file = req.file;
  if (!file) throw badRequest('Choose a file to upload');
  const p = await Product.findOne({ _id: productId, storeId: req.storeId }).select('type digitalFiles');
  if (!p) throw notFound('Product not found');
  if (p.type !== 'digital') throw badRequest('Files can only be added to digital products');
  if (p.digitalFiles.length >= 10) throw badRequest('A product can have up to 10 files');

  const storageKey = await savePrivate(String(req.storeId), file.buffer);
  // browsers send the name as latin1; keep it printable
  const name = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[\\/\0]/g, '_').slice(0, 180);
  p.digitalFiles.push({ name, storageKey, sizeBytes: file.size });
  await p.save();
  const added = p.digitalFiles[p.digitalFiles.length - 1];
  await audit(req, { action: 'product.file.add', entity: 'product', entityId: p._id, after: { name } });
  res.status(201).json({ _id: added._id, name, sizeBytes: file.size });
});

catalogRouter.delete('/products/:productId/files/:fileId', requirePermission('product.write', scope), async (req, res) => {
  const productId = objectId.parse(req.params.productId);
  const fileId = objectId.parse(req.params.fileId);
  const p = await Product.findOne({ _id: productId, storeId: req.storeId });
  if (!p) throw notFound('Product not found');
  const f = p.digitalFiles.id(fileId);
  if (!f) throw notFound('File not found');
  if (p.status === 'active' && p.digitalFiles.length === 1) throw badRequest('An active digital product needs at least one file. Set it to draft first.');
  const key = f.storageKey;
  f.deleteOne();
  await p.save();
  if (key) await deletePrivate(key);
  await audit(req, { action: 'product.file.remove', entity: 'product', entityId: p._id });
  res.json({ ok: true });
});

// Big digital files go straight from the browser to the private bucket (a serverless function cannot take
// more than about 4.5 MB per request). Step 1: ask for a signed upload link. Step 2: upload. Step 3: confirm.
catalogRouter.post('/products/:productId/files/presign', requirePermission('product.write', scope), async (req, res) => {
  if (!usesObjectStorage()) throw new AppError(501, 'direct_upload_unavailable', 'Direct uploads are not enabled here. Use the normal upload.');
  const productId = objectId.parse(req.params.productId);
  const body = z.object({ size: z.number().int().min(1), contentType: z.string().trim().max(100).default('application/octet-stream') }).parse(req.body);
  if (body.size > MAX_DIGITAL_BYTES) throw new AppError(413, 'file_too_large', `Files can be up to ${Math.round(MAX_DIGITAL_BYTES / 1024 / 1024)} MB.`);
  const p = await Product.findOne({ _id: productId, storeId: req.storeId }).select('type digitalFiles');
  if (!p) throw notFound('Product not found');
  if (p.type !== 'digital') throw badRequest('Files can only be added to digital products');
  if (p.digitalFiles.length >= 10) throw badRequest('A product can have up to 10 files');
  res.json(await presignPrivateUpload(String(req.storeId), body.contentType));
});

catalogRouter.post('/products/:productId/files/confirm', requirePermission('product.write', scope), async (req, res) => {
  const productId = objectId.parse(req.params.productId);
  const body = z.object({ key: z.string().max(100), name: z.string().trim().min(1).max(180) }).parse(req.body);
  // the key must be one of this store's own, so a store cannot attach another store's file
  if (!isPrivateKey(body.key) || !body.key.startsWith(`${String(req.storeId)}/`)) throw badRequest('Invalid upload');
  const p = await Product.findOne({ _id: productId, storeId: req.storeId }).select('type digitalFiles');
  if (!p) throw notFound('Product not found');
  if (p.type !== 'digital') throw badRequest('Files can only be added to digital products');
  if (p.digitalFiles.some((f) => f.storageKey === body.key)) throw conflict('That upload is already attached');
  const size = await privateObjectSize(body.key);
  if (size === null) throw badRequest('The upload was not found. Try again.');
  if (size > MAX_DIGITAL_BYTES) {
    await deletePrivate(body.key);
    throw new AppError(413, 'file_too_large', 'That file is too large.');
  }
  p.digitalFiles.push({ name: body.name.replace(/[\\/\0]/g, '_'), storageKey: body.key, sizeBytes: size });
  await p.save();
  const added = p.digitalFiles[p.digitalFiles.length - 1];
  await audit(req, { action: 'product.file.add', entity: 'product', entityId: p._id, after: { name: body.name } });
  res.status(201).json({ _id: added._id, name: added.name, sizeBytes: size });
});

// ------------------------------------------------------------ stock
const stockBody = z.object({
  sku: z.string().trim().min(1),
  delta: z.number().int().refine((n) => n !== 0, 'Change cannot be zero').refine((n) => Math.abs(n) <= 1_000_000),
  reason: z.enum(['restock', 'correction', 'damaged', 'return', 'other']),
  note: z.string().trim().max(300).optional(),
});

catalogRouter.post('/products/:productId/stock', requirePermission('stock.adjust', scope), async (req, res) => {
  const productId = objectId.parse(req.params.productId);
  const body = stockBody.parse(req.body);

  // One atomic update. For a decrease, the condition guarantees stock never goes below zero,
  // even if two staff members adjust at the same moment.
  const updated = await Product.findOneAndUpdate(
    {
      _id: productId,
      storeId: req.storeId,
      type: 'physical',
      variants: { $elemMatch: { sku: body.sku, ...(body.delta < 0 ? { stock: { $gte: -body.delta } } : {}) } },
    },
    { $inc: { 'variants.$.stock': body.delta } },
    { returnDocument: 'after' },
  );
  if (!updated) {
    const exists = await Product.findOne({ _id: productId, storeId: req.storeId }).select('type variants.sku');
    if (!exists) throw notFound('Product not found');
    if (exists.type !== 'physical') throw badRequest('Digital products have no stock');
    if (!exists.variants.some((v) => v.sku === body.sku)) throw notFound('SKU not found on this product');
    throw conflict('Not enough stock for that decrease');
  }
  const balance = updated.variants.find((v) => v.sku === body.sku)!.stock ?? 0;
  await StockMovement.create({
    storeId: req.storeId, productId, sku: body.sku, delta: body.delta, balanceAfter: balance, reason: body.reason, note: body.note, userId: req.auth!.userId,
  });
  await audit(req, { action: 'stock.adjust', entity: 'product', entityId: productId, after: { sku: body.sku, delta: body.delta, balance } });
  res.json({ sku: body.sku, stock: balance });
});

catalogRouter.get('/products/:productId/stock-movements', requirePermission('product.read', scope), async (req, res) => {
  const productId = objectId.parse(req.params.productId);
  const items = await StockMovement.find({ storeId: req.storeId, productId }).sort({ createdAt: -1 }).limit(50).populate('userId', 'name').lean();
  res.json({ items });
});
