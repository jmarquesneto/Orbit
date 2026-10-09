/**
 * Regras de transporte (HTTP × HTTPS), sem dependências de runtime: usadas no middleware
 * (edge) e nos testes.
 *
 * O HTTPS é terminado por um proxy na frente do contêiner (Nginx, Nginx Proxy Manager,
 * Cloudflare…), que informa o esquema original em X-Forwarded-Proto. Acesso direto pela
 * rede local (http://IP:3010) não tem esse cabeçalho e continua funcionando em HTTP.
 */

export const HSTS_VALUE = 'max-age=63072000; includeSubDomains; preload';

export interface TransportDecision {
  /** URL https para onde redirecionar (301/308), ou null. */
  redirectTo: string | null;
  /** HSTS só vale (e só é enviado) em resposta servida por HTTPS — RFC 6797 §7.2. */
  sendHsts: boolean;
}

/** Primeiro valor de X-Forwarded-Proto ("https, http" → "https"), em minúsculas. */
export function forwardedProto(header: string | null): string | null {
  const first = header?.split(',')[0]?.trim().toLowerCase();
  return first === 'http' || first === 'https' ? first : null;
}

/**
 * Endereço de rede local: IP (v4/v6), "localhost" ou nome ".local". Nesses o acesso direto
 * em HTTP (http://IP:3010) continua permitido — não há certificado para um IP de casa.
 * Obs.: o próprio Next.js preenche X-Forwarded-Proto=http em acesso direto, então o
 * cabeçalho sozinho não distingue "veio do proxy" de "veio da rede local".
 */
export function isLocalHost(host: string): boolean {
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return (
    name === 'localhost' ||
    name.endsWith('.local') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(name) ||
    name.includes(':') // IPv6 literal
  );
}

export function decideTransport(input: {
  url: string;
  forwardedProto: string | null;
  forwardedHost: string | null;
  forceHttps: boolean;
}): TransportDecision {
  const proto = forwardedProto(input.forwardedProto);
  if (proto === 'https') return { redirectTo: null, sendHsts: true };
  if (proto === 'http' && input.forceHttps) {
    const url = new URL(input.url);
    const host = input.forwardedHost?.split(',')[0]?.trim() || url.host;
    if (isLocalHost(host)) return { redirectTo: null, sendHsts: false };
    // Só o host público; a porta interna do contêiner (3000) nunca vai para o link.
    const publicHost = host.replace(/:(80|3000)$/, '');
    return { redirectTo: `https://${publicHost}${url.pathname}${url.search}`, sendHsts: false };
  }
  return { redirectTo: null, sendHsts: false };
}
