'use client';

import { ImageOff, LayoutGrid, List, Plus, Search, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useStore } from '@/components/admin/store-context';
import { Alert, Badge, Button, Card, EmptyState, Input, Select, Skeleton } from '@/components/admin/ui';
import { ApiError, get, mediaUrl } from '@/lib/api';
import { priceRange } from '@/lib/format';
import type { Category, Page, ProductRow } from '@/lib/types';

const statusTone = (s: string) => (s === 'active' ? 'good' : s === 'draft' ? 'warn' : 'neutral');

function Thumb({ src, className }: { src: string | null; className: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={mediaUrl(src)} alt="" loading="lazy" className={`${className} object-cover`} />
  ) : (
    <div className={`${className} flex items-center justify-center bg-slate-100 text-slate-400`}><ImageOff size={18} aria-label="No photo" /></div>
  );
}

export default function ProductsPage() {
  const { store, can } = useStore();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [data, setData] = useState<Page<ProductRow> | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    try { const v = localStorage.getItem('admin:products-view'); if (v === 'grid' || v === 'list') setView(v); } catch { /* ignore */ }
  }, []);
  const pick = (v: 'grid' | 'list') => { setView(v); try { localStorage.setItem('admin:products-view', v); } catch { /* ignore */ } };

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    get<{ items: Category[] }>(`/stores/${store._id}/categories`).then((d) => setCategories(d.items)).catch(() => undefined);
  }, [store._id]);
  useEffect(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '24' });
    if (debounced) qs.set('search', debounced);
    if (status) qs.set('status', status);
    if (type) qs.set('type', type);
    if (categoryId) qs.set('categoryId', categoryId);
    if (lowStock) qs.set('lowStock', '1');
    let alive = true;
    get<Page<ProductRow>>(`/stores/${store._id}/products?${qs}`)
      .then((d) => alive && (setData(d), setError('')))
      .catch((e: ApiError) => alive && setError(e.message));
    return () => { alive = false; };
  }, [store._id, debounced, status, type, categoryId, lowStock, page]);

  const reset = (fn: () => void) => () => { fn(); setPage(1); };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const filtered = Boolean(debounced || status || type || categoryId || lowStock);
  const base = `/admin/stores/${store._id}/products`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Products{data ? <span className="ml-2 text-sm font-normal text-slate-500">{data.total}</span> : null}</h2>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="View" className="inline-flex rounded-lg border border-slate-200 bg-surface p-0.5">
            <button type="button" aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => pick('grid')} className={`rounded-md p-1.5 transition-colors ${view === 'grid' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}><LayoutGrid size={16} /></button>
            <button type="button" aria-label="List view" aria-pressed={view === 'list'} onClick={() => pick('list')} className={`rounded-md p-1.5 transition-colors ${view === 'list' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}><List size={16} /></button>
          </div>
          {can('product.write') && <Link href={`${base}/new`}><Button><Plus size={16} /> New product</Button></Link>}
        </div>
      </div>

      {store.type === 'external' && <Alert tone="info">Products of an external store are copied in from its website. Changes made here may be overwritten by the next sync.</Alert>}

      <Card padded={false}>
        <div className="flex flex-wrap gap-3 p-4">
          <div className="relative min-w-56 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input type="search" aria-label="Search products" placeholder="Search by name, brand or SKU" className="!pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select aria-label="Status" value={status} onChange={(e) => reset(() => setStatus(e.target.value))()} className="!w-36"><option value="">Not archived</option><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option></Select>
          <Select aria-label="Type" value={type} onChange={(e) => reset(() => setType(e.target.value))()} className="!w-32"><option value="">All types</option><option value="physical">Physical</option><option value="digital">Digital</option></Select>
          <Select aria-label="Category" value={categoryId} onChange={(e) => reset(() => setCategoryId(e.target.value))()} className="!w-44"><option value="">All categories</option>{categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={lowStock} onChange={(e) => reset(() => setLowStock(e.target.checked))()} /> Low stock only</label>
        </div>

        {error && <div className="px-4 pb-4"><Alert>{error}</Alert></div>}
        {!data && !error && <div className="grid grid-cols-2 gap-4 p-4 pt-0 sm:grid-cols-3 lg:grid-cols-4">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <Skeleton key={i} className="h-56" />)}</div>}
        {data && data.items.length === 0 && (
          <EmptyState icon={<ImageOff size={22} />} title={filtered ? 'No products match' : 'No products yet'} action={!filtered && can('product.write') ? <Link href={`${base}/new`}><Button><Plus size={16} /> Add your first product</Button></Link> : undefined}>
            {filtered ? 'Try different filters.' : 'Add products so customers can start shopping.'}
          </EmptyState>
        )}

        {data && data.items.length > 0 && view === 'grid' && (
          <ul className="grid grid-cols-2 gap-4 p-4 pt-0 sm:grid-cols-3 lg:grid-cols-4">
            {data.items.map((p) => (
              <li key={p._id}>
                <Link href={`${base}/${p._id}`} className="group block overflow-hidden rounded-xl border border-slate-200 bg-surface transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <div className="relative aspect-square overflow-hidden bg-slate-100">
                    <Thumb src={p.image} className="h-full w-full transition-transform duration-300 group-hover:scale-105" />
                    <div className="absolute left-2 top-2 flex gap-1.5"><Badge tone={statusTone(p.status)}>{p.status}</Badge>{p.type === 'digital' && <Badge tone="info">digital</Badge>}</div>
                    {p.lowStock && <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"><TriangleAlert size={12} /> low stock</span>}
                  </div>
                  <div className="p-3">
                    <div className="truncate text-sm font-medium group-hover:text-brand-700">{p.name}</div>
                    <div className="truncate text-xs text-slate-500">{p.category?.name ?? 'No category'}{p.stock !== null ? ` · ${p.stock} in stock` : ''}</div>
                    <div className="mt-1 text-sm font-semibold">{priceRange(p.priceMin, p.priceMax)}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {data && data.items.length > 0 && view === 'list' && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-y border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-2.5 font-medium">Product</th><th className="px-3 py-2.5 font-medium">Type</th><th className="px-3 py-2.5 font-medium">Status</th><th className="px-3 py-2.5 font-medium">Price</th><th className="px-5 py-2.5 text-right font-medium">Stock</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((p) => (
                  <tr key={p._id} className="transition-colors hover:bg-slate-50">
                    <td className="px-5 py-3"><div className="flex items-center gap-3"><Thumb src={p.image} className="h-10 w-10 rounded-md border border-slate-200" /><div><Link href={`${base}/${p._id}`} className="font-medium text-brand-700 hover:underline">{p.name}</Link><div className="text-xs text-slate-500">{p.category?.name ?? 'No category'} · {p.variantCount} {p.variantCount === 1 ? 'variant' : 'variants'}</div></div></div></td>
                    <td className="px-3 py-3"><Badge tone={p.type === 'digital' ? 'info' : 'neutral'}>{p.type}</Badge></td>
                    <td className="px-3 py-3"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-3">{priceRange(p.priceMin, p.priceMax)}</td>
                    <td className="px-5 py-3 text-right">{p.stock === null ? <span className="text-slate-400">n/a</span> : <span className={p.lowStock ? 'font-medium text-amber-700' : ''}>{p.stock}{p.lowStock && <span className="ml-1.5"><Badge tone="warn">low</Badge></span>}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total > data.limit && (
          <div className="flex items-center justify-between border-t border-slate-100 p-4 text-sm text-slate-600">
            <span>{data.total} products</span>
            <div className="flex items-center gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {pages}</span><Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>
          </div>
        )}
      </Card>
    </div>
  );
}
