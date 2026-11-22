import { NextResponse, type NextRequest } from 'next/server';

// Each store lives on its own subdomain: kababjess.<platform domain>.
// This sends a request for a store subdomain to that store's storefront pages (app/s/[sub]).
// The main domain keeps serving the landing page and the admin panel.
const PLATFORM_HOST = (process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? 'localhost:3000').split(':')[0].toLowerCase();
const RESERVED = new Set(['www', 'admin', 'api', 'app', 'mail', 'static', 'cdn']);

export function proxy(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').split(':')[0].toLowerCase();
  if (!host.endsWith(`.${PLATFORM_HOST}`)) return NextResponse.next();

  const sub = host.slice(0, -(PLATFORM_HOST.length + 1));
  if (!sub || sub.includes('.') || RESERVED.has(sub)) return NextResponse.next();

  const url = request.nextUrl.clone();
  // the admin panel is not served on store domains
  if (url.pathname.startsWith('/admin')) return new NextResponse('Not found', { status: 404 });
  url.pathname = `/s/${sub}${url.pathname === '/' ? '' : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // skip Next internals and files with an extension (images, favicon...)
  matcher: ['/((?!_next/|api/|.*\\..*).*)'],
};
