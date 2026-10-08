import { AppNameSchema, isSettingKey, SETTING_DEFINITIONS } from './setting-definitions.js';

describe('AppNameSchema (nome do sistema)', () => {
  it.each(['Orbit', 'Finanças da Família', "D'Avila & Filhos", 'Casa 2026', 'Grupo (Beta)'])(
    'aceita "%s"',
    (name) => expect(AppNameSchema.safeParse(name).success).toBe(true),
  );

  it('remove espaços nas pontas', () => {
    expect(AppNameSchema.parse('  Orbit  ')).toBe('Orbit');
  });

  it.each([
    ['<script>alert(1)</script>', 'tag HTML'],
    ['"><img src=x onerror=alert(1)>', 'quebra de atributo'],
    ['Orbit`${1}`', 'template literal'],
    ['javascript:alert(1)', 'esquema de URL'],
    ['{{constructor}}', 'template injection'],
    ['A', 'curto demais'],
    ['X'.repeat(33), 'longo demais'],
    ['Orbit  Finanças', 'espaços repetidos'],
    ['-Orbit', 'começa com símbolo'],
  ])('rejeita %s (%s)', (name) => {
    expect(AppNameSchema.safeParse(name).success).toBe(false);
  });
});

describe('outras configurações', () => {
  it('cor de destaque precisa ser hexadecimal', () => {
    expect(SETTING_DEFINITIONS['app.accent'].schema.safeParse('#3DD6C3').success).toBe(true);
    expect(SETTING_DEFINITIONS['app.accent'].schema.safeParse('red; background:url(x)').success).toBe(false);
  });

  it('logo só aceita https ou vazio', () => {
    const s = SETTING_DEFINITIONS['app.logo_url'].schema;
    expect(s.safeParse('https://cdn.exemplo.com/logo.svg').success).toBe(true);
    expect(s.safeParse(null).success).toBe(true);
    expect(s.safeParse('http://exemplo.com/logo.png').success).toBe(false);
    expect(s.safeParse('javascript:alert(1)').success).toBe(false);
  });

  it('não aceita chaves fora do registro', () => {
    expect(isSettingKey('app.name')).toBe(true);
    expect(isSettingKey('__proto__')).toBe(false);
    expect(isSettingKey('constructor')).toBe(false);
  });
});
