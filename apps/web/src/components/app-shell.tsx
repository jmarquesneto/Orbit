'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { api, ApiError, post } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Brand } from './branding';
import { Icon, type IconName } from './icons';

const NAV: { href: string; label: string; icon: IconName; admin?: boolean }[] = [
  { href: '/', label: 'Visão geral', icon: 'overview' },
  { href: '/lancamentos', label: 'Lançamentos', icon: 'list' },
  { href: '/orcamentos', label: 'Orçamentos', icon: 'budget' },
  { href: '/carteiras', label: 'Carteiras', icon: 'wallet' },
  { href: '/faturas', label: 'Faturas', icon: 'card' },
  { href: '/caixinhas', label: 'Caixinhas', icon: 'goal' },
  { href: '/ofx', label: 'Conciliação OFX', icon: 'ofx' },
  { href: '/admin', label: 'Administração', icon: 'shield', admin: true },
];

const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe fora do AppShell');
  return me;
}

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** Área logada: confere a sessão (renovando se preciso) e desenha menu + conteúdo. */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });

  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    if (unauthenticated) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, pathname, router]);

  if (!me.data) {
    return (
      <div className="auth-page" role="status">
        <span className="muted">{me.error && !unauthenticated ? 'Não foi possível carregar. Recarregue a página.' : 'Carregando…'}</span>
      </div>
    );
  }

  async function logout() {
    try {
      await post('/auth/logout');
    } finally {
      queryClient.clear();
      router.replace('/login');
    }
  }

  return (
    <MeContext.Provider value={me.data}>
      <div className="shell">
        <aside className="sidebar">
          <Brand />
          <nav aria-label="Principal" className="nav">
            {NAV.filter((n) => !n.admin || me.data.role === 'admin').map((n) => (
              <Link key={n.href} href={n.href} aria-current={isActive(pathname, n.href) ? 'page' : undefined}>
                <Icon name={n.icon} />
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="sidebar-footer">
            <span>{me.data.email}</span>
            <button type="button" className="btn small" onClick={logout}>
              <Icon name="logout" size={16} />
              Sair
            </button>
          </div>
        </aside>
        <main className="main">
          <div className="page">{children}</div>
        </main>
      </div>
    </MeContext.Provider>
  );
}
