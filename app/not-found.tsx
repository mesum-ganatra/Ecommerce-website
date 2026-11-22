import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-slate-600">The page you are looking for does not exist, or this store is no longer open.</p>
      <Link href="/" className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-inverse hover:bg-ink/85">Go to the home page</Link>
    </main>
  );
}
