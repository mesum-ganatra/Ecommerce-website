import { createApp } from './app';
import { env } from './config/env';
import { connectDB, disconnectDB } from './db/connect';
import './models';
import { startPaymentExpiryJob } from './services/payments';
import { assertStorageConfigured } from './services/storage';

async function main() {
  assertStorageConfigured();
  await connectDB();
  startPaymentExpiryJob();
  const server = createApp().listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port}  (health: /api/v1/health)`);
  });

  const stop = () => {
    server.close(() => void disconnectDB().then(() => process.exit(0)));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err: Error) => {
  console.error('Failed to start:', err.message.replace(/\/\/[^@\s]*@/g, '//***@'));
  process.exit(1);
});
