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

describe('branding ao vivo', () => {
  it('valida o evento recebido pela rede', async () => {
    const { parseBrandingEvent } = await import('./branding');
    expect(parseBrandingEvent('{"name":"Novo","accent":"#112233","logoUrl":null}')).toEqual({
      name: 'Novo',
      accent: '#112233',
      logoUrl: null,
    });
    expect(parseBrandingEvent('{"name":"X","accent":"red","logoUrl":null}')).toBeNull();
    expect(parseBrandingEvent('{"name":"X","accent":"#112233","logoUrl":"javascript:alert(1)"}')?.logoUrl).toBeNull();
    expect(parseBrandingEvent('não é json')).toBeNull();
  });

  it('troca o nome no título da aba', async () => {
    const { retitle } = await import('./branding');
    expect(retitle('Carteiras · Antigo', 'Antigo', 'Novo')).toBe('Carteiras · Novo');
    expect(retitle('Antigo', 'Antigo', 'Novo')).toBe('Novo');
    expect(retitle('Outra coisa', 'Antigo', 'Novo')).toBe('Outra coisa');
  });

  it('atualiza o menu quando chega um evento, sem recarregar', async () => {
    const { act } = await import('@testing-library/react');
    const listeners: ((e: MessageEvent<string>) => void)[] = [];
    class FakeEventSource {
      constructor(readonly url: string) {}
      addEventListener(_type: string, fn: (e: MessageEvent<string>) => void) {
        listeners.push(fn);
      }
      close() {}
    }
    const original = globalThis.EventSource;
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    try {
      render(
        <BrandingProvider value={{ name: 'Antigo', accent: '#3DD6C3', logoUrl: null }}>
          <Brand />
        </BrandingProvider>,
      );
      expect(screen.getByText('Antigo')).toBeTruthy();
      act(() => {
        for (const fn of listeners) {
          fn({ data: '{"name":"Novo Nome","accent":"#FF8800","logoUrl":null}' } as MessageEvent<string>);
        }
      });
      expect(screen.getByText('Novo Nome')).toBeTruthy();
      expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#FF8800');
    } finally {
      globalThis.EventSource = original;
    }
  });
});
