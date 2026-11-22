import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { ProductCard, shopButtonOutline } from '@/components/shop/ui';
import { shopBase } from '@/lib/shop-base';
import { shopGet, type ShopCategory, type ShopPage, type ShopProductCard } from '@/lib/shop-api';

export const metadata: Metadata = { title: 'All products' };

type SP = { category?: string; search?: string; sort?: string; page?: string };

const SORTS: [string, string][] = [['newest', 'Newest'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['name', 'Name']];

export default async function ProductsPage({ params, searchParams }: { params: Promise<{ sub: string }>; searchParams: Promise<SP> }) {
  const { sub } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const sort = ['newest', 'price_asc', 'price_desc', 'name'].includes(sp.sort ?? '') ? sp.sort! : 'newest';

  const qs = new URLSearchParams({ page: String(page), limit: '12', sort });
  if (sp.category) qs.set('category', sp.category);
  if (sp.search) qs.set('search', sp.search);

  const [list, cats, base] = await Promise.all([
    shopGet<ShopPage<ShopProductCard>>(sub, `/products?${qs}`, 15),
    shopGet<{ items: ShopCategory[] }>(sub, '/categories'),
    shopBase(sub),
  ]);
  const categories = (cats.ok ? cats.data.items : []).filter((c) => c.productCount > 0);
  const data = list.ok ? list.data : { items: [], total: 0, page, limit: 12 };
  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  const activeCategory = categories.find((c) => c.slug === sp.category);
  const sortLabel = SORTS.find(([v]) => v === sort)?.[1] ?? 'Newest';

  const link = (over: Partial<SP>) => {
    const q = new URLSearchParams();
    const merged = { category: sp.category, search: sp.search, sort: sort === 'newest' ? undefined : sort, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, String(v));
    const s = q.toString();
    return `${base}/products${s ? `?${s}` : ''}`;
  };
  const pill = (active: boolean) => `whitespace-nowrap rounded-full border px-4 py-2 text-sm transition-colors ${active ? 'border-ink bg-ink font-medium text-inverse' : 'border-slate-200 text-slate-700 hover:border-ink'}`;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{activeCategory ? activeCategory.name : sp.search ? `Results for “${sp.search}”` : 'All products'}</h1>
          <p className="mt-1 text-sm text-slate-500">{data.total} {data.total === 1 ? 'product' : 'products'}</p>
        </div>
        <details className="group relative">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium hover:border-ink [&::-webkit-details-marker]:hidden">
            Sort: {sortLabel} <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="absolute right-0 z-10 mt-2 w-52 rounded-xl border border-slate-200 bg-surface p-1.5 text-sm shadow-lg">
            {SORTS.map(([v, l]) => (
              <li key={v}><Link href={link({ sort: v === 'newest' ? undefined : v, page: undefined })} className={`block rounded-lg px-3 py-2 ${sort === v ? 'bg-slate-100 font-medium' : 'hover:bg-slate-50'}`}>{l}</Link></li>
            ))}
          </ul>
        </details>
      </div>

      <form action={`${base}/products`} method="get" role="search" className="mt-5 md:hidden">
        <input name="search" type="search" defaultValue={sp.search} placeholder="Search products" aria-label="Search" className="block w-full rounded-full border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-accent focus:bg-surface focus:outline-none" />
        {sp.category && <input type="hidden" name="category" value={sp.category} />}
      </form>

      <nav aria-label="Categories" className="mt-5 flex gap-2 overflow-x-auto pb-1">
        <Link href={link({ category: undefined, page: undefined })} className={pill(!sp.category)}>All</Link>
        {categories.map((c) => (
          <Link key={c._id} href={link({ category: c.slug, page: undefined })} className={pill(sp.category === c.slug)}>{c.name} <span className={sp.category === c.slug ? 'text-inverse/70' : 'text-slate-400'}>{c.productCount}</span></Link>
        ))}
      </nav>

      <div className="mt-8">
        {!list.ok && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">{list.message}</p>}
        {list.ok && data.items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 py-16 text-center">
            <p className="text-slate-600">No products found.</p>
            <Link href={`${base}/products`} className={`${shopButtonOutline} mt-4`}>Clear filters</Link>
          </div>
        )}
        {data.items.length > 0 && (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
            {data.items.map((p) => (
              <li key={p.slug}><ProductCard product={p} base={base} /></li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <nav aria-label="Pages" className="mt-12 flex items-center justify-center gap-3 text-sm">
            {page > 1 ? <Link href={link({ page: String(page - 1) })} className={shopButtonOutline}>Previous</Link> : <span />}
            <span className="text-slate-600">Page {page} of {pages}</span>
            {page < pages ? <Link href={link({ page: String(page + 1) })} className={shopButtonOutline}>Next</Link> : <span />}
          </nav>
        )}
      </div>
    </div>
  );
}
