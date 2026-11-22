'use client';

import { post } from './api';

export interface QuoteLine {
  sku: string;
  name: string;
  slug: string;
  type: 'physical' | 'digital';
  attributes: Record<string, string>;
  image: string | null;
  unitPrice: number;
  compareAtPrice?: number;
  quantity: number;
  lineTotal: number;
  available: number | null;
}

export interface QuoteProblem {
  sku: string;
  code: 'unavailable' | 'insufficient_stock';
  message: string;
  available?: number;
}

export interface Quote {
  lines: QuoteLine[];
  problems: QuoteProblem[];
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  hasPhysical: boolean;
  hasDigital: boolean;
  paymentOptions: { cod: { enabled: boolean }; online: { gateway: string; label: string }[] };
}

export const getQuote = (sub: string, items: { sku: string; quantity: number }[]) =>
  post<Quote>(`/shop/${encodeURIComponent(sub)}/cart/quote`, { items });

export interface TrackedOrder {
  number: number;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
  items: { name: string; sku: string; quantity: number; unitPrice: number; lineTotal: number; attributes: Record<string, string> }[];
  totals: { subtotal: number; discount: number; shipping: number; tax: number; total: number };
  shippingAddress: { city: string; line1: string } | null;
  history: { status: string; at: string }[];
  shipment: { courier: string; trackingNumber: string | null; trackingUrl: string | null } | null;
  downloads?: { id: string; name: string; remaining: number; expiresAt: string; expired: boolean }[];
}

export interface PlacedOrder {
  number: number;
  total: number;
  contact: string;
}

export const attrLabel = (a: Record<string, string>) => Object.values(a).join(' / ');

export interface RedirectForm {
  method: 'POST' | 'GET';
  action: string;
  fields: Record<string, string>;
}

/** Sends the customer to the payment gateway by posting the signed form the server prepared. */
export function submitToGateway(form: RedirectForm) {
  const f = document.createElement('form');
  f.method = form.method;
  f.action = form.action;
  for (const [k, v] of Object.entries(form.fields)) {
    const i = document.createElement('input');
    i.type = 'hidden';
    i.name = k;
    i.value = v;
    f.appendChild(i);
  }
  document.body.appendChild(f);
  f.submit();
}

export const METHOD_LABEL: Record<string, string> = { cod: 'Cash on Delivery', jazzcash: 'JazzCash', easypaisa: 'EasyPaisa', simulator: 'Test payment (development)' };
