import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { env } from './config/env';
import { isReplicaSet } from './db/connect';
import { authRouter } from './routes/auth';
import { cronRouter } from './routes/cron';
import { connectDB } from './db/connect';
import { catalogRouter } from './routes/catalog';
import { ordersRouter } from './routes/orders';
import { shopRouter } from './routes/shop';
import { staffRouter } from './routes/staff';
import { usersRouter } from './routes/users';
import { PUBLIC_DIR, usesObjectStorage } from './services/storage';
import { dashboardRouter } from './routes/dashboard';
import { payPublicRouter, paymentConfigRouter } from './routes/payments';
import { storesRouter } from './routes/stores';
import { errorHandler } from './utils/errors';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Nginx/Cloudflare in production, so req.ip is the real client
  app.use(helmet());
  // Allowed browsers origins: the configured list, plus every store subdomain of the platform domain.
  const platformHost = env.platformDomain.split(':')[0].toLowerCase();
  app.use(
    cors({
      credentials: true,
      origin(origin, cb) {
        if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
        try {
          const host = new URL(origin).hostname.toLowerCase();
          return cb(null, host === platformHost || host.endsWith('.' + platformHost));
        } catch {
          return cb(null, false);
        }
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  // gateways send their result back as an ordinary HTML form post
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());

  // liveness: the process is up (no database call)
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // readiness: the database answers
  app.get('/api/v1/health', async (_req, res) => {
    try {
      if (process.env.VERCEL) await connectDB();
      await mongoose.connection.db!.admin().command({ ping: 1 });
      res.json({ ok: true, database: 'up', replicaSet: await isReplicaSet() });
    } catch {
      res.status(503).json({ ok: false, database: 'down' });
    }
  });

  // uploaded product images (public). Digital files live in private storage and are never served here.
  if (!usesObjectStorage()) app.use(
    '/media',
    express.static(PUBLIC_DIR, {
      maxAge: '7d',
      immutable: true,
      index: false,
      setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
    }),
  );

  // Serverless hosting starts a fresh instance per burst of traffic: connect on demand (the connection is reused while the instance lives).
  if (process.env.VERCEL) {
    app.use(async (_req, _res, next) => {
      try {
        await connectDB();
        next();
      } catch (err) {
        next(err);
      }
    });
  }

  app.use('/api/v1/cron', cronRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/stores', storesRouter);
  app.use('/api/v1/stores/:storeId', catalogRouter);
  app.use('/api/v1/stores/:storeId', ordersRouter);
  app.use('/api/v1/stores/:storeId', staffRouter);
  app.use('/api/v1/stores/:storeId', paymentConfigRouter);
  app.use('/api/v1/pay', payPublicRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/shop/:subdomain', shopRouter);
  app.use('/api/v1', dashboardRouter);
  // Next modules: catalogue, cart and checkout, orders, payments, connectors.

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
  });
  app.use(errorHandler);

  return app;
}
