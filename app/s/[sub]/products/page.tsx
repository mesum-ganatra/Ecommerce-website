import type { Metadata } from 'next';
import Link from 'next/link';
import { ProductCard, shopButtonOutline, shopInput } from '@/components/shop/ui';
import { shopBase } from '@/lib/shop-base';
import { shopGet, type ShopCategory, type ShopPage, type ShopProductCard } from '@/lib/shop-api';

export const metadata: Metadata = { title: 'All products' };

type SP = { category?: string; search?: string; sort?: string; page?: string };

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

  const link = (over: Partial<SP>) => {
    const q = new URLSearchParams();
    const merged = { category: sp.category, search: sp.search, sort: sort === 'newest' ? undefined : sort, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, String(v));
    const s = q.toString();
    return `${base}/products${s ? `?${s}` : ''}`;
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{activeCategory ? activeCategory.name : sp.search ? `Results for “${sp.search}”` : 'All products'}</h1>
      <p className="mt-1 text-sm text-slate-600">{data.total} {data.total === 1 ? 'product' : 'products'}</p>

      <div className="mt-6 grid gap-8 md:grid-cols-[200px_1fr]">
        <aside aria-label="Filters" className="space-y-6">
          <form action={`${base}/products`} method="get" role="search" className="space-y-2 md:hidden">
            <input name="search" defaultValue={sp.search} placeholder="Search" aria-label="Search" className={shopInput} />
            {sp.category && <input type="hidden" name="category" value={sp.category} />}
          </form>
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Categories</h2>
            <ul className="space-y-1 text-sm">
              <li><Link href={link({ category: undefined, page: undefined })} className={`block rounded-lg px-3 py-1.5 ${!sp.category ? 'bg-ink font-medium text-inverse' : 'hover:bg-slate-100'}`}>All</Link></li>
              {categories.map((c) => (
                <li key={c._id}>
                  <Link href={link({ category: c.slug, page: undefined })} className={`flex justify-between rounded-lg px-3 py-1.5 ${sp.category === c.slug ? 'bg-ink font-medium text-inverse' : 'hover:bg-slate-100'}`}>
                    {c.name} <span className={sp.category === c.slug ? 'text-inverse/70' : 'text-slate-500'}>{c.productCount}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Sort by</h2>
            <ul className="space-y-1 text-sm">
              {[['newest', 'Newest'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['name', 'Name']].map(([v, l]) => (
                <li key={v}><Link href={link({ sort: v === 'newest' ? undefined : v, page: undefined })} className={`block rounded-lg px-3 py-1.5 ${sort === v ? 'bg-slate-100 font-medium' : 'hover:bg-slate-50'}`}>{l}</Link></li>
              ))}
            </ul>
          </div>
        </aside>

        <div>
          {!list.ok && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">{list.message}</p>}
          {list.ok && data.items.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 py-16 text-center">
              <p className="text-slate-600">No products found.</p>
              <Link href={`${base}/products`} className={`${shopButtonOutline} mt-4`}>Clear filters</Link>
            </div>
          )}
          {data.items.length > 0 && (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-3">
              {data.items.map((p) => (
                <li key={p.slug}><ProductCard product={p} base={base} /></li>
              ))}
            </ul>
          )}
          {pages > 1 && (
            <nav aria-label="Pages" className="mt-10 flex items-center justify-center gap-3 text-sm">
              {page > 1 ? <Link href={link({ page: String(page - 1) })} className={shopButtonOutline}>Previous</Link> : <span />}
              <span className="text-slate-600">Page {page} of {pages}</span>
              {page < pages ? <Link href={link({ page: String(page + 1) })} className={shopButtonOutline}>Next</Link> : <span />}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
