import { apiInternalUrl } from '@/lib/server-env';

export const dynamic = 'force-dynamic';

type Readiness = { status: string; dependencies?: Record<string, string> };

async function fetchReadiness(): Promise<Readiness> {
  try {
    const res = await fetch(`${apiInternalUrl()}/api/health/ready`, { cache: 'no-store' });
    return (await res.json()) as Readiness;
  } catch {
    return { status: 'unreachable' };
  }
}

/** Página provisória do Bloco 1: confirma que web → api → (db, cache) está ligado. */
export default async function Home() {
  const readiness = await fetchReadiness();
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
      <h1>Infraestrutura</h1>
      <p>
        API: <strong>{readiness.status}</strong>
      </p>
      {readiness.dependencies && (
        <ul>
          {Object.entries(readiness.dependencies).map(([name, state]) => (
            <li key={name}>
              {name}: {state}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
