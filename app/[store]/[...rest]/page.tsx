import { redirect } from 'next/navigation';

// /krave-mart/products, /krave-mart/cart ... also work
export default async function ShortLinkDeep({ params }: { params: Promise<{ store: string; rest: string[] }> }) {
  const { store, rest } = await params;
  redirect(`/s/${encodeURIComponent(store.toLowerCase())}/${rest.map(encodeURIComponent).join('/')}`);
}
