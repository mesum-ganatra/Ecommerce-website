# Deploying to Vercel

Two Vercel projects from the same repository: the **API** (folder `backend`) and the **web app** (repo root).
Data lives in Atlas and files in a bucket, so nothing depends on your computer.

## 0. What you need
- A domain you own (examples use `yourdomain.com`).
- Accounts: Vercel, MongoDB Atlas (you have it), Cloudflare R2 or AWS S3 (files), GitHub (Vercel deploys from a repository).
- Four secrets, each from `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`: `ENCRYPTION_KEY`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CRON_SECRET`.
  Use new values for production. If `ENCRYPTION_KEY` is lost, stored gateway credentials cannot be read again.

## 1. Atlas
1. Network Access: `0.0.0.0/0` is already allowed (Vercel has no fixed IP), so the database password must be strong.
2. Database Access: create a dedicated production user with **readWrite** on database `ecomm` only. Rotate the password that was pasted into chat earlier.
3. Create the indexes once from your computer, with `backend/.env` pointing at that database: `cd backend && npm run db:indexes`.

## 2. File storage (Cloudflare R2 shown; S3 works the same)
1. Create two buckets: **public** (product and logo images) and **private** (digital downloads, never public).
2. Public bucket: attach a custom domain such as `media.yourdomain.com`; that is `S3_PUBLIC_BASE_URL`.
3. Private bucket: add a CORS rule allowing `PUT` from `https://yourdomain.com` with header `Content-Type`. This lets the admin panel upload large files straight to storage.
4. Create an API token with read/write on both buckets: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`.

## 3. API project
1. Vercel > Add New Project > the repository > **Root Directory: `backend`**. Framework preset: Other (`backend/vercel.json` sets the build).
2. Environment variables: everything in `backend/.env.production.example`.
3. Domains: add `api.yourdomain.com`.
4. Deploy, then open `https://api.yourdomain.com/api/v1/health`. Expect `{"ok":true,"database":"up","replicaSet":true}`.

## 4. Web project
1. Add New Project > same repository > Root Directory: repo root. Framework: Next.js.
2. Environment variables (see `.env.example`): `NEXT_PUBLIC_API_URL` and `API_URL` = `https://api.yourdomain.com/api/v1`; `NEXT_PUBLIC_PLATFORM_DOMAIN` = `yourdomain.com`.
3. Domains: add `yourdomain.com` and `*.yourdomain.com`. Wildcards need Vercel to host your DNS: at your registrar switch the nameservers to the ones Vercel shows, then add the `api` and `media` records inside Vercel DNS.
4. Deploy. The admin panel is `https://yourdomain.com/admin`; each store is `https://<subdomain>.yourdomain.com`.

## 5. First-time setup
From your computer, with `backend/.env` holding the production `MONGODB_URI`, `ENCRYPTION_KEY`, `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`:

```
cd backend
npm run db:seed
```

It creates the Super Admin only if none exists. Sign in at `/admin`, turn on two-step verification at once (Security page), and delete the password line from the file.

## 6. Smoke test
1. The health URL says database up.
2. Sign in, create a store, open `https://<sub>.yourdomain.com`.
3. Upload a product photo: its address should start with your `S3_PUBLIC_BASE_URL`.
4. Create a digital product and attach a file over 5 MB; it should upload and be listed. Buying it needs an online gateway, so test that once sandbox credentials exist.
5. Place a cash-on-delivery order for a physical product and find it in the admin.

## 7. Good to know
- **Cron:** Hobby plans run it once a day (03:00, set in `vercel.json`). Expired online payments are also cleaned up whenever someone checks out, so this is a backstop. Pro plans can use `*/10 * * * *`.
- **Rate limits** are stored in MongoDB on Vercel (automatic), so they hold across instances.
- **Upload limits:** Vercel caps a request at about 4.5 MB, so images are capped at 4 MB in the UI; digital files bypass the API through presigned uploads.
- **JazzCash / EasyPaisa live mode stays locked** until each adapter is verified against the official merchant guide with sandbox credentials. Do not set `PAYMENTS_ALLOW_UNVERIFIED_LIVE=true` for real customers.
- **Rollback:** Vercel > Deployments > an earlier one > Promote to Production. Database changes are not rolled back.
- **Checks before pushing:** `cd backend && npm run typecheck && npm run build:vercel`, then `npm run build` at the root (`NEXT_DIST_DIR=.next-build` builds beside a running dev server).
