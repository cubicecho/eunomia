// Server access for the dashboard. Every operation lives in
// src/operations.graphql and every request/response type comes from the
// generated SDK (src/gql/sdk.ts — regenerate with `npm run codegen` at the
// root); this file supplies the fetch transport, the session token, and the
// error shape the views branch on.

import {
  type AppSummaryQuery,
  type CategoriesQuery,
  type CategoryRulesQuery,
  type CategorySummaryQuery,
  type ContextRulesQuery,
  type CreateCategoryRuleMutationVariables,
  type CreateContextRuleMutationVariables,
  type DeviceSummaryQuery,
  type DevicesQuery,
  getSdk,
  type RecentActivitiesQuery,
  type Requester,
} from '@/gql/sdk';

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

/**
 * Executes generated document strings against `/graphql` (vite proxies it in
 * dev). The token is read per call rather than captured, so signing in or out
 * takes effect on the next request without rebuilding the SDK.
 */
const requester: Requester = async <R, V>(doc: string, vars?: V): Promise<R> => {
  const token = getToken();
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    // `doc` may be a TypedDocumentString (a String subclass) — normalize.
    body: JSON.stringify({ query: String(doc), variables: vars }),
  });
  if (!response.ok) throw new GraphQLError(`HTTP ${response.status}`);
  const body = (await response.json()) as {
    data?: R;
    errors?: { message: string; extensions?: { code?: string } }[];
  };
  const error = body.errors?.[0];
  if (error) {
    throw new GraphQLError(error.message ?? 'GraphQL error', error.extensions?.code ?? null);
  }
  if (body.data == null) throw new GraphQLError('empty response');
  return body.data;
};

const sdk = getSdk(requester);

// Row shapes, read off the generated operations rather than restated: a server
// field that changes type or disappears now fails `npm run typecheck` here.
export type CategoryDaySummary = CategorySummaryQuery['categorySummary'][number];
export type AppSummaryRow = AppSummaryQuery['appSummary'][number];
/** A recent activity, as the rule forms' live preview sees it. */
export type ActivitySample = RecentActivitiesQuery['activities'][number];
export type Category = CategoriesQuery['categories'][number];
export type CategoryRule = CategoryRulesQuery['categoryRules'][number];
export type ContextRule = ContextRulesQuery['contextRules'][number];
export type Device = DevicesQuery['devices'][number];
export type DeviceSummaryRow = DeviceSummaryQuery['deviceSummary'][number];

/** Everything a category rule is, minus its id — what the rule editor submits. */
export type CategoryRuleInput = CreateCategoryRuleMutationVariables;
export type ContextRuleInput = CreateContextRuleMutationVariables;

/**
 * Emails a single-use sign-in link. Returns the raw token only when the
 * server runs with UNSAFE_LOCAL_NETWORK — then the caller can verify it
 * immediately and skip the inbox round-trip.
 */
export const requestMagicLink = (email: string): Promise<string | null> =>
  sdk.RequestMagicLink({ email }).then((d) => d.requestMagicLink.token ?? null);

export const verifyMagicLink = async (token: string): Promise<void> => {
  const data = await sdk.VerifyMagicLink({ token });
  setToken(data.verifyMagicLink.token);
};

export const signOut = async (): Promise<void> => {
  await sdk.SignOut().catch(() => {});
  clearToken();
};

/** deviceId null = every device the user owns, folded together. */
export const fetchSummary = (
  from: string,
  to: string,
  deviceId: string | null = null,
): Promise<CategoryDaySummary[]> =>
  sdk.CategorySummary({ from, to, deviceId }).then((d) => d.categorySummary);

export const fetchAppSummary = (
  from: string,
  to: string,
  deviceId: string | null = null,
): Promise<AppSummaryRow[]> => sdk.AppSummary({ from, to, deviceId }).then((d) => d.appSummary);

/**
 * Per-device totals for the range, busiest first — what the device filter is
 * chosen from, so it takes no deviceId itself.
 */
export const fetchDeviceSummary = (from: string, to: string): Promise<DeviceSummaryRow[]> =>
  sdk.DeviceSummary({ from, to }).then((d) => d.deviceSummary);

/**
 * The most recent activities, newest first — the corpus the rule builder tests
 * a draft pattern against, so "no matches" shows up before saving rather than
 * after wondering why nothing got categorized.
 */
export const fetchRecentActivities = (limit = 500): Promise<ActivitySample[]> =>
  sdk.RecentActivities({ limit }).then((d) => d.activities);

export const fetchCategories = (): Promise<Category[]> =>
  sdk.Categories().then((d) => d.categories);

export const fetchCategoryRules = (): Promise<CategoryRule[]> =>
  sdk.CategoryRules().then((d) => d.categoryRules);

export const fetchContextRules = (): Promise<ContextRule[]> =>
  sdk.ContextRules().then((d) => d.contextRules);

export const fetchDevices = (): Promise<Device[]> => sdk.Devices().then((d) => d.devices);

export const createCategory = (name: string, color: string | null): Promise<unknown> =>
  sdk.CreateCategory({ name, color });

export const deleteCategory = (id: string): Promise<unknown> => sdk.DeleteCategory({ id });

export const createCategoryRule = (rule: CategoryRuleInput): Promise<unknown> =>
  sdk.CreateCategoryRule(rule);

/** A whole-rule replacement: a null pattern clears that condition. */
export const updateCategoryRule = (id: string, rule: CategoryRuleInput): Promise<unknown> =>
  sdk.UpdateCategoryRule({ id, ...rule });

export const deleteCategoryRule = (id: string): Promise<unknown> => sdk.DeleteCategoryRule({ id });

export const createContextRule = (rule: ContextRuleInput): Promise<unknown> =>
  sdk.CreateContextRule(rule);

export const updateContextRule = (id: string, rule: ContextRuleInput): Promise<unknown> =>
  sdk.UpdateContextRule({ id, ...rule });

export const deleteContextRule = (id: string): Promise<unknown> => sdk.DeleteContextRule({ id });

/** Re-runs category rules over past activities; resolves to the number changed. */
export const applyCategoryRules = (): Promise<number> =>
  sdk.ApplyCategoryRules().then((d) => d.applyCategoryRules);

export const renameDevice = (id: string, name: string): Promise<unknown> =>
  sdk.RenameDevice({ id, name });

/** Moves `id`'s history onto `intoId` and retires `id`. */
export const mergeDevice = (id: string, intoId: string): Promise<unknown> =>
  sdk.MergeDevice({ id, intoId });

export const deleteDevice = (id: string): Promise<unknown> => sdk.DeleteDevice({ id });
