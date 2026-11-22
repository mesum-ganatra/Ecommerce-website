import { Router } from 'express';
import multer from 'multer';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { authenticate, requirePermission } from '../middleware/auth';
import { ApiKey, Store, StaffMembership } from '../models';
import { audit } from '../services/audit';
import { randomToken, sha256 } from '../utils/crypto';
import { MAX_IMAGE_BYTES, deleteImage, isAllowedImage, saveImage } from '../services/storage';
import { badRequest, notFound } from '../utils/errors';

const mediaOrUrl = z.string().refine((u) => u === '' || /^\/media\/[a-zA-Z0-9_-]+\/[a-f0-9]+\.[a-z]+$/.test(u) || /^https:\/\//.test(u), 'Use an https link or an uploaded image');
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #4f46e5');

export const storesRouter = Router();
storesRouter.use(authenticate);

const subdomain = z
  .string()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, 'Use lowercase letters, digits and hyphens only');

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  subdomain,
  type: z.enum(['native', 'external']).default('native'),
  platform: z.enum(['native', 'woocommerce', 'shopify', 'generic_rest']).optional(),
  currency: z.string().length(3).toUpperCase().default('PKR'),
});

const courierSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  trackingUrlTemplate: z.string().optional(),
  active: z.boolean().default(true),
});

// Fields a Store Admin may change (the subdomain and status are platform-level)
const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    logoUrl: mediaOrUrl,
    settings: z
      .object({
        returnWindowDays: z.number().int().min(0).max(365),
        lowStockThreshold: z.number().int().min(0),
        cod: z.object({ enabled: z.boolean(), maxOrderAmount: z.number().int().min(0).optional() }).partial(),
        couriers: z.array(courierSchema).min(1),
        theme: z.object({ accentColor: hexColor, tagline: z.string().trim().max(120), bannerUrl: mediaOrUrl }).partial(),
        shipping: z.object({ flatRate: z.number().int().min(0), freeAbove: z.number().int().min(0).optional() }).partial(),
      })
      .partial(),
  })
  .partial()
  .strict();

// ---- list: Super Admin sees all stores, staff only theirs ----
storesRouter.get('/', async (req, res) => {
  const q = z
    .object({
      search: z.string().trim().optional(),
      status: z.enum(['active', 'suspended', 'archived']).optional(),
      type: z.enum(['native', 'external']).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .parse(req.query);

  const filter: Record<string, unknown> = {};
  if (!req.auth!.isSuperAdmin) {
    const ids = await StaffMembership.find({ userId: req.auth!.userId, status: 'active' }).distinct('storeId');
    filter._id = { $in: ids };
  }
  if (q.status) filter.status = q.status;
  else if (req.auth!.isSuperAdmin) filter.status = { $ne: 'archived' };
  if (q.type) filter.type = q.type;
  if (q.search) {
    const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { subdomain: rx }];
  }

  const [items, total] = await Promise.all([
    Store.find(filter)
      .select('name subdomain status type platform currency lastSyncAt createdAt')
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit),
    Store.countDocuments(filter),
  ]);
  res.json({ items, total, page: q.page, limit: q.limit });
});

// ---- create (Super Admin) ----
storesRouter.post('/', requirePermission('store.create'), async (req, res) => {
  const body = createSchema.parse(req.body);
  const store = await Store.create({
    ...body,
    platform: body.platform ?? (body.type === 'native' ? 'native' : 'generic_rest'),
  });
  await audit(req, { action: 'store.create', entity: 'store', entityId: store._id, storeId: store._id, after: { name: store.name, subdomain: store.subdomain, type: store.type } });
  res.status(201).json(store);
});

// ---- read / update ----
storesRouter.get('/:storeId', requirePermission('product.read', { storeParam: 'storeId' }), async (req, res) => {
  const store = await Store.findById(req.storeId);
  if (!store) throw notFound('Store not found');
  res.json(store);
});

