// Plain-language names for the permission keys (the keys themselves live in backend/src/permissions.ts).
export const PERMISSION_GROUPS: { title: string; items: [key: string, label: string][] }[] = [
  { title: 'Products and stock', items: [['product.read', 'View products'], ['product.write', 'Create, edit and archive products'], ['stock.adjust', 'Adjust stock']] },
  { title: 'Orders', items: [['order.read', 'View orders'], ['order.update', 'Process orders (ship, deliver, record cash)'], ['order.cancel', 'Cancel orders'], ['order.refund', 'Refund orders']] },
  { title: 'Customers', items: [['customer.read', 'View customers'], ['customer.block', 'Block customers']] },
  { title: 'Marketing and content', items: [['coupon.manage', 'Manage coupons'], ['cms.manage', 'Edit pages, banners and menus'], ['review.moderate', 'Moderate reviews']] },
  { title: 'Store setup', items: [['store.settings', 'Change store settings'], ['shipping.manage', 'Shipping rules'], ['tax.manage', 'Tax rules'], ['payment.credentials', 'Payment credentials'], ['apikey.manage', 'Storefront API keys'], ['store.connect', 'Connect an external website'], ['sync.run', 'Run syncs'], ['sync.view_logs', 'View sync logs']] },
  { title: 'Team and reports', items: [['user.manage', 'Manage the team'], ['role.manage', 'Manage roles'], ['report.view', 'View reports'], ['audit.view', 'View the activity log']] },
];

export const permissionLabel = (key: string) => PERMISSION_GROUPS.flatMap((g) => g.items).find(([k]) => k === key)?.[1] ?? key;
