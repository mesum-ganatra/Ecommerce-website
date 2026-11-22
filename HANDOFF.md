# Handoff: multi-store e-commerce platform

Read this first. It says what exists, how to run it, what is left, and the traps already found.
Full requirements: the SRS Google-style doc "SRS: Multi-Store E-commerce Platform"
(https://claude.ai/artifact/1Xm3p9Dp2WH2s3UH2fjjse). Section numbers below (SRS 7, FR-xx) refer to it.

## 1. What this is

One platform, many online stores. A **Super Admin** manages every store; each store has its own storefront on a
subdomain (`kababjess.<platform domain>`). Stores are either **native** (run on this platform) or **external**
(existing websites, to be synced in through connectors, not built yet).
Currency PKR, prices stored as integer paisa. Pakistan market: JazzCash, EasyPaisa, Cash on Delivery, Leopard courier.

## 2. Stack and layout

- **Frontend**: Next.js 16 (App Router, React 19, Tailwind 4, TypeScript) in the project root.
  - `app/admin/**` admin panel (Super Admin and store staff)
  - `app/s/[sub]/**` customer storefront; `proxy.ts` rewrites `<sub>.localhost:3000` to `/s/<sub>` (Next 16 calls middleware "proxy")
  - `components/admin`, `components/shop`, `lib/` (api client, types, formatting)
- **Backend**: Node.js 24, Express 5, TypeScript, Mongoose 9, in `backend/`.
  - `src/routes` (auth, stores, catalog, orders, shop, dashboard), `src/models`, `src/services`, `src/middleware/auth.ts`, `src/permissions.ts`
  - `tests/*.api-test.ts` end-to-end tests against the real database
- **Database**: MongoDB Atlas (replica set; transactions are used). Database name in `backend/.env` (`MONGODB_DB`).
- `lib/db/mongodb.ts` + the `mongodb` and `server-only` packages in the root `package.json` are leftovers from the
  original scaffold and are unused. Safe to delete.

## 3. Run it

```bash
# terminal 1: API on :4000
cd backend && npm run dev
# terminal 2: web on :3000 (project root)
npm run dev
```
- Admin: http://localhost:3000/admin   Storefront: http://<subdomain>.localhost:3000 or http://localhost:3000/s/<subdomain>
- Secrets live in `.env.local` (root: `MONGODB_URI`) and `backend/.env` (`MONGODB_DB`, `ENCRYPTION_KEY`, `JWT_*`, super admin seed values). Never commit them (`.gitignore` already excludes `.env*`).
- Backend scripts: `npm run db:check`, `db:indexes` (create/refresh all indexes), `db:seed` (roles, first Super Admin, optional demo store with `SEED_SAMPLE_STORE=true`), `typecheck`.
- Tests (start the API on port 4010 first: `PORT=4010 npm run start`): `npm run test:catalog` (47 checks), `npm run test:shop` (64 checks), `npm run test:staff` (74 checks: two-step login, invites, team and roles), `npm run test:payments` (63 checks: online payments and downloads). They create and delete their own data. Emergency Super Admin recovery: `SUPER_ADMIN_NEW_PASSWORD="..." npm run admin:reset` (also switches two-step off so it is set up again).
- Typecheck both: `npx tsc --noEmit` in the root and in `backend/`.

## 4. Done (and tested)

- Auth: email+password login, rotating HttpOnly refresh cookie, 15 min access token, login rate limit, audit log.
- RBAC: permission keys in `src/permissions.ts`; `requirePermission(perm, { storeParam })` on every store route; Super Admin passes everything; suspended store locks staff out; disabled user cut off immediately. Default roles: super_admin, store_admin, manager, inventory, support, content.
- Stores: create / edit / suspend / reactivate / archive, settings (COD, return window, delivery fee, couriers with Leopard default), storefront API keys (hashed, shown once), dashboard, audit log page.
- Catalogue: nested categories, products (physical and digital) with variants, images upload (checked by magic bytes), digital files in private storage, atomic stock adjust with history, low-stock filter, soft delete.
- Storefront: home, product list (filters, search, sort, pagination), product page (SSR, SEO, JSON-LD), basket (localStorage, server-priced), COD checkout (transactional stock, idempotency key, sequential order numbers), confirmation, guest order tracking (POST lookup so contact details never go in a URL).
- Two-step login (TOTP, RFC 6238 vectors tested): required for the Super Admin (a Super Admin without it can only reach /auth/* and the Security page), optional for store staff; 8 one-time recovery codes (hashed), replay protection, 5-wrong-codes lockout, password change that signs out other devices.
- Team management: invite by one-time link (hashed token, 7 days; email sending not built, the admin copies the link), roles per store, custom roles, role changes with anti-escalation (cannot grant more than you hold, cannot edit your own role/membership), last Store Admin protected, reset links only for single-store staff, Super Admin "Users" page (disable, reset two-step, password link).
- Orders (admin): list/search, detail, pending to processing to shipped (tracking) to delivered to completed, cancel with stock restore, COD cash collected.

## 5. Left to do (priority order)

1. ~~Staff and user management~~ and 2. ~~Two-step login for the Super Admin~~: DONE (see section 4). Still missing there: sending invite and reset emails (needs the email provider, item 7) and a self-service "forgot password" for staff.
3. **Online payments: JazzCash and EasyPaisa** (framework DONE, gateway verification still open: see section 8) (SRS section 7). Model `PaymentConfig` exists (encrypted `credentials`, never returned). Need: admin screen to save/test credentials, `POST /pay/:gateway/initiate`, redirect, server-to-server callback with signature + amount + reference verification, idempotent via `Payment.processedCallbacks`, scheduled job to settle payments stuck in `initiated` after 15 min, stock reservation during payment (`reservedStock`, 15 min), refunds (FR-PY-007). The exact request fields and hash algorithm come from each gateway's merchant documentation; get sandbox credentials from the client first. Then allow online payment in `shop.ts` checkout (currently `paymentMethod: z.literal('cod')`).
4. **Digital delivery** (DONE, see section 8) (FR-PR-004/005). After payment succeeds create `DownloadAccess` rows (expiry and limit from product or store defaults), signed short-lived (5 min) download endpoint reading `privatePath()` from `src/services/storage.ts`, download log, resend/extend by staff. The basket currently blocks digital items because they need online payment.
5. **Customer accounts**: register/login (separate from staff, FR-AC-005), saved addresses, order history, wishlist, reviews with moderation, return/cancel requests (FR-ST-020..025).
6. **Coupons, tax rules, shipping zones**. `Coupon` model exists but has no API or UI; `settings.taxRules` and `settings.shippingZones` exist but pricing (`src/services/pricing.ts`) only uses a flat delivery fee and tax 0. Leopard: decide whether to integrate its API (booking/tracking) or keep manual tracking numbers (open question in the SRS).
7. **Email and SMS notifications** (order confirmation, shipped, delivered, password reset). Providers not chosen yet (open question). Use a queue.
8. **External store connectors** (SRS section 10, FR-SY-*). Framework with the same interface per platform (connect, test, pull, push, webhook), generic REST connector with field mapping first, then WooCommerce/Shopify; queue and retries (BullMQ + Redis), `SyncLog` model exists, webhook signature verification, sync health on the dashboard, conflict rules from SRS 10.2. Store records already carry `type`, `platform`, encrypted `apiCredentials`, `syncSettings`.
9. **Reports and bulk tools** (FR-AD-012, FR-AD-002): sales by period/product/category, payments report, CSV import and export of products, revenue on the dashboard.
10. **Use the storefront API keys**. Keys are created and stored hashed but no route checks an `x-store-key` header yet. Needed only if external storefronts will call the API; the platform's own storefront uses the subdomain in the URL.
11. **Production readiness**: swap `src/services/storage.ts` to S3-compatible storage (same functions, public bucket for images, private for digital files); Docker + Nginx; wildcard DNS and wildcard SSL for `*.<platform domain>`; set `NODE_ENV=production`, `PLATFORM_DOMAIN`, `NEXT_PUBLIC_PLATFORM_DOMAIN`, `NEXT_PUBLIC_API_URL`, `CORS_ORIGINS`; MongoDB Atlas backups; CI (GitHub Actions) running typecheck and the two test suites; uptime, error tracking; load test against the capacity targets (launch 20 stores, 40,000 products, 1 checkout/s; scale to 50 stores, 100,000 products, 10 checkouts/s).
12. **Smaller gaps**: per-store theme/logo upload UI, sitemap.xml and robots for storefronts, accessibility audit (WCAG AA), Urdu/RTL later (strings are not yet in translation files), admin order notes, partial refunds, product reviews display, search suggestions.

## 6. Traps already found (do not repeat)

- **Money is integer paisa everywhere.** Convert only at the UI edge (`lib/format.ts`).
- **MongoDB compound unique indexes**: `sparse: true` does NOT skip documents that lack only one of the fields (storeId is always present), so every native record collided on `(storeId, externalId)`. Use `partialFilterExpression: { externalId: { $type: 'string' } }`. Already fixed in all models; run `npm run db:indexes` after any index change.
- **Mongoose 9 + TypeScript 7**: pass schema options as `as const` literals (`baseOptions` in `models/_shared.ts`), not as a `SchemaOptions`-typed variable, or document types collapse to `{}`. Do not name a schema field `errors` (reserved).
- **Stock changes** must be a single conditional update (`$elemMatch ... stock: { $gte: qty }` plus `$inc`); checkout and cancel run inside a transaction. Existing variants keep their stock on product PATCH; only the stock endpoint changes it (so history stays exact).
- **Permissions are enforced on the server** for every route via `requirePermission`; the store id always comes from the route and the user's membership, never the request body. Keep that pattern for new routes.
- **No personal data in URLs or logs.** That is why order tracking is `POST /shop/:sub/orders/lookup`.
- **Express 5**: async handler errors propagate automatically; the central handler is `src/utils/errors.ts`.
- **Next 16**: `params` and `searchParams` are Promises; `headers()` is async; `proxy.ts` replaces `middleware.ts`; a page file may only export the page (and metadata), not helpers.
- **Router mounting**: a router that does `router.use(authenticate)` and is mounted at `/api/v1` intercepts every route registered after it (public storefront included). Mount guarded routers on their own prefix (e.g. `/api/v1/users`).
- **Rate limits** on sign-in count failures only (`skipSuccessfulRequests`), otherwise tests and busy legitimate users get locked out. In-memory limits do not work across serverless instances (use Redis/Upstash on Vercel).
- **React StrictMode** runs effects twice in development: read one-time values (like the invite token, which is then removed from the URL) behind a ref guard.
- A stale `tsx`/`node` process on a port makes new code look like 404s: check what listens on 4000/4010 first.

## 7. Housekeeping the owner should do

- **Rotate the MongoDB Atlas database password** (it was pasted into a chat earlier), then update `MONGODB_URI` in `.env.local`.
- Delete `SUPER_ADMIN_PASSWORD` from `backend/.env` (only the seed needs it).
- The real Super Admin is asked to set up two-step verification at the next sign-in. Save the 8 recovery codes safely; if both phone and codes are lost, use `npm run admin:reset`.
- The folder is **not a git repository yet**: run `git init`, commit, and push to a private repo.
- Keep `.env*` files out of screenshots and chats.

## 8. Update: online payments (JazzCash, EasyPaisa) and digital delivery

**Built and tested** (`npm run test:payments`, 63 checks, plus browser run of the full flow with the test gateway):
- Per-store credentials (`PaymentConfig`, AES-GCM encrypted, never returned; the admin UI shows masked hints), sandbox/live mode, on/off, admin tab "Payments", return URL shown for the gateway portal.
- Gateways are small adapters in `backend/src/payments/` (`jazzcash.ts`, `easypaisa.ts`, `simulator.ts`, registry in `index.ts`). Everything else is gateway-independent: `services/checkout.ts` (order + payment record + stock hold in one transaction), `services/payments.ts` (`settlePayment` is idempotent, checks the amount, never lets a later "failed" undo a success; late money after cancellation sets `needsAttention`), `routes/payments.ts` (return endpoints, admin config).
- Customer flow: checkout lists enabled methods, server returns a signed form, the browser posts it to the gateway, the gateway sends the customer back to `/api/v1/pay/:gateway/:storeId/return`, which redirects to the storefront `/pay-result`. The basket is emptied only after payment is confirmed. Unpaid online orders cannot be processed by staff and are closed (stock released) after `PAYMENT_EXPIRY_MINUTES` (default 30) by a timer in `server.ts`.
- Digital products: paying creates `DownloadAccess` rows, a digital-only order completes at once, the tracking page shows downloads, 5 minute signed links, download limit and expiry enforced atomically.
- A built-in **test gateway** (`simulator`) for development and tests; it is disabled when `NODE_ENV=production` (override: `ENABLE_PAYMENT_SIMULATOR`).

**NOT done, needs the real merchant material (most important next step):**
- `jazzcash.ts` and `easypaisa.ts` are written from public third-party information, NOT from the official guides, which are only given to merchants (search done 2026-11-22 found no public spec). Both adapters carry `verifiedAgainstOfficialGuide: false`, which **locks live mode** in the API (override only for testing: `PAYMENTS_ALLOW_UNVERIFIED_LIVE=true`). To finish: get the JazzCash "Page Redirection" guide and the Easypaisa Easypay guide from the merchant portals, compare field by field (field list, hash recipe, amount units, date formats, response codes), test with sandbox credentials, then set `verifiedAgainstOfficialGuide: true`.
- Easypaisa specifically: the real flow has a second step (an `auth_token` returned to the postback URL that must be confirmed with Easypay). `parseReturn` currently returns `authentic: false`, so an Easypaisa payment is never accepted from the browser alone. Implement the confirmation step per the guide.
- A server-to-server status check ("inquiry") for payments whose browser return was lost is not built; today such orders expire and, if money later arrives, are flagged `needsAttention`. Add the gateways' inquiry APIs and run them before expiring.
- Refunds through the gateways (FR-PY-007) are not built; staff can only cancel/mark.
- The expiry job is a `setInterval`. On Vercel/serverless replace it with a scheduled call to `expireStalePayments()`.

**New environment variables** (backend/.env): `API_PUBLIC_URL` (public address of the API, used in return URLs), `STOREFRONT_URL_TEMPLATE` (e.g. `https://{sub}.yourdomain.com`), `ENABLE_PAYMENT_SIMULATOR`, `PAYMENT_EXPIRY_MINUTES`, `PAYMENTS_ALLOW_UNVERIFIED_LIVE` (leave unset), `CHECKOUT_RATE_LIMIT` and `TRACK_RATE_LIMIT` (only raised for tests).

**Traps found:** a page's `form-action` CSP also applies to the redirect after a form post, so the API's own test page needs the storefront origin allowed; gateways post results as form-encoded bodies (the API now parses them); a checkout idempotency key must not outlive a failed payment attempt (the storefront removes it when it redirects).

**Interface redesign: done, see section 9.**

## 9. Update: interface redesign (done 2026-11-22)

The admin panel and storefront were redesigned (light and dark mode, indigo platform accent, per-store accent on storefronts). Typechecks clean; all 248 API checks still pass; checked in a real browser in both themes.

**Design system** (`app/globals.css`, `components/admin/ui.tsx`):
- Colours are CSS variables. The Tailwind `slate`, `brand`, `emerald`, `red`, `amber` scales are remapped in `.dark`, so existing class names (`bg-slate-100`, `text-slate-600`...) work in both themes. Surfaces use `bg-surface`, page background `bg-canvas`, storefront strong fills `bg-ink text-inverse`. Do not hard-code `bg-white` or hex colours in new UI.
- The storefront's main colour is `--accent` (set per store from Admin > Appearance, on the layout's root `div`): use `bg-accent`, `text-accent`.
- Libraries: lucide-react (icons), recharts (charts), framer-motion (success animation), sonner (toasts, `toast.success/error`), @dnd-kit (boards, image reorder), cmdk (Ctrl+K search), next-themes (theme).
- Dialogs use the native `<dialog>` (`Modal`, `Drawer`, `ConfirmButton` in `ui.tsx`). `ConfirmButton` now opens a confirmation dialog.

**Admin:** collapsible sidebar with store switcher, top bar with Ctrl+K command palette (`components/admin/shell.tsx`, `command-palette.tsx`); dashboards with KPI cards, trend, sales chart, status donut, top lists and "needs attention" chips (`analytics-view.tsx`, `charts.tsx`; backend `services/analytics.ts`, `GET /dashboard/analytics`, `GET /stores/:id/analytics`); orders board (drag to the next column; pointer-based drop detection) plus list, order drawer (`order-panel.tsx`); products grid/list; image manager with drag-and-drop upload and reorder; Appearance tab (logo, banner, accent colour, tagline; `POST /stores/:id/branding/:kind`).

**Storefront:** accent-themed header, hero with banner or gradient, perks strip, category tiles, sale and new-arrivals sections, product cards with hover image swap and one-click add, slide-in basket with free-delivery progress (`cart-drawer.tsx`), zoomable gallery, sticky buy box, checkout steps, animated success/failure marks.

**Not done / ideas:** real upload progress bars (uploads show a spinner only); reordering products and categories; a wishlist and reviews display; category pictures (tiles use gradients); a mobile bottom navigation; automated browser tests (only API tests exist); Urdu/RTL. The dev server caches storefront data for 30 seconds (`next: { revalidate }` in `lib/shop-api.ts`), so changes in Appearance can take a moment to show.

## 10. Update: Vercel preparation (done 2026-11-22)
- The API runs on Vercel as one function: `backend/scripts/build-vercel.mjs` bundles `src/vercel.ts` into `backend/api/index.cjs` (it must be `.cjs`; a `.js` bundle exported an empty object). `backend/vercel.json` rewrites everything to it and defines the daily cron.
- With `VERCEL` set, the app connects to MongoDB on demand (also inside `/api/v1/health`), rate limits use MongoDB (`RATE_LIMIT_STORE`), and payment expiry runs lazily (`maybeExpireStale`) and from `/api/v1/cron/expire-payments` (needs `CRON_SECRET`).
- Files: `STORAGE_DRIVER=s3` (R2/S3/B2). Images go through the API (4 MB max in the UI); digital files use presigned upload (`uploadDigitalFile` in `lib/api.ts`, falls back to multipart when the API answers 501).
- Frontend: `NEXT_DIST_DIR` lets a production build run beside the dev server; the unused `lib/db/mongodb.ts` and `mongodb` package are gone; `.env.example` lists `API_URL`.
- Verified locally: the bundle serves health/shop/cron, the four API suites pass (47/64/74/63), `next build` succeeds. NOT verified: a real Vercel deployment, S3/R2 uploads (no bucket yet), wildcard DNS.
- Steps: see `DEPLOY.md`.

## 11. Update: live on Vercel (2026-11-22)
- Web: https://ecomm-web-hazel.vercel.app (admin at /admin). API: https://ecomm-api-steel.vercel.app. Vercel team `mesum4`, projects `ecomm-web` (repo root) and `ecomm-api` (root `backend`), both auto-deploy from `main` of github.com/mesum-ganatra/Ecommerce-website.
- No custom domain, so stores open by path: `/s/<subdomain>` (`NEXT_PUBLIC_STORE_PATHS=true`, `STOREFRONT_URL_TEMPLATE=https://<web>/s/{sub}`). Real subdomains need a bought domain and Vercel nameservers (see DEPLOY.md), then unset `NEXT_PUBLIC_STORE_PATHS`.
- The browser calls the API through the web app (`/api/v1` rewrite, `API_PROXY_TARGET`) so the sign-in cookie stays on one site. Server pages call the API directly (`API_URL`).
- The API entry is the committed `backend/api/index.js`, which loads `dist/app.cjs` built by `npm run build:vercel`.
- Production env vars live only in Vercel. Not yet set: S3 storage (so image/file uploads fail on Vercel), gateway sandbox credentials, the payment simulator is off.
- CLI tips on Windows Git Bash: prefix `MSYS_NO_PATHCONV=1` for `vercel api /v9/...`; `vercel link` fails for the Next project (symlink EPERM), so the web project was created with `vercel project add` plus `vercel git connect`.

## 12. Update: free "assignment" setup (2026-11-22)
- Files now live in MongoDB (`STORAGE_DRIVER=mongo`, collection `blobs`, 4 MB per file). `/media/*` is served by the API and forwarded by the web app's rewrite. S3/R2 drivers still exist for a real launch.
- Demo gateway: `ENABLE_PAYMENT_SIMULATOR=true` on Vercel, and a `simulator` PaymentConfig is enabled for each store. Labelled "Online payment (demo, no real money)". Turn both off for a real shop.
- Home page lists stores (`/api/v1/directory`); `/<store>` and `/<store>/...` redirect to `/s/<store>/...`.
- Cart no longer blocks digital products when the store has online payment.
- Demo data (4 stores, 35 products) was created by a script through the API; product pictures are SVG tiles in `public/demo/`.
- `catalog` test skips its disk checks when run with `STORAGE_DRIVER=mongo`.
