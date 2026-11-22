'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ShopVariant } from '@/lib/shop-api';
import { Price, shopButton, shopButtonOutline } from './ui';
import { useShop } from './shop-context';

const label = (v: ShopVariant) => Object.values(v.attributes).join(' / ') || 'Standard';

export function ProductBuy({ variants, digital }: { variants: ShopVariant[]; digital: boolean }) {
  const { add, openCart, base, items } = useShop();
  const firstAvailable = variants.find((v) => v.inStock) ?? variants[0];
  const [sku, setSku] = useState(firstAvailable?.sku);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const variant = useMemo(() => variants.find((v) => v.sku === sku), [variants, sku]);
  if (!variant) return <p className="text-slate-600">This product is not available right now.</p>;

  const inBasket = items.find((i) => i.sku === variant.sku)?.quantity ?? 0;
  const room = Math.max(0, variant.maxQuantity - inBasket);
  const canAdd = variant.inStock && room > 0;

  return (
    <div className="space-y-5">
      <div className="text-2xl">
        <Price price={variant.price} compareAt={variant.compareAtPrice} />
        {variant.compareAtPrice && variant.compareAtPrice > variant.price && (
          <span className="ml-3 align-middle rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
            Save {Math.round(((variant.compareAtPrice - variant.price) / variant.compareAtPrice) * 100)}%
          </span>
        )}
      </div>

      {variants.length > 1 && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Choose an option</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => (
              <label
                key={v.sku}
                className={`cursor-pointer rounded-full border px-4 py-2 text-sm ${v.sku === sku ? 'border-ink bg-ink text-inverse' : v.inStock ? 'border-slate-300 hover:border-ink' : 'cursor-not-allowed border-slate-200 text-slate-400 line-through'}`}
              >
                <input
                  type="radio"
                  name="variant"
                  className="sr-only"
                  value={v.sku}
                  checked={v.sku === sku}
                  disabled={!v.inStock}
                  onChange={() => {
                    setSku(v.sku);
                    setQty(1);
                    setAdded(false);
                  }}
                />
                {label(v)}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <p className="text-sm" aria-live="polite">
        {!variant.inStock ? (
          <span className="font-medium text-red-700">Sold out</span>
        ) : variant.fewLeft ? (
          <span className="font-medium text-amber-700">Only a few left</span>
        ) : digital ? (
          <span className="text-slate-600">Instant download after payment</span>
        ) : (
          <span className="font-medium text-emerald-700">In stock</span>
        )}
      </p>

      {variant.inStock && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center rounded-full border border-slate-300" role="group" aria-label="Quantity">
            <button type="button" className="h-11 w-11 text-lg disabled:text-inverse/70" disabled={qty <= 1} onClick={() => setQty(qty - 1)} aria-label="Decrease quantity">−</button>
            <span className="w-8 text-center text-sm font-medium" aria-live="polite">{qty}</span>
            <button type="button" className="h-11 w-11 text-lg disabled:text-inverse/70" disabled={qty >= room} onClick={() => setQty(qty + 1)} aria-label="Increase quantity">+</button>
          </div>
          <button
            type="button"
            className={`${shopButton} flex-1 sm:flex-none sm:min-w-52`}
            disabled={!canAdd}
            onClick={() => {
              add(variant.sku, Math.min(qty, room));
              openCart();
              setAdded(true);
              setQty(1);
            }}
          >
            {canAdd ? 'Add to basket' : 'Maximum in basket'}
          </button>
        </div>
      )}

      {added && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Added to your basket.
          <Link href={`${base}/cart`} className={`${shopButtonOutline} !px-4 !py-1.5`}>View basket</Link>
        </div>
      )}
      {inBasket > 0 && !added && <p className="text-xs text-slate-500">{inBasket} already in your basket.</p>}
    </div>
  );
}
