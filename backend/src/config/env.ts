import path from 'node:path';
import dotenv from 'dotenv';

// Load backend/.env first, then fall back to the Next.js app's ../.env.local.
// dotenv never overrides a value that is already set, so backend/.env wins.
// scripts and the dev server always run from the backend folder (npm run ...)
const backendRoot = process.env.BACKEND_ROOT ?? process.cwd();
dotenv.config({ path: path.join(backendRoot, '.env'), quiet: true });
dotenv.config({ path: path.resolve(backendRoot, '../.env.local'), quiet: true });

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGODB_URI ?? '',
  mongoDb: process.env.MONGODB_DB ?? 'ecomm',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  platformDomain: process.env.PLATFORM_DOMAIN ?? 'localhost',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? '',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
  accessTokenMinutes: Number(process.env.ACCESS_TOKEN_MINUTES ?? 15),
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS ?? 7),
  // Public address of this API (gateways send customers back here) and the storefront address pattern.
  apiPublicUrl: (process.env.API_PUBLIC_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  storefrontUrlTemplate: process.env.STOREFRONT_URL_TEMPLATE ?? 'http://{sub}.localhost:3000',
  // The built-in test gateway is for development only. It must stay off in production.
  paymentSimulator: process.env.ENABLE_PAYMENT_SIMULATOR ? process.env.ENABLE_PAYMENT_SIMULATOR === 'true' : (process.env.NODE_ENV ?? 'development') !== 'production',
  paymentExpiryMinutes: Number(process.env.PAYMENT_EXPIRY_MINUTES ?? 30),
  encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  superAdminEmail: process.env.SUPER_ADMIN_EMAIL ?? '',
  superAdminPassword: process.env.SUPER_ADMIN_PASSWORD ?? '',
  seedSampleStore: process.env.SEED_SAMPLE_STORE === 'true',
};

/** Returns the Mongo URI or throws a message that says exactly what to fix. */
export function requireMongoUri(): string {
  const uri = env.mongoUri;
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Put it in backend/.env (or ../.env.local).');
  }
  if (uri.includes('<') || uri.includes('>')) {
    throw new Error(
      'MONGODB_URI still contains a placeholder such as <username> or <cluster-host>. ' +
        'Paste your real Atlas connection string (Atlas > Connect > Drivers).',
    );
  }
  return uri;
}
