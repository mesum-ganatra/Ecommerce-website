'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AdminShell } from '@/components/admin/shell';
import { Loading } from '@/components/admin/ui';
import { useAuth } from '@/lib/auth';

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const { user, status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anon') router.replace('/admin/login');
    // the Super Admin must finish two-step setup before using anything else
    if (status === 'authed' && user?.mfaSetupRequired && pathname !== '/admin/security') router.replace('/admin/security');
  }, [status, user, pathname, router]);

  if (status !== 'authed' || !user) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16"><Loading label="Checking your session" /></div>
    );
  }
  return <AdminShell>{children}</AdminShell>;
}
