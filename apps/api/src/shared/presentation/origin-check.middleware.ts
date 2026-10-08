import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.schema.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Defesa contra CSRF em profundidade (além do cookie SameSite=Strict): toda requisição
 * que altera estado e vem de navegador precisa ter Origin (ou Referer) igual ao do frontend.
 * Requisições sem Origin e sem cookies (ex.: scripts, curl com Bearer) seguem permitidas,
 * pois não há credencial ambiente para um site malicioso abusar.
 */
@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  private readonly allowed: string;

  constructor(@Inject(ENV) env: Env) {
    this.allowed = new URL(env.WEB_ORIGIN).origin;
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = originOf(req.get('origin')) ?? originOf(req.get('referer'));
    const hasCookies = Boolean(req.headers.cookie);

    if ((origin && origin !== this.allowed) || (!origin && hasCookies)) {
      res.status(403).json({ error: { code: 'bad_origin', message: 'Origem não permitida.' } });
      return;
    }
    next();
  }
}
