# Multi-Store E-Commerce Platform

A platform where one Super Admin runs many online stores. Each store has its own products, orders, staff, theme and payment settings. Customers shop in a modern storefront; store staff work in an admin panel.

**Live demo:** https://ecomm-web-hazel.vercel.app
**Source:** https://github.com/mesum-ganatra/Ecommerce-website

| Part | Address |
|---|---|
| Home page (list of stores) | https://ecomm-web-hazel.vercel.app |
| A store (short link) | https://ecomm-web-hazel.vercel.app/kababjess (also `/urbanthreads`, `/technest`, `/krave-mart`) |
| Admin panel | https://ecomm-web-hazel.vercel.app/admin |
| API health check | https://ecomm-api-steel.vercel.app/api/v1/health |

## What it does

**For customers**
- Browse stores from the home page, search and filter products, sort by price or name.
- Product pages with photo gallery and zoom, options (size, colour, pack), stock status.
- Basket drawer with free-delivery progress, checkout with address and phone, order tracking.
- Pay by **cash on delivery** or **online payment** (a built-in demo gateway that moves no real money). Digital products are delivered as time-limited download links after payment.
- Light and dark theme, works on phones.

**For store staff and the Super Admin**
- Store management: create stores, themes (accent colour, tagline, banner), delivery pricing, suspend or archive.
- Products and categories with variants, images, stock adjustments and a stock history.
- Orders board with drag-and-drop status changes, order details, courier and tracking details.
- Team and roles: built-in roles (owner, manager, inventory, support, content) plus custom roles, with rules that stop anyone granting more power than they have.
- Payment settings per store; credentials are encrypted and never shown again.
- Analytics: revenue, orders, top products, payment methods.
- Audit log of every important action.
- Security: password rules, **two-step verification (authenticator app)**, recovery codes, sign-in rate limits, short-lived access tokens.

## How it is built

```
Browser ──> Next.js 16 web app (App Router, Tailwind 4)  ── Vercel project "ecomm-web"
                │  /api/v1/*  (forwarded, so the sign-in cookie stays on one site)
                ▼
            Express 5 API (TypeScript, zod validation)    ── Vercel project "ecomm-api"
                ▼
            MongoDB Atlas (Mongoose 9, free M0 cluster)
```

- **One database, many stores.** Every business record carries a `storeId`; every query is filtered by it, and permissions are checked per store.
- **Money is stored as whole paisa** (integers), never decimals.
- **Orders use database transactions** so stock cannot go negative and a failed checkout leaves stock untouched.
- **Payments:** an adapter for each gateway (JazzCash, EasyPaisa, demo). Results are verified, the amount is checked, and applying the same result twice changes the order only once.
- **Files:** product pictures and digital files are stored in MongoDB itself (free, no extra service), limited to 4 MB each because of the serverless host.
- **Hosting:** all free tiers (Vercel Hobby, Atlas M0, GitHub).

Main folders: `app/` (pages), `components/` (admin and shop UI), `lib/` (API helpers), `backend/src/` (routes, models, services, payments), `backend/tests/` (API tests), `public/demo/` (product illustrations).

## Run it on your computer

Needs Node 20+ and a MongoDB Atlas connection string.

```
cp backend/.env.example backend/.env       # fill in MONGODB_URI, ENCRYPTION_KEY, JWT secrets
cd backend && npm install && npm run db:indexes && npm run db:seed
npm run dev                                 # API on http://localhost:4000

# second terminal, project root
cp .env.example .env.local
npm install && npm run dev                  # web on http://localhost:3000
```

Tests (API on port 4010): `cd backend && npm run test:catalog` (also `test:shop`, `test:staff`, `test:payments`). They create temporary data and remove it afterwards. 248 checks pass.

## Notes for the marker

- **Demo payment gateway:** JazzCash and EasyPaisa are built to the adapter interface but their *live* mode is deliberately locked until each is verified against the official merchant guide with sandbox credentials. For the demo, a built-in gateway shows the full online-payment flow without real money.
- **Demo data:** the four stores and their 35 products are sample data. Pictures are illustrations, not photos; real photos can be uploaded in the admin panel.
- **Free-tier limits:** the first page after a quiet period can take a few seconds (serverless cold start). Uploaded files are capped at 4 MB.
- **Not included:** customer accounts, email/SMS notifications, coupons, tax rules, refunds and the Leopard courier connection. Orders can still be tracked by order number and phone.

More detail for developers: `HANDOFF.md` (decisions, traps, history) and `DEPLOY.md` (hosting steps).
