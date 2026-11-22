'use client';

import { Minus, Plus, ShoppingBag, Trash2, Truck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Drawer } from '@/components/admin/ui';
import { mediaUrl } from '@/lib/api';
import { rs } from '@/lib/format';
import { attrLabel, getQuote, type Quote } from '@/lib/shop-client';
import { useShop } from './shop-context';
import { shopButton, shopButtonOutline } from './ui';

/** Slide-in basket: change quantities, see the free-delivery progress, and go to checkout. */
export function CartDrawer() {
  const { sub, base, store, items, cartOpen, closeCart, setQuantity, remove, ready } = useShop();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const signature = JSON.stringify(items);

  useEffect(() => {
    if (!cartOpen || !ready) return;
    if (items.length === 0) return void setQuote(null);
    let alive = true;
    setLoading(true);
    getQuote(sub, items).then((q) => alive && setQuote(q)).catch(() => undefined).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartOpen, ready, sub, signature]);

  const freeAbove = store.shipping.freeAbove;
  const progress = quote && quote.hasPhysical && freeAbove ? Math.min(100, (quote.subtotal / freeAbove) * 100) : null;
  const problems = (quote?.problems.length ?? 0) > 0;

  return (
    <Drawer open={cartOpen} onClose={closeCart} title="Your basket">
      {items.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500"><ShoppingBag size={24} /></span>
          <p className="font-medium">Your basket is empty</p>
          <p className="mt-1 text-sm text-slate-500">Add something you like and it will show up here.</p>
          <Link href={`${base}/products`} onClick={closeCart} className={`${shopButton} mt-6`}>Browse products</Link>
        </div>
      ) : (
        <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
          {progress !== null && quote && (
            <div className="mb-5 rounded-2xl bg-slate-50 p-4 text-sm">
              <div className="mb-2 flex items-center gap-2 font-medium"><Truck size={16} aria-hidden />
                {quote.subtotal >= (freeAbove ?? 0) ? 'You get free delivery!' : `Add ${rs((freeAbove ?? 0) - quote.subtotal)} more for free delivery`}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to free delivery"><div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>
            </div>
          )}

          <ul className="flex-1 divide-y divide-slate-200">
            {(quote?.lines ?? items.map((i) => ({ sku: i.sku, name: i.sku, slug: '', type: 'physical' as const, attributes: {}, image: null, unitPrice: 0, compareAtPrice: undefined, quantity: i.quantity, lineTotal: 0, available: null }))).map((l) => {
              const problem = quote?.problems.find((p) => p.sku === l.sku);
              return (
                <li key={l.sku} className="flex gap-3 py-4">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-100">{l.image && /* eslint-disable-next-line @next/next/no-img-element */ <img src={mediaUrl(l.image)} alt="" className="h-full w-full object-cover" />}</div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex justify-between gap-2">
                      <div className="min-w-0"><Link href={`${base}/products/${l.slug}`} onClick={closeCart} className="line-clamp-2 text-sm font-medium hover:underline">{l.name}</Link><div className="text-xs text-slate-500">{attrLabel(l.attributes)}</div></div>
                      <button type="button" onClick={() => remove(l.sku)} aria-label={`Remove ${l.name}`} className="h-fit rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 size={15} /></button>
                    </div>
                    {problem && <p role="alert" className="mt-1 text-xs font-medium text-red-700">{problem.message}</p>}
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <div className="inline-flex items-center rounded-full border border-slate-300" role="group" aria-label={`Quantity of ${l.name}`}>
                        <button type="button" onClick={() => setQuantity(l.sku, l.quantity - 1)} aria-label="Decrease quantity" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100"><Minus size={14} /></button>
                        <span className="w-6 text-center text-sm font-medium">{l.quantity}</span>
                        <button type="button" disabled={l.available !== null && l.quantity >= l.available} onClick={() => setQuantity(l.sku, l.quantity + 1)} aria-label="Increase quantity" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100 disabled:text-slate-300"><Plus size={14} /></button>
                      </div>
                      <span className="text-sm font-semibold">{quote ? rs(l.lineTotal) : ''}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="sticky bottom-0 -mx-6 -mb-6 mt-4 border-t border-slate-200 bg-surface/95 px-6 py-5 backdrop-blur">
            <dl className="mb-4 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd>{quote ? rs(quote.subtotal) : loading ? '…' : ''}</dd></div>
              {quote?.hasPhysical && <div className="flex justify-between"><dt className="text-slate-600">Delivery</dt><dd>{quote.shipping === 0 ? 'Free' : rs(quote.shipping)}</dd></div>}
              <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd>{quote ? rs(quote.total) : ''}</dd></div>
            </dl>
            {problems ? (
              <Link href={`${base}/cart`} onClick={closeCart} className={`${shopButton} w-full`}>Review basket</Link>
            ) : (
              <Link href={`${base}/checkout`} onClick={closeCart} className={`${shopButton} w-full`} aria-disabled={!quote}>Checkout</Link>
            )}
            <Link href={`${base}/cart`} onClick={closeCart} className={`${shopButtonOutline} mt-2 w-full`}>View full basket</Link>
          </div>
        </div>
      )}
    </Drawer>
  );
}
