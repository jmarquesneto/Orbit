import 'server-only';

/**
 * URL interna da API, resolvida pelo DNS da rede Docker. Lida em tempo de execução
 * (não de build), então a mesma imagem serve qualquer ambiente.
 */
export function apiInternalUrl(): string {
  const url = process.env.API_INTERNAL_URL;
  if (!url) throw new Error('API_INTERNAL_URL não definida');
  return url.replace(/\/+$/, '');
}
