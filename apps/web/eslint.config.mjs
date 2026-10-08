import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * White-label: o nome do sistema vem SEMPRE de system_settings (useBranding/getBranding).
 * Qualquer texto com o nome padrão de fábrica escrito no código quebra o lint.
 */
const HARDCODED_NAME = 'Não escreva o nome do sistema no código: use useBranding() ou getBranding().';
const forbidden = '/\\borbit\\b/i';

export default tseslint.config(
  { ignores: ['.next/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=${forbidden}]`, message: HARDCODED_NAME },
        { selector: `TemplateElement[value.raw=${forbidden}]`, message: HARDCODED_NAME },
        { selector: `JSXText[value=${forbidden}]`, message: HARDCODED_NAME },
      ],
      // React já escapa texto; HTML cru com dados é proibido (XSS).
      'no-restricted-properties': [
        'error',
        { property: 'dangerouslySetInnerHTML', message: 'Nunca injete HTML com dados (risco de XSS).' },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
