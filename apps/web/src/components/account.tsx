'use client';

import { type FormEvent, useState } from 'react';
import { errorMessage, patch, post } from '@/lib/api';
import { ErrorAlert, SuccessAlert } from './ui';

const MIN = 12;
const NAME_RULE = /^\p{L}[\p{L}\p{M} .'-]*$/u;

/** Nome de exibição ("Olá, Marina"). */
export function ProfileForm({
  initialName,
  email,
  submitLabel = 'Salvar',
  onSaved,
}: {
  initialName: string | null;
  email: string;
  submitLabel?: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = name.trim();
  const problem = value.length < 2 ? 'Informe ao menos 2 letras.' : NAME_RULE.test(value) ? null : "Use apenas letras, espaço e . ' -";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      await patch('/auth/me', { name: value });
      setSaved('Nome atualizado.');
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack-sm" style={{ gap: 14 }} onSubmit={onSubmit} noValidate>
      <ErrorAlert error={error} />
      <SuccessAlert message={saved} />
      <label className="field">
        Nome
        <input
          className="input"
          value={name}
          maxLength={60}
          autoComplete="name"
          onChange={(e) => {
            setName(e.target.value);
            setSaved(null);
          }}
          required
        />
      </label>
      <label className="field">
        E-mail
        <input className="input" value={email} readOnly aria-readonly="true" />
      </label>
      <button className="btn primary" type="submit" style={{ alignSelf: 'flex-start' }} disabled={busy || value === (initialName ?? '')}>
        {submitLabel}
      </button>
    </form>
  );
}

/**
 * Troca de senha. `forced`: a pessoa entrou com a senha provisória do admin e precisa
 * criar a própria antes de continuar (o campo "senha atual" é a provisória).
 */
export function PasswordForm({ forced = false, onDone }: { forced?: boolean; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setError('As senhas novas não conferem.');
    setBusy(true);
    setError(null);
    try {
      await post('/auth/password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setSaved('Senha alterada. Os outros aparelhos conectados foram desconectados.');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const strength = next.length >= 20 ? 'forte' : next.length >= MIN ? 'boa' : 'curta demais';

  return (
    <form className="stack-sm" style={{ gap: 14 }} onSubmit={onSubmit} noValidate>
      <ErrorAlert error={error} />
      <SuccessAlert message={saved} />
      <label className="field">
        {forced ? 'Senha provisória (a que o administrador passou)' : 'Senha atual'}
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </label>
      <label className="field">
        Nova senha
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          maxLength={128}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          aria-describedby="new-pw-help"
          required
        />
        <span id="new-pw-help" className="xsmall muted">
          Mínimo de {MIN} caracteres. Uma frase longa é mais segura que símbolos. Força: {strength}.
        </span>
      </label>
      <label className="field">
        Confirme a nova senha
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </label>
      <button
        className="btn primary"
        type="submit"
        style={{ alignSelf: forced ? 'stretch' : 'flex-start' }}
        disabled={busy || !current || next.length < MIN}
      >
        {busy ? 'Salvando…' : 'Trocar senha'}
      </button>
    </form>
  );
}
