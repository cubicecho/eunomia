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

export interface AppSummaryRow {
  app: string;
  // Sub-app division: browser site, open project/book — null when undivided.
  context: string | null;
  seconds: number;
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

export const fetchAppSummary = (from: string, to: string) =>
  gql<{ appSummary: AppSummaryRow[] }>(
    'query ($from: String!, $to: String!) { appSummary(from: $from, to: $to) { app context seconds } }',
    { from, to },
  ).then((d) => d.appSummary);

export interface Category {
  id: string;
  name: string;
  color: string | null;
}

export interface CategoryRule {
  id: string;
  categoryId: string;
  appPattern: string | null;
  titlePattern: string | null;
  contextPattern: string | null;
  priority: number;
}

export interface ContextRule {
  id: string;
  appPattern: string | null;
  titlePattern: string;
  priority: number;
}

export interface Device {
  id: string;
  name: string;
  platform: string;
  createdAt: string;
}

export const fetchCategories = () =>
  gql<{ categories: Category[] }>('query { categories { id name color } }').then(
    (d) => d.categories,
  );

export const fetchCategoryRules = () =>
  gql<{ categoryRules: CategoryRule[] }>(
    'query { categoryRules { id categoryId appPattern titlePattern contextPattern priority } }',
  ).then((d) => d.categoryRules);

export const fetchContextRules = () =>
  gql<{ contextRules: ContextRule[] }>(
    'query { contextRules { id appPattern titlePattern priority } }',
  ).then((d) => d.contextRules);

export const fetchDevices = () =>
  gql<{ devices: Device[] }>('query { devices { id name platform createdAt } }').then(
    (d) => d.devices,
  );

export const createCategory = (name: string, color: string | null) =>
  gql(
    'mutation ($name: String!, $color: String) { createCategory(name: $name, color: $color) { id } }',
    { name, color },
  );

export const deleteCategory = (id: string) =>
  gql('mutation ($id: String!) { deleteCategory(id: $id) }', { id });

export const createCategoryRule = (rule: {
  categoryId: string;
  appPattern: string | null;
  titlePattern: string | null;
  contextPattern: string | null;
  priority: number;
}) =>
  gql(
    `mutation ($categoryId: String!, $appPattern: String, $titlePattern: String, $contextPattern: String, $priority: Int) {
      createCategoryRule(categoryId: $categoryId, appPattern: $appPattern, titlePattern: $titlePattern, contextPattern: $contextPattern, priority: $priority) { id }
    }`,
    rule,
  );

export const deleteCategoryRule = (id: string) =>
  gql('mutation ($id: String!) { deleteCategoryRule(id: $id) }', { id });

export const createContextRule = (rule: {
  appPattern: string | null;
  titlePattern: string;
  priority: number;
}) =>
  gql(
    `mutation ($appPattern: String, $titlePattern: String!, $priority: Int) {
      createContextRule(appPattern: $appPattern, titlePattern: $titlePattern, priority: $priority) { id }
    }`,
    rule,
  );

export const deleteContextRule = (id: string) =>
  gql('mutation ($id: String!) { deleteContextRule(id: $id) }', { id });

/** Re-runs category rules over past activities; resolves to the number changed. */
export const applyCategoryRules = () =>
  gql<{ applyCategoryRules: number }>('mutation { applyCategoryRules }').then(
    (d) => d.applyCategoryRules,
  );

export const renameDevice = (id: string, name: string) =>
  gql('mutation ($id: String!, $name: String!) { renameDevice(id: $id, name: $name) { id } }', {
    id,
    name,
  });

export const deleteDevice = (id: string) =>
  gql('mutation ($id: String!) { deleteDevice(id: $id) }', { id });
