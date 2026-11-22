'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useStore } from '@/components/admin/store-context';
import { ProductForm } from '@/components/admin/product-form';
import { Alert, Badge, ConfirmButton, Loading } from '@/components/admin/ui';
import { ApiError, del, get } from '@/lib/api';
import type { ProductDetail } from '@/lib/types';

export default function EditProductPage() {
  const { productId } = useParams<{ productId: string }>();
  const { store, can } = useStore();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState('');
  const [archived, setArchived] = useState(false);

  useEffect(() => {
    get<ProductDetail>(`/stores/${store._id}/products/${productId}`)
      .then(setProduct)
      .catch((e: ApiError) => setError(e.status === 404 ? 'This product does not exist.' : e.message));
  }, [store._id, productId]);

  if (error) return <Alert>{error}</Alert>;
  if (!product) return <Loading />;

  const writable = can('product.write');
  return (
    <>
      <div className="mb-4">
        <Link href={`/admin/stores/${store._id}/products`} className="text-sm text-slate-600 hover:underline">← Products</Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            {product.name}
            <Badge tone={product.type === 'digital' ? 'info' : 'neutral'}>{product.type}</Badge>
          </h2>
          {writable && !archived && product.status !== 'archived' && (
            <ConfirmButton
              label="Archive"
              confirmLabel="Yes, archive"
              onConfirm={async () => {
                await del(`/stores/${store._id}/products/${product._id}`);
                setArchived(true);
              }}
            />
          )}
        </div>
      </div>
      {archived && <div className="mb-4"><Alert tone="good">Archived. It is hidden from the storefront and the default list. Set the status back to Draft to restore it.</Alert></div>}
      {writable ? (
        <ProductForm key={`${product._id}-${archived}`} storeId={store._id} product={archived ? { ...product, status: 'archived' } : product} />
      ) : (
        <Alert tone="info">Your role can view this product but not change it.</Alert>
      )}
    </>
  );
}
