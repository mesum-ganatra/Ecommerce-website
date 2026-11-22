import { env } from '../config/env';
import { decrypt } from '../utils/crypto';
import { easypaisa } from './easypaisa';
import { jazzcash } from './jazzcash';
import { simulator } from './simulator';
import type { Adapter, Creds } from './types';

export * from './types';

const ADAPTERS: Record<string, Adapter> = { jazzcash, easypaisa, simulator };

/** Gateway ids that may be offered at all (the test gateway only when enabled). */
export const gatewayIds = (): string[] => Object.keys(ADAPTERS).filter((id) => id !== 'simulator' || env.paymentSimulator);

export function getAdapter(id: string): Adapter | undefined {
  if (id === 'simulator' && !env.paymentSimulator) return undefined;
  return ADAPTERS[id];
}

export const decryptCreds = (encrypted: string): Creds => JSON.parse(decrypt(encrypted)) as Creds;

/** Real gateways may go live only after their adapter has been checked against the official guide (or an explicit override). */
export const mayGoLive = (a: Adapter) => a.verifiedAgainstOfficialGuide || process.env.PAYMENTS_ALLOW_UNVERIFIED_LIVE === 'true';
