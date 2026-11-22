import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../middleware/auth';
import { AuditLog, Customer, Order, Product, Store, User } from '../models';
import { salesAnalytics } from '../services/analytics';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

// Cross-store numbers for the Super Admin dashboard (FR-SA-005)
dashboardRouter.get('/dashboard', requirePermission('platform.settings'), async (_req, res) => {
  const [byStatus, byType, staff, customers, products, orders] = await Promise.all([
    Store.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Store.aggregate([{ $match: { status: { $ne: 'archived' } } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
    User.countDocuments({ isSuperAdmin: false }),
    Customer.countDocuments(),
    Product.countDocuments({ status: 'active' }),
    Order.countDocuments(),
  ]);
  const count = (rows: { _id: string; n: number }[], k: string) => rows.find((r) => r._id === k)?.n ?? 0;
  res.json({
    stores: {
      active: count(byStatus, 'active'),
      suspended: count(byStatus, 'suspended'),
      native: count(byType, 'native'),
      external: count(byType, 'external'),
    },
    staff,
    customers,
    products,
    orders,
  });
});

// Audit trail: Super Admin sees everything, optionally for one store
dashboardRouter.get('/audit-logs', requirePermission('platform.settings'), async (req, res) => {
  const q = z
    .object({ storeId: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(20) })
    .parse(req.query);
  const filter = q.storeId ? { storeId: q.storeId } : {};
  const items = await AuditLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(q.limit)
    .populate('userId', 'name email')
    .populate('storeId', 'name subdomain');
  res.json({ items });
});

// Sales charts and "needs attention" counts across every store (Super Admin)
dashboardRouter.get('/dashboard/analytics', requirePermission('platform.settings'), async (req, res) => {
  const { days } = z.object({ days: z.coerce.number().int().refine((n) => [7, 30, 90].includes(n), 'Use 7, 30 or 90').default(30) }).parse(req.query);
  res.json(await salesAnalytics({}, days, true));
});
