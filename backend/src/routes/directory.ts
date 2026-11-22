import { Router } from 'express';
import { Product, Store } from '../models';

// Public list of the open stores for the platform's home page. Only what a visitor may see.
export const directoryRouter = Router();

directoryRouter.get('/', async (_req, res) => {
  const stores = await Store.find({ status: 'active', type: 'native' }).select('name subdomain logoUrl settings.theme').sort({ name: 1 }).limit(60).lean();
  const ids = stores.map((s) => s._id);
  const stats = await Product.aggregate<{ _id: unknown; count: number; images: string[] }>([
    { $match: { storeId: { $in: ids }, status: 'active' } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$storeId', count: { $sum: 1 }, images: { $push: { $arrayElemAt: ['$images.url', 0] } } } },
  ]);
  const byStore = new Map(stats.map((s) => [String(s._id), s]));
  res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  res.json({
    items: stores.map((s) => {
      const st = byStore.get(String(s._id));
      return {
        name: s.name,
        subdomain: s.subdomain,
        logoUrl: s.logoUrl ?? null,
        tagline: s.settings?.theme?.tagline ?? null,
        accentColor: s.settings?.theme?.accentColor ?? null,
        productCount: st?.count ?? 0,
        previews: (st?.images ?? []).filter(Boolean).slice(0, 3),
      };
    }),
  });
});
