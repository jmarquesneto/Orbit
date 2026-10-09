'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { Brand, useBranding } from '@/components/branding';
import { ErrorAlert } from '@/components/ui';
import { errorMessage, post } from '@/lib/api';

type State =
  | { step: 'checking' }
  | { step: 'invalid' }
  | { step: 'ready'; token: string; email: string; expiresAt: string };

const NAME_RULE = /^\p{L}[\p{L}\p{M} .'-]*$/u;

const MIN = 12;

/**
 * Flow do convite (etapas 4–10): lê o token do fragmento (#), tira-o da barra de endereço,
 * valida no servidor e, se válido, deixa a pessoa criar a senha. O e-mail vem travado.
 */
export function InviteScreen() {
  const { name } = useBranding();
  const router = useRouter();
  const [state, setState] = useState<State>({ step: 'checking' });
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = window.location.hash.slice(1);
    // O token sai da URL logo após ser lido (não fica no histórico nem em capturas de tela).
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setState({ step: 'invalid' });
      return;
    }
    post<{ email: string; name: string | null; expiresAt: string }>('/invitations/inspect', { token })
      .then((r) => {
        setFullName(r.name ?? '');
        setState({ step: 'ready', token, email: r.email, expiresAt: r.expiresAt });
      })
      .catch(() => setState({ step: 'invalid' }));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (state.step !== 'ready') return;
    if (fullName.trim().length < 2 || !NAME_RULE.test(fullName.trim())) {
      setError("Informe seu nome (letras, espaço e . ' -).");
      return;
    }
    if (password !== confirm) {
      setError('As senhas não conferem.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post('/invitations/accept', { token: state.token, name: fullName.trim(), password });
      router.replace('/?bem-vindo=1');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const strength = password.length >= 20 ? 'forte' : password.length >= MIN ? 'boa' : 'curta demais';

  return (
    <main className="auth-page">
      <div className="auth-card">
        <Brand href="/login" />
        {state.step === 'checking' && <p className="muted" role="status">Verificando o convite…</p>}

        {state.step === 'invalid' && (
          <>
            <h1 style={{ fontSize: 22 }}>Convite inválido</h1>
            <p className="text-2" style={{ margin: 0 }}>
              Este link não é válido ou já expirou. Peça um novo convite ao administrador do {name}.
            </p>
          </>
        )}

        {state.step === 'ready' && (
          <form className="stack" onSubmit={onSubmit}>
            <div className="stack-sm">
              <h1 style={{ fontSize: 22 }}>Boas-vindas ao {name}</h1>
              <p className="small muted" style={{ margin: 0 }}>Diga como quer ser chamado e crie sua senha.</p>
            </div>
            <ErrorAlert error={error} />
            <label className="field">
              E-mail
              <input className="input" value={state.email} readOnly aria-readonly="true" autoComplete="username" />
            </label>
            <label className="field">
              Seu nome
              <input
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                maxLength={60}
                required
                autoFocus
              />
            </label>
            <label className="field">
              Nova senha
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                minLength={MIN}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby="pw-help"
                required
              />
              <span id="pw-help" className="xsmall muted">
                Mínimo de {MIN} caracteres. Uma frase longa é mais segura que símbolos. Força: {strength}.
              </span>
            </label>
            <label className="field">
              Confirme a senha
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </label>
            <button className="btn primary" type="submit" disabled={busy || password.length < MIN}>
              {busy ? 'Ativando…' : 'Ativar conta'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
