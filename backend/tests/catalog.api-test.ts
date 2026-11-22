// End-to-end test of the catalogue API against the real database, with temporary data that is removed afterwards.
// Start the API on port 4010 first:   PORT=4010 npm run start      then:   npm run test:catalog
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { connectDB, disconnectDB } from '../src/db/connect';
import { encrypt } from '../src/utils/crypto';
import { generateSecret, totpAt } from '../src/utils/totp';
import { AuditLog, Category, Product, Role, StaffMembership, StockMovement, Store, User } from '../src/models';

const API = process.env.TEST_API ?? 'http://localhost:4010';
const base = API + '/api/v1';
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${ok ? '' : '  -> ' + extra}`); };
async function call(method: string, p: string, token?: string, body?: unknown) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function upload(p: string, token: string, field: string, filename: string, type: string, bytes: Buffer) {
  const fd = new FormData(); fd.append(field, new Blob([new Uint8Array(bytes)], { type }), filename);
  const res = await fetch(base + p, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
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
const tag = 'cat' + Date.now();
const store = await Store.create({ name: 'Catalog Test', subdomain: tag });
const other = await Store.create({ name: 'Other', subdomain: tag + 'x' });
const role = async (key: string) => (await Role.findOne({ storeId: null, key }))!;
const mk = async (key: string, roleKey?: string, sa = false) => {
  const u = await User.create({ name: key, email: `${tag}-${key}@test.local`, passwordHash: hash, isSuperAdmin: sa, ...(sa ? { mfaEnabled: true, mfaSecret: encrypt(MFA_SECRET) } : {}) });
  if (roleKey) await StaffMembership.create({ userId: u._id, storeId: store._id, roleId: (await role(roleKey))._id });
  return u;
};
const users = [await mk('sa', undefined, true), await mk('inv', 'inventory'), await mk('sup', 'support'), await mk('con', 'content')];
const sid = String(store._id);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

try {
  const sa = await login(`${tag}-sa@test.local`, pw), inv = await login(`${tag}-inv@test.local`, pw), sup = await login(`${tag}-sup@test.local`, pw), con = await login(`${tag}-con@test.local`, pw);

  // ---- categories
  let r = await call('POST', `/stores/${sid}/categories`, sa, { name: 'Frozen Food' }); check('create category', r.status === 201 && r.json.slug === 'frozen-food', JSON.stringify(r.json));
  const cat = r.json._id;
  r = await call('POST', `/stores/${sid}/categories`, sa, { name: 'Frozen Food' }); check('duplicate name gets a new slug', r.status === 201 && r.json.slug === 'frozen-food-2', JSON.stringify(r.json));
  r = await call('POST', `/stores/${sid}/categories`, sa, { name: 'Kababs', parentId: cat }); const child = r.json._id; check('child category', r.status === 201, JSON.stringify(r.json));
  r = await call('PATCH', `/stores/${sid}/categories/${cat}`, sa, { parentId: child }); check('category loop blocked', r.status === 400, r.status + '');
  r = await call('DELETE', `/stores/${sid}/categories/${cat}`, sa); check('delete with children blocked', r.status === 409, r.status + '');
  r = await call('POST', `/stores/${sid}/categories`, sup, { name: 'Nope' }); check('support cannot create category', r.status === 403, r.status + '');

  // ---- physical product
  r = await call('POST', `/stores/${sid}/products`, inv, { name: 'Seekh Kabab 500g', categoryId: child, status: 'active', variants: [{ sku: 'SK-500', price: 85000, stock: 20 }, { sku: 'SK-1000', attributes: { size: '1kg' }, price: 160000, stock: 3 }] });
  check('inventory staff creates product', r.status === 201 && r.json.slug === 'seekh-kabab-500g', JSON.stringify(r.json).slice(0, 200));
  const pid = r.json._id;
  r = await call('POST', `/stores/${sid}/products`, inv, { name: 'Dup SKU', variants: [{ sku: 'SK-500', price: 100 }] }); check('same SKU in another product -> 409', r.status === 409, `${r.status} ${JSON.stringify(r.json)}`);
  r = await call('POST', `/stores/${sid}/products`, inv, { name: 'Dup in one', variants: [{ sku: 'A1', price: 1 }, { sku: 'a1', price: 2 }] }); check('same SKU twice in one product -> 400', r.status === 400, r.status + '');
  r = await call('POST', `/stores/${sid}/products`, inv, { name: 'Float price', variants: [{ sku: 'F1', price: 10.5 }] }); check('fractional paisa rejected', r.status === 400, r.status + '');
  r = await call('POST', `/stores/${sid}/products`, sup, { name: 'Nope', variants: [{ sku: 'N1', price: 1 }] }); check('support cannot create product', r.status === 403, r.status + '');
  r = await call('GET', `/stores/${sid}/products`, sup); check('support can list products with price range and stock', r.status === 200 && r.json.items.length === 1 && r.json.items[0].priceMin === 85000 && r.json.items[0].stock === 23, JSON.stringify(r.json).slice(0, 300));
  check('list shows low stock (3 <= 5)', r.json.items[0].lowStock === true);
  r = await call('GET', `/stores/${sid}/products?lowStock=1`, sup); check('lowStock filter', r.json.items.length === 1);
  r = await call('GET', `/stores/${sid}/products?search=SK-1000`, sup); check('search by SKU', r.json.items.length === 1);
  r = await call('GET', `/stores/${sid}/products?type=digital`, sup); check('type filter', r.json.items.length === 0);
  r = await call('GET', `/stores/${String(other._id)}/products`, inv); check('inventory blocked from another store', r.status === 403, r.status + '');

  // ---- stock
  r = await call('POST', `/stores/${sid}/products/${pid}/stock`, inv, { sku: 'SK-500', delta: 10, reason: 'restock' }); check('restock +10', r.json?.stock === 30, JSON.stringify(r.json));
  r = await call('POST', `/stores/${sid}/products/${pid}/stock`, inv, { sku: 'SK-500', delta: -999, reason: 'damaged' }); check('cannot go below zero', r.status === 409, r.status + '');
  r = await call('POST', `/stores/${sid}/products/${pid}/stock`, con, { sku: 'SK-500', delta: 1, reason: 'restock' }); check('content editor cannot adjust stock', r.status === 403, r.status + '');
  const [a, b] = await Promise.all([1, 2].map(() => call('POST', `/stores/${sid}/products/${pid}/stock`, inv, { sku: 'SK-1000', delta: -2, reason: 'correction' })));
  check('concurrent decreases cannot oversell (stock 3, two of -2)', [a.status, b.status].sort().join() === '200,409', `${a.status},${b.status}`);
  r = await call('GET', `/stores/${sid}/products/${pid}`, sup); check('stock is 1 after the race', r.json.variants.find((v: any) => v.sku === 'SK-1000').stock === 1, JSON.stringify(r.json.variants));
  r = await call('GET', `/stores/${sid}/products/${pid}/stock-movements`, sup); check('stock history recorded (2 initial, 1 restock, 1 decrease)', r.json.items.length === 4, r.json.items?.length + '');

  r = await call('PATCH', `/stores/${sid}/products/${pid}`, inv, { variants: [{ sku: 'SK-500', price: 90000, stock: 9999 }, { sku: 'SK-1000', price: 160000, stock: 9999 }, { sku: 'SK-250', price: 50000, stock: 7 }] });
  const vs = r.json?.variants ?? [];
  check('PATCH cannot overwrite existing stock', vs.find((v: any) => v.sku === 'SK-500')?.stock === 30 && vs.find((v: any) => v.sku === 'SK-1000')?.stock === 1, JSON.stringify(vs.map((v: any) => [v.sku, v.stock])));
  check('PATCH new variant starts with given stock; new price applies', vs.find((v: any) => v.sku === 'SK-250')?.stock === 7 && vs.find((v: any) => v.sku === 'SK-500')?.price === 90000);
  r = await call('PATCH', `/stores/${sid}/products/${pid}`, inv, { type: 'digital' }); check('product type cannot be changed', r.status === 400, r.status + '');

  // ---- images
  r = await upload(`/stores/${sid}/products/${pid}/images`, inv, 'image', 'pic.png', 'image/png', png); check('upload png', r.status === 201 && r.json.url?.startsWith('/media/'), JSON.stringify(r.json));
  const imgUrl = r.json?.url;
  const media = await fetch(API + imgUrl); check('image is served publicly with cross-origin header', media.status === 200 && media.headers.get('cross-origin-resource-policy') === 'cross-origin', media.status + '');
  r = await upload(`/stores/${sid}/products/${pid}/images`, inv, 'image', 'evil.png', 'image/png', Buffer.from('<?php echo 1; ?>')); check('fake image (wrong bytes) rejected', r.status === 400, r.status + '');
  r = await upload(`/stores/${sid}/products/${pid}/images`, inv, 'image', 'a.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')); check('svg rejected', r.status === 400, r.status + '');
  r = await upload(`/stores/${sid}/products/${pid}/images`, sup, 'image', 'pic.png', 'image/png', png); check('support cannot upload', r.status === 403, r.status + '');
  r = await call('PATCH', `/stores/${sid}/products/${pid}`, inv, { images: [] }); const gone = await fetch(API + imgUrl); check('removing an image deletes the file', r.status === 200 && gone.status === 404, `${r.status}/${gone.status}`);

  // ---- digital product
  r = await call('POST', `/stores/${sid}/products`, inv, { name: 'Recipe Book', type: 'digital', status: 'active', variants: [{ sku: 'EB-1', price: 50000 }] }); check('digital cannot be active without a file', r.status === 400, r.status + '');
  r = await call('POST', `/stores/${sid}/products`, inv, { name: 'Recipe Book', type: 'digital', variants: [{ sku: 'EB-1', price: 50000, stock: 50 }] }); check('digital draft created, stock forced to 0', r.status === 201 && r.json.variants[0].stock === 0, JSON.stringify(r.json));
  const did = r.json._id;
  r = await upload(`/stores/${sid}/products/${pid}/files`, inv, 'file', 'x.pdf', 'application/pdf', Buffer.from('%PDF-1.4')); check('files only on digital products', r.status === 400, r.status + '');
  r = await upload(`/stores/${sid}/products/${did}/files`, inv, 'file', 'recipes.pdf', 'application/pdf', Buffer.from('%PDF-1.4 test content')); check('upload digital file', r.status === 201 && r.json.name === 'recipes.pdf', JSON.stringify(r.json));
  const fid = r.json?._id;
  r = await call('GET', `/stores/${sid}/products/${did}`, sup); check('storage key never exposed to the browser', !JSON.stringify(r.json).includes('storageKey') && r.json.digitalFiles.length === 1, JSON.stringify(r.json.digitalFiles));
  const privFiles = fs.readdirSync(path.join('storage', 'private', sid)); check('file kept in private storage under a random name', privFiles.length === 1 && !privFiles[0].includes('recipes'), privFiles.join());
  const direct = await fetch(`${API}/media/${sid}/${privFiles[0]}`); check('private file is not reachable through /media', direct.status === 404, direct.status + '');
  r = await call('PATCH', `/stores/${sid}/products/${did}`, inv, { status: 'active' }); check('digital can go active once it has a file', r.status === 200 && r.json.status === 'active', JSON.stringify(r.json).slice(0, 150));
  r = await call('DELETE', `/stores/${sid}/products/${did}/files/${fid}`, inv); check('cannot remove the last file of an active product', r.status === 400, r.status + '');
  r = await call('POST', `/stores/${sid}/products/${did}/stock`, inv, { sku: 'EB-1', delta: 1, reason: 'restock' }); check('digital products have no stock', r.status === 400, r.status + '');
  await call('PATCH', `/stores/${sid}/products/${did}`, inv, { status: 'draft' }); r = await call('DELETE', `/stores/${sid}/products/${did}/files/${fid}`, inv); check('file removed from a draft', r.status === 200, r.status + '');
  check('private file deleted from disk', fs.readdirSync(path.join('storage', 'private', sid)).length === 0);

  // ---- archive + category rules
  r = await call('DELETE', `/stores/${sid}/products/${pid}`, inv); check('archive product', r.status === 200);
  r = await call('GET', `/stores/${sid}/products`, sup); check('archived products hidden from the default list', !r.json.items.some((p: any) => p._id === pid));
  r = await call('DELETE', `/stores/${sid}/categories/${child}`, sa); check('category in use cannot be deleted', r.status === 409, r.status + '');
} finally {
  const ids = [store._id, other._id];
  await StockMovement.deleteMany({ storeId: { $in: ids } }); await Product.deleteMany({ storeId: { $in: ids } }); await Category.deleteMany({ storeId: { $in: ids } });
  await StaffMembership.deleteMany({ storeId: { $in: ids } }); await AuditLog.deleteMany({ $or: [{ storeId: { $in: ids } }, { userId: { $in: users.map((u) => u._id) } }] });
  await User.deleteMany({ _id: { $in: users.map((u) => u._id) } }); await Store.deleteMany({ _id: { $in: ids } });
  for (const d of ['public', 'private']) fs.rmSync(path.join('storage', d, sid), { recursive: true, force: true });
  await disconnectDB();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
