import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setReauthHandler } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const reauthRequired = () => json(403, { error: { code: 'mfa_reauth_required', message: 'Confirme o código.' } });

afterEach(() => {
  vi.unstubAllGlobals();
  setReauthHandler(null);
});

describe('cliente HTTP: reconfirmação do MFA', () => {
  it('pede o código e repete a ação quando a pessoa confirma', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reauthRequired()).mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const handler = vi.fn().mockResolvedValue(true);
    setReauthHandler(handler);

    await expect(api('/admin/settings/app.name', { method: 'PATCH', body: { value: 'X' } })).resolves.toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('se a pessoa cancela, devolve o erro original sem repetir', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => reauthRequired());
    vi.stubGlobal('fetch', fetchMock);
    setReauthHandler(async () => false);

    const err = await api('/admin/x', { method: 'POST', body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('mfa_reauth_required');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('pede o código no máximo uma vez por chamada', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => reauthRequired());
    vi.stubGlobal('fetch', fetchMock);
    const handler = vi.fn().mockResolvedValue(true);
    setReauthHandler(handler);

    await expect(api('/admin/x', { method: 'POST', body: {} })).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
