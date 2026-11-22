'use client';

import Link from 'next/link';
import { useStore } from '@/components/admin/store-context';
import { ProductForm } from '@/components/admin/product-form';
import { Alert } from '@/components/admin/ui';

export default function NewProductPage() {
  const { store, can } = useStore();
  if (!can('product.write')) return <Alert>Your role cannot create products.</Alert>;
  return (
    <>
      <div className="mb-4 text-sm">
        <Link href={`/admin/stores/${store._id}/products`} className="text-slate-600 hover:underline">← Products</Link>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">New product</h2>
      </div>
      <ProductForm storeId={store._id} />
    </>
  );
}
