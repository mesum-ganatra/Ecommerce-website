import { Router, type Request, type Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { env } from '../config/env';
import { requirePermission } from '../middleware/auth';
import { PaymentConfig, Store } from '../models';
import { decryptCreds, gatewayIds, getAdapter, mayGoLive, type Creds } from '../payments';
import { simSign } from '../payments/simulator';
import { audit } from '../services/audit';
import { settlePayment, storefrontOrigin } from '../services/payments';
import { encrypt } from '../utils/crypto';
import { badRequest, notFound } from '../utils/errors';

// ============================================================ public: where gateways send customers back
export const payPublicRouter = Router();

const strings = (o: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>` +
  `<body style="font-family:system-ui,sans-serif;max-width:420px;margin:12vh auto;padding:0 20px;color:#0f172a">${body}</body>`;

async function handleReturn(req: Request, res: Response) {
  const storeId = String(req.params.storeId);
  const adapter = getAdapter(String(req.params.gateway));
  if (!adapter || !isValidObjectId(storeId)) throw notFound();
  const store = await Store.findById(storeId).select('subdomain');
  if (!store) throw notFound();

  let creds: Creds = {};
  if (adapter.id !== 'simulator') {
    const cfg = await PaymentConfig.findOne({ storeId, gateway: adapter.id }).select('+credentials');
    if (!cfg) throw notFound();
    creds = decryptCreds(cfg.credentials);
  }
  const result = adapter.parseReturn(creds, strings({ ...req.query, ...req.body }));
  // a message we cannot prove came from the gateway changes nothing
  if (!result.authentic || !result.txnRef) {
    return void res.status(400).send(page('Payment message not verified', '<h1>We could not verify this payment message</h1><p>If you paid, do not pay again. Contact the store with your order number.</p>'));
  }
  const settled = await settlePayment(storeId, result.txnRef, result);
  const url = `${storefrontOrigin(store.subdomain)}/pay-result?order=${settled.orderNumber ?? ''}&status=${settled.status}`;
  res.redirect(303, url);
}
payPublicRouter.post('/:gateway/:storeId/return', handleReturn);
payPublicRouter.get('/:gateway/:storeId/return', handleReturn);

/** The development-only "bank page": three buttons that send a signed result back, like a real gateway. */
payPublicRouter.post('/simulator/:storeId/page', (req, res) => {
  const adapter = getAdapter('simulator');
  if (!adapter) throw notFound();
  const p = strings(req.body);
  if (!p.sig || simSign(p) !== p.sig) throw badRequest('Invalid request');
  // This page posts to our own API, which then redirects the browser to the store. Browsers apply a page's
  // form-action rule to that redirect too, so the store's address must be allowed here (helmet's default is 'self' only).
  res.setHeader('Content-Security-Policy', `default-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self' ${env.storefrontUrlTemplate.replace('{sub}', '*').replace(/\/$/, '')}`);
  const form = (label: string, result: string, style: string) => {
    const f: Record<string, string> = { txnRef: p.txnRef, amount: p.amount, storeId: p.storeId, result };
    f.sig = simSign(f);
    return `<form method="post" action="${esc(`${env.apiPublicUrl}/api/v1/pay/simulator/${p.storeId}/return`)}" style="margin:10px 0">${Object.entries(f)
      .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
      .join('')}<button style="width:100%;padding:12px;border-radius:10px;border:0;font-size:16px;${style}">${label}</button></form>`;
  };
  res.send(
    page(
      'Test payment',
      `<p style="color:#b45309;font-weight:600">TEST GATEWAY: no real money</p><h1>Pay Rs ${(Number(p.amount) / 100).toLocaleString('en-PK')}</h1><p>Reference ${esc(p.txnRef)}</p>` +
        form('Pay now', 'success', 'background:#059669;color:#fff') +
        form('Simulate a failed payment', 'failed', 'background:#dc2626;color:#fff') +
        form('Cancel', 'cancelled', 'background:#e2e8f0'),
    ),
  );
});

