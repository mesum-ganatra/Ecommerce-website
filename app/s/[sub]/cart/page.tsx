'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Price, shopButton, shopButtonOutline } from '@/components/shop/ui';
import { useShop } from '@/components/shop/shop-context';
import { ApiError, mediaUrl } from '@/lib/api';
import { rs } from '@/lib/format';
import { attrLabel, getQuote, type Quote, type QuoteLine } from '@/lib/shop-client';

export default function CartPage() {
  const { sub, base, store, items, ready, setQuantity, remove } = useShop();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const signature = JSON.stringify(items);
  useEffect(() => {
    if (!ready) return;
    if (items.length === 0) {
      setQuote(null);
      return;
    }
    let alive = true;
    setLoading(true);
    getQuote(sub, items)
      .then((q) => alive && (setQuote(q), setError('')))
      .catch((e: ApiError) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, ready, signature]);

  if (!ready) return <p className="py-20 text-center text-slate-500" role="status">Loading your basket…</p>;

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Your basket is empty</h1>
        <p className="mt-2 text-slate-600">Add something you like and it will show up here.</p>
        <Link href={`${base}/products`} className={`${shopButton} mt-6`}>Browse products</Link>
      </div>
    );
  }

  const problemOf = (sku: string) => quote?.problems.find((p) => p.sku === sku);
  const hasProblems = (quote?.problems.length ?? 0) > 0;
  const freeAbove = store.shipping.freeAbove;
  const toFree = quote && quote.hasPhysical && freeAbove && quote.subtotal < freeAbove ? freeAbove - quote.subtotal : 0;

  function fixBasket() {
    for (const p of quote?.problems ?? []) {
      if (p.code === 'unavailable' || !p.available) remove(p.sku);
      else setQuantity(p.sku, p.available);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Your basket</h1>
      {error && <p role="alert" className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_360px]">
        <ul className="divide-y divide-slate-200 border-y border-slate-200">
          {(quote?.lines ?? items.map((i) => ({ sku: i.sku, name: i.sku, slug: '', type: 'physical' as const, attributes: {}, image: null, unitPrice: 0, compareAtPrice: undefined, quantity: i.quantity, lineTotal: 0, available: null } satisfies QuoteLine))).map((l) => {
            const problem = problemOf(l.sku);
            return (
              <li key={l.sku} className="flex gap-4 py-5">
                <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-slate-100">
                  {l.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaUrl(l.image)} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`${base}/products/${l.slug}`} className="line-clamp-2 font-medium hover:underline">{l.name}</Link>
                      <div className="text-sm text-slate-500">{attrLabel(l.attributes)}{l.type === 'digital' ? ' · Digital' : ''}</div>
                    </div>
                    <div className="text-right font-semibold">{quote ? rs(l.lineTotal) : ''}</div>
                  </div>
                  {problem && <p role="alert" className="mt-1 text-sm font-medium text-red-700">{problem.message}</p>}
                  <div className="mt-auto flex items-center justify-between pt-3">
                    <div className="inline-flex items-center rounded-full border border-slate-300" role="group" aria-label={`Quantity of ${l.name}`}>
                      <button type="button" className="h-9 w-9 text-lg" onClick={() => setQuantity(l.sku, l.quantity - 1)} aria-label="Decrease quantity">−</button>
                      <span className="w-8 text-center text-sm font-medium">{l.quantity}</span>
                      <button type="button" className="h-9 w-9 text-lg disabled:text-inverse/70" disabled={l.available !== null && l.quantity >= l.available} onClick={() => setQuantity(l.sku, l.quantity + 1)} aria-label="Increase quantity">+</button>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      {quote && <span className="text-slate-500"><Price price={l.unitPrice} compareAt={l.compareAtPrice} /> each</span>}
                      <button type="button" className="font-medium text-slate-600 underline-offset-4 hover:underline" onClick={() => remove(l.sku)}>Remove</button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <aside className="h-fit rounded-3xl border border-slate-200 bg-slate-50 p-6" aria-label="Order summary">
          <h2 className="text-lg font-semibold">Summary</h2>
          {!quote ? (
            <p className="mt-4 text-sm text-slate-500" role="status">{loading ? 'Checking prices…' : ''}</p>
          ) : (
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{rs(quote.subtotal)}</dd></div>
              {quote.hasPhysical && <div className="flex justify-between"><dt>Delivery</dt><dd>{quote.shipping === 0 ? 'Free' : rs(quote.shipping)}</dd></div>}
              <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-semibold"><dt>Total</dt><dd>{rs(quote.total)}</dd></div>
            </dl>
          )}
          {toFree > 0 && <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Add {rs(toFree)} more for free delivery.</p>}

          {hasProblems ? (
            <div className="mt-5 space-y-2">
              <p className="text-sm text-red-700">Some items need your attention before you can check out.</p>
              <button type="button" className={`${shopButton} w-full`} onClick={fixBasket}>Update my basket</button>
            </div>
          ) : quote?.hasDigital ? (
            <div className="mt-5 space-y-2">
              <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Digital products need online payment, which is not available yet. Remove them to pay on delivery.</p>
              <span className={`${shopButton} w-full cursor-not-allowed opacity-50`} aria-disabled>Checkout</span>
            </div>
          ) : (
            <Link href={`${base}/checkout`} className={`${shopButton} mt-5 w-full`} aria-disabled={!quote}>Checkout</Link>
          )}
          <Link href={`${base}/products`} className={`${shopButtonOutline} mt-3 w-full`}>Keep shopping</Link>
        </aside>
      </div>
    </div>
  );
}
