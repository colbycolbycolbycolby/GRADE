export type Route =
  | { name: 'library' }
  | { name: 'import' }
  | { name: 'settings' }
  | { name: 'planner' }
  | { name: 'analyzing'; jobId: string; trackId: string }
  | { name: 'program'; id: string }
  | { name: 'plan'; id: string }
  | { name: 'run'; kind: 'program' | 'plan'; id: string };

/** Reads a route from `location.hash`, for example `#/program/abc`. Unknown paths open the library. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'import') return { name: 'import' };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'planner') return { name: 'planner' };
  if (parts[0] === 'analyzing' && parts[1] && parts[2]) {
    return { name: 'analyzing', jobId: parts[1], trackId: parts[2] };
  }
  if (parts[0] === 'program' && parts[1]) return { name: 'program', id: parts[1] };
  if (parts[0] === 'plan' && parts[1]) return { name: 'plan', id: parts[1] };
  if (parts[0] === 'run' && (parts[1] === 'program' || parts[1] === 'plan') && parts[2]) {
    return { name: 'run', kind: parts[1], id: parts[2] };
  }
  return { name: 'library' };
}

export const hrefs = {
  library: () => '#/',
  import: () => '#/import',
  settings: () => '#/settings',
  planner: () => '#/planner',
  analyzing: (jobId: string, trackId: string) =>
    `#/analyzing/${encodeURIComponent(jobId)}/${encodeURIComponent(trackId)}`,
  program: (id: string) => `#/program/${encodeURIComponent(id)}`,
  plan: (id: string) => `#/plan/${encodeURIComponent(id)}`,
  run: (kind: 'program' | 'plan', id: string) => `#/run/${kind}/${encodeURIComponent(id)}`,
};
