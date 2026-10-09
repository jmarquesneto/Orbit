'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { api, ApiError, post } from '@/lib/api';
import { firstName, type Me } from '@/lib/types';
import { Brand } from './branding';
import { Icon, type IconName } from './icons';
import { PasswordForm, ProfileForm } from './account';
import { MfaEnrollment, ReauthDialog } from './mfa';

const NAV: { href: string; label: string; icon: IconName; admin?: boolean }[] = [
  { href: '/', label: 'Visão geral', icon: 'overview' },
  { href: '/lancamentos', label: 'Lançamentos', icon: 'list' },
  { href: '/orcamentos', label: 'Orçamentos', icon: 'budget' },
  { href: '/carteiras', label: 'Carteiras', icon: 'wallet' },
  { href: '/faturas', label: 'Faturas', icon: 'card' },
  { href: '/caixinhas', label: 'Caixinhas', icon: 'goal' },
  { href: '/ofx', label: 'Conciliação OFX', icon: 'ofx' },
  { href: '/manutencao', label: 'Manutenção', icon: 'wrench' },
  { href: '/equipamentos', label: 'Equipamentos', icon: 'box' },
  { href: '/conta', label: 'Minha conta', icon: 'lock' },
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

  // Configuração da conta, uma etapa por vez, antes de liberar o sistema:
  // senha provisória → nome → verificação em duas etapas (quando obrigatória).
  const reload = () => void queryClient.invalidateQueries();
  const setup = (title: string, intro: string, body: ReactNode) => (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="h-setup" style={{ maxWidth: 460 }}>
        <Brand />
        <h1 id="h-setup" style={{ fontSize: 22, textAlign: 'center' }}>{title}</h1>
        <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>{intro}</p>
        {body}
        <button type="button" className="btn small" onClick={logout} style={{ alignSelf: 'center' }}>
          Sair
        </button>
      </section>
    </main>
  );
  if (me.data.mustChangePassword) {
    return setup(
      'Crie sua nova senha',
      'Você entrou com uma senha provisória. Defina agora uma senha só sua.',
      <PasswordForm forced onDone={reload} />,
    );
  }
  if (!me.data.name) {
    return setup(
      'Como você quer ser chamado?',
      'Seu nome aparece na saudação da tela inicial e para quem compartilha orçamentos com você.',
      <ProfileForm initialName={null} email={me.data.email} submitLabel="Continuar" onSaved={reload} />,
    );
  }
  if (me.data.mfaRequired && !me.data.mfaEnabled) {
    return setup(
      'Proteja sua conta',
      'Esta instalação exige verificação em duas etapas. Leva um minuto e só precisa ser feito uma vez.',
      <MfaEnrollment onDone={reload} />,
    );
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
            <span className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
              <span style={{ color: 'var(--text)', fontWeight: 500 }}>{me.data.name ?? firstName(me.data)}</span>
              <span className="xsmall" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.data.email}</span>
            </span>
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
      <ReauthDialog />
    </MeContext.Provider>
  );
}
