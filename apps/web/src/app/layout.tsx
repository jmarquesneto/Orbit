import type { ReactNode } from 'react';

// O título e a identidade visual virão de GET /branding (system_settings) no Bloco 4.
// Nenhum nome de sistema é escrito aqui de propósito: a interface é white-label.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
