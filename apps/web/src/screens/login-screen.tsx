'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Brand, useBranding } from '@/components/branding';
import { ErrorAlert } from '@/components/ui';
import { errorMessage, post } from '@/lib/api';

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

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await post('/auth/login', { email: String(form.get('email')), password: String(form.get('password')) });
      queryClient.clear();
      router.replace(safeNext(params.get('next')));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
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
