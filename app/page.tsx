import Link from 'next/link';
import { ArrowRight, LayoutDashboard, ShieldCheck, Store, Truck } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { mediaUrl } from '@/lib/api';

type DirectoryStore = { name: string; subdomain: string; logoUrl: string | null; tagline: string | null; accentColor: string | null; productCount: number; previews: string[] };

const API = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

async function loadStores(): Promise<DirectoryStore[]> {
  try {
    const res = await fetch(`${API}/directory`, { next: { revalidate: 30 } });
    if (!res.ok) return [];
    return ((await res.json()) as { items: DirectoryStore[] }).items;
  } catch {
    return [];
  }
}

export default async function Home() {
  const stores = await loadStores();
  return (
    <div className="min-h-screen bg-surface text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white"><Store size={18} aria-hidden /></span>
            Marketplace
          </Link>
          <nav className="ml-auto flex items-center gap-2 text-sm">
            <ThemeToggle className="!h-10 !w-10 !rounded-full" />
            <Link href="/admin" className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 font-medium hover:border-ink">
              <LayoutDashboard size={16} aria-hidden /> Store owner sign in
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pb-6 pt-14 text-center sm:px-6 sm:pt-20">
          <span className="inline-flex rounded-full bg-brand-50 px-3.5 py-1 text-xs font-semibold text-brand-700">Many stores, one place</span>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">Shop from independent stores, delivered to your door</h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-slate-600 sm:text-lg">Pick a store below. Each one has its own products and prices, and you can pay with cash on delivery or online.</p>
        </section>

        <section aria-labelledby="stores" className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
          <h2 id="stores" className="mb-6 text-2xl font-bold tracking-tight">Open stores</h2>
          {stores.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 py-16 text-center text-slate-500">No stores are open yet. Please check back soon.</p>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {stores.map((s) => {
                const accent = s.accentColor ?? '#4f46e5';
                return (
                  <li key={s.subdomain}>
                    <Link href={`/s/${s.subdomain}`} style={{ ['--accent' as string]: accent }} className="group block overflow-hidden rounded-2xl border border-slate-200 bg-surface transition-all hover:-translate-y-1 hover:border-ink hover:shadow-xl">
                      <div className="grid h-40 grid-cols-3 gap-px bg-[color-mix(in_oklab,var(--accent)_14%,var(--surface))]">
                        {s.previews.length > 0 ? (
                          s.previews.map((p, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i} src={mediaUrl(p)} alt="" loading="lazy" className="h-40 w-full object-cover" />
                          ))
                        ) : (
                          <div className="col-span-3 flex items-center justify-center text-6xl font-bold text-accent/60">{s.name.slice(0, 1)}</div>
                        )}
                      </div>
                      <div className="p-5">
                        <div className="flex items-center gap-3">
                          {s.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={mediaUrl(s.logoUrl)} alt="" className="h-10 w-10 rounded-full object-cover ring-1 ring-slate-200" />
                          ) : (
                            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">{s.name.slice(0, 1).toUpperCase()}</span>
                          )}
                          <div className="min-w-0">
                            <h3 className="truncate text-lg font-bold">{s.name}</h3>
                            <p className="text-xs text-slate-500">{s.productCount} {s.productCount === 1 ? 'product' : 'products'}</p>
                          </div>
                        </div>
                        {s.tagline && <p className="mt-3 line-clamp-2 text-sm text-slate-600">{s.tagline}</p>}
                        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">Visit store <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" aria-hidden /></span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="border-y border-slate-200 bg-slate-50">
          <ul className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:grid-cols-3 sm:px-6">
            {[
              { icon: Truck, title: 'Delivery to your door', text: 'Each store ships its own orders and shows you the delivery cost before you pay.' },
              { icon: ShieldCheck, title: 'Pay your way', text: 'Cash on delivery, or pay online with a secure checkout.' },
              { icon: Store, title: 'Run your own store', text: 'Store owners manage products, stock and orders from one admin panel.' },
            ].map((f) => (
              <li key={f.title} className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-slate-900 ring-1 ring-slate-200"><f.icon size={20} aria-hidden /></span>
                <span><span className="block font-semibold">{f.title}</span><span className="mt-1 block text-sm text-slate-600">{f.text}</span></span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="py-8 text-center text-sm text-slate-500">
        © {new Date().getFullYear()} Marketplace · <Link href="/admin" className="underline-offset-4 hover:underline">Store owner sign in</Link>
      </footer>
    </div>
  );
}
