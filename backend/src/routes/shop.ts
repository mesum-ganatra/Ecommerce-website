import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { isValidObjectId, type Types } from 'mongoose';
import { env } from '../config/env';
import { Category, DownloadAccess, Order, Payment, PaymentConfig, Product, Shipment, Store } from '../models';
import { decryptCreds, gatewayIds, getAdapter } from '../payments';
import { rateStore } from '../utils/rate-limit-store';
import { maybeExpireStale } from '../services/payments';
import { privateDownloadUrl, privatePath, usesObjectStorage } from '../services/storage';
import { signDownloadToken, verifyDownloadToken } from '../utils/tokens';
import { placeOrder, type PayMethod } from '../services/checkout';
import { priceCart } from '../services/pricing';
import { AppError, badRequest, notFound } from '../utils/errors';

// Public storefront API. No sign-in: everything here is what a visitor may see or do.
// The store is chosen by its subdomain in the URL, and only ACTIVE stores answer.
export const shopRouter = Router({ mergeParams: true });

const msg = (m: string) => ({ error: { code: 'too_many_requests', message: m } });
const readLimiter = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false, message: msg('Too many requests. Slow down a little.') });
// per customer connection; raised only for automated tests (CHECKOUT_RATE_LIMIT / TRACK_RATE_LIMIT)
const checkoutLimiter = rateLimit({ windowMs: 15 * 60_000, limit: Number(process.env.CHECKOUT_RATE_LIMIT ?? 20), store: rateStore('checkout'), passOnStoreError: true, standardHeaders: 'draft-7', legacyHeaders: false, message: msg('Too many orders from this connection. Try again later.') });
const trackLimiter = rateLimit({ windowMs: 15 * 60_000, limit: Number(process.env.TRACK_RATE_LIMIT ?? 30), store: rateStore('track'), passOnStoreError: true, standardHeaders: 'draft-7', legacyHeaders: false, message: msg('Too many lookups. Try again later.') });

shopRouter.use(readLimiter);

type ShopStore = NonNullable<Awaited<ReturnType<typeof findStore>>>;
async function findStore(subdomain: string) {
  return Store.findOne({ subdomain: subdomain.toLowerCase(), status: { $in: ['active', 'suspended'] } }).select(
    'name subdomain logoUrl currency status type settings.cod settings.shipping settings.returnWindowDays settings.couriers settings.theme',
  );
}

// resolve the store for every route below
shopRouter.use(async (req, res, next) => {
  const store = await findStore(String(req.params.subdomain));
  if (!store) throw notFound('This store does not exist.');
  if (store.status !== 'active') throw new AppError(503, 'store_unavailable', 'This store is temporarily closed.');
  res.locals.store = store;
  next();
});
const storeOf = (res: { locals: Record<string, unknown> }) => res.locals.store as ShopStore;

// ------------------------------------------------------------ store + catalogue
/** Online payment methods this store has switched on (only gateways that exist and are allowed). */
async function onlineMethods(storeId: Types.ObjectId) {
  const on = await PaymentConfig.find({ storeId, enabled: true }).select('gateway').lean();
  return on.filter((c) => gatewayIds().includes(c.gateway)).map((c) => ({ gateway: c.gateway, label: getAdapter(c.gateway)!.label }));
}

shopRouter.get('/store', async (_req, res) => {
  const s = storeOf(res);
  res.json({
    payments: { cod: s.settings?.cod?.enabled ?? true, online: await onlineMethods(s._id) },
    name: s.name,
    subdomain: s.subdomain,
    logoUrl: s.logoUrl || null,
    currency: s.currency,
    cod: { enabled: s.settings?.cod?.enabled ?? true, maxOrderAmount: s.settings?.cod?.maxOrderAmount || null },
    shipping: { flatRate: s.settings?.shipping?.flatRate ?? 0, freeAbove: s.settings?.shipping?.freeAbove ?? null },
    returnWindowDays: s.settings?.returnWindowDays ?? 7,
    theme: { accentColor: s.settings?.theme?.accentColor ?? null, tagline: s.settings?.theme?.tagline ?? null, bannerUrl: s.settings?.theme?.bannerUrl ?? null },
  });
});

