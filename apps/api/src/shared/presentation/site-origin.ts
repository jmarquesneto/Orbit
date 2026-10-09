import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Endereço pelo qual a pessoa está usando o site (ex.: http://localhost:3010), para montar
 * links que ela vai compartilhar. Só use em POST/PATCH/DELETE: nesses métodos o
 * OriginCheckMiddleware já recusou qualquer Origin que não seja o próprio site, então o
 * valor que chega aqui é confiável. Sem Origin (scripts, Bearer) devolve null e quem chama
 * cai para WEB_ORIGIN.
 */
export const SiteOrigin = createParamDecorator((_: unknown, ctx: ExecutionContext): string | null => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return null;
  const raw = req.get('origin');
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
});
