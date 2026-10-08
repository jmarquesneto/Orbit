'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, del, errorMessage, post } from '@/lib/api';
import type { Share } from '@/lib/types';
import { ROLE_LABEL } from '@/lib/types';
import { ErrorAlert } from './ui';

const ROLES = [
  { code: 'read', label: 'Leitura', help: 'vê tudo, não altera' },
  { code: 'edit', label: 'Edição', help: 'vê e edita' },
  { code: 'create', label: 'Criação', help: 'vê, edita e cria itens' },
] as const;

/** Compartilhamento de um orçamento ou caixinha. Só o dono vê o formulário. */
export function SharePanel({ type, id, isOwner }: { type: 'budget' | 'goal'; id: string; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const key = ['shares', type, id];
  const shares = useQuery({
    queryKey: key,
    queryFn: () => api<{ shares: Share[] }>(`/shares?resourceType=${type}&resourceId=${id}`).then((r) => r.shares),
  });
  const [error, setError] = useState<string | null>(null);

  const share = useMutation({
    mutationFn: (body: { email: string; role: string }) => post('/shares', { resourceType: type, resourceId: id, ...body }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (shareId: string) => del(`/shares/${shareId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
    onError: (e) => setError(errorMessage(e)),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    share.mutate({ email: String(form.get('email')), role: String(form.get('role')) });
    e.currentTarget.reset();
  }

  return (
    <section className="card" aria-labelledby={`share-${id}`}>
      <div className="stack-sm" style={{ gap: 2 }}>
        <h2 id={`share-${id}`} style={{ fontSize: 17 }}>
          Compartilhamento
        </h2>
        <span className="small muted">
          A permissão é conferida em cada acesso. Só o dono compartilha, exclui e arquiva.
        </span>
      </div>
      <ErrorAlert error={error} />
      {shares.data?.length ? (
        <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {shares.data.map((s) => (
            <li key={s.id} className="between">
              <span>{s.grantee.email}</span>
              <span className="row" style={{ gap: 8 }}>
                <span className="badge ok">{ROLE_LABEL[s.role]}</span>
                {isOwner && (
                  <button type="button" className="btn small" onClick={() => revoke.mutate(s.id)}>
                    Remover
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="small muted">Ninguém mais tem acesso.</span>
      )}
      {isOwner && (
        <form className="row" onSubmit={onSubmit} style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '2 1 220px' }}>
            E-mail da pessoa
            <input className="input" name="email" type="email" required />
          </label>
          <label className="field" style={{ flex: '1 1 160px' }}>
            Papel
            <select className="select" name="role" defaultValue="read">
              {ROLES.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label} — {r.help}
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary" type="submit" disabled={share.isPending}>
            Compartilhar
          </button>
        </form>
      )}
    </section>
  );
}
