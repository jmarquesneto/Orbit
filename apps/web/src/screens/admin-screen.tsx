'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { useMe } from '@/components/app-shell';
import { BrandMark, useBranding } from '@/components/branding';
import { Empty, ErrorAlert, PageHeader, SuccessAlert } from '@/components/ui';
import { api, del, errorMessage, patch, post } from '@/lib/api';
import { isoToBr } from '@/lib/format';
import type { AdminUser, Invitation } from '@/lib/types';

const SWATCHES = [
  { value: '#3DD6C3', label: 'Turquesa' },
  { value: '#7AA7FF', label: 'Azul' },
  { value: '#F6B467', label: 'Âmbar' },
  { value: '#C4A7FF', label: 'Lilás' },
];

/** Mesma regra do servidor (validação final é lá): letras, números, espaço e . , ' & ( ) - */
const NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N} .,'&()-]*$/u;

function nameProblem(name: string): string | null {
  const v = name.trim();
  if (v.length < 2) return 'Use ao menos 2 caracteres.';
  if (v.length > 32) return 'Use no máximo 32 caracteres.';
  if (!NAME_RULE.test(v)) return "Use apenas letras, números, espaço e . , ' & ( ) -";
  if (/\s{2,}/.test(v)) return 'Evite espaços repetidos.';
  return null;
}

