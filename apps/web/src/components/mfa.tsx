'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { errorMessage, post, setReauthHandler } from '@/lib/api';
import type { MfaSetup } from '@/lib/types';
import { ErrorAlert } from './ui';

/** Campo do código de 6 dígitos (ou de recuperação, quando `allowRecovery`). */
export function CodeField({
  allowRecovery = false,
  autoFocus = true,
  label = 'Código de 6 dígitos',
}: {
  allowRecovery?: boolean;
  autoFocus?: boolean;
  label?: string;
}) {
  return (
    <label className="field">
      {label}
      <input
        className="input code-input"
        name="code"
        required
        autoFocus={autoFocus}
        autoComplete="one-time-code"
        inputMode={allowRecovery ? 'text' : 'numeric'}
        pattern={allowRecovery ? undefined : '[0-9 ]{6,7}'}
        maxLength={allowRecovery ? 32 : 7}
        spellCheck={false}
      />
    </label>
  );
}

export const codeFrom = (form: HTMLFormElement) => String(new FormData(form).get('code') ?? '').replace(/\s/g, '');

/** Códigos de recuperação: mostrados uma única vez, com botão de copiar. */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack-sm">
      <div className="alert ok" role="status">
        Guarde estes códigos em lugar seguro (gerenciador de senhas ou papel). Cada um entra uma única
        vez se você perder o celular. Eles não serão mostrados de novo.
      </div>
      <ul className="recovery-codes" aria-label="Códigos de recuperação">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <button
        type="button"
        className="btn small"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => navigator.clipboard.writeText(codes.join('\n')).then(() => setCopied(true))}
      >
        {copied ? 'Copiado!' : 'Copiar códigos'}
      </button>
    </div>
  );
}

/**
 * Cadastro do app autenticador: QR code → primeiro código → códigos de recuperação.
 * O segredo só é gravado na conta depois que o código confere.
 */
export function MfaEnrollment({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    post<MfaSetup>('/auth/mfa/setup').then(setSetup, (e) => setError(errorMessage(e)));
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code: codeFrom(e.currentTarget) });
      setCodes(r.recoveryCodes);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (codes) {
    return (
      <div className="stack-sm" style={{ gap: 16 }}>
        <h2 style={{ fontSize: 18 }}>Pronto! Verificação em duas etapas ativa.</h2>
        <RecoveryCodes codes={codes} />
        <label className="row small" style={{ gap: 8 }}>
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          Guardei os códigos de recuperação
        </label>
        <button type="button" className="btn primary" disabled={!saved} onClick={onDone}>
          Continuar
        </button>
      </div>
    );
  }

  return (
    <form className="stack-sm" style={{ gap: 16 }} onSubmit={onSubmit} noValidate>
      <ol className="small text-2" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
        <li>Instale um app autenticador no celular (Google Authenticator, Microsoft Authenticator, Authy…).</li>
        <li>No app, toque em “adicionar” e aponte a câmera para o QR code abaixo.</li>
        <li>Digite o código de 6 dígitos que aparecer no app.</li>
      </ol>
      {setup ? (
        <>
          <img className="qr" src={setup.qrCode} alt="QR code para cadastrar no app autenticador" />
          <details className="small">
            <summary className="muted" style={{ cursor: 'pointer' }}>Não consigo ler o QR code</summary>
            <p className="muted" style={{ margin: '8px 0 4px' }}>Digite esta chave no app (tipo “baseado em tempo”):</p>
            <span className="secret">{setup.secret}</span>
          </details>
        </>
      ) : (
        !error && <span className="muted" role="status">Gerando QR code…</span>
      )}
      <ErrorAlert error={error} />
      <CodeField autoFocus={false} />
      <button className="btn primary" type="submit" disabled={busy || !setup}>
        {busy ? 'Conferindo…' : 'Ativar'}
      </button>
    </form>
  );
}

/**
 * Diálogo de reconfirmação: ações sensíveis (ex.: publicar configurações) pedem o código de
 * novo depois de 5 minutos. O cliente HTTP chama este diálogo e repete a ação ao confirmar.
 */
export function ReauthDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReauthHandler(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setError(null);
          dialog.current?.showModal();
        }),
    );
    return () => setReauthHandler(null);
  }, []);

  function finish(ok: boolean) {
    resolver.current?.(ok);
    resolver.current = null;
    dialog.current?.close();
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError(null);
    try {
      await post('/auth/mfa/reauth', { code: codeFrom(form) });
      form.reset();
      finish(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="modal" aria-labelledby="reauth-title" onCancel={() => finish(false)}>
      <form onSubmit={onSubmit} noValidate>
        <h2 id="reauth-title" style={{ fontSize: 18 }}>Confirme que é você</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Esta ação é sensível. Digite o código do seu app autenticador (ou um código de recuperação).
        </p>
        <ErrorAlert error={error} />
        <CodeField allowRecovery label="Código" />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => finish(false)}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            Confirmar
          </button>
        </div>
      </form>
    </dialog>
  );
}
