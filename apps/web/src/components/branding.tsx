'use client';

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import type { Branding } from '@/lib/branding';

const BrandingContext = createContext<Branding | null>(null);

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** O evento vem da rede: só aceita o formato esperado (o React já escapa o texto). */
export function parseBrandingEvent(raw: string): Branding | null {
  try {
    const v = JSON.parse(raw) as Partial<Branding>;
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 64) return null;
    if (typeof v.accent !== 'string' || !HEX.test(v.accent)) return null;
    const logoUrl = typeof v.logoUrl === 'string' && v.logoUrl.startsWith('https://') ? v.logoUrl : null;
    return { name: v.name, accent: v.accent, logoUrl };
  } catch {
    return null;
  }
}

/** Troca o nome antigo pelo novo no título da aba ("Carteiras · Antigo" → "Carteiras · Novo"). */
export function retitle(title: string, oldName: string, newName: string): string {
  if (title === oldName) return newName;
  const suffix = ` · ${oldName}`;
  return title.endsWith(suffix) ? `${title.slice(0, -suffix.length)} · ${newName}` : title;
}

/**
 * Recebe a identidade lida no servidor e a distribui para toda a interface. Depois fica
 * ouvindo /api/branding/events (SSE): quando o admin salva um novo nome, cor ou logo,
 * todas as abas abertas se atualizam na hora, sem recarregar.
 */
export function BrandingProvider({ value, children }: { value: Branding; children: ReactNode }) {
  const [branding, setBranding] = useState(value);
  const current = useRef(value);

  // router.refresh() traz um valor novo do servidor: ele também vale (ex.: SSE fora do ar).
  useEffect(() => {
    current.current = value;
    setBranding(value);
  }, [value.name, value.accent, value.logoUrl]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/branding/events');
    source.addEventListener('branding', (event) => {
      const next = parseBrandingEvent((event as MessageEvent<string>).data);
      if (!next) return;
      const prev = current.current;
      if (prev.name === next.name && prev.accent === next.accent && prev.logoUrl === next.logoUrl) return;
      current.current = next;
      setBranding(next);
      document.documentElement.style.setProperty('--accent', next.accent);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next.accent);
      document.title = retitle(document.title, prev.name, next.name);
    });
    // Se a conexão cair, o navegador reconecta sozinho (retry enviado pela API).
    return () => source.close();
  }, []);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

/** Única forma de obter o nome do sistema nos componentes (nunca escreva o nome no código). */
export function useBranding(): Branding {
  const value = useContext(BrandingContext);
  if (!value) throw new Error('useBranding fora do BrandingProvider');
  return value;
}

/** Marca do design: um planeta e sua órbita, na cor de destaque. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" fill="var(--accent)" stroke="none" />
      <ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-25 12 12)" />
    </svg>
  );
}

export function Brand({ href = '/' }: { href?: string }) {
  const { name, logoUrl } = useBranding();
  return (
    <a className="brand" href={href}>
      {logoUrl ? (
        // COEP require-corp: imagem de outra origem só carrega com CORS (crossOrigin).
        <img src={logoUrl} alt="" referrerPolicy="no-referrer" crossOrigin="anonymous" />
      ) : (
        <BrandMark />
      )}
      <span className="brand-name">{name}</span>
    </a>
  );
}
