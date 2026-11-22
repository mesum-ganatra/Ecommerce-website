'use client';

import { AnalyticsView } from '@/components/admin/analytics-view';
import { useStore } from '@/components/admin/store-context';
import { Alert } from '@/components/admin/ui';

export default function StoreOverviewPage() {
  const { store, can } = useStore();
  if (!can('report.view')) return <Alert tone="info">Your role cannot view reports. Use the Orders and Products tabs.</Alert>;
  return <AnalyticsView storeId={store._id} />;
}
