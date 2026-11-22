'use client';

import { createContext, useContext } from 'react';
import type { Store } from '@/lib/types';

export interface StoreCtx {
  store: Store;
  setStore: (s: Store) => void;
  /** true for the Super Admin, or when the user's role in this store holds the permission */
  can: (permission: string) => boolean;
}

export const StoreContext = createContext<StoreCtx | null>(null);

export function useStore(): StoreCtx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside the store layout');
  return ctx;
}
