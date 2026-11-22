import { redirect } from 'next/navigation';

// Short link: /krave-mart opens that store's shop at /s/krave-mart
export default async function ShortLink({ params }: { params: Promise<{ store: string }> }) {
  const { store } = await params;
  redirect(`/s/${encodeURIComponent(store.toLowerCase())}`);
}
