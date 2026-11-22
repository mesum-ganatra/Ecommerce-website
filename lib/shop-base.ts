import 'server-only';
import { headers } from 'next/headers';

/** '' on the store's own subdomain; '/s/<sub>' when the store is opened by path (handy in development). */
export async function shopBase(sub: string): Promise<string> {
  const host = ((await headers()).get('host') ?? '').toLowerCase();
  return host.startsWith(`${sub}.`) ? '' : `/s/${sub}`;
}
