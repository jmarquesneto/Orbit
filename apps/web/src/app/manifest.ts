import type { MetadataRoute } from 'next';
import { getBranding } from '@/lib/branding';

export const dynamic = 'force-dynamic';

/** Manifest do app instalável (PWA) gerado a partir do nome atual do sistema. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { name, accent } = await getBranding();
  return {
    name,
    short_name: name.slice(0, 12),
    start_url: '/',
    display: 'standalone',
    background_color: '#0B0E13',
    theme_color: accent,
    lang: 'pt-BR',
  };
}
