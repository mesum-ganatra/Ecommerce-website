import Link from 'next/link';

// Placeholder until the customer storefront is built. Each store's subdomain will render its own storefront here.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Ecommerce Platform</h1>
      <p className="text-slate-600">The customer storefront is coming next. Store owners and the platform team sign in below.</p>
      <Link
        href="/admin"
        className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
      >
        Open the admin panel
      </Link>
    </main>
  );
}
