'use client';

import { Plus } from 'lucide-react';
import { useShop } from './shop-context';

/** One-click add for products with a single choice. Sits on top of the product card image. */
export function QuickAdd({ sku, name }: { sku: string; name: string }) {
  const { add, openCart } = useShop();
  return (
    <button
      type="button"
      onClick={() => { add(sku, 1); openCart(); }}
      aria-label={`Add ${name} to basket`}
      className="absolute bottom-3 right-3 flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-accent text-white opacity-0 shadow-lg transition-all duration-200 hover:brightness-110 focus-visible:translate-y-0 focus-visible:opacity-100 group-hover/card:translate-y-0 group-hover/card:opacity-100 max-md:translate-y-0 max-md:opacity-100"
    >
      <Plus size={18} aria-hidden />
    </button>
  );
}
