import { describe, expect, it } from 'vitest';
import { decideTransport, forwardedProto } from './transport';

const base = { url: 'http://web:3000/manutencao?x=1', forwardedHost: 'vesta.exemplo.com', forceHttps: true };

describe('HTTP × HTTPS', () => {
  it('HTTPS (pelo proxy): envia HSTS e não redireciona', () => {
    expect(decideTransport({ ...base, forwardedProto: 'https' })).toEqual({ redirectTo: null, sendHsts: true });
  });

  it('HTTP com FORCE_HTTPS: redireciona para https mantendo caminho e sem HSTS', () => {
    expect(decideTransport({ ...base, forwardedProto: 'http' })).toEqual({
      redirectTo: 'https://vesta.exemplo.com/manutencao?x=1',
      sendHsts: false,
    });
    expect(decideTransport({ ...base, forwardedProto: 'http', forwardedHost: 'vesta.exemplo.com:80' }).redirectTo).toBe(
      'https://vesta.exemplo.com/manutencao?x=1',
    );
  });

  it('acesso direto pela rede local (sem proxy): nem redireciona nem manda HSTS', () => {
    expect(decideTransport({ ...base, forwardedProto: null })).toEqual({ redirectTo: null, sendHsts: false });
    expect(decideTransport({ ...base, forwardedProto: 'http', forceHttps: false })).toEqual({ redirectTo: null, sendHsts: false });
  });

  it('com FORCE_HTTPS, acesso por IP/localhost/.local na rede de casa continua em HTTP', () => {
    for (const host of ['192.168.1.50:3010', 'localhost:3010', 'nas.local:3010', '[fe80::1]:3010']) {
      expect(decideTransport({ ...base, forwardedProto: 'http', forwardedHost: host })).toEqual({ redirectTo: null, sendHsts: false });
    }
  });

  it('lê só o primeiro valor do X-Forwarded-Proto e ignora lixo', () => {
    expect(forwardedProto('https, http')).toBe('https');
    expect(forwardedProto('HTTP')).toBe('http');
    expect(forwardedProto('javascript')).toBeNull();
  });
});
