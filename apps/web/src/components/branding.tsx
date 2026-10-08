'use client';

import { createContext, type ReactNode, useContext } from 'react';
import type { Branding } from '@/lib/branding';

const BrandingContext = createContext<Branding | null>(null);

/** Recebe a identidade lida no servidor e a distribui para toda a interface. */
export function BrandingProvider({ value, children }: { value: Branding; children: ReactNode }) {
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
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
        <img src={logoUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        <BrandMark />
      )}
      <span className="brand-name">{name}</span>
    </a>
  );
}
