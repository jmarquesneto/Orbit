import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.schema.js';
import { ROLES } from '../domain/user.js';
import type { AccessTokenClaims, AccessTokenService } from '../application/ports.js';

const ISSUER = 'api';
const AUDIENCE = 'web';
const ALGORITHM = 'HS256';

const ClaimsSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  role: z.enum(ROLES),
});

@Injectable()
export class JoseAccessTokenService implements AccessTokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(ENV) env: Env) {
    this.key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  sign(claims: AccessTokenClaims, ttlSeconds: number): Promise<string> {
    return new SignJWT({ sid: claims.sid, role: claims.role })
      .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.key);
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    // algorithms fixo impede ataques de troca de algoritmo ("alg": "none" etc.).
    const { payload } = await jwtVerify(token, this.key, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
      clockTolerance: 5,
    });
    return ClaimsSchema.parse(payload);
  }
}
