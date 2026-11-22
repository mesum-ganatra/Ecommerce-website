'use client';

import { useEffect, useState } from 'react';
import { shopButton, shopInput } from '@/components/shop/ui';
import { useShop } from '@/components/shop/shop-context';
import { ApiError, post } from '@/lib/api';
import { rs } from '@/lib/format';
import { attrLabel, type PlacedOrder, type TrackedOrder } from '@/lib/shop-client';

const STEPS = [
  ['pending', 'Order placed'],
  ['processing', 'Being prepared'],
  ['shipped', 'On the way'],
  ['delivered', 'Delivered'],
] as const;

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export default function TrackPage() {
  const { sub } = useShop();
  const [number, setNumber] = useState('');
  const [contact, setContact] = useState('');
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // after checkout, pre-fill the form from this browser's session (nothing personal goes in the URL)
  useEffect(() => {
    try {
      const placed = JSON.parse(sessionStorage.getItem(`placed:${sub}`) ?? 'null') as PlacedOrder | null;
      if (placed) {
        setNumber(String(placed.number));
        setContact(placed.contact);
      }
    } catch {
      /* ignore */
    }
  }, [sub]);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOrder(null);
    try {
      setOrder(await post<TrackedOrder>(`/shop/${encodeURIComponent(sub)}/orders/lookup`, { number: Number(number.replace(/\D/g, '')), contact }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const [dlError, setDlError] = useState('');
  async function download(id: string) {
    setDlError('');
    try {
      const r = await post<{ url: string }>(`/shop/${encodeURIComponent(sub)}/downloads/${id}/link`, { number: Number(number.replace(/D/g, '')), contact });
      window.location.href = r.url;
      setTimeout(() => lookup(new Event('submit') as unknown as React.FormEvent), 2500); // refresh the downloads left
    } catch (err) {
      setDlError(err instanceof ApiError ? err.message : 'Could not start the download');
    }
  }

  const stepIndex = order ? STEPS.findIndex(([s]) => s === (order.status === 'completed' ? 'delivered' : order.status)) : -1;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Track your order</h1>
      <p className="mt-1 text-sm text-slate-600">Enter your order number and the phone or email you used when ordering.</p>

      <form onSubmit={lookup} className="mt-6 grid gap-4 sm:grid-cols-[140px_1fr_auto] sm:items-end">
        <label className="block"><span className="mb-1.5 block text-sm font-medium">Order number</span><input required inputMode="numeric" placeholder="e.g. 1042" className={shopInput} value={number} onChange={(e) => setNumber(e.target.value)} /></label>
        <label className="block"><span className="mb-1.5 block text-sm font-medium">Phone or email</span><input required className={shopInput} value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="off" /></label>
        <button type="submit" disabled={busy} className={shopButton}>{busy ? 'Looking…' : 'Find order'}</button>
      </form>

      {error && <p role="alert" className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      {order && (
        <section aria-label={`Order ${order.number}`} className="mt-8 rounded-3xl border border-slate-200 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-bold">Order #{order.number}</h2>
            <span className="text-sm text-slate-500">Placed {when(order.createdAt)}</span>
          </div>

          {order.status === 'cancelled' ? (
            <p role="status" className="mt-4 rounded-2xl bg-slate-100 px-4 py-3 text-sm">This order was cancelled. If this is a surprise, please contact the store.</p>
          ) : (
            <ol className="mt-6 grid grid-cols-4 gap-2 text-center text-xs sm:text-sm" aria-label="Order progress">
              {STEPS.map(([s, label], i) => (
                <li key={s} aria-current={i === stepIndex ? 'step' : undefined}>
                  <div className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${i <= stepIndex ? 'bg-ink text-inverse' : 'bg-slate-100 text-slate-400'}`}>{i < stepIndex ? '✓' : i + 1}</div>
                  <div className={`mt-2 ${i <= stepIndex ? 'font-medium text-slate-900' : 'text-slate-400'}`}>{label}</div>
                </li>
              ))}
            </ol>
          )}

          {order.shipment && (
            <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm">
              <div className="font-medium">Shipped with {order.shipment.courier}</div>
              {order.shipment.trackingNumber ? (
                <div className="mt-1 text-slate-600">
                  Tracking number: <strong className="text-slate-900">{order.shipment.trackingNumber}</strong>
                  {order.shipment.trackingUrl && <> · <a href={order.shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline">Track with the courier</a></>}
                </div>
              ) : <div className="mt-1 text-slate-600">A tracking number will appear here soon.</div>}
            </div>
          )}

          {order.downloads && order.downloads.length > 0 && (
            <div className="mt-6 rounded-2xl bg-emerald-50 p-4 text-sm">
              <div className="font-medium text-emerald-900">Your downloads</div>
              <ul className="mt-2 space-y-2">
                {order.downloads.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{d.name} <span className="text-xs text-emerald-800">{d.expired ? 'expired' : `${d.remaining} download${d.remaining === 1 ? '' : 's'} left`}</span></span>
                    <button type="button" disabled={d.expired || d.remaining === 0} className={`${shopButton} !px-4 !py-1.5`} onClick={() => download(d.id)}>Download</button>
                  </li>
                ))}
              </ul>
              {dlError && <p role="alert" className="mt-2 text-red-700">{dlError}</p>}
            </div>
          )}

          <ul className="mt-6 divide-y divide-slate-200 border-y border-slate-200 text-sm">
            {order.items.map((i) => (
              <li key={i.sku} className="flex justify-between gap-3 py-3">
                <span>{i.name} <span className="text-slate-500">{attrLabel(i.attributes)} × {i.quantity}</span></span>
                <span className="font-medium">{rs(i.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{rs(order.totals.subtotal)}</dd></div>
            {order.totals.shipping > 0 && <div className="flex justify-between"><dt>Delivery</dt><dd>{rs(order.totals.shipping)}</dd></div>}
            <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd>{rs(order.totals.total)}</dd></div>
          </dl>
          <p className="mt-3 text-sm text-slate-600">
            {order.paymentStatus === 'paid' ? 'Paid. Thank you!' : order.paymentMethod === 'cod' ? 'Pay in cash when it arrives.' : ''}
            {order.shippingAddress ? ` Delivering to ${order.shippingAddress.city}.` : ''}
          </p>
        </section>
      )}
    </div>
  );
}