shopRouter.get('/categories', async (_req, res) => {
  const store = storeOf(res);
  const [cats, counts] = await Promise.all([
    Category.find({ storeId: store._id, active: true }).sort({ sortOrder: 1, name: 1 }).select('name slug parentId imageUrl').lean(),
    Product.aggregate([{ $match: { storeId: store._id, status: 'active' } }, { $group: { _id: '$categoryId', n: { $sum: 1 } } }]),
  ]);
  const n = new Map(counts.map((c) => [String(c._id), c.n as number]));
  res.json({ items: cats.map((c) => ({ ...c, productCount: n.get(String(c._id)) ?? 0 })) });
});

function publicProduct(p: any) {
  const active = (p.variants ?? []).filter((v: any) => v.active);
  const prices: number[] = active.map((v: any) => v.price);
  const inStock = p.type === 'digital' || p.allowBackorder || active.some((v: any) => (v.stock ?? 0) - (v.reservedStock ?? 0) > 0);
  const onSale = active.some((v: any) => v.compareAtPrice && v.compareAtPrice > v.price);
  return {
    name: p.name,
    slug: p.slug,
    type: p.type,
    brand: p.brand || null,
    image: p.images?.[0]?.url ?? null,
    image2: p.images?.[1]?.url ?? null,
    imageAlt: p.images?.[0]?.alt ?? '',
    // set only when there is a single, buyable choice, so a card can offer one-click add
    quickAddSku: active.length === 1 && inStock ? (active[0].sku ?? null) : null,
    priceMin: prices.length ? Math.min(...prices) : 0,
    priceMax: prices.length ? Math.max(...prices) : 0,
    onSale,
    inStock,
  };
}

shopRouter.get('/products', async (req, res) => {
  const store = storeOf(res);
  const q = z
    .object({
      category: z.string().trim().max(100).optional(), // category slug
      search: z.string().trim().max(80).optional(),
      sort: z.enum(['newest', 'price_asc', 'price_desc', 'name']).default('newest'),
      page: z.coerce.number().int().min(1).max(500).default(1),
      limit: z.coerce.number().int().min(1).max(48).default(12),
    })
    .parse(req.query);

  const match: Record<string, unknown> = { storeId: store._id, status: 'active' };
  if (q.category) {
    const cat = await Category.findOne({ storeId: store._id, slug: q.category, active: true }).select('_id');
    if (!cat) return res.json({ items: [], total: 0, page: q.page, limit: q.limit });
    // include sub-categories
    const kids = await Category.find({ storeId: store._id, parentId: cat._id, active: true }).select('_id');
    match.categoryId = { $in: [cat._id, ...kids.map((k) => k._id)] };
  }
  if (q.search) {
    const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    match.$or = [{ name: rx }, { brand: rx }];
  }
  const sort: Record<string, 1 | -1> =
    q.sort === 'price_asc' ? { _priceMin: 1, _id: 1 } : q.sort === 'price_desc' ? { _priceMin: -1, _id: 1 } : q.sort === 'name' ? { name: 1, _id: 1 } : { createdAt: -1, _id: 1 };

  const [rows, total] = await Promise.all([
    Product.aggregate([
      { $match: match },
      { $addFields: { _priceMin: { $min: '$variants.price' } } },
      { $sort: sort },
      { $skip: (q.page - 1) * q.limit },
      { $limit: q.limit },
      { $project: { name: 1, slug: 1, type: 1, brand: 1, images: { $slice: ['$images', 2] }, 'variants.sku': 1, 'variants.price': 1, 'variants.compareAtPrice': 1, 'variants.stock': 1, 'variants.reservedStock': 1, 'variants.active': 1, allowBackorder: 1 } },
    ]),
    Product.countDocuments(match),
  ]);
  res.json({ items: rows.map(publicProduct), total, page: q.page, limit: q.limit });
});

