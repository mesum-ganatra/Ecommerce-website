// End-to-end test of the public storefront API, COD checkout and admin order handling, against the real database.
// Temporary data is removed afterwards.   Start the API on port 4010 first, then:   npm run test:shop
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { connectDB, disconnectDB } from '../src/db/connect';
import { encrypt } from '../src/utils/crypto';
import { generateSecret, totpAt } from '../src/utils/totp';
import { AuditLog, Category, Counter, Order, Payment, Product, Role, Shipment, StaffMembership, StockMovement, Store, User } from '../src/models';

const API = process.env.TEST_API ?? 'http://localhost:4010';
const base = API + '/api/v1';
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${ok ? '' : '  -> ' + extra}`); };
async function call(method: string, p: string, token?: string, body?: unknown) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const MFA_SECRET = generateSecret();
async function login(email: string, password: string) {
  const r = await call('POST', '/auth/login', undefined, { email, password });
  if (r.json?.mfaRequired) return (await call('POST', '/auth/mfa/verify', undefined, { mfaToken: r.json.mfaToken, code: totpAt(MFA_SECRET) })).json?.accessToken as string;
  return r.json?.accessToken as string;
}

await connectDB();
const pw = crypto.randomBytes(12).toString('hex'); const hash = await bcrypt.hash(pw, 10);
const tag = 'shop' + Date.now();
const store = await Store.create({
  name: 'Shop Test', subdomain: tag,
  settings: { cod: { enabled: true, maxOrderAmount: 400000 }, shipping: { flatRate: 20000, freeAbove: 300000 }, couriers: [{ name: 'Leopard Courier', code: 'leopard', trackingUrlTemplate: 'https://track.test/{trackingNumber}', active: true }] },
});
const other = await Store.create({ name: 'Other', subdomain: tag + 'x' });
const sid = String(store._id);
const role = async (key: string) => (await Role.findOne({ storeId: null, key }))!;
const mk = async (key: string, roleKey?: string, sa = false, storeDoc = store) => {
  const u = await User.create({ name: key, email: `${tag}-${key}@test.local`, passwordHash: hash, isSuperAdmin: sa, ...(sa ? { mfaEnabled: true, mfaSecret: encrypt(MFA_SECRET) } : {}) });
  if (roleKey) await StaffMembership.create({ userId: u._id, storeId: storeDoc._id, roleId: (await role(roleKey))._id });
  return u;
};
const users = [await mk('sa', undefined, true), await mk('mgr', 'manager'), await mk('inv', 'inventory'), await mk('con', 'content'), await mk('oth', 'store_admin', false, other)];

const cat = await Category.create({ storeId: store._id, name: 'Frozen', slug: 'frozen' });
const mkProduct = (o: Record<string, unknown>) => Product.create({ storeId: store._id, status: 'active', ...o });
const pKabab = await mkProduct({ name: 'Seekh Kabab', slug: 'seekh-kabab', categoryId: cat._id, variants: [{ sku: 'SK-500', price: 85000, compareAtPrice: 95000, stock: 5 }, { sku: 'SK-1000', price: 160000, stock: 1 }] });
const pBurger = await mkProduct({ name: 'Zinger Burger Patty', slug: 'zinger', variants: [{ sku: 'ZB-1', price: 40000, stock: 100 }] });
await mkProduct({ name: 'Secret Draft', slug: 'secret-draft', status: 'draft', variants: [{ sku: 'DR-1', price: 100, stock: 1 }] });
await mkProduct({ name: 'Recipe E-book', slug: 'ebook', type: 'digital', variants: [{ sku: 'EB-1', price: 50000 }], digitalFiles: [{ name: 'r.pdf', storageKey: 'x/abc' }] });
await mkProduct({ name: 'Hidden Variant', slug: 'hidden-variant', variants: [{ sku: 'HV-OFF', price: 100, stock: 5, active: false }] });
const S = `/shop/${tag}`;
const stockOf = async (sku: string) => (await Product.findOne({ storeId: store._id, 'variants.sku': sku }).lean())!.variants.find((v) => v.sku === sku)!.stock;
const addr = { line1: 'House 12, Street 4, Gulberg', city: 'Lahore' };
const cust = { name: 'Ali Khan', phone: '0300 1234567', email: 'ali@test.local' };
let key = 0; const idem = () => `test-key-${tag}-${++key}-xxxx`;

try {
  // ---------------------------------------------------------- public catalogue
  let r = await call('GET', `${S}/store`); check('store info is public', r.status === 200 && r.json.name === 'Shop Test' && r.json.shipping.flatRate === 20000, JSON.stringify(r.json));
  r = await call('GET', `/shop/nope-${tag}/store`); check('unknown store -> 404', r.status === 404, r.status + '');
  r = await call('GET', `${S}/products`); const names = r.json.items.map((p: any) => p.name);
  check('lists only active products with an active variant... drafts hidden', r.status === 200 && !names.includes('Secret Draft'), names.join());
  check('no exact stock in the public list', !JSON.stringify(r.json).includes('"stock"') && !JSON.stringify(r.json).includes('reservedStock'));
  const k = r.json.items.find((p: any) => p.name === 'Seekh Kabab'); check('price range, sale flag and in-stock flag', k.priceMin === 85000 && k.priceMax === 160000 && k.onSale === true && k.inStock === true, JSON.stringify(k));
  r = await call('GET', `${S}/products?sort=price_desc`); check('sort by price desc', r.json.items[0].priceMin >= r.json.items[1].priceMin, JSON.stringify(r.json.items.map((p: any) => p.priceMin)));
  r = await call('GET', `${S}/products?category=frozen`); check('category filter', r.json.items.length === 1 && r.json.items[0].name === 'Seekh Kabab', r.json.items.length + '');
  r = await call('GET', `${S}/products?search=zinger`); check('search', r.json.items.length === 1);
  r = await call('GET', `${S}/products?limit=1&page=2`); check('pagination', r.json.items.length === 1 && r.json.total >= 3, JSON.stringify(r.json).slice(0, 120));
  r = await call('GET', `${S}/products/seekh-kabab`); check('product detail with variants', r.status === 200 && r.json.variants.length === 2, JSON.stringify(r.json).slice(0, 150));
  check('detail hides exact stock but flags few left', !('stock' in r.json.variants[0]) && r.json.variants.find((v: any) => v.sku === 'SK-1000').fewLeft === true && r.json.variants.find((v: any) => v.sku === 'SK-500').maxQuantity === 5);
  r = await call('GET', `${S}/products/secret-draft`); check('draft product is not reachable by slug', r.status === 404, r.status + '');
  r = await call('GET', `${S}/products/hidden-variant`); check('product with no active variant shows none', r.json.variants?.length === 0);

  // ---------------------------------------------------------- quote
  r = await call('POST', `${S}/cart/quote`, undefined, { items: [{ sku: 'SK-500', quantity: 2 }, { sku: 'ZB-1', quantity: 1 }] });
  check('quote: subtotal, flat shipping, total', r.json.subtotal === 210000 && r.json.shipping === 20000 && r.json.total === 230000 && r.json.problems.length === 0, JSON.stringify(r.json).slice(0, 250));
  r = await call('POST', `${S}/cart/quote`, undefined, { items: [{ sku: 'SK-500', quantity: 4 }] }); check('quote: free shipping above the threshold', r.json.subtotal === 340000 && r.json.shipping === 0, JSON.stringify([r.json.subtotal, r.json.shipping]));
  r = await call('POST', `${S}/cart/quote`, undefined, { items: [{ sku: 'SK-1000', quantity: 3 }, { sku: 'NOPE', quantity: 1 }, { sku: 'HV-OFF', quantity: 1 }] });
  check('quote reports unavailable and insufficient items', r.json.problems.some((p: any) => p.code === 'insufficient_stock' && p.available === 1) && r.json.problems.filter((p: any) => p.code === 'unavailable').length === 2, JSON.stringify(r.json.problems));
  r = await call('POST', `${S}/cart/quote`, undefined, { items: [{ sku: 'SK-500', quantity: 1, unitPrice: 1, price: 1 }] }); check('browser-supplied prices are ignored', r.json.lines[0].unitPrice === 85000, JSON.stringify(r.json.lines[0]));
  r = await call('POST', `${S}/cart/quote`, undefined, { items: [{ sku: 'EB-1', quantity: 1 }] }); check('digital-only basket: no shipping, COD offered? no', r.json.shipping === 0 && r.json.paymentOptions.cod.enabled === false, JSON.stringify([r.json.shipping, r.json.paymentOptions]));
  r = await call('POST', `${S}/cart/quote`, undefined, { items: [] }); check('empty basket rejected', r.status === 400, r.status + '');

  // ---------------------------------------------------------- checkout validation
  r = await call('POST', `${S}/checkout`, undefined, { items: [{ sku: 'ZB-1', quantity: 1 }], customer: cust, paymentMethod: 'cod', idempotencyKey: idem() }); check('physical order needs an address', r.status === 400, r.status + '');
  r = await call('POST', `${S}/checkout`, undefined, { items: [{ sku: 'ZB-1', quantity: 1 }], customer: { ...cust, phone: 'abc' }, shippingAddress: addr, paymentMethod: 'cod', idempotencyKey: idem() }); check('bad phone rejected', r.status === 400, r.status + '');
  r = await call('POST', `${S}/checkout`, undefined, { items: [{ sku: 'EB-1', quantity: 1 }], customer: cust, paymentMethod: 'cod', idempotencyKey: idem() }); check('digital items cannot be paid by COD', r.status === 400, r.status + '');
  r = await call('POST', `${S}/checkout`, undefined, { items: [{ sku: 'SK-500', quantity: 4 }, { sku: 'ZB-1', quantity: 2 }], customer: cust, shippingAddress: addr, paymentMethod: 'cod', idempotencyKey: idem() }); check('COD above the store maximum rejected', r.status === 400, `${r.status} ${JSON.stringify(r.json)}`);
  check('failed checkouts leave stock untouched', (await stockOf('SK-500')) === 5 && (await stockOf('ZB-1')) === 100);

  // ---------------------------------------------------------- checkout success
  const k1 = idem();
  r = await call('POST', `${S}/checkout`, undefined, { items: [{ sku: 'SK-500', quantity: 2 }, { sku: 'ZB-1', quantity: 1 }], customer: cust, shippingAddress: addr, paymentMethod: 'cod', note: 'Ring the bell', idempotencyKey: k1 });
  check('COD order placed', r.status === 201 && r.json.number === 1 && r.json.total === 230000, JSON.stringify(r.json));
  check('stock reduced by the order', (await stockOf('SK-500')) === 3 && (await stockOf('ZB-1')) === 99);
  r = await call('POST', `${S}/checkout`, undefined, { items: [{ sku: 'SK-500', quantity: 2 }, { sku: 'ZB-1', quantity: 1 }], customer: cust, shippingAddress: addr, paymentMethod: 'cod', note: 'Ring the bell', idempotencyKey: k1 });
  check('same idempotency key returns the same order, no double charge', r.status === 200 && r.json.number === 1 && r.json.duplicate === true && (await stockOf('SK-500')) === 3, JSON.stringify(r.json));
  const o1 = (await Order.findOne({ storeId: store._id, number: 1 }).lean())!;
  check('order stores a price snapshot and totals', o1.items.length === 2 && o1.items[0].unitPrice === 85000 && o1.totals?.shipping === 20000 && o1.courierCode === 'leopard' && o1.paymentStatus === 'unpaid', JSON.stringify(o1.totals));
  check('payment record and stock history written', (await Payment.countDocuments({ orderId: o1._id, gateway: 'cod' })) === 1 && (await StockMovement.countDocuments({ storeId: store._id, reason: 'sale' })) === 2);

  // ---------------------------------------------------------- race for the last item
  const attempts = await Promise.all([1, 2, 3].map((i) => call('POST', `${S}/checkout`, undefined, { items: [{ sku: 'SK-1000', quantity: 1 }], customer: { ...cust, name: 'Buyer ' + i }, shippingAddress: addr, paymentMethod: 'cod', idempotencyKey: idem() })));
  const codes = attempts.map((a) => a.status).sort();
  check('three buyers, one item left: exactly one wins', codes.filter((c) => c === 201).length === 1 && codes.filter((c) => c === 409).length === 2, codes.join());
  check('stock never goes negative', (await stockOf('SK-1000')) === 0);
  const nums = (await Order.find({ storeId: store._id }).select('number').lean()).map((o) => o.number).sort((a, b) => a - b);
  check('order numbers are sequential with no gaps', nums.join() === '1,2', nums.join());

  // ---------------------------------------------------------- guest tracking
  r = await call('POST', `${S}/orders/lookup`, undefined, { number: 1, contact: decodeURIComponent('03009999999') }); check('tracking with the wrong phone -> 404', r.status === 404, r.status + '');
  r = await call('POST', `${S}/orders/lookup`, undefined, { number: 1, contact: decodeURIComponent('%2B92%20300%201234567') }); check('tracking works with a differently formatted phone', r.status === 200 && r.json.status === 'pending', `${r.status} ${JSON.stringify(r.json).slice(0, 100)}`);
  r = await call('POST', `${S}/orders/lookup`, undefined, { number: 1, contact: decodeURIComponent('ALI@test.local') }); check('tracking works with the email (any case)', r.status === 200);
  r = await call('POST', `${S}/orders/lookup`, undefined, { number: 999, contact: decodeURIComponent('ali@test.local') }); check('unknown order number -> 404', r.status === 404);
  check('tracking never exposes contact details', !JSON.stringify((await call('POST', `${S}/orders/lookup`, undefined, { number: 1, contact: decodeURIComponent('ali@test.local') })).json).includes('ali@test.local'));

  // ---------------------------------------------------------- admin: orders
  const sa = await login(`${tag}-sa@test.local`, pw), mgr = await login(`${tag}-mgr@test.local`, pw), inv = await login(`${tag}-inv@test.local`, pw), con = await login(`${tag}-con@test.local`, pw), oth = await login(`${tag}-oth@test.local`, pw);
  r = await call('GET', `/stores/${sid}/orders`, mgr); check('manager lists orders', r.status === 200 && r.json.items.length === 2 && r.json.pendingCount === 2, JSON.stringify(r.json).slice(0, 150));
  const oid = r.json.items.find((o: any) => o.number === 1)._id;
  r = await call('GET', `/stores/${sid}/orders?search=0300`, mgr); check('search orders by phone', r.json.items.length === 2);
  r = await call('GET', `/stores/${sid}/orders?search=%231`, mgr); check('search by order number', r.json.items.length === 1);
  r = await call('GET', `/stores/${sid}/orders`, con); check('content editor cannot see orders', r.status === 403, r.status + '');
  r = await call('GET', `/stores/${sid}/orders`, oth); check("another store's admin cannot see these orders", r.status === 403, r.status + '');
  r = await call('GET', `/stores/${sid}/orders`, inv); check('inventory staff can read orders', r.status === 200);
  r = await call('POST', `/stores/${sid}/orders/${oid}/status`, inv, { status: 'processing' }); check('inventory staff cannot update orders', r.status === 403, r.status + '');
  r = await call('GET', `/stores/${sid}/orders/${oid}`, mgr); check('order detail has next steps and COD info', r.json.nextStatuses.join() === 'processing' && r.json.canCancel === true && r.json.canCollectCod === false && r.json.couriers.length === 1, JSON.stringify([r.json.nextStatuses, r.json.canCancel]));
  r = await call('POST', `/stores/${sid}/orders/${oid}/status`, mgr, { status: 'shipped' }); check('cannot skip pending -> shipped', r.status === 400, r.status + '');
  r = await call('POST', `/stores/${sid}/orders/${oid}/status`, mgr, { status: 'processing' }); check('pending -> processing', r.status === 200);
  r = await call('POST', `/stores/${sid}/orders/${oid}/status`, mgr, { status: 'shipped', courierCode: 'leopard', trackingNumber: 'LP12345' }); check('processing -> shipped with tracking', r.status === 200);
  check('shipment created with COD amount', (await Shipment.findOne({ orderId: oid }).lean())?.codAmount === 230000);
  r = await call('POST', `${S}/orders/lookup`, undefined, { number: 1, contact: decodeURIComponent('ali@test.local') }); check('customer sees tracking number and link', r.json.shipment?.trackingNumber === 'LP12345' && r.json.shipment?.trackingUrl === 'https://track.test/LP12345' && r.json.status === 'shipped', JSON.stringify(r.json.shipment));
  r = await call('POST', `/stores/${sid}/orders/${oid}/cancel`, mgr, {}); check('cannot cancel once shipped', r.status === 400, r.status + '');
  r = await call('POST', `/stores/${sid}/orders/${oid}/cod-collected`, mgr); check('cannot record cash before delivery', r.status === 400, r.status + '');
  r = await call('POST', `/stores/${sid}/orders/${oid}/status`, mgr, { status: 'delivered' }); check('shipped -> delivered', r.status === 200);
  r = await call('POST', `/stores/${sid}/orders/${oid}/cod-collected`, mgr); check('record cash collected', r.status === 200);
  r = await call('POST', `/stores/${sid}/orders/${oid}/cod-collected`, mgr); check('cash can be recorded only once', r.status === 400, r.status + '');
  r = await call('GET', `/stores/${sid}/orders/${oid}`, mgr); check('order is paid, payment succeeded', r.json.paymentStatus === 'paid' && r.json.payment.status === 'succeeded' && r.json.statusHistory.length >= 5, JSON.stringify([r.json.paymentStatus, r.json.payment]));
  r = await call('POST', `/stores/${sid}/orders/${oid}/status`, mgr, { status: 'completed' }); check('delivered -> completed', r.status === 200);

  // cancel the second (pending) order: stock comes back
  const o2 = (await Order.findOne({ storeId: store._id, number: 2 }).lean())!;
  check('before cancel: last kabab is sold', (await stockOf('SK-1000')) === 0);
  r = await call('POST', `/stores/${sid}/orders/${o2._id}/cancel`, mgr, { note: 'Customer called' }); check('cancel a pending order', r.status === 200, r.status + '');
  check('cancelling puts the stock back', (await stockOf('SK-1000')) === 1);
  r = await call('POST', `/stores/${sid}/orders/${o2._id}/cancel`, mgr, {}); check('cancelling twice is refused (stock not restored twice)', r.status === 400 && (await stockOf('SK-1000')) === 1, r.status + '');
  check('cancelled order has history, payment cancelled', (await Payment.findOne({ orderId: o2._id }).lean())?.status === 'cancelled' && (await StockMovement.countDocuments({ storeId: store._id, reason: 'return' })) === 1);

  // ---------------------------------------------------------- suspended store
  await Store.updateOne({ _id: store._id }, { status: 'suspended' });
  r = await call('GET', `${S}/products`); check('suspended store storefront is closed (503)', r.status === 503, r.status + '');
  r = await call('POST', `${S}/checkout`, undefined, { items: [{ sku: 'ZB-1', quantity: 1 }], customer: cust, shippingAddress: addr, paymentMethod: 'cod', idempotencyKey: idem() }); check('suspended store cannot take orders', r.status === 503, r.status + '');
} finally {
  const ids = [store._id, other._id];
  await Promise.all([Payment, Shipment, StockMovement, Order, Product, Category, StaffMembership].map((m: any) => m.deleteMany({ storeId: { $in: ids } })));
  await Counter.deleteMany({ _id: { $in: ids.map((i) => `order:${i}`) } });
  await AuditLog.deleteMany({ $or: [{ storeId: { $in: ids } }, { userId: { $in: users.map((u) => u._id) } }] });
  await User.deleteMany({ _id: { $in: users.map((u) => u._id) } }); await Store.deleteMany({ _id: { $in: ids } });
  await disconnectDB();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
