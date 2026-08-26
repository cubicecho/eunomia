// Thin GraphQL client: relative /graphql (vite proxies in dev), bearer token
// from localStorage — mirroring the server's GraphQL-only auth.

const TOKEN_KEY = 'eunomia.token';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

/** Carries the server's extensions.code — callers branch on that, not wording. */
export class GraphQLError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

/** The server's code for "no session, or an expired one". */
export const UNAUTHENTICATED = 'UNAUTHENTICATED';

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
  const body = (await response.json()) as {
    data?: T;
    errors?: { message: string; extensions?: { code?: string } }[];
  };
  const error = body.errors?.[0];
  if (error) {
    throw new GraphQLError(error.message ?? 'GraphQL error', error.extensions?.code ?? null);
  }
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

/** A recent activity, as the rule forms' live preview sees it. */
export interface ActivitySample {
  app: string;
  title: string | null;
  context: string | null;
}

/**
 * The most recent activities, newest first — the corpus the rule builder tests
 * a draft pattern against, so "no matches" shows up before saving rather than
 * after wondering why nothing got categorized.
 */
export const fetchRecentActivities = (limit = 500) =>
  gql<{ activities: ActivitySample[] }>(
    'query ($limit: Int) { activities(limit: $limit, orderBy: { startedAt: { direction: desc, priority: 1 } }) { app title context } }',
    { limit },
  ).then((d) => d.activities);

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
  /** Receipt time of the device's last ping; null until its first upload. */
  lastSeenAt: string | null;
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
  gql<{ devices: Device[] }>('query { devices { id name platform createdAt lastSeenAt } }').then(
    (d) => d.devices,
  );

export const createCategory = (name: string, color: string | null) =>
  gql(
    'mutation ($name: String!, $color: String) { createCategory(name: $name, color: $color) { id } }',
    { name, color },
  );

export const deleteCategory = (id: string) =>
  gql('mutation ($id: String!) { deleteCategory(id: $id) }', { id });

/** Everything a category rule is, minus its id — what the rule editor submits. */
export type CategoryRuleInput = {
  categoryId: string;
  appPattern: string | null;
  titlePattern: string | null;
  contextPattern: string | null;
  priority: number;
};

export const createCategoryRule = (rule: CategoryRuleInput) =>
  gql(
    `mutation ($categoryId: String!, $appPattern: String, $titlePattern: String, $contextPattern: String, $priority: Int) {
      createCategoryRule(categoryId: $categoryId, appPattern: $appPattern, titlePattern: $titlePattern, contextPattern: $contextPattern, priority: $priority) { id }
    }`,
    rule,
  );

/** A whole-rule replacement: a null pattern clears that condition. */
export const updateCategoryRule = (id: string, rule: CategoryRuleInput) =>
  gql(
    `mutation ($id: String!, $categoryId: String!, $appPattern: String, $titlePattern: String, $contextPattern: String, $priority: Int) {
      updateCategoryRule(id: $id, categoryId: $categoryId, appPattern: $appPattern, titlePattern: $titlePattern, contextPattern: $contextPattern, priority: $priority) { id }
    }`,
    { id, ...rule },
  );

export const deleteCategoryRule = (id: string) =>
  gql('mutation ($id: String!) { deleteCategoryRule(id: $id) }', { id });

export type ContextRuleInput = {
  appPattern: string | null;
  titlePattern: string;
  priority: number;
};

export const createContextRule = (rule: ContextRuleInput) =>
  gql(
    `mutation ($appPattern: String, $titlePattern: String!, $priority: Int) {
      createContextRule(appPattern: $appPattern, titlePattern: $titlePattern, priority: $priority) { id }
    }`,
    rule,
  );

export const updateContextRule = (id: string, rule: ContextRuleInput) =>
  gql(
    `mutation ($id: String!, $appPattern: String, $titlePattern: String!, $priority: Int) {
      updateContextRule(id: $id, appPattern: $appPattern, titlePattern: $titlePattern, priority: $priority) { id }
    }`,
    { id, ...rule },
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

/** Moves `id`'s history onto `intoId` and retires `id`. */
export const mergeDevice = (id: string, intoId: string) =>
  gql(
    'mutation ($id: String!, $intoId: String!) { mergeDevice(id: $id, intoId: $intoId) { id } }',
    { id, intoId },
  );

export const deleteDevice = (id: string) =>
  gql('mutation ($id: String!) { deleteDevice(id: $id) }', { id });
