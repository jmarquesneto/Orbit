export const dynamic = 'force-dynamic';

/** Liveness do frontend, usado pelo healthcheck do Docker. */
export function GET(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
