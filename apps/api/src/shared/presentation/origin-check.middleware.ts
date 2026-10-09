import { Inject, Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.schema.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parse(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Defesa contra CSRF em profundidade (além do cookie SameSite=Strict): toda requisição
 * que altera estado e vem de navegador precisa vir do PRÓPRIO site. Vale se o Origin
 * (ou Referer) for:
 *  - igual a WEB_ORIGIN; ou
 *  - igual ao endereço que o navegador usou para abrir o site. O proxy do frontend informa
 *    esse endereço em X-Forwarded-Host, sobrescrevendo qualquer valor vindo do cliente, e a
 *    API só é alcançável por esse proxy (rede interna do Docker).
 * Um site de terceiros nunca satisfaz nenhuma das duas regras.
 * Requisições sem Origin e sem cookies (ex.: scripts, curl com Bearer) seguem permitidas,
 * pois não há credencial ambiente para um site malicioso abusar.
 */
@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  private readonly logger = new Logger('OriginCheck');
  private readonly allowed: string;
  private warned = false;

  constructor(@Inject(ENV) env: Env) {
    this.allowed = new URL(env.WEB_ORIGIN).origin;
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = parse(req.get('origin')) ?? parse(req.get('referer'));
    const hasCookies = Boolean(req.headers.cookie);

    if (!origin) {
      if (hasCookies) return this.reject(res);
      return next();
    }
    if (origin.origin === this.allowed) return next();

    const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase();
    if (forwardedHost && origin.host.toLowerCase() === forwardedHost) {
      if (!this.warned) {
        this.warned = true;
        this.logger.log(`Site acessado por ${origin.origin} (WEB_ORIGIN=${this.allowed}).`);
      }
      return next();
    }
    return this.reject(res);
  }

  private reject(res: Response): void {
    res.status(403).json({ error: { code: 'bad_origin', message: 'Origem não permitida.' } });
  }
}
