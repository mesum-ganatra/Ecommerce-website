import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Search } from 'lucide-react';
import { CartDrawer } from '@/components/shop/cart-drawer';
import { CartLink } from '@/components/shop/cart-link';
import { ShopProvider } from '@/components/shop/shop-context';
import { ThemeToggle } from '@/components/theme-toggle';
import { mediaUrl } from '@/lib/api';
import { shopBase } from '@/lib/shop-base';
import { shopGet, type ShopCategory, type ShopStore } from '@/lib/shop-api';

type Props = { children: React.ReactNode; params: Promise<{ sub: string }> };

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { sub } = await params;
  const r = await shopGet<ShopStore>(sub, '/store');
  if (!r.ok) return { title: 'Shop' };
  return { title: { default: r.data.name, template: `%s | ${r.data.name}` }, description: r.data.theme?.tagline ?? `Shop online at ${r.data.name}` };
}

export default async function ShopLayout({ children, params }: Props) {
  const { sub } = await params;
  const [store, cats, base] = await Promise.all([shopGet<ShopStore>(sub, '/store'), shopGet<{ items: ShopCategory[] }>(sub, '/categories'), shopBase(sub)]);

  if (!store.ok && store.status === 404) notFound();
  if (!store.ok) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">We&apos;ll be back soon</h1>
        <p className="text-slate-600">{store.status === 503 ? 'This store is temporarily closed.' : store.message}</p>
      </main>
    );
  }

  const s = store.data;
  const accent = s.theme?.accentColor ?? '#4f46e5';
  const topCategories = (cats.ok ? cats.data.items : []).filter((c) => !c.parentId && c.productCount > 0).slice(0, 7);

  return (
    <ShopProvider sub={sub} base={base} store={s}>
      {/* the store's own accent colour drives buttons, links and highlights */}
      <div style={{ ['--accent' as string]: accent }} className="flex min-h-screen flex-col bg-canvas text-slate-900">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-surface/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
            <Link href={`${base}/` || '/'} className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
              {s.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(s.logoUrl)} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-slate-200" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">{s.name.slice(0, 1).toUpperCase()}</span>
              )}
              <span className="max-w-40 truncate sm:max-w-none">{s.name}</span>
            </Link>
            <form action={`${base}/products`} method="get" role="search" className="relative ml-auto hidden max-w-sm flex-1 md:block">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
              <input name="search" type="search" aria-label="Search products" placeholder="Search products" className="w-full rounded-full border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm transition-colors focus:border-accent focus:bg-surface focus:outline-none" />
            </form>
            <div className="ml-auto flex items-center gap-1 md:ml-0">
              <Link href={`${base}/products`} className="rounded-full p-2.5 text-slate-700 hover:bg-slate-100 md:hidden" aria-label="Search products"><Search size={20} /></Link>
              <ThemeToggle className="!h-10 !w-10 !rounded-full" />
              <CartLink />
            </div>
          </div>
          <nav aria-label="Categories" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2.5 text-sm">
            <Link href={`${base}/products`} className="whitespace-nowrap rounded-full px-3.5 py-1.5 font-medium text-slate-900 hover:bg-slate-100">All products</Link>
            {topCategories.map((c) => (
              <Link key={c._id} href={`${base}/products?category=${c.slug}`} className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">{c.name}</Link>
            ))}
            <Link href={`${base}/track`} className="ml-auto whitespace-nowrap rounded-full px-3.5 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">Track order</Link>
          </nav>
        </header>

        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</div>

        <footer className="border-t border-slate-200 bg-surface">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm sm:grid-cols-3">
            <div>
              <div className="font-bold">{s.name}</div>
              <p className="mt-2 max-w-xs text-slate-500">{s.theme?.tagline ?? 'Thank you for shopping with us.'}</p>
            </div>
            <div className="space-y-2 text-slate-600">
              <div className="font-semibold text-slate-900">Shop</div>
              <Link href={`${base}/products`} className="block hover:text-slate-900">All products</Link>
              <Link href={`${base}/track`} className="block hover:text-slate-900">Track your order</Link>
            </div>
            <div className="space-y-2 text-slate-600">
              <div className="font-semibold text-slate-900">Good to know</div>
              <p>{s.cod.enabled ? 'Cash on Delivery available' : 'Secure online payment'}</p>
              {s.returnWindowDays > 0 && <p>{s.returnWindowDays}-day returns</p>}
              <p>{s.shipping.freeAbove ? 'Free delivery on bigger baskets' : 'Delivered to your door'}</p>
            </div>
          </div>
          <div className="border-t border-slate-100 py-4 text-center text-xs text-slate-500">© {new Date().getFullYear()} {s.name}</div>
        </footer>
        <CartDrawer />
      </div>
    </ShopProvider>
  );
}