shopRouter.get('/products/:slug', async (req, res) => {
  const store = storeOf(res);
  const p = await Product.findOne({ storeId: store._id, slug: String(req.params.slug).toLowerCase(), status: 'active' })
    .populate('categoryId', 'name slug')
    .lean();
  if (!p) throw notFound('Product not found');
  const physical = p.type === 'physical';
  res.json({
    ...publicProduct(p),
    description: p.description ?? '',
    images: (p.images ?? []).map((i) => ({ url: i.url, alt: i.alt ?? '' })),
    category: p.categoryId && typeof p.categoryId === 'object' ? { name: (p.categoryId as any).name, slug: (p.categoryId as any).slug } : null,
    seo: { title: p.seo?.title || p.name, description: p.seo?.description || (p.description ?? '').slice(0, 160) },
    variants: p.variants
      .filter((v) => v.active)
      .map((v) => {
        const unlimited = !physical || p.allowBackorder;
        const avail = unlimited ? null : Math.max(0, (v.stock ?? 0) - (v.reservedStock ?? 0));
        return {
          sku: v.sku,
          attributes: Object.fromEntries(Object.entries((v.attributes as unknown as Record<string, string>) ?? {})),
          price: v.price,
          compareAtPrice: v.compareAtPrice ?? null,
          inStock: avail === null || avail > 0,
          // never reveal exact stock: only a cap for the quantity picker, and a "few left" signal
          maxQuantity: avail === null ? 20 : Math.min(avail, 20),
          fewLeft: avail !== null && avail > 0 && avail <= 5,
        };
      }),
  });
});

// ------------------------------------------------------------ basket + checkout
const cartItems = z
  .array(z.object({ sku: z.string().trim().min(1).max(64), quantity: z.number().int().min(1).max(99) }))
  .min(1, 'Your basket is empty')
  .max(50);

/** Price a basket exactly as checkout will: the browser shows these numbers, never its own. */
shopRouter.post('/cart/quote', async (req, res) => {
  const { items } = z.object({ items: cartItems }).parse(req.body);
  const pricing = await priceCart(storeOf(res), items);
  const store = storeOf(res);
  res.json({
    lines: pricing.lines.map((l) => ({ ...l, productId: undefined })),
    problems: pricing.problems,
    subtotal: pricing.subtotal,
    shipping: pricing.shipping,
    tax: pricing.tax,
    total: pricing.total,
    hasPhysical: pricing.hasPhysical,
    hasDigital: pricing.hasDigital,
    paymentOptions: {
      online: await onlineMethods(store._id),
      cod: { enabled: (store.settings?.cod?.enabled ?? true) && !pricing.hasDigital && (!store.settings?.cod?.maxOrderAmount || pricing.total <= store.settings.cod.maxOrderAmount) },
    },
  });
});

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s-]{8,16}$/, 'Enter a valid phone number');

const checkoutBody = z.object({
  items: cartItems,
  customer: z.object({
    name: z.string().trim().min(2).max(80),
    phone,
    email: z.string().trim().toLowerCase().email().max(120).optional().or(z.literal('').transform(() => undefined)),
  }),
  shippingAddress: z
    .object({
      line1: z.string().trim().min(3).max(200),
      line2: z.string().trim().max(200).optional(),
      city: z.string().trim().min(2).max(60),
      province: z.string().trim().max(60).optional(),
      postalCode: z.string().trim().max(12).optional(),
    })
    .optional(),
  paymentMethod: z.enum(['cod', 'jazzcash', 'easypaisa', 'simulator']),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(64),
});

