import path from 'node:path';
import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Isolamento entre origens: nenhuma outra origem embute, abre ou lê os recursos do site.
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  // Strict-Transport-Security NÃO fica aqui: só pode ir em respostas HTTPS (middleware.ts).
];

const nextConfig: NextConfig = {
  // Gera um servidor Node mínimo em .next/standalone — imagem Docker enxuta.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  poweredByHeader: false,
  // Sem otimização de imagens no servidor (e sem o módulo nativo "sharp"): a imagem
  // Docker fica igual para amd64 e arm64.
  images: { unoptimized: true },
  reactStrictMode: true,
  // O navegador só conversa com o frontend (mesma origem → cookies SameSite=Strict funcionam).
  // /api/* é repassado à API pela rede interna, com X-Forwarded-For para o rate limit.
  async rewrites() {
    const api = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