// ============================================================ admin: each store's own gateway credentials
export const paymentConfigRouter = Router({ mergeParams: true });
const scope = { storeParam: 'storeId' };

const mask = (v: string) => (v.length > 6 ? `••••${v.slice(-3)}` : '••••');

paymentConfigRouter.get('/payment-configs', requirePermission('payment.credentials', scope), async (req, res) => {
  const configs = await PaymentConfig.find({ storeId: req.storeId }).select('+credentials').lean();
  const items = gatewayIds().map((id) => {
    const a = getAdapter(id)!;
    const cfg = configs.find((c) => c.gateway === id);
    const creds = cfg ? decryptCreds(cfg.credentials) : {};
    return {
      gateway: id,
      label: a.label,
      verified: a.verifiedAgainstOfficialGuide,
      canGoLive: mayGoLive(a),
      fields: a.credentialFields,
      // secrets are never sent back, only a masked hint that shows something is saved
      values: Object.fromEntries(a.credentialFields.map((f) => [f.key, creds[f.key] ? (f.secret ? mask(creds[f.key]) : creds[f.key]) : ''])),
      configured: Boolean(cfg),
      enabled: cfg?.enabled ?? false,
      mode: cfg?.mode ?? 'sandbox',
      returnUrl: `${env.apiPublicUrl}/api/v1/pay/${id}/${String(req.storeId)}/return`,
    };
  });
  res.json({ items });
});

paymentConfigRouter.put('/payment-configs/:gateway', requirePermission('payment.credentials', scope), async (req, res) => {
  const adapter = getAdapter(String(req.params.gateway));
  if (!adapter) throw notFound('Unknown payment method');
  const body = z.object({ mode: z.enum(['sandbox', 'live']), enabled: z.boolean(), credentials: z.record(z.string(), z.string().max(300)).default({}) }).parse(req.body);

  const existing = await PaymentConfig.findOne({ storeId: req.storeId, gateway: adapter.id }).select('+credentials');
  const old = existing ? decryptCreds(existing.credentials) : {};
  const merged: Creds = {};
  for (const f of adapter.credentialFields) {
    const given = (body.credentials[f.key] ?? '').trim();
    merged[f.key] = given && !given.startsWith('••••') ? given : (old[f.key] ?? '');
  }
  const missing = adapter.credentialFields.filter((f) => f.required && !merged[f.key]).map((f) => f.label);
  if (missing.length) throw badRequest(`Please fill in: ${missing.join(', ')}.`);
  if (body.mode === 'live' && !mayGoLive(adapter)) {
    throw badRequest(`Live mode for ${adapter.label} is locked until its integration has been checked against the official guide and tested with your sandbox account. Use sandbox mode for now.`);
  }
  await PaymentConfig.findOneAndUpdate(
    { storeId: req.storeId, gateway: adapter.id },
    { $set: { mode: body.mode, enabled: body.enabled, credentials: encrypt(JSON.stringify(merged)), maskedHint: Object.values(merged)[0] ? mask(Object.values(merged)[0]) : undefined } },
    { upsert: true, returnDocument: 'after' },
  );
  // never log the credentials themselves
  await audit(req, { action: 'payment_config.update', entity: 'payment_config', entityId: adapter.id, after: { gateway: adapter.id, mode: body.mode, enabled: body.enabled } });
  res.json({ ok: true });
});

paymentConfigRouter.delete('/payment-configs/:gateway', requirePermission('payment.credentials', scope), async (req, res) => {
  const r = await PaymentConfig.deleteOne({ storeId: req.storeId, gateway: String(req.params.gateway) as 'jazzcash' | 'easypaisa' | 'simulator' });
  if (!r.deletedCount) throw notFound('Nothing saved for that payment method');
  await audit(req, { action: 'payment_config.delete', entity: 'payment_config', entityId: String(req.params.gateway) });
  res.json({ ok: true });
});