shopRouter.post('/checkout', checkoutLimiter, async (req, res) => {
  const body = checkoutBody.parse(req.body);
  const store = storeOf(res);
  const method = body.paymentMethod as PayMethod;
  await maybeExpireStale(); // keeps stock from being held by abandoned payments, even without a scheduler

  const pricing = await priceCart(store, body.items);
  if (pricing.problems.length) {
    throw new AppError(409, 'cart_changed', 'Some items in your basket changed. Please review it.', pricing.problems);
  }

  const adapter = method === 'cod' ? undefined : getAdapter(method);
  type Cfg = { mode: 'sandbox' | 'live'; credentials: string };
  let cfg = null as Cfg | null;
  if (method === 'cod') {
    if (!(store.settings?.cod?.enabled ?? true)) throw badRequest('This store does not accept Cash on Delivery right now.');
    if (pricing.hasDigital) throw badRequest('Digital products need online payment. Choose an online method, or remove them to pay on delivery.');
    const max = store.settings?.cod?.maxOrderAmount;
    if (max && pricing.total > max) throw badRequest(`Cash on Delivery is limited to orders up to Rs ${(max / 100).toLocaleString('en-PK')}.`);
  } else {
    cfg = adapter ? ((await PaymentConfig.findOne({ storeId: store._id, gateway: method, enabled: true }).select('+credentials mode').lean()) as Cfg | null) : null;
    if (!adapter || !cfg) throw badRequest('That payment method is not available for this store.');
    if (pricing.hasDigital && !body.customer.email) throw badRequest('Enter your email address so we can send your download.');
  }

  const { order, payment, duplicate } = await placeOrder(
    store,
    pricing,
    { customer: body.customer, shippingAddress: body.shippingAddress, note: body.note, idempotencyKey: body.idempotencyKey },
    method,
  );
  const summary = { number: order.number, status: order.status, total: order.totals?.total ?? pricing.total, paymentMethod: order.paymentMethod, duplicate };

  if (method === 'cod' || !adapter || !cfg || !payment || order.paymentStatus === 'paid') {
    return void res.status(duplicate ? 200 : 201).json(summary);
  }
  if (!duplicate) await Payment.updateOne({ _id: payment._id }, { $set: { mode: cfg.mode } });

  // the browser posts this form to the gateway, which takes the customer to its own payment page
  const redirect = adapter.buildRedirect({
    creds: method === 'simulator' ? {} : decryptCreds(cfg.credentials),
    mode: cfg.mode,
    storeId: String(store._id),
    txnRef: payment.txnRef,
    amountPaisa: payment.amount,
    description: `Order ${order.number} at ${store.name}`,
    returnUrl: `${env.apiPublicUrl}/api/v1/pay/${method}/${String(store._id)}/return`,
    expiresAt: payment.expiresAt ?? new Date(Date.now() + env.paymentExpiryMinutes * 60_000),
    customer: { phone: body.customer.phone, email: body.customer.email },
    now: new Date(),
  });
  res.status(duplicate ? 200 : 201).json({ ...summary, redirect });
});

// ------------------------------------------------------------ order tracking (guest) and downloads
const digits = (s?: string | null) => (s ?? '').replace(/\D/g, '');
const tail = (s?: string | null) => digits(s).slice(-10);
const contactSchema = z.object({ number: z.coerce.number().int().positive(), contact: z.string().trim().min(5).max(120) });

/** The order number AND the phone or email used at checkout, so numbers cannot be guessed to read orders. */
async function findOwnedOrder(storeId: Types.ObjectId, number: number, contact: string) {
  const order = await Order.findOne({ storeId, number }).lean();
  const ok =
    order &&
    ((order.guest?.email && order.guest.email.toLowerCase() === contact.toLowerCase()) ||
      (order.guest?.phone && tail(order.guest.phone).length >= 9 && tail(order.guest.phone) === tail(contact)));
  if (!order || !ok) throw notFound('We could not find that order. Check the number and the phone or email you used.');
  return order;
}

