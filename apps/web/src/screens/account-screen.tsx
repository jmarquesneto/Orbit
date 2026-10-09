'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { PasswordForm, ProfileForm } from '@/components/account';
import { useMe } from '@/components/app-shell';
import { CodeField, codeFrom, MfaEnrollment, RecoveryCodes } from '@/components/mfa';
import { ErrorAlert, Loading, PageHeader, SuccessAlert } from '@/components/ui';
import { api, errorMessage, post } from '@/lib/api';
import type { MfaStatus } from '@/lib/types';

type Action = 'regenerate' | 'disable' | null;

/** Tela "Minha conta": nome, senha e verificação em duas etapas. */
export function AccountScreen() {
  const me = useMe();
  const queryClient = useQueryClient();
  return (
    <>
      <PageHeader eyebrow="Conta" title="Minha conta" />
      <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
        <section className="card" aria-labelledby="h-profile" style={{ flex: '1 1 340px', maxWidth: 560 }}>
          <h2 id="h-profile" style={{ fontSize: 18 }}>Perfil</h2>
          <ProfileForm
            key={me.name ?? ''}
            initialName={me.name}
            email={me.email}
            onSaved={() => void queryClient.invalidateQueries({ queryKey: ['me'] })}
          />
        </section>
        <section className="card" aria-labelledby="h-password" style={{ flex: '1 1 340px', maxWidth: 560 }}>
          <h2 id="h-password" style={{ fontSize: 18 }}>Senha</h2>
          <PasswordForm onDone={() => undefined} />
        </section>
      </div>
      <MfaSection />
    </>
  );
}

/** Verificação em duas etapas da própria conta. */
function MfaSection() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['mfa'], queryFn: () => api<MfaStatus>('/auth/mfa') });
  const [action, setAction] = useState<Action>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['mfa'] }).then(() => queryClient.invalidateQueries({ queryKey: ['me'] }));

  async function onConfirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = codeFrom(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      if (action === 'regenerate') {
        const r = await post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { code });
        setCodes(r.recoveryCodes);
      } else {
        await post('/auth/mfa/disable', { code });
        setMessage('Verificação em duas etapas desativada.');
      }
      setAction(null);
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!status.data) return status.error ? <ErrorAlert error={errorMessage(status.error)} /> : <Loading />;
  const s = status.data;

  return (
    <>
      <section className="card" aria-labelledby="h-mfa" style={{ maxWidth: 560 }}>
        <div className="between">
          <h2 id="h-mfa" style={{ fontSize: 18 }}>Verificação em duas etapas</h2>
          <span className={`badge ${s.enabled ? 'ok' : 'warn'}`}>{s.enabled ? 'Ativa' : 'Desativada'}</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Além da senha, o login pede um código que muda a cada 30 segundos no app autenticador do seu celular.
          {s.required && ' Nesta instalação ela é obrigatória.'}
        </p>
        <SuccessAlert message={message} />
        <ErrorAlert error={error} />

        {!s.enabled &&
          (enrolling ? (
            <MfaEnrollment
              onDone={() => {
                setEnrolling(false);
                setMessage('Verificação em duas etapas ativada.');
                refresh();
              }}
            />
          ) : (
            <button type="button" className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => setEnrolling(true)}>
              Ativar agora
            </button>
          ))}

        {s.enabled && (
          <>
            <p className="small" style={{ margin: 0 }}>
              Códigos de recuperação restantes: <b className="mono">{s.recoveryCodesLeft}</b> de 10
              {s.recoveryCodesLeft <= 3 && <span style={{ color: 'var(--warn-fg)' }}> — gere novos códigos.</span>}
            </p>
            {codes && <RecoveryCodes codes={codes} />}
            {action ? (
              <form className="stack-sm" onSubmit={onConfirm} noValidate>
                <p className="small text-2" style={{ margin: 0 }}>
                  {action === 'regenerate'
                    ? 'Os códigos antigos deixam de valer. Confirme com o código do app:'
                    : 'Confirme com o código do app para desativar:'}
                </p>
                <CodeField allowRecovery />
                <div className="row">
                  <button type="button" className="btn" onClick={() => setAction(null)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn primary" disabled={busy}>
                    {action === 'regenerate' ? 'Gerar novos códigos' : 'Desativar'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="row">
                <button type="button" className="btn" onClick={() => { setCodes(null); setMessage(null); setAction('regenerate'); }}>
                  Gerar novos códigos de recuperação
                </button>
                {!s.required && (
                  <button type="button" className="btn" onClick={() => { setMessage(null); setAction('disable'); }}>
                    Desativar
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
