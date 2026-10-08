import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { BrandingProvider } from '@/components/branding';
import { Providers } from '@/components/providers';
import { getBranding } from '@/lib/branding';

/**
 * Toda página é renderizada por requisição: o branding nunca fica "congelado" no build,
 * e cada resposta recebe um nonce próprio de CSP (ver middleware.ts).
 */
export const dynamic = 'force-dynamic';

/**
 * White-label: o nome e a cor vêm de system_settings (via API) já no primeiro HTML.
 * Não existe nome de sistema escrito neste código — ele chega por getBranding().
 */
export async function generateMetadata(): Promise<Metadata> {
  const { name } = await getBranding();
  return {
    title: { default: name, template: `%s · ${name}` },
    applicationName: name,
    robots: { index: false, follow: false },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const { accent } = await getBranding();
  return { themeColor: accent, colorScheme: 'dark' };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const branding = await getBranding();
  return (
    <html lang="pt-BR" style={{ '--accent': branding.accent } as CSSProperties}>
      <body>
        <BrandingProvider value={branding}>
          <Providers>{children}</Providers>
        </BrandingProvider>
      </body>
    </html>
  );
}
