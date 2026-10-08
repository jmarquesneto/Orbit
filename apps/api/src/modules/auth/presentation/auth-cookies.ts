import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.schema.js';
import type { IssuedSession } from '../application/session.service.js';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';

/**
 * Tokens só trafegam em cookies httpOnly (inacessíveis a JavaScript → imunes a roubo por XSS),
 * SameSite=Strict (não vão em requisições de outros sites) e Secure quando o site é HTTPS.
 * O refresh token só é enviado para /api/auth, reduzindo sua exposição.
 */
@Injectable()
export class AuthCookies {
  private readonly secure: boolean;

  constructor(@Inject(ENV) env: Env) {
    this.secure = new URL(env.WEB_ORIGIN).protocol === 'https:';
  }

  private base(path: string): CookieOptions {
    return { httpOnly: true, secure: this.secure, sameSite: 'strict', path };
  }

  set(res: Response, session: IssuedSession): void {
    res.cookie(ACCESS_COOKIE, session.accessToken, {
      ...this.base('/api'),
      expires: session.accessExpiresAt,
    });
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...this.base('/api/auth'),
      expires: session.refreshExpiresAt,
    });
  }

  clear(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, this.base('/api'));
    res.clearCookie(REFRESH_COOKIE, this.base('/api/auth'));
  }

  /** Cookie httpOnly primeiro; `Authorization: Bearer` para clientes que não são navegador. */
  accessTokenFrom(req: Request): string | null {
    const fromCookie = (req.cookies as Record<string, unknown> | undefined)?.[ACCESS_COOKIE];
    if (typeof fromCookie === 'string' && fromCookie) return fromCookie;
    const header = req.get('authorization');
    const match = header?.match(/^Bearer ([A-Za-z0-9._-]{20,4096})$/);
    return match?.[1] ?? null;
  }

  refreshTokenFrom(req: Request): unknown {
    return (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  }
}
