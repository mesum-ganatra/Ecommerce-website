import mongoose from 'mongoose';
import { env } from '../config/env';
import { connectDB, disconnectDB, isReplicaSet } from '../db/connect';

// npm run db:check  -> proves the Atlas connection works, without printing credentials.
async function main() {
  await connectDB();
  const db = mongoose.connection.db!;
  const ping = await db.admin().command({ ping: 1 });
  const replica = await isReplicaSet();
  const collections = (await db.listCollections().toArray()).map((c) => c.name).sort();

  console.log(`Connected to MongoDB. ping ok = ${ping.ok === 1}`);
  console.log(`Database: ${env.mongoDb}`);
  console.log(`Replica set (needed for transactions): ${replica ? 'yes' : 'NO - orders/stock transactions will fail'}`);
  console.log(`Collections (${collections.length}): ${collections.join(', ') || 'none yet - run npm run db:indexes'}`);
}

main()
  .catch((err: Error) => {
    // never print the connection string
    console.error('Connection failed:', err.message.replace(/\/\/[^@\s]*@/g, '//***@'));
    process.exitCode = 1;
  })
  .finally(disconnectDB);
