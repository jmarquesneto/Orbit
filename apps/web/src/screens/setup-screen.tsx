'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { Brand, useBranding } from '@/components/branding';
import { ErrorAlert } from '@/components/ui';
import { api, errorMessage, post } from '@/lib/api';

const MIN = 12;
const NAME_RULE = /^\p{L}[\p{L}\p{M} .'-]*$/u;

/**
 * Primeiro acesso: enquanto o sistema não tem nenhuma conta, quem abre o site cria o
 * administrador (como no Portainer). Depois disso esta tela some e leva para o login.
 */
export function SetupScreen() {
  const { name: appName } = useBranding();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ needed: boolean }>('/setup')
      .then((r) => (r.needed ? setReady(true) : router.replace('/login')))
      .catch(() => router.replace('/login'));
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2 || !NAME_RULE.test(name.trim())) return setError("Informe seu nome (letras, espaço e . ' -).");
    if (password !== confirm) return setError('As senhas não conferem.');
    setBusy(true);
    setError(null);
    try {
      await post('/setup', { name: name.trim(), email: email.trim(), password });
      queryClient.clear();
      router.replace('/'); // a seguir o sistema pede o app autenticador
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="auth-page" role="status">
        <span className="muted">Carregando…</span>
      </main>
    );
  }

  const strength = password.length >= 20 ? 'forte' : password.length >= MIN ? 'boa' : 'curta demais';
  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <Brand href="/primeiro-acesso" />
        <div className="stack-sm">
          <h1 style={{ fontSize: 22, textAlign: 'center' }}>Bem-vindo ao {appName}</h1>
          <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
            Primeiro acesso: crie a conta de administrador. Depois você convida as outras pessoas.
          </p>
        </div>
        <ErrorAlert error={error} />
        <label className="field">
          Seu nome
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} required autoFocus />
        </label>
        <label className="field">
          E-mail
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label className="field">
          Senha
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="setup-pw-help"
            required
          />
          <span id="setup-pw-help" className="xsmall muted">
            Mínimo de {MIN} caracteres. Uma frase longa é mais segura que símbolos. Força: {strength}.
          </span>
        </label>
        <label className="field">
          Confirme a senha
          <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        <button className="btn primary" type="submit" disabled={busy || password.length < MIN || !email}>
          {busy ? 'Criando…' : 'Criar administrador'}
        </button>
      </form>
    </main>
  );
}
