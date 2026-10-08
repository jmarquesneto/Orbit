import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '../application/ports.js';

export function requestContextOf(req: Request): RequestContext {
  const ua = req.get('user-agent');
  return {
    // Com "trust proxy" = 1, req.ip é o IP do cliente informado pelo proxy do frontend.
    ip: req.ip ? req.ip.replace(/^::ffff:/, '') : null,
    userAgent: ua ? ua.slice(0, 512) : null,
  };
}

/** Injeta { ip, userAgent } da requisição no controller. */
export const ReqContext = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RequestContext =>
    requestContextOf(ctx.switchToHttp().getRequest<Request>()),
);
