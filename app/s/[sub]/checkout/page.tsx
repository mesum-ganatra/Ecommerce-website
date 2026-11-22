'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { shopButton, shopButtonOutline, shopInput } from '@/components/shop/ui';
import { useShop } from '@/components/shop/shop-context';
import { CheckoutSteps } from '@/components/shop/success-mark';
import { ApiError, post } from '@/lib/api';
import { rs } from '@/lib/format';
import { METHOD_LABEL, attrLabel, getQuote, submitToGateway, type PlacedOrder, type Quote, type RedirectForm } from '@/lib/shop-client';

const PROVINCES = ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad Capital Territory', 'Gilgit-Baltistan', 'Azad Jammu & Kashmir'];

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const HELP: Record<string, string> = {
  cod: 'Pay in cash when your order arrives.',
  jazzcash: 'Pay with your JazzCash wallet or card on the secure JazzCash page.',
  easypaisa: 'Pay with your EasyPaisa account or card on the secure EasyPaisa page.',
  simulator: 'A fake payment page for testing. No real money.',
};

export default function CheckoutPage() {
  const { sub, base, store, items, ready, clear } = useShop();
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [note, setNote] = useState('');
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [basketChanged, setBasketChanged] = useState(false);

  useEffect(() => {
    if (!ready || items.length === 0) return;
    getQuote(sub, items).then(setQuote).catch((e: ApiError) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, ready, JSON.stringify(items)]);

  // the payment methods this basket can use right now
  const methods = useMemo(() => {
    if (!quote) return [];
    return [
      ...(quote.paymentOptions.cod.enabled ? [{ id: 'cod', label: METHOD_LABEL.cod }] : []),
      ...quote.paymentOptions.online.map((m) => ({ id: m.gateway, label: m.label })),
    ];
  }, [quote]);
  useEffect(() => {
    if (methods.length && !methods.some((m) => m.id === method)) setMethod(methods[0].id);
  }, [methods, method]);

  if (!ready) return <p className="py-20 text-center text-slate-500" role="status">Loading…</p>;
  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Your basket is empty</h1>
        <Link href={`${base}/products`} className={`${shopButton} mt-6`}>Browse products</Link>
      </div>
    );
  }

  const online = method !== 'cod';
  const blocked = !quote || quote.problems.length > 0 || methods.length === 0 || !method;

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!quote || blocked) return;
    setBusy(true);
    setError('');
    setFields({});
    setBasketChanged(false);
    // One key per attempt: if the connection drops and the customer retries, they never get two orders.
    const keyName = `idem:${sub}:${method}:${JSON.stringify(items)}`;
    let key = sessionStorage.getItem(keyName);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(keyName, key);
    }
    try {
      const res = await post<{ number: number; total: number; redirect?: RedirectForm }>(`/shop/${encodeURIComponent(sub)}/checkout`, {
        items,
        customer: { name, phone, email: email || undefined },
        ...(quote.hasPhysical ? { shippingAddress: { line1, line2: line2 || undefined, city, province: province || undefined, postalCode: postalCode || undefined } } : {}),
        paymentMethod: method,
        note: note || undefined,
        idempotencyKey: key,
      });
      const placed: PlacedOrder = { number: res.number, total: res.total, contact: email || phone };
      sessionStorage.setItem(`placed:${sub}`, JSON.stringify(placed));
      sessionStorage.removeItem(keyName);
      if (res.redirect) {
        // the basket stays until the payment is confirmed, so a failed payment loses nothing
        submitToGateway(res.redirect);
        return;
      }
      clear();
      router.push(`${base}/order-placed`);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.code === 'cart_changed' || err.code === 'out_of_stock') {
          setBasketChanged(true);
          sessionStorage.removeItem(keyName);
        }
        setFields(Object.fromEntries((err.details ?? []).filter((d) => d.field).map((d) => [d.field, d.message])));
      } else setError('Could not place your order. Please try again.');
    }
  }

  const err = (k: string) => fields[k];

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
      <CheckoutSteps current={2} />
      <form onSubmit={placeOrder} className="mt-6 grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-8">
          {error && (
            <div role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
              {basketChanged && <Link href={`${base}/cart`} className="ml-2 font-semibold underline">Review basket</Link>}
            </div>
          )}

          <section aria-labelledby="contact" className="space-y-4">
            <h2 id="contact" className="text-lg font-semibold">Contact</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field label="Full name" error={err('customer.name')}><input required minLength={2} maxLength={80} autoComplete="name" className={shopInput} value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
              <Field label="Phone" error={err('customer.phone')} hint="The courier or the store may call this number."><input required type="tel" inputMode="tel" autoComplete="tel" placeholder="0300 1234567" className={shopInput} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
              <Field label={quote?.hasDigital ? 'Email' : 'Email (optional)'} error={err('customer.email')} hint={quote?.hasDigital ? 'Your download link is shown on your order page and tied to this email.' : 'For order updates.'}><input type="email" required={quote?.hasDigital} autoComplete="email" className={shopInput} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            </div>
          </section>

          {quote?.hasPhysical && (
            <section aria-labelledby="address" className="space-y-4">
              <h2 id="address" className="text-lg font-semibold">Delivery address</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2"><Field label="Address" error={err('shippingAddress.line1')}><input required minLength={3} maxLength={200} autoComplete="address-line1" placeholder="House, street, area" className={shopInput} value={line1} onChange={(e) => setLine1(e.target.value)} /></Field></div>
                <div className="sm:col-span-2"><Field label="Apartment, landmark (optional)"><input maxLength={200} autoComplete="address-line2" className={shopInput} value={line2} onChange={(e) => setLine2(e.target.value)} /></Field></div>
                <Field label="City" error={err('shippingAddress.city')}><input required minLength={2} maxLength={60} autoComplete="address-level2" className={shopInput} value={city} onChange={(e) => setCity(e.target.value)} /></Field>
                <Field label="Province"><select className={shopInput} value={province} onChange={(e) => setProvince(e.target.value)}><option value="">Select</option>{PROVINCES.map((p) => <option key={p}>{p}</option>)}</select></Field>
                <Field label="Postal code (optional)"><input maxLength={12} autoComplete="postal-code" inputMode="numeric" className={shopInput} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} /></Field>
              </div>
            </section>
          )}

          <section aria-labelledby="pay" className="space-y-3">
            <h2 id="pay" className="text-lg font-semibold">Payment</h2>
            {quote && methods.length === 0 && (
              <p role="status" className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {quote.hasDigital ? 'This store has not switched on an online payment method yet, which digital products need.' : `No payment method is available for this order${store.cod.maxOrderAmount ? ` (Cash on Delivery limit ${rs(store.cod.maxOrderAmount)})` : ''}.`}
                {' '}<Link href={`${base}/cart`} className="font-semibold underline">Edit basket</Link>
              </p>
            )}
            <div role="radiogroup" aria-label="Payment method" className="space-y-2.5">
              {methods.map((m) => (
                <label key={m.id} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${method === m.id ? 'border-ink bg-slate-50 ring-1 ring-ink' : 'border-slate-300 hover:border-slate-400'}`}>
                  <input type="radio" name="pay" className="mt-1" checked={method === m.id} onChange={() => setMethod(m.id)} />
                  <span>
                    <span className="block font-medium">{m.label}</span>
                    <span className="block text-sm text-slate-600">{HELP[m.id] ?? ''}</span>
                  </span>
                </label>
              ))}
            </div>
            <Field label="Order note (optional)"><textarea rows={2} maxLength={500} className={shopInput} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything we should know?" /></Field>
          </section>
        </div>

        <aside className="h-fit rounded-3xl border border-slate-200 bg-slate-50 p-6" aria-label="Order summary">
          <h2 className="text-lg font-semibold">Your order</h2>
          {!quote ? <p className="mt-4 text-sm text-slate-500" role="status">Checking prices…</p> : (
            <>
              <ul className="mt-4 divide-y divide-slate-200 text-sm">
                {quote.lines.map((l) => (
                  <li key={l.sku} className="flex justify-between gap-3 py-2.5">
                    <span className="min-w-0"><span className="line-clamp-2">{l.name}</span><span className="text-xs text-slate-500">{attrLabel(l.attributes)} × {l.quantity}</span></span>
                    <span className="shrink-0 font-medium">{rs(l.lineTotal)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm">
                <div className="flex justify-between"><dt>Subtotal</dt><dd>{rs(quote.subtotal)}</dd></div>
                {quote.hasPhysical && <div className="flex justify-between"><dt>Delivery</dt><dd>{quote.shipping === 0 ? 'Free' : rs(quote.shipping)}</dd></div>}
                <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-semibold"><dt>Total</dt><dd>{rs(quote.total)}</dd></div>
              </dl>
            </>
          )}
          <button type="submit" disabled={blocked || busy} className={`${shopButton} mt-5 w-full`}>
            {busy ? (online ? 'Taking you to the payment page…' : 'Placing your order…') : online ? `Pay ${quote ? rs(quote.total) : ''} with ${METHOD_LABEL[method] ?? 'card'}` : 'Place order'}
          </button>
          <Link href={`${base}/cart`} className={`${shopButtonOutline} mt-3 w-full`}>Back to basket</Link>
          <p className="mt-3 text-center text-xs text-slate-500">{online ? 'You will pay on the payment provider\'s secure page, then come back here.' : `You pay ${quote ? rs(quote.total) : 'the total'} to the courier on delivery.`}</p>
        </aside>
      </form>
    </div>
  );
}
