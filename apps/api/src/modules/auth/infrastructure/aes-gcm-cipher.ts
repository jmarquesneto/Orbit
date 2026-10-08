import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.schema.js';
import type { SecretCipher } from '../application/ports.js';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM com a chave DATA_ENCRYPTION_KEY. Formato gravado:
 * [versão 1 byte][IV 12 bytes][tag 16 bytes][texto cifrado]. A versão permite trocar de
 * chave/algoritmo no futuro sem ambiguidade; a tag detecta qualquer adulteração.
 */
@Injectable()
export class AesGcmCipher implements SecretCipher {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.key = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
  }

  encrypt(plain: Buffer): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
  }

  decrypt(sealed: Buffer): Buffer {
    if (sealed[0] !== VERSION) throw new Error('Formato de segredo desconhecido');
    const iv = sealed.subarray(1, 1 + IV_BYTES);
    const tag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const body = sealed.subarray(1 + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  }
}
