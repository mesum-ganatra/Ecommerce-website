import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';
import { RateLimit } from '../models';

/**
 * Rate-limit counters kept in MongoDB, so every server instance counts together. The default in-memory counters
 * are per instance, which on Vercel (many short-lived instances) would let a guesser spread attempts across them.
 * One document per key; a TTL index removes it when its window ends.
 */
class MongoRateLimitStore implements Store {
  localKeys = false;
  prefix: string;
  windowMs = 60_000;

  constructor(prefix: string) {
    this.prefix = `${prefix}:`;
  }

  init(options: Options) {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const now = new Date();
    const doc = await RateLimit.collection.findOneAndUpdate(
      { _id: this.prefix + key } as never,
      // in one atomic step: start a new window if the old one ended, otherwise count one more
      [
        {
          $set: {
            count: { $cond: [{ $gt: ['$resetAt', now] }, { $add: ['$count', 1] }, 1] },
            resetAt: { $cond: [{ $gt: ['$resetAt', now] }, '$resetAt', new Date(now.getTime() + this.windowMs)] },
          },
        },
      ],
      { upsert: true, returnDocument: 'after' },
    );
    return { totalHits: Number(doc?.count ?? 1), resetTime: doc?.resetAt as Date };
  }

  async decrement(key: string) {
    await RateLimit.collection.updateOne({ _id: this.prefix + key } as never, { $inc: { count: -1 } });
  }

  async resetKey(key: string) {
    await RateLimit.collection.deleteOne({ _id: this.prefix + key } as never);
  }
}

/** Shared counters when running on Vercel (or when RATE_LIMIT_STORE=mongo); fast in-memory counters otherwise. */
export function rateStore(name: string): Store | undefined {
  return process.env.RATE_LIMIT_STORE === 'mongo' || (process.env.VERCEL && process.env.RATE_LIMIT_STORE !== 'memory') ? new MongoRateLimitStore(name) : undefined;
}