// POST, so the phone or email travels in the body and never ends up in URLs, logs or browser history.
shopRouter.post('/orders/lookup', trackLimiter, async (req, res) => {
  const store = storeOf(res);
  const { number, contact } = contactSchema.parse(req.body);
  const order = await findOwnedOrder(store._id, number, contact);

  const shipment = await Shipment.findOne({ storeId: store._id, orderId: order._id }).lean();
  const courier = store.settings?.couriers?.find((c) => c.code === (shipment?.courierCode ?? order.courierCode));

  let downloads: { id: string; name: string; remaining: number; expiresAt: Date; expired: boolean }[] = [];
  if (order.paymentStatus === 'paid' && order.hasDigital && order.status !== 'cancelled') {
    const access = await DownloadAccess.find({ storeId: store._id, orderId: order._id }).lean();
    const products = await Product.find({ _id: { $in: access.map((a) => a.productId) } }).select('digitalFiles').lean();
    downloads = access.map((a) => {
      const file = products.find((p) => String(p._id) === String(a.productId))?.digitalFiles.find((f) => String(f._id) === String(a.fileId));
      return { id: String(a._id), name: file?.name ?? 'File', remaining: Math.max(0, a.downloadLimit - a.downloadCount), expiresAt: a.expiresAt, expired: a.expiresAt < new Date() };
    });
  }

  res.json({
    number: order.number,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    createdAt: order.createdAt,
    items: order.items.map((i) => ({ name: i.name, sku: i.sku, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal, attributes: Object.fromEntries(Object.entries((i.attributes as unknown as Record<string, string>) ?? {})) })),
    totals: order.totals,
    shippingAddress: order.shippingAddress ? { city: order.shippingAddress.city, line1: order.shippingAddress.line1 } : null,
    history: (order.statusHistory ?? []).map((h) => ({ status: h.status, at: h.at })),
    downloads,
    shipment: shipment
      ? {
          courier: courier?.name ?? shipment.courierCode,
          trackingNumber: shipment.trackingNumber ?? null,
          trackingUrl: courier?.trackingUrlTemplate && shipment.trackingNumber ? courier.trackingUrlTemplate.replace('{trackingNumber}', encodeURIComponent(shipment.trackingNumber)) : null,
        }
      : null,
  });
});

/** Gives a 5 minute link for one purchased file, after checking the customer owns the order. */
shopRouter.post('/downloads/:accessId/link', trackLimiter, async (req, res) => {
  const store = storeOf(res);
  const { number, contact } = contactSchema.parse(req.body);
  const order = await findOwnedOrder(store._id, number, contact);
  const accessId = String(req.params.accessId);
  const a = isValidObjectId(accessId) ? await DownloadAccess.findOne({ _id: accessId, storeId: store._id, orderId: order._id }).lean() : null;
  if (!a || order.paymentStatus !== 'paid' || order.status === 'cancelled') throw notFound('Download not found');
  if (a.expiresAt < new Date()) throw new AppError(410, 'download_expired', 'This download has expired. Contact the store.');
  if (a.downloadCount >= a.downloadLimit) throw new AppError(410, 'download_limit', 'You have used all your downloads. Contact the store.');
  res.json({ url: `${env.apiPublicUrl}/api/v1/shop/${store.subdomain}/files/${signDownloadToken(String(a._id))}` });
});

shopRouter.get('/files/:token', trackLimiter, async (req, res) => {
  const store = storeOf(res);
  let accessId: string;
  try {
    accessId = verifyDownloadToken(String(req.params.token));
  } catch {
    throw new AppError(410, 'link_expired', 'This download link has expired. Go back to your order and try again.');
  }
  // the count is increased in the same step that checks the limit, so parallel requests cannot exceed it
  const a = await DownloadAccess.findOneAndUpdate(
    { _id: accessId, storeId: store._id, expiresAt: { $gt: new Date() }, $expr: { $lt: ['$downloadCount', '$downloadLimit'] } },
    { $inc: { downloadCount: 1 }, $push: { log: { at: new Date(), ip: req.ip } } },
    { returnDocument: 'after' },
  );
  if (!a) throw new AppError(410, 'download_unavailable', 'This download is no longer available.');
  const product = await Product.findOne({ _id: a.productId, storeId: store._id }).select('digitalFiles').lean();
  const file = product?.digitalFiles.find((f) => String(f._id) === String(a.fileId));
  if (!file?.storageKey) throw notFound('File not found');
  if (usesObjectStorage()) return void res.redirect(302, await privateDownloadUrl(file.storageKey, file.name));
  res.download(privatePath(file.storageKey), file.name);
});
