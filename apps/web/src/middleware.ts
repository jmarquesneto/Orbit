import { type NextRequest, NextResponse } from 'next/server';
import { decideTransport, HSTS_VALUE } from './lib/transport';

/**
 * Content-Security-Policy com nonce por requisição: só scripts emitidos pelo próprio Next
 * (que recebem o nonce) executam. Um XSS injetado não tem o nonce e é bloqueado.
 * Estilos inline são permitidos porque a cor de destaque é uma variável CSS dinâmica.
 */
export function middleware(request: NextRequest) {
  // HTTP → HTTPS (quando FORCE_HTTPS=true e o proxy informa que a conexão veio em HTTP).
  const transport = decideTransport({
    url: request.url,
    forwardedProto: request.headers.get('x-forwarded-proto'),
    forwardedHost: request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
    forceHttps: process.env.FORCE_HTTPS === 'true',
  });
  if (transport.redirectTo) {
    // 301 para navegação; 308 preserva método e corpo de um POST que chegou em HTTP.
    const status = request.method === 'GET' || request.method === 'HEAD' ? 301 : 308;
    return NextResponse.redirect(transport.redirectTo, status);
  }

  const nonce = btoa(crypto.randomUUID()); // runtime edge: sem Buffer
  const dev = process.env.NODE_ENV === 'development';
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  if (transport.sendHsts) response.headers.set('Strict-Transport-Security', HSTS_VALUE);
  return response;
}

export const config = {
  // A API (/api/*) define a própria CSP; arquivos estáticos não precisam de nonce.
  matcher: [{ source: '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|healthz).*)' }],
};
