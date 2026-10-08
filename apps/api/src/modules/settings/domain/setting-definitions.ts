import { z } from 'zod';

/**
 * Nome do sistema (white-label). A lista de caracteres permitidos é a principal defesa
 * contra XSS armazenado: "<", ">", aspas duplas, crases e afins nunca entram no banco.
 */
export const AppNameSchema = z
  .string()
  .trim()
  .min(2, 'O nome deve ter ao menos 2 caracteres.')
  .max(32, 'O nome deve ter no máximo 32 caracteres.')
  .regex(
    /^[\p{L}\p{N}][\p{L}\p{N} .,'&()-]*$/u,
    "Use apenas letras, números, espaço e . , ' & ( ) -",
  )
  .refine((v) => !/\s{2,}/.test(v), 'Evite espaços repetidos.');

const AccentSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use uma cor hexadecimal, ex.: #3DD6C3.');

const LogoUrlSchema = z
  .url({ protocol: /^https$/, error: 'Use um endereço https://' })
  .max(2048)
  .nullable();

const InviteTtlSchema = z.number().int().min(1).max(24 * 30);

interface SettingDefinition<T> {
  schema: z.ZodType<T>;
  isPublic: boolean;
  description: string;
}

export const SETTING_DEFINITIONS = {
  'app.name': {
    schema: AppNameSchema,
    isPublic: true,
    description: 'Nome do sistema exibido em todas as telas e e-mails',
  },
  'app.accent': {
    schema: AccentSchema,
    isPublic: true,
    description: 'Cor de destaque da interface',
  },
  'app.logo_url': {
    schema: LogoUrlSchema,
    isPublic: true,
    description: 'Endereço do logotipo (https) ou vazio',
  },
  'invite.ttl_hours': {
    schema: InviteTtlSchema,
    isPublic: false,
    description: 'Validade padrão dos convites, em horas',
  },
} satisfies Record<string, SettingDefinition<unknown>>;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTING_DEFINITIONS)[K]['schema']>;

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_DEFINITIONS, key);
}

export interface Branding {
  name: string;
  accent: string;
  logoUrl: string | null;
}
