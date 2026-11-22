import mongoose from 'mongoose';
import { env, requireMongoUri } from '../config/env';

let connecting: Promise<typeof mongoose> | undefined;

export function connectDB(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose);
  if (!connecting) {
    mongoose.set('strictQuery', true);
    connecting = mongoose
      .connect(requireMongoUri(), {
        dbName: env.mongoDb,
        serverSelectionTimeoutMS: 15_000,
        // Indexes are created explicitly with `npm run db:indexes`, not on every boot.
        autoIndex: env.nodeEnv !== 'production',
      })
      .catch((err: unknown) => {
        connecting = undefined;
        throw err;
      });
  }
  return connecting;
}

export async function disconnectDB(): Promise<void> {
  connecting = undefined;
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

/** Atlas is always a replica set, which MongoDB transactions require. */
export async function isReplicaSet(): Promise<boolean> {
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  return Boolean(hello.setName);
}
