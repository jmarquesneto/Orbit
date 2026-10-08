'use client';

import type { ReactNode } from 'react';
import { percent } from '@/lib/format';

export function PageHeader({ eyebrow, title, children }: { eyebrow?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="stack-sm" style={{ gap: 4 }}>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
      </div>
      {children && <div className="row">{children}</div>}
    </header>
  );
}

export function Progress({ value, max, variant }: { value: number; max: number; variant?: 'goal' }) {
  const pct = percent(value, max);
  const over = pct > 100;
  return (
    <div
      className={`progress${variant ? ` ${variant}` : ''}${over ? ' over' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(pct, 100)}
    >
      <span style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

export function ErrorAlert({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <div className="alert error" role="alert">
      {error}
    </div>
  );
}

export function SuccessAlert({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div className="alert ok" role="status">
      {message}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong style={{ color: 'var(--text)' }}>{title}</strong>
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <p className="muted" role="status">
      Carregando…
    </p>
  );
}
