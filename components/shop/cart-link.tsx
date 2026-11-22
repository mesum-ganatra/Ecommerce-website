'use client';

import { ShoppingBag } from 'lucide-react';
import { useShop } from './shop-context';

/** The basket button in the header: opens the slide-in basket and shows how many items are in it. */
export function CartLink() {
  const { count, ready, openCart } = useShop();
  return (
    <button type="button" onClick={openCart} className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-900 transition-colors hover:bg-slate-100" aria-label={`Open basket, ${ready ? count : 0} items`}>
      <ShoppingBag size={20} aria-hidden />
      {ready && count > 0 && (
        <span key={count} className="animate-pop absolute -right-0.5 -top-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-white">{count}</span>
      )}
    </button>
  );
}