storesRouter.patch('/:storeId', requirePermission('store.settings', { storeParam: 'storeId' }), async (req, res) => {
  const body = updateSchema.parse(req.body);
  const set: Record<string, unknown> = {};
  if (body.name !== undefined) set.name = body.name;
  if (body.logoUrl !== undefined) set.logoUrl = body.logoUrl;
  for (const [k, v] of Object.entries(body.settings ?? {})) {
    if ((k === 'cod' || k === 'shipping' || k === 'theme') && v && typeof v === 'object') {
      for (const [ck, cv] of Object.entries(v)) set[`settings.${k}.${ck}`] = cv;
    } else {
      set[`settings.${k}`] = v;
    }
  }
  const before = await Store.findById(req.storeId).select('name settings');
  const store = await Store.findByIdAndUpdate(req.storeId, { $set: set }, { returnDocument: 'after', runValidators: true });
  if (!store) throw notFound('Store not found');
  await audit(req, { action: 'store.update', entity: 'store', entityId: store._id, before: before?.toJSON(), after: body });
  res.json(store);
});

// ---- suspend / reactivate / archive (Super Admin) ----
async function setStatus(action: 'suspend' | 'reactivate' | 'archive', status: 'suspended' | 'active' | 'archived', perm: 'store.suspend' | 'store.delete') {
  storesRouter.post(`/:storeId/${action}`, requirePermission(perm, { storeParam: 'storeId' }), async (req, res) => {
    const store = await Store.findByIdAndUpdate(req.storeId, { $set: { status } }, { returnDocument: 'after' });
    if (!store) throw notFound('Store not found');
    await audit(req, { action: `store.${action}`, entity: 'store', entityId: store._id, after: { status } });
    res.json(store);
  });
}
void setStatus('suspend', 'suspended', 'store.suspend');
void setStatus('reactivate', 'active', 'store.suspend');
void setStatus('archive', 'archived', 'store.delete'); // soft delete: data is kept (SRS 9.3)

// ---- API keys for storefronts: shown once, stored hashed (FR-SA-002) ----
storesRouter.get('/:storeId/api-keys', requirePermission('apikey.manage', { storeParam: 'storeId' }), async (req, res) => {
  const keys = await ApiKey.find({ storeId: req.storeId }).select('label prefix lastUsedAt revokedAt createdAt').sort({ createdAt: -1 });
  res.json({ items: keys });
});

storesRouter.post('/:storeId/api-keys', requirePermission('apikey.manage', { storeParam: 'storeId' }), async (req, res) => {
  const { label } = z.object({ label: z.string().trim().max(60).default('Storefront') }).parse(req.body ?? {});
  const key = `sk_${randomToken(32)}`;
  const doc = await ApiKey.create({ storeId: req.storeId, label, keyHash: sha256(key), prefix: key.slice(0, 10) });
  await audit(req, { action: 'apikey.create', entity: 'api_key', entityId: doc._id });
  // This is the only time the full key is ever returned.
  res.status(201).json({ id: doc.id, label: doc.label, prefix: doc.prefix, key });
});

storesRouter.delete('/:storeId/api-keys/:keyId', requirePermission('apikey.manage', { storeParam: 'storeId' }), async (req, res) => {
  if (!isValidObjectId(req.params.keyId)) throw notFound();
  const doc = await ApiKey.findOneAndUpdate(
    { _id: req.params.keyId, storeId: req.storeId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!doc) throw notFound('Key not found');
  await audit(req, { action: 'apikey.revoke', entity: 'api_key', entityId: doc._id });
  res.json({ ok: true });
});

// ---- logo and banner pictures
const brandingUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
storesRouter.post('/:storeId/branding/:kind', requirePermission('store.settings', { storeParam: 'storeId' }), brandingUpload.single('image'), async (req, res) => {
  const kind = z.enum(['logo', 'banner']).parse(req.params.kind);
  const file = req.file;
  if (!file) throw badRequest('Choose a picture to upload');
  if (!isAllowedImage(file.mimetype, file.buffer)) throw badRequest('Only JPEG, PNG or WebP pictures are allowed');
  const store = await Store.findById(req.storeId).select('logoUrl settings.theme');
  if (!store) throw notFound('Store not found');
  const url = await saveImage(String(req.storeId), file.mimetype, file.buffer);
  const old = kind === 'logo' ? store.logoUrl : store.settings?.theme?.bannerUrl;
  await Store.updateOne({ _id: store._id }, { $set: kind === 'logo' ? { logoUrl: url } : { 'settings.theme.bannerUrl': url } });
  if (old) await deleteImage(old);
  await audit(req, { action: 'store.branding', entity: 'store', entityId: store._id, after: { kind } });
  res.status(201).json({ url });
});
