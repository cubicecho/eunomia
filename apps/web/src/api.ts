// Thin GraphQL client: relative /graphql (vite proxies in dev), bearer token
// from localStorage — mirroring the server's GraphQL-only auth.

const TOKEN_KEY = 'eunomia.token';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

export class GraphQLError extends Error {}

export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = getToken();
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new GraphQLError(`HTTP ${response.status}`);
  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new GraphQLError(body.errors[0]?.message ?? 'GraphQL error');
  if (body.data == null) throw new GraphQLError('empty response');
  return body.data;
}

export interface CategoryDaySummary {
  day: string;
  categoryId: string | null;
  name: string | null;
  color: string | null;
  seconds: number;
}

export interface ActivityRow {
  app: string;
  // Sub-app division: browser site, open project/book — null when undivided.
  context: string | null;
  activeSeconds: number;
}

/**
 * Emails a single-use sign-in link. Returns the raw token only when the
 * server runs with UNSAFE_LOCAL_NETWORK — then the caller can verify it
 * immediately and skip the inbox round-trip.
 */
export const requestMagicLink = (email: string) =>
  gql<{ requestMagicLink: { token: string | null } }>(
    'mutation ($email: String!) { requestMagicLink(email: $email) { token } }',
    { email },
  ).then((d) => d.requestMagicLink.token);

export const verifyMagicLink = async (token: string): Promise<void> => {
  const data = await gql<{ verifyMagicLink: { token: string } }>(
    'mutation ($token: String!) { verifyMagicLink(token: $token) { token } }',
    { token },
  );
  setToken(data.verifyMagicLink.token);
};

export const signOut = async (): Promise<void> => {
  await gql('mutation { signOut }').catch(() => {});
  clearToken();
};

export const fetchSummary = (from: string, to: string) =>
  gql<{ categorySummary: CategoryDaySummary[] }>(
    'query ($from: String!, $to: String!) { categorySummary(from: $from, to: $to) { day categoryId name color seconds } }',
    { from, to },
  ).then((d) => d.categorySummary);

export const fetchActivities = (from: string, to: string) =>
  gql<{ activities: ActivityRow[] }>(
    // startedAt is the generated DateTime scalar, not String.
    'query ($from: DateTime!, $to: DateTime!) { activities(where: { startedAt: { gte: $from, lt: $to } }) { app context activeSeconds } }',
    { from, to },
  ).then((d) => d.activities);
