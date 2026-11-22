'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ShopStore } from '@/lib/shop-api';

export interface CartItem {
  sku: string;
  quantity: number;
}

interface ShopValue {
  sub: string;
  /** '' on the store's own subdomain, '/s/<sub>' when reached by path (development) */
  base: string;
  store: ShopStore;
  items: CartItem[];
  count: number;
  ready: boolean;
  cartOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  add: (sku: string, quantity?: number) => void;
  setQuantity: (sku: string, quantity: number) => void;
  remove: (sku: string) => void;
  clear: () => void;
}

const Ctx = createContext<ShopValue | null>(null);
const MAX_QTY = 99;

export function ShopProvider({ sub, base, store, children }: { sub: string; base: string; store: ShopStore; children: React.ReactNode }) {
  const storageKey = `cart:${sub}`;
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  // The basket lives in this browser only. Prices and stock are always re-checked by the server.
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      if (Array.isArray(raw)) {
        setItems(raw.filter((i) => typeof i?.sku === 'string' && Number.isInteger(i?.quantity) && i.quantity > 0).slice(0, 50));
      }
    } catch {
      /* private mode or corrupted value: start with an empty basket */
    }
    setReady(true);
  }, [storageKey]);

  const persist = useCallback(
    (next: CartItem[]) => {
      setItems(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* storage unavailable: the basket still works for this visit */
      }
    },
    [storageKey],
  );

  const add = useCallback(
    (sku: string, quantity = 1) => {
      const existing = items.find((i) => i.sku === sku);
      persist(existing ? items.map((i) => (i.sku === sku ? { ...i, quantity: Math.min(MAX_QTY, i.quantity + quantity) } : i)) : [...items, { sku, quantity: Math.min(MAX_QTY, quantity) }]);
    },
    [items, persist],
  );
  const setQuantity = useCallback(
    (sku: string, quantity: number) =>
      persist(quantity <= 0 ? items.filter((i) => i.sku !== sku) : items.map((i) => (i.sku === sku ? { ...i, quantity: Math.min(MAX_QTY, quantity) } : i))),
    [items, persist],
  );
  const remove = useCallback((sku: string) => persist(items.filter((i) => i.sku !== sku)), [items, persist]);
  const clear = useCallback(() => persist([]), [persist]);

  const value = useMemo<ShopValue>(
    () => ({ sub, base, store, items, count: items.reduce((n, i) => n + i.quantity, 0), ready, cartOpen, openCart: () => setCartOpen(true), closeCart: () => setCartOpen(false), add, setQuantity, remove, clear }),
    [sub, base, store, items, ready, cartOpen, add, setQuantity, remove, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShop(): ShopValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShop must be used inside the storefront layout');
  return v;
}
