import 'server-only';
import { apiInternalUrl } from './server-env';

export interface Branding {
  name: string;
  accent: string;
  logoUrl: string | null;
}

/**
 * Lê a identidade do sistema da tabela system_settings (via API) a cada renderização.
 * A API guarda em cache no Redis; aqui não há cache para que uma troca feita no painel
 * apareça na próxima página. Se a API estiver fora do ar, usa um nome neutro — nunca um
 * nome fixo de produto.
 */
export async function getBranding(): Promise<Branding> {
  try {
    const res = await fetch(`${apiInternalUrl()}/api/branding`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as Branding;
    return {
      name: data.name,
      accent: /^#[0-9A-Fa-f]{6}$/.test(data.accent) ? data.accent : '#3DD6C3',
      logoUrl: data.logoUrl && data.logoUrl.startsWith('https://') ? data.logoUrl : null,
    };
  } catch {
    return { name: 'Finanças', accent: '#3DD6C3', logoUrl: null };
  }
}
