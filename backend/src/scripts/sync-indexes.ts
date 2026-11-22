import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../db/connect';
import '../models'; // registers every model

// npm run db:indexes -> creates all collections and indexes defined in the schemas.
async function main() {
  await connectDB();
  for (const name of mongoose.modelNames().sort()) {
    const m = mongoose.model(name);
    await m.createCollection().catch(() => undefined); // already exists is fine
    const dropped = await m.syncIndexes();
    console.log(`${m.collection.name.padEnd(20)} indexes ok${dropped.length ? ` (dropped: ${dropped.join(', ')})` : ''}`);
  }
}

main()
  .catch((err: Error) => {
    console.error('Index sync failed:', err.message.replace(/\/\/[^@\s]*@/g, '//***@'));
    process.exitCode = 1;
  })
  .finally(disconnectDB);
