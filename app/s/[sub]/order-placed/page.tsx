'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { shopButton, shopButtonOutline } from '@/components/shop/ui';
import { useShop } from '@/components/shop/shop-context';
import { SuccessMark } from '@/components/shop/success-mark';
import { rs } from '@/lib/format';
import type { PlacedOrder } from '@/lib/shop-client';

export default function OrderPlacedPage() {
  const { sub, base } = useShop();
  const [placed, setPlaced] = useState<PlacedOrder | null | undefined>(undefined);

  useEffect(() => {
    try {
      setPlaced(JSON.parse(sessionStorage.getItem(`placed:${sub}`) ?? 'null'));
    } catch {
      setPlaced(null);
    }
  }, [sub]);

  if (placed === undefined) return <p className="py-20 text-center text-slate-500" role="status">Loading…</p>;
  if (!placed) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Looking for an order?</h1>
        <p className="mt-2 text-slate-600">Use your order number and the phone or email you ordered with.</p>
        <Link href={`${base}/track`} className={`${shopButton} mt-6`}>Track an order</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <SuccessMark />
      <h1 className="mt-5 text-3xl font-bold tracking-tight">Thank you! Your order is placed.</h1>
      <p className="mt-3 text-slate-600">Your order number is</p>
      <p className="text-4xl font-bold tracking-tight">#{placed.number}</p>
      <div className="mx-auto mt-8 max-w-md rounded-3xl border border-slate-200 bg-slate-50 p-6 text-left text-sm">
        <div className="flex justify-between"><span>Pay on delivery</span><strong>{rs(placed.total)}</strong></div>
        <ul className="mt-4 list-disc space-y-1.5 pl-5 text-slate-600">
          <li>We will confirm your order and pack it.</li>
          <li>The courier will call you before delivery. Please keep the exact cash ready.</li>
          <li>Keep your order number. You can follow it any time with {placed.contact.includes('@') ? 'your email' : 'your phone number'}.</li>
        </ul>
      </div>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href={`${base}/track`} className={shopButton}>Track this order</Link>
        <Link href={`${base}/products`} className={shopButtonOutline}>Continue shopping</Link>
      </div>
    </div>
  );
}
