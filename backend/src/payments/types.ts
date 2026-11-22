// A payment gateway is a small adapter: it turns an order into the form the customer's browser posts to the
// gateway, and turns what the gateway sends back into a plain, verified result. Everything else (orders, stock,
// idempotency, expiry, refunds) lives outside the adapters and is the same for every gateway.

export type Creds = Record<string, string>;
export type Mode = 'sandbox' | 'live';

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean; // secrets are never shown again after saving
  required: boolean;
  hint?: string;
}

export interface InitiateInput {
  creds: Creds;
  mode: Mode;
  storeId: string;
  txnRef: string; // our unique reference (max 20 letters and digits)
  amountPaisa: number;
  description: string;
  returnUrl: string; // where the gateway sends the customer's browser back
  expiresAt: Date;
  customer: { phone: string; email?: string };
  now: Date;
}

export interface RedirectForm {
  method: 'POST' | 'GET';
  action: string;
  fields: Record<string, string>;
}

export interface GatewayResult {
  /** false when the signature is wrong or the message is malformed: ignore it completely */
  authentic: boolean;
  txnRef?: string;
  outcome?: 'success' | 'failed' | 'cancelled';
  amountPaisa?: number;
  gatewayTxnId?: string;
  message?: string;
}

export interface Adapter {
  id: 'jazzcash' | 'easypaisa' | 'simulator';
  label: string;
  credentialFields: CredentialField[];
  /** unverified = written from public information; confirm against the merchant integration guide before going live */
  verifiedAgainstOfficialGuide: boolean;
  buildRedirect(input: InitiateInput): RedirectForm;
  /** Reads the browser's return (and any server notification). Must verify the signature first. */
  parseReturn(creds: Creds, params: Record<string, string>): GatewayResult;
}
