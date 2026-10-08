/**
 * Cliente HTTP do navegador. Fala só com a própria origem (/api/* é repassado à API),
 * então os cookies httpOnly da sessão vão sozinhos — o JavaScript nunca toca nos tokens.
 * Em 401, tenta renovar a sessão UMA vez (refresh rotativo) e repete a chamada.
 */

export interface ApiIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: ApiIssue[] = [],
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => (refreshing = null), 0);
    });
  return refreshing;
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; issues?: ApiIssue[] } };
    return new ApiError(
      res.status,
      body.error?.code ?? `http_${res.status}`,
      body.error?.message ?? 'Algo deu errado. Tente novamente.',
      body.error?.issues ?? [],
    );
  } catch {
    return new ApiError(res.status, `http_${res.status}`, 'Algo deu errado. Tente novamente.');
  }
}

type Body = Record<string, unknown> | FormData | undefined;

export async function api<T>(path: string, init: { method?: string; body?: Body } = {}, retry = true): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: isForm || !init.body ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? (init.body as FormData) : init.body ? JSON.stringify(init.body) : undefined,
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, init, false);
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const post = <T>(path: string, body?: Body) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T>(path: string, body: Body) => api<T>(path, { method: 'PATCH', body });
export const del = <T = void>(path: string) => api<T>(path, { method: 'DELETE' });

/** Mensagem amigável para qualquer erro vindo da API. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.issues.length ? err.issues.map((i) => i.message).join(' ') : err.message;
  }
  return 'Não foi possível falar com o servidor. Verifique sua conexão.';
}