function Identity() {
  const router = useRouter();
  const current = useBranding();
  const [name, setName] = useState(current.name);
  const [accent, setAccent] = useState(current.accent.toUpperCase());
  const [logoUrl, setLogoUrl] = useState(current.logoUrl ?? '');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const problem = nameProblem(name);
  const dirty = name.trim() !== current.name || accent !== current.accent.toUpperCase() || (logoUrl || null) !== current.logoUrl;

  const publish = useMutation({
    mutationFn: async () => {
      let version = 0;
      const save = async (key: string, value: unknown) => {
        const r = await patch<{ setting: { version: number } }>(`/admin/settings/${key}`, { value });
        version = Math.max(version, r.setting.version);
      };
      if (name.trim() !== current.name) await save('app.name', name.trim());
      if (accent !== current.accent.toUpperCase()) await save('app.accent', accent);
      if ((logoUrl || null) !== current.logoUrl) await save('app.logo_url', logoUrl.trim() || null);
      return version;
    },
    onSuccess: (version) => {
      setError(null);
      setSaved(`Publicado como versão ${version}. O novo nome já aparece em todas as telas e abas abertas.`);
      // Re-renderiza o layout no servidor, que lê o branding atualizado.
      router.refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const preview = name.trim() || current.name;
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
      <section className="card" style={{ flex: '3 1 420px', gap: 20 }} aria-labelledby="h-ident">
        <div className="stack-sm" style={{ gap: 4 }}>
          <h2 id="h-ident" style={{ fontSize: 18 }}>Identidade do sistema</h2>
          <p className="small muted" style={{ margin: 0 }}>
            O nome aparece no título das páginas, no menu, na tela de login, no convite e no app instalado.
          </p>
        </div>
        <div className="stack-sm" style={{ gap: 6 }}>
          <label htmlFor="app-name" className="small text-2">Nome do sistema</label>
          <input
            id="app-name"
            className="input"
            style={{ minHeight: 48, fontSize: 17 }}
            value={name}
            maxLength={32}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(null);
            }}
            aria-invalid={Boolean(problem)}
            aria-describedby="app-name-help"
          />
          <div id="app-name-help" className="between xsmall">
            <span style={{ color: problem ? 'var(--danger)' : 'var(--muted)' }}>
              {problem ?? 'Validado no servidor; sempre exibido como texto.'}
            </span>
            <span className="mono muted">{name.length}/32</span>
          </div>
        </div>
        <div className="stack-sm" role="group" aria-label="Cor de destaque">
          <span className="small text-2">Cor de destaque</span>
          <div className="row" style={{ gap: 10 }}>
            {SWATCHES.map((s) => (
              <button
                key={s.value}
                type="button"
                aria-label={s.label}
                aria-pressed={accent === s.value}
                onClick={() => setAccent(s.value)}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  border: `3px solid ${accent === s.value ? 'var(--text)' : 'transparent'}`,
                  background: s.value,
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>
        <label className="field">
          Endereço do logotipo (https, opcional)
          <input className="input" type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." />
        </label>
        <SuccessAlert message={saved} />
        <ErrorAlert error={error} />
        <div className="row" style={{ justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setName(current.name);
              setAccent(current.accent.toUpperCase());
              setLogoUrl(current.logoUrl ?? '');
            }}
          >
            Descartar
          </button>
          <button type="button" className="btn primary" disabled={!dirty || Boolean(problem) || publish.isPending} onClick={() => publish.mutate()}>
            Publicar alterações
          </button>
        </div>
      </section>

      <section className="card" style={{ flex: '2 1 320px' }} aria-labelledby="h-prev">
        <div className="between">
          <h2 id="h-prev" style={{ fontSize: 18 }}>Pré-visualização</h2>
          <span className="xsmall muted">{dirty ? 'rascunho, ainda não publicado' : 'publicado'}</span>
        </div>
        <div style={{ border: '1px solid var(--border-strong)', borderRadius: 10, overflow: 'hidden', ['--accent' as string]: accent }}>
          <div className="row xsmall" style={{ gap: 8, padding: '8px 12px', background: 'var(--hover)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Visão geral · {preview}</span>
          </div>
          <div className="stack-sm" style={{ alignItems: 'center', padding: '24px 16px', gap: 12 }}>
            <BrandMark size={36} />
            <span style={{ fontSize: 18, fontWeight: 600, textAlign: 'center', overflowWrap: 'anywhere' }}>Entrar no {preview}</span>
            <span style={{ width: '100%', maxWidth: 240, height: 36, border: '1px solid var(--border-strong)', borderRadius: 6 }} />
            <span style={{ width: '100%', maxWidth: 240, height: 36, borderRadius: 6, background: accent }} />
          </div>
        </div>
        <div className="stack-sm small" style={{ padding: 14, border: '1px solid var(--border-strong)', borderRadius: 10 }}>
          <span className="muted">Convite</span>
          <span>
            <b>Título:</b> Boas-vindas ao {preview}
          </span>
        </div>
        <div className="stack-sm small muted" style={{ gap: 6 }}>
          <span className="text-2" style={{ fontWeight: 500 }}>Ao publicar</span>
          <span>1. Grava <span className="mono" style={{ color: 'var(--text)' }}>app.name</span> em system_settings, com revisão e auditoria.</span>
          <span>2. Limpa o cache de branding no servidor.</span>
          <span>3. Todas as abas abertas trocam o nome na hora, sem recarregar.</span>
        </div>
      </section>
    </div>
  );
}

function SecurityPolicy() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const settings = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api<{ settings: { key: string; value: unknown }[] }>('/admin/settings').then((r) => r.settings),
  });
  const required = settings.data?.find((s) => s.key === 'security.mfa_required')?.value === true;
  const toggle = useMutation({
    mutationFn: (value: boolean) => patch('/admin/settings/security.mfa_required', { value }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <section className="card" aria-labelledby="h-sec">
      <h2 id="h-sec" style={{ fontSize: 18 }}>Segurança</h2>
      <ErrorAlert error={error} />
      <label className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={required}
          disabled={!settings.data || toggle.isPending}
          onChange={(e) => toggle.mutate(e.target.checked)}
          style={{ marginTop: 4 }}
        />
        <span className="stack-sm" style={{ gap: 2 }}>
          <span>Exigir verificação em duas etapas de todos os usuários</span>
          <span className="small muted">
            Quem ainda não ativou será levado ao cadastro do app autenticador no próximo acesso.
          </span>
        </span>
      </label>
    </section>
  );
}

const STATUS_LABEL: Record<Invitation['status'], [string, string]> = {
  pending: ['Pendente', 'info'],
  used: ['Aceito', 'ok'],
  revoked: ['Revogado', ''],
  expired: ['Expirado', 'warn'],
};

function Invitations() {
  const queryClient = useQueryClient();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['invitations'],
    queryFn: () => api<{ invitations: Invitation[] }>('/admin/invitations').then((r) => r.invitations),
  });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => post<{ link: string }>('/admin/invitations', body),
    onSuccess: (r) => {
      setError(null);
      setLink(r.link);
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/admin/invitations/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['invitations'] }),
    onError: (e) => setError(errorMessage(e)),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate({ email: String(f.get('email')), role: String(f.get('role')), ttlHours: Number(f.get('ttl')) });
    e.currentTarget.reset();
  }

  return (
    <section id="convites" className="card" aria-labelledby="h-conv">
      <h2 id="h-conv" style={{ fontSize: 18 }}>Convites</h2>
      <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={onSubmit}>
        <label className="field" style={{ flex: '2 1 220px' }}>
          E-mail do convidado
          <input className="input" name="email" type="email" required />
        </label>
        <label className="field" style={{ flex: '1 1 120px' }}>
          Papel
          <select className="select" name="role" defaultValue="user">
            <option value="user">Usuário</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <label className="field" style={{ flex: '1 1 120px' }}>
          Validade
          <select className="select" name="ttl" defaultValue="72">
            <option value="72">72 horas</option>
            <option value="24">24 horas</option>
            <option value="168">7 dias</option>
          </select>
        </label>
        <button className="btn primary" type="submit" disabled={create.isPending}>
          Gerar convite
        </button>
      </form>
      <ErrorAlert error={error} />
      {link && (
        <div className="alert ok" role="status" style={{ flexDirection: 'column' }}>
          <span>Convite criado. Envie este link à pessoa — ele só aparece agora e só funciona uma vez:</span>
          <span className="row" style={{ gap: 8, width: '100%' }}>
            <input className="input mono" readOnly value={link} onFocus={(e) => e.currentTarget.select()} style={{ flex: '1 1 260px', fontSize: 13 }} />
            <button
              type="button"
              className="btn small"
              onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}
            >
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </span>
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Convidado</th>
              <th scope="col">Papel</th>
              <th scope="col">Status</th>
              <th scope="col">Expira</th>
              <th scope="col"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((i) => {
              const [label, tone] = STATUS_LABEL[i.status];
              return (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{i.role === 'admin' ? 'Administrador' : 'Usuário'}</td>
                  <td><span className={`badge ${tone}`}>{label}</span></td>
                  <td className="mono">{isoToBr(i.expiresAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {i.status === 'pending' && (
                      <button type="button" className="btn small" onClick={() => revoke.mutate(i.id)}>Revogar</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Users() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['admin-users'], queryFn: () => api<{ users: AdminUser[] }>('/admin/users').then((r) => r.users) });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AdminUser['status'] }) => patch(`/admin/users/${id}/status`, { status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (e) => setError(errorMessage(e)),
  });
  const resetMfa = useMutation({
    mutationFn: (id: string) => post(`/admin/users/${id}/mfa/reset`),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <section className="card" aria-labelledby="h-users">
      <h2 id="h-users" style={{ fontSize: 18 }}>Usuários</h2>
      <ErrorAlert error={error} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">E-mail</th>
              <th scope="col">Papel</th>
              <th scope="col">Último acesso</th>
              <th scope="col">2 etapas</th>
              <th scope="col">Status</th>
              <th scope="col"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.role === 'admin' ? 'Administrador' : 'Usuário'}</td>
                <td className="mono">{u.lastLoginAt ? isoToBr(u.lastLoginAt) : '—'}</td>
                <td><span className={`badge ${u.mfaEnabled ? 'ok' : ''}`}>{u.mfaEnabled ? 'Ativa' : 'Não'}</span></td>
                <td><span className={`badge ${u.status === 'active' ? 'ok' : 'warn'}`}>{u.status === 'active' ? 'Ativo' : 'Bloqueado'}</span></td>
                <td style={{ textAlign: 'right' }}>
                  {u.id !== me.id && u.mfaEnabled && (
                    <button
                      type="button"
                      className="btn small"
                      style={{ marginRight: 8 }}
                      onClick={() => {
                        if (window.confirm(`Redefinir a verificação em duas etapas de ${u.email}? A pessoa sai de todos os dispositivos e cadastra o app de novo no próximo login.`)) {
                          resetMfa.mutate(u.id);
                        }
                      }}
                    >
                      Redefinir 2 etapas
                    </button>
                  )}
                  {u.id !== me.id && (
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => setStatus.mutate({ id: u.id, status: u.status === 'active' ? 'locked' : 'active' })}
                    >
                      {u.status === 'active' ? 'Bloquear' : 'Desbloquear'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Tela "Painel administrativo" do design. */
export function AdminScreen() {
  const me = useMe();
  if (me.role !== 'admin') {
    return <Empty title="Área restrita a administradores." />;
  }
  return (
    <>
      <PageHeader eyebrow="Administração" title="Configurações globais">
        <span className="small muted">Valem para todos os usuários desta instalação</span>
      </PageHeader>
      <Identity />
      <SecurityPolicy />
      <Invitations />
      <Users />
    </>
  );
}
