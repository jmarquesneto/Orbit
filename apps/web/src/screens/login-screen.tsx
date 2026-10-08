'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Brand, useBranding } from '@/components/branding';
import { CodeField, codeFrom } from '@/components/mfa';
import { ErrorAlert } from '@/components/ui';
import { ApiError, errorMessage, post } from '@/lib/api';

/** Só aceita voltar para um caminho interno (evita redirecionamento aberto). */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LoginScreen() {
  const { name } = useBranding();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Senha certa numa conta com MFA: o servidor devolve um desafio de 5 minutos. */
  const [challenge, setChallenge] = useState<string | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);

  function enter() {
    queryClient.clear();
    router.replace(safeNext(params.get('next')));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ mfaRequired?: boolean; challenge?: string }>('/auth/login', {
        email: String(form.get('email')),
        password: String(form.get('password')),
      });
      if (r.mfaRequired && r.challenge) {
        setChallenge(r.challenge);
        setBusy(false);
        return;
      }
      enter();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function onCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/mfa/verify', { challenge, code: codeFrom(e.currentTarget) });
      enter();
    } catch (err) {
      // Desafio vencido ou bloqueado: volta para a senha.
      if (err instanceof ApiError && err.code === 'invalid_credentials') {
        setChallenge(null);
        setError('O tempo para digitar o código acabou. Entre com a senha de novo.');
      } else {
        setError(errorMessage(err));
      }
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <main className="auth-page">
        <form className="auth-card" onSubmit={onCode} noValidate key={useRecovery ? 'rec' : 'totp'}>
          <Brand href="/login" />
          <h1 style={{ fontSize: 22, textAlign: 'center' }}>Verificação em duas etapas</h1>
          <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
            {useRecovery
              ? 'Digite um dos seus códigos de recuperação (cada um vale uma vez).'
              : 'Abra o app autenticador no celular e digite o código de 6 dígitos.'}
          </p>
          <ErrorAlert error={error} />
          <CodeField allowRecovery={useRecovery} label={useRecovery ? 'Código de recuperação' : 'Código de 6 dígitos'} />
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Conferindo…' : 'Confirmar'}
          </button>
          <button type="button" className="btn small" style={{ alignSelf: 'center' }} onClick={() => setUseRecovery((v) => !v)}>
            {useRecovery ? 'Usar o app autenticador' : 'Perdi o celular: usar código de recuperação'}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <Brand href="/login" />
        <h1 style={{ fontSize: 22, textAlign: 'center' }}>Entrar no {name}</h1>
        <ErrorAlert error={error} />
        <label className="field">
          E-mail
          <input className="input" name="email" type="email" autoComplete="username" required autoFocus />
        </label>
        <label className="field">
          Senha
          <input className="input" name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
          Acesso somente por convite. Peça um ao administrador.
        </p>
      </form>
    </main>
  );
}
