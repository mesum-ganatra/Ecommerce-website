import crypto from 'node:crypto';
import type { Adapter, Creds, GatewayResult } from './types';

// Easypaisa "Easypay" hosted checkout: the customer's browser posts a signed request to Easypay, pays there,
// and Easypay sends the customer back to our postBackURL with the result.
//
// !!  UNVERIFIED. The merchant guide is given only to onboarded merchants. The request fields, how
// !!  `merchantHashedReq` is produced, the "second redirection" (auth token confirmation) and the result
// !!  parameters below are written from public third-party code and MUST be checked against Easypaisa's
// !!  current guide and your staging account before going live. Everything specific to Easypaisa is in this
// !!  one file; if their flow differs, only this file changes.

const ENDPOINT = {
  sandbox: 'https://easypaystg.easypaisa.com.pk/easypay/Index.jsf',
  live: 'https://easypay.easypaisa.com.pk/easypay/Index.jsf',
};

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** "yyyyMMdd HHmmss" in Pakistan time */
export function easypayDate(d: Date): string {
  const p = new Date(d.getTime() + 5 * 3600 * 1000);
  return `${p.getUTCFullYear()}${pad(p.getUTCMonth() + 1)}${pad(p.getUTCDate())} ${pad(p.getUTCHours())}${pad(p.getUTCMinutes())}${pad(p.getUTCSeconds())}`;
}

/** The request is signed as AES-128-ECB (PKCS7) over "key=value&key=value" (keys sorted), then base64, with the store's hash key. */
export function easypayHash(params: Record<string, string>, hashKey: string): string {
  const text = Object.keys(params)
    .filter((k) => k !== 'merchantHashedReq' && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(hashKey.padEnd(16, '\0').slice(0, 16), 'utf8'), null);
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}

export const easypaisa: Adapter = {
  id: 'easypaisa',
  label: 'EasyPaisa',
  verifiedAgainstOfficialGuide: false,
  credentialFields: [
    { key: 'storeId', label: 'Store ID', secret: false, required: true },
    { key: 'hashKey', label: 'Hash key', secret: true, required: true, hint: 'The 16-character key from your Easypay merchant portal.' },
    { key: 'accountNum', label: 'Account number (optional)', secret: false, required: false },
  ],

  buildRedirect({ creds, mode, txnRef, amountPaisa, returnUrl, expiresAt, customer }) {
    const params: Record<string, string> = {
      storeId: creds.storeId,
      amount: (amountPaisa / 100).toFixed(1), // Easypay takes rupees
      postBackURL: returnUrl,
      orderRefNum: txnRef,
      expiryDate: easypayDate(expiresAt),
      autoRedirect: '1',
      paymentMethod: '', // empty lets the customer choose (mobile account, card...)
      emailAddr: customer.email ?? '',
      mobileNum: customer.phone.replace(/\D/g, ''),
    };
    if (creds.accountNum) params.accountNum = creds.accountNum;
    const fields: Record<string, string> = { ...params, merchantHashedReq: easypayHash(params, creds.hashKey) };
    for (const k of Object.keys(fields)) if (fields[k] === '' && k !== 'merchantHashedReq') delete fields[k];
    return { method: 'POST', action: ENDPOINT[mode], fields };
  },

  parseReturn(_creds: Creds, params: Record<string, string>): GatewayResult {
    // Easypay reports the result with the order reference and a status code ("0000" = success).
    // NOTE: the real flow also has an auth_token confirmation step to be added once the guide is checked;
    // until then a result is trusted only when it carries our own reference AND the payment is later settled
    // by the status check (see services/payments.ts), never from the browser alone.
    const ref = params.orderRefNum ?? params.orderRef;
    if (!ref) return { authentic: false };
    const status = params.status ?? params.paymentStatus ?? '';
    return {
      authentic: false, // cannot be proven from the browser alone; see the note above
      txnRef: ref,
      outcome: status === '0000' ? 'success' : status === '0001' ? 'cancelled' : 'failed',
      message: params.desc ?? params.description,
    };
  },
};
