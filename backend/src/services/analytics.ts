import { Order, Product, Store } from '../models';

const TZ = 'Asia/Karachi';
const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD

interface Sums { revenue: number; orders: number }
const sums = (row?: { revenue?: number; orders?: number }): Sums => ({ revenue: row?.revenue ?? 0, orders: row?.orders ?? 0 });

/**
 * Sales figures for the dashboards. `match` limits it to one store (or all stores when empty).
 * Cancelled orders are left out of revenue and order counts. Each day is counted in Pakistan time.
 */
export async function salesAnalytics(match: Record<string, unknown>, days: number, withStores: boolean) {
  const now = new Date();
  const from = new Date(now.getTime() - days * 86_400_000);
  const prevFrom = new Date(from.getTime() - days * 86_400_000);
  const live = { ...match, status: { $ne: 'cancelled' } };
  const inRange = { createdAt: { $gte: from } };
  const group = { revenue: { $sum: '$totals.total' }, orders: { $sum: 1 } };

  const [facet] = await Order.aggregate([
    { $match: { ...live, createdAt: { $gte: prevFrom } } },
    {
      $facet: {
        cur: [{ $match: inRange }, { $group: { _id: null, ...group } }],
        prev: [{ $match: { createdAt: { $lt: from } } }, { $group: { _id: null, ...group } }],
        daily: [{ $match: inRange }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } }, ...group } }],
        products: [{ $match: inRange }, { $unwind: '$items' }, { $group: { _id: '$items.name', qty: { $sum: '$items.quantity' }, revenue: { $sum: '$items.lineTotal' } } }, { $sort: { revenue: -1 } }, { $limit: 5 }],
        payments: [{ $match: inRange }, { $group: { _id: '$paymentMethod', ...group } }, { $sort: { revenue: -1 } }],
        stores: withStores ? [{ $match: inRange }, { $group: { _id: '$storeId', ...group } }, { $sort: { revenue: -1 } }, { $limit: 5 }] : [{ $limit: 0 }],
      },
    },
  ]);

  const byStatus = await Order.aggregate([{ $match: { ...match, ...inRange } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);

  const daily = new Map<string, Sums>((facet.daily as { _id: string; revenue: number; orders: number }[]).map((d) => [d._id, sums(d)]));
  const series = Array.from({ length: days }, (_, i) => {
    const date = dayKey(new Date(now.getTime() - (days - 1 - i) * 86_400_000));
    return { date, ...(daily.get(date) ?? { revenue: 0, orders: 0 }) };
  });

  const stores = withStores ? await Store.find({ _id: { $in: (facet.stores as { _id: unknown }[]).map((s) => s._id) } }).select('name subdomain').lean() : [];
  const cur = sums(facet.cur[0]);
  const prev = sums(facet.prev[0]);

  // things that need a person
  const lowStock = 5;
  const [pending, awaitingPayment, attention, low] = await Promise.all([
    Order.countDocuments({ ...match, status: 'pending', $or: [{ paymentMethod: 'cod' }, { paymentStatus: 'paid' }] }),
    Order.countDocuments({ ...match, status: 'pending', paymentMethod: { $nin: ['cod', 'external'] }, paymentStatus: 'unpaid' }),
    Order.countDocuments({ ...match, needsAttention: true }),
    Product.countDocuments({ ...match, status: 'active', type: 'physical', variants: { $elemMatch: { active: true, stock: { $lte: lowStock } } } }),
  ]);

  return {
    days,
    totals: { ...cur, average: cur.orders ? Math.round(cur.revenue / cur.orders) : 0, previous: prev },
    series,
    byStatus: byStatus.map((s) => ({ status: s._id as string, count: s.count as number })),
    topProducts: (facet.products as { _id: string; qty: number; revenue: number }[]).map((p) => ({ name: p._id, quantity: p.qty, revenue: p.revenue })),
    payments: (facet.payments as { _id: string; orders: number; revenue: number }[]).map((p) => ({ method: p._id ?? 'unknown', orders: p.orders, revenue: p.revenue })),
    topStores: (facet.stores as { _id: unknown; revenue: number; orders: number }[]).map((s) => {
      const st = stores.find((x) => String(x._id) === String(s._id));
      return { id: String(s._id), name: st?.name ?? 'Store', subdomain: st?.subdomain, revenue: s.revenue, orders: s.orders };
    }),
    alerts: { pending, awaitingPayment, attention, lowStock: low },
  };
}
