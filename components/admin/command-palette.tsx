'use client';

import { Command } from 'cmdk';
import { ClipboardList, LayoutDashboard, LogOut, Moon, Package, Plus, ScrollText, Search, ShieldCheck, Store as StoreIcon, Users } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Page, StoreSummary } from '@/lib/types';
import { Modal } from './ui';

const item = 'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 data-[selected=true]:bg-brand-50 data-[selected=true]:text-brand-700';
const group = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-slate-500';

/** Ctrl+K (or Cmd+K): jump to any page or store, or run a quick action. */
export function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [stores, setStores] = useState<StoreSummary[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) get<Page<StoreSummary>>('/stores?limit=60').then((d) => setStores(d.items)).catch(() => undefined);
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Search" wide>
      <Command label="Search" className="-mx-2 -mb-3">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 pb-3">
          <Search size={16} className="text-slate-400" aria-hidden />
          <Command.Input autoFocus placeholder="Search pages, stores and actions…" className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400" />
        </div>
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-8 text-center text-sm text-slate-500">Nothing found.</Command.Empty>
          <Command.Group heading="Go to" className={group}>
            <Command.Item className={item} onSelect={() => go('/admin')}><LayoutDashboard size={16} /> Dashboard</Command.Item>
            <Command.Item className={item} onSelect={() => go('/admin/stores')}><StoreIcon size={16} /> Stores</Command.Item>
            {user?.isSuperAdmin && <Command.Item className={item} onSelect={() => go('/admin/users')}><Users size={16} /> Users</Command.Item>}
            {user?.isSuperAdmin && <Command.Item className={item} onSelect={() => go('/admin/audit')}><ScrollText size={16} /> Audit log</Command.Item>}
            <Command.Item className={item} onSelect={() => go('/admin/security')}><ShieldCheck size={16} /> Security</Command.Item>
          </Command.Group>
          {stores.length > 0 && (
            <Command.Group heading="Stores" className={group}>
              {stores.map((s) => (
                <Command.Item key={s._id} value={`store ${s.name} ${s.subdomain}`} className={item} onSelect={() => go(`/admin/stores/${s._id}`)}>
                  <StoreIcon size={16} /> {s.name} <span className="text-xs text-slate-400">{s.subdomain}</span>
                </Command.Item>
              ))}
              {stores.slice(0, 20).flatMap((s) => [
                <Command.Item key={`${s._id}-o`} value={`${s.name} orders`} className={item} onSelect={() => go(`/admin/stores/${s._id}/orders`)}><ClipboardList size={16} /> {s.name} · Orders</Command.Item>,
                <Command.Item key={`${s._id}-p`} value={`${s.name} products`} className={item} onSelect={() => go(`/admin/stores/${s._id}/products`)}><Package size={16} /> {s.name} · Products</Command.Item>,
              ])}
            </Command.Group>
          )}
          <Command.Group heading="Actions" className={group}>
            {user?.isSuperAdmin && <Command.Item className={item} onSelect={() => go('/admin/stores/new')}><Plus size={16} /> Create a store</Command.Item>}
            <Command.Item className={item} onSelect={() => { setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'); setOpen(false); }}><Moon size={16} /> Switch light / dark mode</Command.Item>
            <Command.Item className={item} onSelect={() => { setOpen(false); logout().then(() => router.replace('/admin/login')); }}><LogOut size={16} /> Sign out</Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </Modal>
  );
}
