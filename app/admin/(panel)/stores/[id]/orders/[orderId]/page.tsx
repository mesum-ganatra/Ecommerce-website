'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { OrderPanel } from '@/components/admin/order-panel';
import { useStore } from '@/components/admin/store-context';

export default function OrderPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { store } = useStore();
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/admin/stores/${store._id}/orders`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft size={15} /> Orders</Link>
      <OrderPanel orderId={orderId} />
    </div>
  );
}
