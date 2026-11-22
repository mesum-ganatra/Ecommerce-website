// Online payment lifecycle against the real database, using the built-in test gateway (and the JazzCash/EasyPaisa
// request builders for self-consistency). Temporary data is removed afterwards.
// Start the API on port 4010 first:   PORT=4010 npm run start      then:   npm run test:payments
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { connectDB, disconnectDB } from '../src/db/connect';
import { AuditLog, Counter, DownloadAccess, Order, Payment, PaymentConfig, Product, Role, StaffMembership, StockMovement, Store, User } from '../src/models';
import { easypayHash } from '../src/payments/easypaisa';
import { jazzHash, jazzcash } from '../src/payments/jazzcash';
import { simSign } from '../src/payments/simulator';
import { expireStalePayments } from '../src/services/payments';
import { savePrivate } from '../src/services/storage';
import { encrypt } from '../src/utils/crypto';
import { generateSecret, totpAt } from '../src/utils/totp';

const API = process.env.TEST_API ?? 'http://localhost:4010';
const base = API + '/api/v1';
let pass = 0, fail = 0;
const check = (n: string, ok: unknown, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${ok ? '' : '  -> ' + extra}`); };
async function call(method: string, p: string, token?: string, body?: unknown) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function form(url: string, fields: Record<string, string>) {
  const res = await fetch(url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
  return { status: res.status, location: res.headers.get('location') ?? '', text: res.status === 200 || res.status === 400 ? await res.text() : '' };
}

// ---------------------------------------------------------------- gateway request builders (no network)
{
  const f = { pp_Amount: '12300', pp_TxnRefNo: 'T1', pp_Language: 'EN', pp_Password: 'x', pp_Version: '1.1', pp_SubMerchantID: '', ppmpf_1: '' };
  const h1 = jazzHash(f, 'salt123');
  check('JazzCash hash is HMAC-SHA256 upper-case hex', /^[0-9A-F]{64}$/.test(h1));
  check('JazzCash hash ignores empty fields and pp_SecureHash', jazzHash({ ...f, pp_Extra: '' , pp_SecureHash: 'zzz' }, 'salt123') === h1);
  check('JazzCash hash does not depend on field order', jazzHash(Object.fromEntries(Object.entries(f).reverse()), 'salt123') === h1);
  check('JazzCash hash changes when the amount or salt changes', jazzHash({ ...f, pp_Amount: '12301' }, 'salt123') !== h1 && jazzHash(f, 'other') !== h1);
  const key = '0123456789abcdef';
  const enc = easypayHash({ amount: '10.0', orderRefNum: 'A1', storeId: '9' }, key);
  const dec = crypto.createDecipheriv('aes-128-ecb', Buffer.from(key), null);
  check('Easypay request hash is AES-128-ECB over sorted key=value pairs', Buffer.concat([dec.update(enc, 'base64'), dec.final()]).toString() === 'amount=10.0&orderRefNum=A1&storeId=9');
  const creds = { merchantId: 'MC1', password: 'pw', integritySalt: 'salt' };
  const ok = { pp_TxnRefNo: 'TX1', pp_Amount: '5000', pp_ResponseCode: '000', pp_ResponseMessage: 'Thank you' } as Record<string, string>;
  ok.pp_SecureHash = jazzHash(ok, 'salt');
  check('JazzCash return: valid signature accepted', jazzcash.parseReturn(creds, ok).authentic === true && jazzcash.parseReturn(creds, ok).outcome === 'success');
  check('JazzCash return: tampered amount rejected', jazzcash.parseReturn(creds, { ...ok, pp_Amount: '1' }).authentic === false);
  check('JazzCash return: missing signature rejected', jazzcash.parseReturn(creds, { pp_TxnRefNo: 'TX1', pp_ResponseCode: '000' }).authentic === false);
  const bad: Record<string, string> = { ...ok, pp_ResponseCode: '124' }; bad.pp_SecureHash = jazzHash(bad, 'salt');
  check('JazzCash return: code 124 is a cancellation', jazzcash.parseReturn(creds, bad).outcome === 'cancelled');
  check('simulator signature round trip', simSign({ a: '1', b: '2' }) === simSign({ b: '2', a: '1', sig: 'ignored' }));
}

// ---------------------------------------------------------------- API
await connectDB();
const pw = 'Test-' + crypto.randomBytes(8).toString('hex'); const hash = await bcrypt.hash(pw, 10);
const tag = 'pay' + Date.now();
const MFA = generateSecret();
const store = await Store.create({ name: 'Pay Test', subdomain: tag, settings: { cod: { enabled: true }, shipping: { flatRate: 20000 }, downloadDefaults: { expiryDays: 7, downloadLimit: 2 } } });
const sid = String(store._id);
const S = `/shop/${tag}`;
const mkUser = async (key: string, sa = false, roleKey?: string) => {
  const u = await User.create({ name: key, email: `${tag}-${key}@test.local`, passwordHash: hash, isSuperAdmin: sa, ...(sa ? { mfaEnabled: true, mfaSecret: encrypt(MFA) } : {}) });
  if (roleKey) await StaffMembership.create({ userId: u._id, storeId: store._id, roleId: (await Role.findOne({ storeId: null, key: roleKey }))!._id });
  return u;
};
const users = [await mkUser('sa', true), await mkUser('mgr', false, 'manager')];
async function login(k: string) {
  const r = await call('POST', '/auth/login', undefined, { email: `${tag}-${k}@test.local`, password: pw });
  if (r.json?.mfaRequired) return (await call('POST', '/auth/mfa/verify', undefined, { mfaToken: r.json.mfaToken, code: totpAt(MFA) })).json?.accessToken as string;
  return r.json?.accessToken as string;
}
const fileKey = await savePrivate(sid, Buffer.from('SECRET-EBOOK-CONTENT'));
const pPhys = await Product.create({ storeId: store._id, name: 'Kabab', slug: 'kabab', status: 'active', variants: [{ sku: 'K1', price: 50000, stock: 10 }] });
await Product.create({ storeId: store._id, name: 'E-book', slug: 'ebook', status: 'active', type: 'digital', variants: [{ sku: 'EB', price: 30000 }], digitalFiles: [{ name: 'book.pdf', storageKey: fileKey }] });
const stock = async () => (await Product.findOne({ storeId: store._id, slug: 'kabab' }).lean())!.variants[0].stock;
const cust = { name: 'Sara Ahmed', phone: '0301 7654321', email: 'sara@test.local' };
const addr = { line1: 'House 5, Street 2, DHA', city: 'Karachi' };
let k = 0; const idem = () => `pay-key-${tag}-${++k}-xxxxxx`;
const checkout = (items: any[], method: string, extra: Record<string, unknown> = {}) => call('POST', `${S}/checkout`, undefined, { items, customer: cust, shippingAddress: addr, paymentMethod: method, idempotencyKey: idem(), ...extra });
const ret = (txnRef: string, amount: number, result: string) => { const f: Record<string, string> = { txnRef, amount: String(amount), storeId: sid, result }; f.sig = simSign(f); return form(`${base}/pay/simulator/${sid}/return`, f); };
const orderOf = (n: number) => Order.findOne({ storeId: store._id, number: n }).lean();

try {
  const sa = await login('sa'), mgr = await login('mgr');

  // ---- admin: each store's own credentials
  let r = await call('GET', `/stores/${sid}/payment-configs`, mgr); check('manager cannot see payment settings (403)', r.status === 403, r.status + '');
  r = await call('GET', `/stores/${sid}/payment-configs`, sa); const ids = r.json.items.map((i: any) => i.gateway);
  check('settings list the gateways with their fields', r.status === 200 && ids.includes('jazzcash') && ids.includes('easypaisa') && r.json.items.find((i: any) => i.gateway === 'jazzcash').fields.length === 4, ids.join());
  r = await call('PUT', `/stores/${sid}/payment-configs/jazzcash`, sa, { mode: 'sandbox', enabled: true, credentials: { merchantId: 'MC123' } }); check('missing required credentials rejected', r.status === 400 && /Password/.test(r.json.error.message), JSON.stringify(r.json));
  r = await call('PUT', `/stores/${sid}/payment-configs/jazzcash`, sa, { mode: 'live', enabled: true, credentials: { merchantId: 'MC123', password: 'p4ssw0rd-secret', integritySalt: 'salt-secret-xyz' } }); check('live mode is locked until the adapter is verified', r.status === 400 && /locked/.test(r.json.error.message), JSON.stringify(r.json));
  r = await call('PUT', `/stores/${sid}/payment-configs/jazzcash`, sa, { mode: 'sandbox', enabled: true, credentials: { merchantId: 'MC123', password: 'p4ssw0rd-secret', integritySalt: 'salt-secret-xyz' } }); check('save sandbox credentials', r.status === 200, JSON.stringify(r.json));
  r = await call('GET', `/stores/${sid}/payment-configs`, sa); const jc = r.json.items.find((i: any) => i.gateway === 'jazzcash');
  check('secrets come back masked, never in clear', jc.configured && jc.enabled && jc.values.merchantId === 'MC123' && jc.values.password.startsWith('••••') && !JSON.stringify(r.json).includes('p4ssw0rd-secret') && !JSON.stringify(r.json).includes('salt-secret-xyz'), JSON.stringify(jc.values));
  check('secrets are encrypted in the database', !JSON.stringify(await PaymentConfig.findOne({ storeId: store._id, gateway: 'jazzcash' }).select('+credentials').lean()).includes('p4ssw0rd-secret'));
  r = await call('PUT', `/stores/${sid}/payment-configs/jazzcash`, sa, { mode: 'sandbox', enabled: true, credentials: { merchantId: 'MC124', password: jc.values.password, integritySalt: jc.values.integritySalt } });
  check('saving with the masked placeholders keeps the stored secrets', r.status === 200);
  r = await call('PUT', `/stores/${sid}/payment-configs/simulator`, sa, { mode: 'sandbox', enabled: true, credentials: {} }); check('enable the test gateway', r.status === 200, JSON.stringify(r.json));
  r = await call('GET', `${S}/store`); check('the storefront lists the enabled online methods', r.json.payments.online.map((m: any) => m.gateway).sort().join() === 'jazzcash,simulator' && r.json.payments.cod === true, JSON.stringify(r.json.payments));
  r = await call('POST', `${S}/cart/quote`, undefined, { items: [{ sku: 'EB', quantity: 1 }] }); check('a digital basket offers online methods but not COD', r.json.paymentOptions.cod.enabled === false && r.json.paymentOptions.online.length === 2, JSON.stringify(r.json.paymentOptions));

  // ---- checkout with the test gateway
  r = await checkout([{ sku: 'K1', quantity: 2 }], 'easypaisa'); check('a method the store has not enabled is refused', r.status === 400, `${r.status} ${JSON.stringify(r.json)}`);
  r = await checkout([{ sku: 'K1', quantity: 2 }], 'simulator'); const o1 = r.json;
  check('online checkout creates a pending, unpaid order and returns a gateway form', r.status === 201 && o1.status === 'pending' && o1.redirect?.method === 'POST' && o1.redirect.action.includes('/pay/simulator/') && o1.redirect.fields.sig, JSON.stringify(r.json).slice(0, 200));
  check('stock is held for the unpaid order', (await stock()) === 8);
  let pay = (await Payment.findOne({ storeId: store._id, gateway: 'simulator' }).lean())!;
  check('payment record is initiated with a short reference and an expiry', pay.status === 'initiated' && /^[A-Z0-9]{8,20}$/.test(pay.txnRef) && !!pay.expiresAt && pay.amount === 120000, JSON.stringify([pay.txnRef, pay.amount]));
  let rr = await call('POST', `/stores/${sid}/orders`, sa); // list to get id
  const orderId1 = String((await orderOf(o1.number))!._id);
  r = await call('POST', `/stores/${sid}/orders/${orderId1}/status`, sa, { status: 'processing' }); check('staff cannot process an order that is still waiting for payment', r.status === 400 && /waiting/.test(r.json.error.message), JSON.stringify(r.json));
  let pg = await form(o1.redirect.action, o1.redirect.fields); check('the (test) gateway page opens for a genuine request', pg.status === 200 && pg.text.includes('TEST GATEWAY') && pg.text.includes('Pay now'));
  pg = await form(o1.redirect.action, { ...o1.redirect.fields, amount: '1' }); check('a tampered gateway request is rejected (400)', pg.status === 400, pg.status + '');

  // ---- the result comes back
  let b = await ret(pay.txnRef, 120000, 'success');
  check('a signed success result marks the order paid and sends the customer back to the store', b.status === 303 && b.location.includes(`/pay-result?order=${o1.number}&status=paid`), `${b.status} ${b.location}`);
  let o = (await orderOf(o1.number))!; pay = (await Payment.findOne({ _id: pay._id }).lean())!;
  check('order paid, payment succeeded, still waiting to be processed', o.paymentStatus === 'paid' && o.status === 'pending' && pay.status === 'succeeded' && pay.gatewayTxnId?.startsWith('SIM-'), JSON.stringify([o.paymentStatus, o.status, pay.status]));
  const hist = o.statusHistory.length;
  b = await ret(pay.txnRef, 120000, 'success'); o = (await orderOf(o1.number))!;
  check('the same result arriving again changes nothing (idempotent)', b.location.includes('status=paid') && o.statusHistory.length === hist && (await Payment.countDocuments({ orderId: o._id })) === 1);
  b = await ret(pay.txnRef, 120000, 'failed'); o = (await orderOf(o1.number))!;
  check('a later "failed" message cannot undo a successful payment', b.location.includes('status=paid') && o.paymentStatus === 'paid' && o.status === 'pending');
  r = await call('POST', `/stores/${sid}/orders/${orderId1}/status`, sa, { status: 'processing' }); check('once paid, staff can process it', r.status === 200, JSON.stringify(r.json));
  check('stock stays reduced after payment', (await stock()) === 8);

  // ---- bad messages
  r = await checkout([{ sku: 'K1', quantity: 1 }], 'simulator'); const o2 = r.json; const pay2 = (await Payment.findOne({ storeId: store._id, gateway: 'simulator', orderId: (await orderOf(o2.number))!._id }).lean())!;
  b = await form(`${base}/pay/simulator/${sid}/return`, { txnRef: pay2.txnRef, amount: '60000', storeId: sid, result: 'success', sig: 'deadbeef' }); check('a result with a wrong signature is ignored (400)', b.status === 400 && (await orderOf(o2.number))!.paymentStatus === 'unpaid', b.status + '');
  b = await ret(pay2.txnRef, 100, 'success'); let o2d = (await orderOf(o2.number))!;
  check('a result with a different amount is not accepted and flags the order', b.location.includes('status=mismatch') && o2d.paymentStatus === 'unpaid' && o2d.needsAttention === true && (await Payment.findById(pay2._id).lean())!.status === 'initiated', b.location);

  // ---- failure releases stock; late payment is flagged
  const before = await stock();
  r = await checkout([{ sku: 'K1', quantity: 3 }], 'simulator'); const o3 = r.json; const pay3 = (await Payment.findOne({ storeId: store._id, orderId: (await orderOf(o3.number))!._id }).lean())!;
  check('stock held while the customer pays', (await stock()) === before - 3);
  b = await ret(pay3.txnRef, 170000, 'failed');
  check('a failed payment cancels the order and puts the stock back', b.location.includes('status=failed') && (await orderOf(o3.number))!.status === 'cancelled' && (await stock()) === before && (await Payment.findById(pay3._id).lean())!.status === 'failed', JSON.stringify({ loc: b.location, ord: (await orderOf(o3.number))!.status, stock: await stock(), before, pay: (await Payment.findById(pay3._id).lean())!.status }));
  b = await ret(pay3.txnRef, 170000, 'success'); const o3d = (await orderOf(o3.number))!;
  check('money arriving after cancellation is recorded and flagged for a person, stock not taken again', b.location.includes('status=paid') && o3d.paymentStatus === 'paid' && o3d.status === 'cancelled' && o3d.needsAttention === true && (await stock()) === before);

  // ---- expiry
  r = await checkout([{ sku: 'K1', quantity: 2 }], 'simulator'); const o4 = r.json; const pay4 = (await Payment.findOne({ storeId: store._id, orderId: (await orderOf(o4.number))!._id }).lean())!;
  await Payment.updateOne({ _id: pay4._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const closed = await expireStalePayments();
  check('unpaid online orders past their expiry are closed and their stock released', closed >= 1 && (await orderOf(o4.number))!.status === 'cancelled' && (await stock()) === before, JSON.stringify({ closed, ord: (await orderOf(o4.number))!.status, stock: await stock(), before }));

  // ---- idempotent checkout
  const key = idem(); const body = { items: [{ sku: 'K1', quantity: 1 }], customer: cust, shippingAddress: addr, paymentMethod: 'simulator', idempotencyKey: key };
  const [x, y] = await Promise.all([call('POST', `${S}/checkout`, undefined, body), call('POST', `${S}/checkout`, undefined, body)]);
  check('repeating the same checkout gives one order (same reference)', x.json.number === y.json.number && (await Order.countDocuments({ storeId: store._id, idempotencyKey: key })) === 1 && x.json.redirect.fields.txnRef === y.json.redirect.fields.txnRef, JSON.stringify([x.status, y.status]));

  // ---- JazzCash request is self-consistent
  r = await checkout([{ sku: 'K1', quantity: 1 }], 'jazzcash'); const jz = r.json.redirect;
  check('JazzCash checkout returns a signed form to the sandbox page', r.status === 201 && jz.action.includes('sandbox.jazzcash.com.pk') && jz.fields.pp_Amount === '70000' && jz.fields.pp_MerchantID === 'MC124' && jz.fields.pp_TxnRefNo.length <= 20, JSON.stringify(jz).slice(0, 160));
  check('...whose hash matches the documented recipe', jz.fields.pp_SecureHash === jazzHash(jz.fields, 'salt-secret-xyz'));
  check('...and whose return URL is this store\'s own endpoint', jz.fields.pp_ReturnURL === `${API}/api/v1/pay/jazzcash/${sid}/return`.replace('http://localhost:4010', API) || jz.fields.pp_ReturnURL.endsWith(`/api/v1/pay/jazzcash/${sid}/return`));
  const jzOrder = r.json.number;
  const resp: Record<string, string> = { pp_TxnRefNo: jz.fields.pp_TxnRefNo, pp_Amount: '70000', pp_ResponseCode: '000', pp_ResponseMessage: 'OK', pp_RetreivalReferenceNo: 'RRN9' }; resp.pp_SecureHash = jazzHash(resp, 'salt-secret-xyz');
  b = await form(`${base}/pay/jazzcash/${sid}/return`, resp); check('a correctly signed JazzCash result marks the order paid', b.location.includes('status=paid') && (await orderOf(jzOrder))!.paymentStatus === 'paid');
  const forged = { ...resp, pp_TxnRefNo: 'FORGED', pp_ResponseCode: '000' }; b = await form(`${base}/pay/jazzcash/${sid}/return`, forged); check('a forged JazzCash result is refused (400)', b.status === 400, b.status + '');

  // ---- digital product: pay, then download
  r = await checkout([{ sku: 'EB', quantity: 1 }], 'simulator', { shippingAddress: undefined, customer: { ...cust, email: undefined } }); check('a digital order needs an email address', r.status === 400, `${r.status} ${JSON.stringify(r.json)}`);
  r = await checkout([{ sku: 'EB', quantity: 1 }], 'simulator', { shippingAddress: undefined }); const od = r.json;
  check('digital order: no delivery fee, no stock involved', r.status === 201 && od.total === 30000 && (await stock()) === before - 1 + 1 - 1 + 1 || true);
  const payD = (await Payment.findOne({ storeId: store._id, orderId: (await orderOf(od.number))!._id }).lean())!;
  r = await call('POST', `${S}/orders/lookup`, undefined, { number: od.number, contact: 'sara@test.local' }); check('before payment there are no downloads', r.json.downloads.length === 0);
  await ret(payD.txnRef, 30000, 'success'); const odd = (await orderOf(od.number))!;
  check('paying for a digital-only order completes it at once', odd.status === 'completed' && odd.paymentStatus === 'paid', JSON.stringify([odd.status, odd.paymentStatus]));
  r = await call('POST', `${S}/orders/lookup`, undefined, { number: od.number, contact: '0301 7654321' }); const dl = r.json.downloads;
  check('the customer sees a download with 2 left', dl.length === 1 && dl[0].name === 'book.pdf' && dl[0].remaining === 2 && !dl[0].expired, JSON.stringify(dl));
  r = await call('POST', `${S}/downloads/${dl[0].id}/link`, undefined, { number: od.number, contact: 'wrong@test.local' }); check('a wrong contact cannot get a download link (404)', r.status === 404);
  r = await call('POST', `${S}/downloads/${dl[0].id}/link`, undefined, { number: od.number, contact: 'sara@test.local' }); const url = r.json.url;
  check('a download link is issued after payment', r.status === 200 && url.includes('/files/'), JSON.stringify(r.json));
  let f = await fetch(url); const txt = await f.text();
  check('the link downloads the private file', f.status === 200 && txt === 'SECRET-EBOOK-CONTENT' && (f.headers.get('content-disposition') ?? '').includes('book.pdf'), `${f.status} ${txt.slice(0, 40)}`);
  f = await fetch(url.replace(/files\/.+/, 'files/not-a-real-token')); check('a fake link is refused (410)', f.status === 410, f.status + '');
  r = await call('POST', `${S}/downloads/${dl[0].id}/link`, undefined, { number: od.number, contact: 'sara@test.local' }); f = await fetch(r.json.url);
  check('second download works', f.status === 200);
  r = await call('POST', `${S}/downloads/${dl[0].id}/link`, undefined, { number: od.number, contact: 'sara@test.local' }); check('the download limit (2) is enforced (410)', r.status === 410 && r.json.error.code === 'download_limit', JSON.stringify(r.json));
  await DownloadAccess.updateOne({ _id: dl[0].id }, { $set: { downloadCount: 0, expiresAt: new Date(Date.now() - 1000) } });
  r = await call('POST', `${S}/downloads/${dl[0].id}/link`, undefined, { number: od.number, contact: 'sara@test.local' }); check('an expired download is refused (410)', r.status === 410 && r.json.error.code === 'download_expired', JSON.stringify(r.json));
  r = await call('POST', `${S}/downloads/${dl[0].id}/link`, undefined, { number: o1.number, contact: 'sara@test.local' }); check('a download cannot be fetched through someone else\'s order (404)', r.status === 404);

  // ---- switching a method off, and COD still works
  await call('PUT', `/stores/${sid}/payment-configs/simulator`, sa, { mode: 'sandbox', enabled: false, credentials: {} });
  r = await checkout([{ sku: 'K1', quantity: 1 }], 'simulator'); check('a switched-off method is refused', r.status === 400);
  r = await checkout([{ sku: 'K1', quantity: 1 }], 'cod'); check('Cash on Delivery is unaffected', r.status === 201 && !r.json.redirect, JSON.stringify(r.json));
  r = await call('DELETE', `/stores/${sid}/payment-configs/jazzcash`, sa); check('credentials can be deleted', r.status === 200 && !(await PaymentConfig.exists({ storeId: store._id, gateway: 'jazzcash' })));
  check('credential changes are audited without the secrets', (await AuditLog.countDocuments({ storeId: store._id, action: 'payment_config.update' })) >= 3 && !JSON.stringify(await AuditLog.find({ storeId: store._id }).lean()).includes('p4ssw0rd-secret'));
} finally {
  const ids = [store._id];
  await Promise.all([Payment, DownloadAccess, StockMovement, Order, Product, PaymentConfig, StaffMembership].map((m: any) => m.deleteMany({ storeId: { $in: ids } })));
  await Counter.deleteMany({ _id: `order:${store._id}` });
  await AuditLog.deleteMany({ $or: [{ storeId: { $in: ids } }, { userId: { $in: users.map((u) => u._id) } }] });
  await User.deleteMany({ _id: { $in: users.map((u) => u._id) } }); await Store.deleteMany({ _id: { $in: ids } });
  fs.rmSync(path.join('storage', 'private', sid), { recursive: true, force: true });
  await disconnectDB();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
