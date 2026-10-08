import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Brand, BrandingProvider } from './branding';

afterEach(cleanup);

describe('white-label', () => {
  it('o menu mostra o nome que veio das configurações', () => {
    render(
      <BrandingProvider value={{ name: 'Finanças da Casa', accent: '#3DD6C3', logoUrl: null }}>
        <Brand />
      </BrandingProvider>,
    );
    expect(screen.getByText('Finanças da Casa')).toBeTruthy();
  });

  it('um nome malicioso é exibido como texto, nunca interpretado como HTML', () => {
    const { container } = render(
      <BrandingProvider value={{ name: '<img src=x onerror=alert(1)>', accent: '#3DD6C3', logoUrl: null }}>
        <Brand />
      </BrandingProvider>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  });

  it('usa o logotipo configurado quando existe', () => {
    const { container } = render(
      <BrandingProvider value={{ name: 'X', accent: '#3DD6C3', logoUrl: 'https://cdn.exemplo.com/logo.svg' }}>
        <Brand />
      </BrandingProvider>,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.exemplo.com/logo.svg');
  });
});
