import crypto from 'node:crypto';
import { env } from '../config/env';
import type { Adapter, Creds, GatewayResult } from './types';

// A fake gateway for development and automated tests, so the whole payment flow can be tried without merchant
// accounts. It signs its messages the same way a real gateway does. It is switched off in production
// (see env.paymentSimulator) and is never offered to customers there.

const key = () => crypto.createHash('sha256').update(`simulator:${env.encryptionKey}`).digest();

export function simSign(fields: Record<string, string>): string {
  const text = Object.keys(fields).filter((k) => k !== 'sig').sort().map((k) => `${k}=${fields[k]}`).join('&');
  return crypto.createHmac('sha256', key()).update(text).digest('hex');
}

export const simulator: Adapter = {
  id: 'simulator',
  label: 'Test gateway (development only)',
  verifiedAgainstOfficialGuide: true,
  credentialFields: [],

  buildRedirect({ storeId, txnRef, amountPaisa, returnUrl }) {
    const fields: Record<string, string> = { txnRef, amount: String(amountPaisa), returnUrl, storeId };
    fields.sig = simSign(fields);
    // the hosted fake payment page is served by our own API
    return { method: 'POST', action: `${env.apiPublicUrl}/api/v1/pay/simulator/${storeId}/page`, fields };
  },

  parseReturn(_creds: Creds, params: Record<string, string>): GatewayResult {
    const given = params.sig ?? '';
    const expected = simSign(params);
    const authentic = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!authentic) return { authentic: false };
    return {
      authentic: true,
      txnRef: params.txnRef,
      amountPaisa: Number(params.amount),
      gatewayTxnId: `SIM-${params.txnRef}`,
      outcome: params.result === 'success' ? 'success' : params.result === 'cancelled' ? 'cancelled' : 'failed',
      message: params.result,
    };
  },
};
