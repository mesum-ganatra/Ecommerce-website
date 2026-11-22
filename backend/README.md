# Backend (Node.js + Express + Mongoose)

Implements the data layer from the SRS: 18 collections plus a `counters` helper, built-in roles and
permissions, encrypted secrets, and a Super Admin seed.

## Setup

1. Put your Atlas connection string in `backend/.env` (copy `.env.example`), or leave it in
   `../.env.local` as `MONGODB_URI` (the backend reads that as a fallback).
   Replace `<username>`, `<password>` and `<cluster-host>` with real values.
   In Atlas, also allow your IP under Network Access, and give the database user read/write access.
2. Generate an encryption key and put it in `ENCRYPTION_KEY`:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
3. Run, in order:

```bash
npm run db:check     # proves the connection works
npm run db:indexes   # creates collections and indexes
npm run db:seed      # roles, first Super Admin, optional demo store
npm run dev          # API on http://localhost:4000, health at /api/v1/health
```

## Layout

- `src/config/env.ts` environment loading and validation
- `src/db/connect.ts` Mongoose connection
- `src/models/` one file per group: `store`, `identity` (users, roles, memberships, API keys),
  `catalog` (categories, products, reviews), `sales` (customers, carts, coupons, orders, payments,
  shipments, download access), `platform` (payment configs, sync logs, audit logs)
- `src/permissions.ts` permission keys and the default roles from SRS 8.2
- `src/utils/crypto.ts` AES-256-GCM for gateway and connector credentials
- `src/scripts/` db-check, sync-indexes, seed

Every business document carries `storeId`. Money is integer paisa.
