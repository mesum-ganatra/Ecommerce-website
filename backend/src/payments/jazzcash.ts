import crypto from 'node:crypto';
import type { Adapter, Creds, GatewayResult } from './types';

// JazzCash "Page Redirection" (hosted payment page): the customer's browser posts a signed form to JazzCash,
// pays there, and JazzCash posts the signed result back to our return URL.
//
// !!  The field list, the order of fields in the hash, and the response codes below are written from public
// !!  third-party integrations, NOT from JazzCash's own guide (which is only given to merchants). Before going live,
// !!  compare this file line by line with the "Page Redirection" guide in your JazzCash merchant portal, and test
// !!  with your sandbox credentials. All JazzCash-specific code is in this one file.

const ENDPOINT = {
  sandbox: 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/',
  live: 'https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/',
};

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** yyyyMMddHHmmss in Pakistan time (UTC+5), which JazzCash expects */
export function jazzDate(d: Date): string {
  const p = new Date(d.getTime() + 5 * 3600 * 1000);
  return `${p.getUTCFullYear()}${pad(p.getUTCMonth() + 1)}${pad(p.getUTCDate())}${pad(p.getUTCHours())}${pad(p.getUTCMinutes())}${pad(p.getUTCSeconds())}`;
}

/**
 * Secure hash: every field whose name starts with "pp" and has a value, sorted by name, values joined with "&",
 * with the integrity salt in front; HMAC-SHA256 keyed with the salt; upper-case hex.
 */
export function jazzHash(fields: Record<string, string>, salt: string): string {
  const parts = Object.keys(fields)
    .filter((k) => k.startsWith('pp') && k !== 'pp_SecureHash' && fields[k] !== '' && fields[k] !== undefined)
    .sort()
    .map((k) => fields[k]);
  return crypto.createHmac('sha256', salt).update([salt, ...parts].join('&')).digest('hex').toUpperCase();
}

export const jazzcash: Adapter = {
  id: 'jazzcash',
  label: 'JazzCash',
  verifiedAgainstOfficialGuide: false,
  credentialFields: [
    { key: 'merchantId', label: 'Merchant ID', secret: false, required: true },
    { key: 'password', label: 'Password', secret: true, required: true },
    { key: 'integritySalt', label: 'Integrity salt', secret: true, required: true, hint: 'Also called the hash key or integrity key in the portal.' },
    { key: 'productId', label: 'Product ID (optional)', secret: false, required: false },
  ],

  buildRedirect({ creds, mode, txnRef, amountPaisa, description, returnUrl, expiresAt, now }) {
    const fields: Record<string, string> = {
      pp_Version: '1.1',
      pp_TxnType: '',
      pp_Language: 'EN',
      pp_MerchantID: creds.merchantId,
      pp_SubMerchantID: '',
      pp_Password: creds.password,
      pp_BankID: '',
      pp_ProductID: creds.productId ?? '',
      pp_TxnRefNo: txnRef,
      pp_Amount: String(amountPaisa), // JazzCash takes the amount in paisa
      pp_TxnCurrency: 'PKR',
      pp_TxnDateTime: jazzDate(now),
      pp_BillReference: 'billRef',
      pp_Description: description.replace(/[^\w .,-]/g, '').slice(0, 100) || 'Order',
      pp_TxnExpiryDateTime: jazzDate(expiresAt),
      pp_ReturnURL: returnUrl,
      ppmpf_1: '',
      ppmpf_2: '',
      ppmpf_3: '',
      ppmpf_4: '',
      ppmpf_5: '',
    };
    fields.pp_SecureHash = jazzHash(fields, creds.integritySalt);
    return { method: 'POST', action: ENDPOINT[mode], fields };
  },

  parseReturn(creds: Creds, params: Record<string, string>): GatewayResult {
    const given = (params.pp_SecureHash ?? '').toUpperCase();
    const expected = jazzHash(params, creds.integritySalt);
    const authentic = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!authentic) return { authentic: false };
    const code = params.pp_ResponseCode;
    return {
      authentic: true,
      txnRef: params.pp_TxnRefNo,
      amountPaisa: Number(params.pp_Amount),
      gatewayTxnId: params.pp_RetreivalReferenceNo || params.pp_AuthCode || undefined, // sic: JazzCash spells it this way
      outcome: code === '000' || code === '121' ? 'success' : code === '124' ? 'cancelled' : 'failed',
      message: params.pp_ResponseMessage,
    };
  },
};
