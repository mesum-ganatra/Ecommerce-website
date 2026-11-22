'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { shopButton, shopButtonOutline } from '@/components/shop/ui';
import { useShop } from '@/components/shop/shop-context';
import { SuccessMark } from '@/components/shop/success-mark';
import { rs } from '@/lib/format';
import type { PlacedOrder } from '@/lib/shop-client';

const COPY: Record<string, { title: string; body: string; tone: string }> = {
  paid: { title: 'Payment received. Thank you!', body: 'Your order is confirmed.', tone: 'bg-emerald-100 text-emerald-700' },
  failed: { title: 'The payment did not go through', body: 'You were not charged for this order. Your basket is still here, so you can try again or choose another way to pay.', tone: 'bg-red-100 text-red-700' },
  cancelled: { title: 'You cancelled the payment', body: 'Nothing was charged. Your basket is still here whenever you are ready.', tone: 'bg-slate-200 text-slate-700' },
  mismatch: { title: 'We are checking your payment', body: 'The amount we received did not match your order, so the store will review it. Please do not pay again. Contact the store with your order number.', tone: 'bg-amber-100 text-amber-700' },
  unknown: { title: 'We could not find that payment', body: 'If you paid, do not pay again. Contact the store with the details of your payment.', tone: 'bg-amber-100 text-amber-700' },
};

export default function PayResultPage() {
  const { sub, base, clear } = useShop();
  const [info, setInfo] = useState<{ status: string; order: string; placed: PlacedOrder | null } | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const q = new URLSearchParams(window.location.search);
    let placed: PlacedOrder | null = null;
    try {
      placed = JSON.parse(sessionStorage.getItem(`placed:${sub}`) ?? 'null');
    } catch {
      /* ignore */
    }
    const status = q.get('status') ?? 'unknown';
    if (status === 'paid') clear(); // the basket is emptied only once the payment is confirmed
    setInfo({ status, order: q.get('order') ?? '', placed });
  }, [sub, clear]);

  if (!info) return <p className="py-20 text-center text-slate-500" role="status">Checking your payment…</p>;
  const c = COPY[info.status] ?? COPY.unknown;
  const paid = info.status === 'paid';

  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <SuccessMark kind={paid ? 'success' : info.status === 'failed' ? 'fail' : 'warn'} />
      <h1 className="mt-5 text-3xl font-bold tracking-tight">{c.title}</h1>
      {info.order && <p className="mt-3 text-slate-600">Order number</p>}
      {info.order && <p className="text-4xl font-bold tracking-tight">#{info.order}</p>}
      <p className="mx-auto mt-4 max-w-md text-slate-600" role="status">{c.body}</p>
      {paid && info.placed && <p className="mt-2 text-sm text-slate-600">Paid {rs(info.placed.total)}. You can follow your order, and download any digital items, on the tracking page.</p>}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {paid ? (
          <>
            <Link href={`${base}/track`} className={shopButton}>Track this order</Link>
            <Link href={`${base}/products`} className={shopButtonOutline}>Continue shopping</Link>
          </>
        ) : (
          <>
            <Link href={`${base}/checkout`} className={shopButton}>Try again</Link>
            <Link href={`${base}/cart`} className={shopButtonOutline}>Back to basket</Link>
          </>
        )}
      </div>
    </div>
  );
}
