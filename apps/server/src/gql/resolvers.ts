import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import type { Activity } from '../activity/fold.ts';
import type { CategoryRule } from '../activity/rules.ts';
import type { ContextRule } from '../activity/context.ts';
import type { MergeRule } from '../activity/merge-rules.ts';
import type { Category, Device, Summary } from '../db/schema.ts';
import type { Context } from '../graphql/context.ts';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** A date-time string at UTC, such as 2007-12-03T10:15:30Z, compliant with the `date-time` format outlined in section 5.6 of the RFC 3339 profile of the ISO 8601 standard for representation of dates and times using the Gregorian calendar. */
  DateTime: { input: Date; output: Date; }
};

export type Activities = {
  __typename?: 'Activities';
  activeSeconds: Scalars['Float']['output'];
  app: Scalars['String']['output'];
  category?: Maybe<Categories>;
  categoryId?: Maybe<Scalars['String']['output']>;
  categorySource?: Maybe<ActivitiesCategorySourceEnum>;
  closedAt?: Maybe<Scalars['DateTime']['output']>;
  context?: Maybe<Scalars['String']['output']>;
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  device?: Maybe<Devices>;
  deviceId: Scalars['String']['output'];
  id: Scalars['String']['output'];
  lastActiveAt: Scalars['DateTime']['output'];
  rolledUp: Scalars['Boolean']['output'];
  startedAt: Scalars['DateTime']['output'];
  title?: Maybe<Scalars['String']['output']>;
};


export type ActivitiesCategoryArgs = {
  where?: InputMaybe<CategoriesFilters>;
};


export type ActivitiesDeviceArgs = {
  where?: InputMaybe<DevicesFilters>;
};

export enum ActivitiesCategorySourceEnum {
  /** Value: manual */
  Manual = 'manual',
  /** Value: rule */
  Rule = 'rule'
}

export type ActivitiesCategorySourceEnumFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<ActivitiesCategorySourceEnumFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<ActivitiesCategorySourceEnumFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<ActivitiesCategorySourceEnumFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<ActivitiesCategorySourceEnum>;
  /** Greater than */
  gt?: InputMaybe<ActivitiesCategorySourceEnum>;
  /** Greater than or equal to */
  gte?: InputMaybe<ActivitiesCategorySourceEnum>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<ActivitiesCategorySourceEnum>>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<ActivitiesCategorySourceEnum>;
  /** Less than or equal to */
  lte?: InputMaybe<ActivitiesCategorySourceEnum>;
  /** Not equal to */
  ne?: InputMaybe<ActivitiesCategorySourceEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<ActivitiesCategorySourceEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type ActivitiesFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<ActivitiesFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<ActivitiesFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<ActivitiesFilters>>;
  activeSeconds?: InputMaybe<FloatFilter>;
  app?: InputMaybe<StringFilter>;
  /** Matches rows whose category matches these filters */
  category?: InputMaybe<CategoriesFilters>;
  categoryId?: InputMaybe<StringFilter>;
  categorySource?: InputMaybe<ActivitiesCategorySourceEnumFilter>;
  closedAt?: InputMaybe<DateTimeFilter>;
  context?: InputMaybe<StringFilter>;
  /** Matches rows whose device matches these filters */
  device?: InputMaybe<DevicesFilters>;
  deviceId?: InputMaybe<StringFilter>;
  id?: InputMaybe<StringFilter>;
  lastActiveAt?: InputMaybe<DateTimeFilter>;
  rolledUp?: InputMaybe<BooleanFilter>;
  startedAt?: InputMaybe<DateTimeFilter>;
  title?: InputMaybe<StringFilter>;
};

export type ActivitiesListRelationFilter = {
  /** Every related row matches */
  every?: InputMaybe<ActivitiesFilters>;
  /** No related row matches */
  none?: InputMaybe<ActivitiesFilters>;
  /** At least one related row matches */
  some?: InputMaybe<ActivitiesFilters>;
};

export type ActivitiesOrderBy = {
  activeSeconds?: InputMaybe<InnerOrder>;
  app?: InputMaybe<InnerOrder>;
  /** Order by columns of the related category row */
  category?: InputMaybe<CategoriesOrderBy>;
  categoryId?: InputMaybe<InnerOrder>;
  categorySource?: InputMaybe<InnerOrder>;
  closedAt?: InputMaybe<InnerOrder>;
  context?: InputMaybe<InnerOrder>;
  /** Order by columns of the related device row */
  device?: InputMaybe<DevicesOrderBy>;
  deviceId?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  lastActiveAt?: InputMaybe<InnerOrder>;
  rolledUp?: InputMaybe<InnerOrder>;
  startedAt?: InputMaybe<InnerOrder>;
  title?: InputMaybe<InnerOrder>;
};

export type AppContextSummary = {
  __typename?: 'AppContextSummary';
  app: Scalars['String']['output'];
  context?: Maybe<Scalars['String']['output']>;
  seconds: Scalars['Float']['output'];
};

export type AuthSession = {
  __typename?: 'AuthSession';
  token: Scalars['String']['output'];
  userId: Scalars['String']['output'];
};

export type BooleanFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<BooleanFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<BooleanFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<BooleanFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<Scalars['Boolean']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['Boolean']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['Boolean']['input']>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['Boolean']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['Boolean']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['Boolean']['input']>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type Categories = {
  __typename?: 'Categories';
  activities: Array<Activities>;
  color?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  rules: Array<CategoryRules>;
  userId: Scalars['String']['output'];
};


export type CategoriesActivitiesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<ActivitiesOrderBy>;
  where?: InputMaybe<ActivitiesFilters>;
};


export type CategoriesRulesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<CategoryRulesOrderBy>;
  where?: InputMaybe<CategoryRulesFilters>;
};

export type CategoriesFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<CategoriesFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<CategoriesFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<CategoriesFilters>>;
  activities?: InputMaybe<ActivitiesListRelationFilter>;
  color?: InputMaybe<StringFilter>;
  createdAt?: InputMaybe<DateTimeFilter>;
  id?: InputMaybe<StringFilter>;
  name?: InputMaybe<StringFilter>;
  rules?: InputMaybe<CategoryRulesListRelationFilter>;
  userId?: InputMaybe<StringFilter>;
};

export type CategoriesOrderBy = {
  color?: InputMaybe<InnerOrder>;
  createdAt?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  name?: InputMaybe<InnerOrder>;
  userId?: InputMaybe<InnerOrder>;
};

export type CategoryDaySummary = {
  __typename?: 'CategoryDaySummary';
  categoryId?: Maybe<Scalars['String']['output']>;
  color?: Maybe<Scalars['String']['output']>;
  day: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  seconds: Scalars['Float']['output'];
};

export type CategoryRules = {
  __typename?: 'CategoryRules';
  appPattern?: Maybe<Scalars['String']['output']>;
  category?: Maybe<Categories>;
  categoryId: Scalars['String']['output'];
  contextPattern?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  priority: Scalars['Int']['output'];
  titlePattern?: Maybe<Scalars['String']['output']>;
  userId: Scalars['String']['output'];
};


export type CategoryRulesCategoryArgs = {
  where?: InputMaybe<CategoriesFilters>;
};

export type CategoryRulesFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<CategoryRulesFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<CategoryRulesFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<CategoryRulesFilters>>;
  appPattern?: InputMaybe<StringFilter>;
  /** Matches rows whose category matches these filters */
  category?: InputMaybe<CategoriesFilters>;
  categoryId?: InputMaybe<StringFilter>;
  contextPattern?: InputMaybe<StringFilter>;
  createdAt?: InputMaybe<DateTimeFilter>;
  id?: InputMaybe<StringFilter>;
  priority?: InputMaybe<IntFilter>;
  titlePattern?: InputMaybe<StringFilter>;
  userId?: InputMaybe<StringFilter>;
};

export type CategoryRulesListRelationFilter = {
  /** Every related row matches */
  every?: InputMaybe<CategoryRulesFilters>;
  /** No related row matches */
  none?: InputMaybe<CategoryRulesFilters>;
  /** At least one related row matches */
  some?: InputMaybe<CategoryRulesFilters>;
};

export type CategoryRulesOrderBy = {
  appPattern?: InputMaybe<InnerOrder>;
  /** Order by columns of the related category row */
  category?: InputMaybe<CategoriesOrderBy>;
  categoryId?: InputMaybe<InnerOrder>;
  contextPattern?: InputMaybe<InnerOrder>;
  createdAt?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  priority?: InputMaybe<InnerOrder>;
  titlePattern?: InputMaybe<InnerOrder>;
  userId?: InputMaybe<InnerOrder>;
};

export type ContextRules = {
  __typename?: 'ContextRules';
  appPattern?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  priority: Scalars['Int']['output'];
  titlePattern: Scalars['String']['output'];
  userId: Scalars['String']['output'];
};

export type ContextRulesFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<ContextRulesFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<ContextRulesFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<ContextRulesFilters>>;
  appPattern?: InputMaybe<StringFilter>;
  createdAt?: InputMaybe<DateTimeFilter>;
  id?: InputMaybe<StringFilter>;
  priority?: InputMaybe<IntFilter>;
  titlePattern?: InputMaybe<StringFilter>;
  userId?: InputMaybe<StringFilter>;
};

export type ContextRulesOrderBy = {
  appPattern?: InputMaybe<InnerOrder>;
  createdAt?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  priority?: InputMaybe<InnerOrder>;
  titlePattern?: InputMaybe<InnerOrder>;
  userId?: InputMaybe<InnerOrder>;
};

export type DateTimeFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<DateTimeFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<DateTimeFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<DateTimeFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<Scalars['DateTime']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['DateTime']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['DateTime']['input']>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<Scalars['DateTime']['input']>>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['DateTime']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['DateTime']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['DateTime']['input']>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<Scalars['DateTime']['input']>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type DeviceRegistration = {
  __typename?: 'DeviceRegistration';
  apiKey: Scalars['String']['output'];
  device: Devices;
};

export type DeviceSummary = {
  __typename?: 'DeviceSummary';
  deviceId: Scalars['String']['output'];
  name: Scalars['String']['output'];
  platform: Scalars['String']['output'];
  seconds: Scalars['Float']['output'];
};

export type Devices = {
  __typename?: 'Devices';
  activities: Array<Activities>;
  createdAt: Scalars['DateTime']['output'];
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  lastSeenAt?: Maybe<Scalars['DateTime']['output']>;
  name: Scalars['String']['output'];
  platform: DevicesPlatformEnum;
  summaries: Array<Summaries>;
  userId: Scalars['String']['output'];
};


export type DevicesActivitiesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<ActivitiesOrderBy>;
  where?: InputMaybe<ActivitiesFilters>;
};


export type DevicesSummariesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<SummariesOrderBy>;
  where?: InputMaybe<SummariesFilters>;
};

export type DevicesFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<DevicesFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<DevicesFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<DevicesFilters>>;
  activities?: InputMaybe<ActivitiesListRelationFilter>;
  createdAt?: InputMaybe<DateTimeFilter>;
  id?: InputMaybe<StringFilter>;
  lastSeenAt?: InputMaybe<DateTimeFilter>;
  name?: InputMaybe<StringFilter>;
  platform?: InputMaybe<DevicesPlatformEnumFilter>;
  summaries?: InputMaybe<SummariesListRelationFilter>;
  userId?: InputMaybe<StringFilter>;
};

export type DevicesOrderBy = {
  createdAt?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  lastSeenAt?: InputMaybe<InnerOrder>;
  name?: InputMaybe<InnerOrder>;
  platform?: InputMaybe<InnerOrder>;
  userId?: InputMaybe<InnerOrder>;
};

export enum DevicesPlatformEnum {
  /** Value: android */
  Android = 'android',
  /** Value: linux */
  Linux = 'linux',
  /** Value: macos */
  Macos = 'macos',
  /** Value: windows */
  Windows = 'windows'
}

export type DevicesPlatformEnumFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<DevicesPlatformEnumFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<DevicesPlatformEnumFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<DevicesPlatformEnumFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<DevicesPlatformEnum>;
  /** Greater than */
  gt?: InputMaybe<DevicesPlatformEnum>;
  /** Greater than or equal to */
  gte?: InputMaybe<DevicesPlatformEnum>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<DevicesPlatformEnum>>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<DevicesPlatformEnum>;
  /** Less than or equal to */
  lte?: InputMaybe<DevicesPlatformEnum>;
  /** Not equal to */
  ne?: InputMaybe<DevicesPlatformEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<DevicesPlatformEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type FloatFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<FloatFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<FloatFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<FloatFilter>>;
  /** Equal to */
  eq?: InputMaybe<Scalars['Float']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['Float']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['Float']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<Scalars['Float']['input']>>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['Float']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['Float']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['Float']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<Scalars['Float']['input']>>;
};

export type InnerOrder = {
  direction: OrderDirection;
  /** Sort by this column's position in the `inArray` list the same request's `where` gives it, rather than by the column's own value — `direction: asc` keeps the list's order, `desc` reverses it. Requires an `inArray` filter on the same column at the top level of `where`, and cannot be combined with `after` or `distinct`. */
  matchFilterOrder?: InputMaybe<Scalars['Boolean']['input']>;
  /** Where NULL values sort. Defaults to the database's own rule (PostgreSQL: last on asc, first on desc; MySQL/SQLite: first on asc, last on desc) */
  nulls?: InputMaybe<OrderNulls>;
  /** Priority of current field */
  priority: Scalars['Int']['input'];
};

export type IntFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<IntFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<IntFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<IntFilter>>;
  /** Equal to */
  eq?: InputMaybe<Scalars['Int']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['Int']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['Int']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<Scalars['Int']['input']>>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['Int']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['Int']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['Int']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<Scalars['Int']['input']>>;
};

export type MagicLinkRequest = {
  __typename?: 'MagicLinkRequest';
  ok: Scalars['Boolean']['output'];
  token?: Maybe<Scalars['String']['output']>;
};

export type MergeRules = {
  __typename?: 'MergeRules';
  createdAt: Scalars['DateTime']['output'];
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  fromApp: Scalars['String']['output'];
  fromContext?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  toApp: Scalars['String']['output'];
  toContext?: Maybe<Scalars['String']['output']>;
  userId: Scalars['String']['output'];
};

export type MergeRulesFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<MergeRulesFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<MergeRulesFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<MergeRulesFilters>>;
  createdAt?: InputMaybe<DateTimeFilter>;
  fromApp?: InputMaybe<StringFilter>;
  fromContext?: InputMaybe<StringFilter>;
  id?: InputMaybe<StringFilter>;
  toApp?: InputMaybe<StringFilter>;
  toContext?: InputMaybe<StringFilter>;
  userId?: InputMaybe<StringFilter>;
};

export type MergeRulesOrderBy = {
  createdAt?: InputMaybe<InnerOrder>;
  fromApp?: InputMaybe<InnerOrder>;
  fromContext?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  toApp?: InputMaybe<InnerOrder>;
  toContext?: InputMaybe<InnerOrder>;
  userId?: InputMaybe<InnerOrder>;
};

export type Mutation = {
  __typename?: 'Mutation';
  applyCategoryRules: Scalars['Int']['output'];
  applyMergeRules: Scalars['Int']['output'];
  assignActivity: Activities;
  createCategory: Categories;
  createCategoryRule: CategoryRules;
  createContextRule: ContextRules;
  createMergeRule: MergeRules;
  deleteCategory: Scalars['Boolean']['output'];
  deleteCategoryRule: Scalars['Boolean']['output'];
  deleteContextRule: Scalars['Boolean']['output'];
  deleteDevice: Scalars['Boolean']['output'];
  deleteMergeRule: Scalars['Boolean']['output'];
  mergeDevice: Devices;
  recordPing?: Maybe<Activities>;
  recordPings: Scalars['Int']['output'];
  registerDevice: DeviceRegistration;
  renameDevice: Devices;
  requestMagicLink: MagicLinkRequest;
  rotateDeviceKey: DeviceRegistration;
  sessionFromDeviceKey: AuthSession;
  signIn: AuthSession;
  signOut: Scalars['Boolean']['output'];
  signUp: AuthSession;
  updateCategoryRule: CategoryRules;
  updateContextRule: ContextRules;
  verifyMagicLink: AuthSession;
};


export type MutationAssignActivityArgs = {
  activityId: Scalars['String']['input'];
  categoryId?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateCategoryArgs = {
  color?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
};


export type MutationCreateCategoryRuleArgs = {
  appPattern?: InputMaybe<Scalars['String']['input']>;
  categoryId: Scalars['String']['input'];
  contextPattern?: InputMaybe<Scalars['String']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  titlePattern?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateContextRuleArgs = {
  appPattern?: InputMaybe<Scalars['String']['input']>;
  priority?: InputMaybe<Scalars['Int']['input']>;
  titlePattern: Scalars['String']['input'];
};


export type MutationCreateMergeRuleArgs = {
  fromApp: Scalars['String']['input'];
  fromContext?: InputMaybe<Scalars['String']['input']>;
  toApp: Scalars['String']['input'];
  toContext?: InputMaybe<Scalars['String']['input']>;
};


export type MutationDeleteCategoryArgs = {
  id: Scalars['String']['input'];
};


export type MutationDeleteCategoryRuleArgs = {
  id: Scalars['String']['input'];
};


export type MutationDeleteContextRuleArgs = {
  id: Scalars['String']['input'];
};


export type MutationDeleteDeviceArgs = {
  id: Scalars['String']['input'];
};


export type MutationDeleteMergeRuleArgs = {
  id: Scalars['String']['input'];
};


export type MutationMergeDeviceArgs = {
  id: Scalars['String']['input'];
  intoId: Scalars['String']['input'];
};


export type MutationRecordPingArgs = {
  app?: InputMaybe<Scalars['String']['input']>;
  capturedAt: Scalars['String']['input'];
  context?: InputMaybe<Scalars['String']['input']>;
  deviceId?: InputMaybe<Scalars['String']['input']>;
  idleSeconds: Scalars['Int']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
};


export type MutationRecordPingsArgs = {
  deviceId?: InputMaybe<Scalars['String']['input']>;
  pings: Array<PingInput>;
};


export type MutationRegisterDeviceArgs = {
  name: Scalars['String']['input'];
  platform: Scalars['String']['input'];
};


export type MutationRenameDeviceArgs = {
  id: Scalars['String']['input'];
  name: Scalars['String']['input'];
};


export type MutationRequestMagicLinkArgs = {
  email: Scalars['String']['input'];
};


export type MutationRotateDeviceKeyArgs = {
  id: Scalars['String']['input'];
};


export type MutationSignInArgs = {
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
};


export type MutationSignUpArgs = {
  email: Scalars['String']['input'];
  name: Scalars['String']['input'];
  password: Scalars['String']['input'];
};


export type MutationUpdateCategoryRuleArgs = {
  appPattern?: InputMaybe<Scalars['String']['input']>;
  categoryId: Scalars['String']['input'];
  contextPattern?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['String']['input'];
  priority?: InputMaybe<Scalars['Int']['input']>;
  titlePattern?: InputMaybe<Scalars['String']['input']>;
};


export type MutationUpdateContextRuleArgs = {
  appPattern?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['String']['input'];
  priority?: InputMaybe<Scalars['Int']['input']>;
  titlePattern: Scalars['String']['input'];
};


export type MutationVerifyMagicLinkArgs = {
  token: Scalars['String']['input'];
};

/** Order by direction */
export enum OrderDirection {
  /** Ascending order */
  Asc = 'asc',
  /** Descending order */
  Desc = 'desc'
}

/** Where NULL values sort relative to non-NULL values */
export enum OrderNulls {
  /** NULL values sort before all non-NULL values */
  First = 'first',
  /** NULL values sort after all non-NULL values */
  Last = 'last'
}

/** A stateless report of what a device looked like at one instant. */
export type PingInput = {
  app?: InputMaybe<Scalars['String']['input']>;
  capturedAt: Scalars['String']['input'];
  context?: InputMaybe<Scalars['String']['input']>;
  idleSeconds: Scalars['Int']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
};

export type Query = {
  __typename?: 'Query';
  activities: Array<Activities>;
  appSummary: Array<AppContextSummary>;
  categories: Array<Categories>;
  categoryRules: Array<CategoryRules>;
  categorySummary: Array<CategoryDaySummary>;
  contextRules: Array<ContextRules>;
  deviceSummary: Array<DeviceSummary>;
  devices: Array<Devices>;
  me?: Maybe<Scalars['String']['output']>;
  mergeRules: Array<MergeRules>;
};


export type QueryActivitiesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<ActivitiesOrderBy>;
  where?: InputMaybe<ActivitiesFilters>;
};


export type QueryAppSummaryArgs = {
  deviceId?: InputMaybe<Scalars['String']['input']>;
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
};


export type QueryCategoriesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<CategoriesOrderBy>;
  where?: InputMaybe<CategoriesFilters>;
};


export type QueryCategoryRulesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<CategoryRulesOrderBy>;
  where?: InputMaybe<CategoryRulesFilters>;
};


export type QueryCategorySummaryArgs = {
  deviceId?: InputMaybe<Scalars['String']['input']>;
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
};


export type QueryContextRulesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<ContextRulesOrderBy>;
  where?: InputMaybe<ContextRulesFilters>;
};


export type QueryDeviceSummaryArgs = {
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
};


export type QueryDevicesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<DevicesOrderBy>;
  where?: InputMaybe<DevicesFilters>;
};


export type QueryMergeRulesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<MergeRulesOrderBy>;
  where?: InputMaybe<MergeRulesFilters>;
};

export type StringFilter = {
  /** Every branch matches */
  AND?: InputMaybe<Array<StringFilter>>;
  /** Negates the nested operators */
  NOT?: InputMaybe<StringFilter>;
  /** At least one branch matches; ANDed with any sibling operators */
  OR?: InputMaybe<Array<StringFilter>>;
  /** Matches values containing the given string. `%`, `_` and `\` are matched literally. */
  contains?: InputMaybe<Scalars['String']['input']>;
  /** Matches values ending with the given string. `%`, `_` and `\` are matched literally. */
  endsWith?: InputMaybe<Scalars['String']['input']>;
  /** Equal to */
  eq?: InputMaybe<Scalars['String']['input']>;
  /** Greater than */
  gt?: InputMaybe<Scalars['String']['input']>;
  /** Greater than or equal to */
  gte?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `contains`. */
  iContains?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `endsWith`. */
  iEndsWith?: InputMaybe<Scalars['String']['input']>;
  /** Case-insensitive `startsWith`. */
  iStartsWith?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Matches any one of these values (SQL `IN`) */
  inArray?: InputMaybe<Array<Scalars['String']['input']>>;
  /** When true, matches rows where the column is not NULL */
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  /** When true, matches rows where the column is NULL */
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** Less than */
  lt?: InputMaybe<Scalars['String']['input']>;
  /** Less than or equal to */
  lte?: InputMaybe<Scalars['String']['input']>;
  /** Not equal to */
  ne?: InputMaybe<Scalars['String']['input']>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Matches none of these values (SQL `NOT IN`) */
  notInArray?: InputMaybe<Array<Scalars['String']['input']>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
  /** Matches values starting with the given string. `%`, `_` and `\` are matched literally. */
  startsWith?: InputMaybe<Scalars['String']['input']>;
};

export type Summaries = {
  __typename?: 'Summaries';
  app: Scalars['String']['output'];
  categoryId?: Maybe<Scalars['String']['output']>;
  context?: Maybe<Scalars['String']['output']>;
  /** Opaque cursor of this row's position in the query's ordering. Pass it as `after` to resume from here. Only set on rows returned by a list query. */
  cursor?: Maybe<Scalars['String']['output']>;
  day: Scalars['String']['output'];
  device?: Maybe<Devices>;
  deviceId: Scalars['String']['output'];
  id: Scalars['String']['output'];
  seconds: Scalars['Float']['output'];
};


export type SummariesDeviceArgs = {
  where?: InputMaybe<DevicesFilters>;
};

export type SummariesFilters = {
  /** Every branch matches */
  AND?: InputMaybe<Array<SummariesFilters>>;
  /** Negates the nested filters */
  NOT?: InputMaybe<SummariesFilters>;
  /** At least one branch matches; ANDed with any sibling fields */
  OR?: InputMaybe<Array<SummariesFilters>>;
  app?: InputMaybe<StringFilter>;
  categoryId?: InputMaybe<StringFilter>;
  context?: InputMaybe<StringFilter>;
  day?: InputMaybe<StringFilter>;
  /** Matches rows whose device matches these filters */
  device?: InputMaybe<DevicesFilters>;
  deviceId?: InputMaybe<StringFilter>;
  id?: InputMaybe<StringFilter>;
  seconds?: InputMaybe<FloatFilter>;
};

export type SummariesListRelationFilter = {
  /** Every related row matches */
  every?: InputMaybe<SummariesFilters>;
  /** No related row matches */
  none?: InputMaybe<SummariesFilters>;
  /** At least one related row matches */
  some?: InputMaybe<SummariesFilters>;
};

export type SummariesOrderBy = {
  app?: InputMaybe<InnerOrder>;
  categoryId?: InputMaybe<InnerOrder>;
  context?: InputMaybe<InnerOrder>;
  day?: InputMaybe<InnerOrder>;
  /** Order by columns of the related device row */
  device?: InputMaybe<DevicesOrderBy>;
  deviceId?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  seconds?: InputMaybe<InnerOrder>;
};



export type ResolverTypeWrapper<T> = Promise<T> | T;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;





/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  Activities: ResolverTypeWrapper<Activity>;
  ActivitiesCategorySourceEnum: ActivitiesCategorySourceEnum;
  ActivitiesCategorySourceEnumFilter: ActivitiesCategorySourceEnumFilter;
  ActivitiesFilters: ActivitiesFilters;
  ActivitiesListRelationFilter: ActivitiesListRelationFilter;
  ActivitiesOrderBy: ActivitiesOrderBy;
  AppContextSummary: ResolverTypeWrapper<AppContextSummary>;
  AuthSession: ResolverTypeWrapper<AuthSession>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  BooleanFilter: BooleanFilter;
  Categories: ResolverTypeWrapper<Category>;
  CategoriesFilters: CategoriesFilters;
  CategoriesOrderBy: CategoriesOrderBy;
  CategoryDaySummary: ResolverTypeWrapper<CategoryDaySummary>;
  CategoryRules: ResolverTypeWrapper<CategoryRule>;
  CategoryRulesFilters: CategoryRulesFilters;
  CategoryRulesListRelationFilter: CategoryRulesListRelationFilter;
  CategoryRulesOrderBy: CategoryRulesOrderBy;
  ContextRules: ResolverTypeWrapper<ContextRule>;
  ContextRulesFilters: ContextRulesFilters;
  ContextRulesOrderBy: ContextRulesOrderBy;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  DateTimeFilter: DateTimeFilter;
  DeviceRegistration: ResolverTypeWrapper<Omit<DeviceRegistration, 'device'> & { device: ResolversTypes['Devices'] }>;
  DeviceSummary: ResolverTypeWrapper<DeviceSummary>;
  Devices: ResolverTypeWrapper<Device>;
  DevicesFilters: DevicesFilters;
  DevicesOrderBy: DevicesOrderBy;
  DevicesPlatformEnum: DevicesPlatformEnum;
  DevicesPlatformEnumFilter: DevicesPlatformEnumFilter;
  Float: ResolverTypeWrapper<Scalars['Float']['output']>;
  FloatFilter: FloatFilter;
  InnerOrder: InnerOrder;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  IntFilter: IntFilter;
  MagicLinkRequest: ResolverTypeWrapper<MagicLinkRequest>;
  MergeRules: ResolverTypeWrapper<MergeRule>;
  MergeRulesFilters: MergeRulesFilters;
  MergeRulesOrderBy: MergeRulesOrderBy;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  OrderDirection: OrderDirection;
  OrderNulls: OrderNulls;
  PingInput: PingInput;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  StringFilter: StringFilter;
  Summaries: ResolverTypeWrapper<Summary>;
  SummariesFilters: SummariesFilters;
  SummariesListRelationFilter: SummariesListRelationFilter;
  SummariesOrderBy: SummariesOrderBy;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  Activities: Activity;
  ActivitiesCategorySourceEnumFilter: ActivitiesCategorySourceEnumFilter;
  ActivitiesFilters: ActivitiesFilters;
  ActivitiesListRelationFilter: ActivitiesListRelationFilter;
  ActivitiesOrderBy: ActivitiesOrderBy;
  AppContextSummary: AppContextSummary;
  AuthSession: AuthSession;
  Boolean: Scalars['Boolean']['output'];
  BooleanFilter: BooleanFilter;
  Categories: Category;
  CategoriesFilters: CategoriesFilters;
  CategoriesOrderBy: CategoriesOrderBy;
  CategoryDaySummary: CategoryDaySummary;
  CategoryRules: CategoryRule;
  CategoryRulesFilters: CategoryRulesFilters;
  CategoryRulesListRelationFilter: CategoryRulesListRelationFilter;
  CategoryRulesOrderBy: CategoryRulesOrderBy;
  ContextRules: ContextRule;
  ContextRulesFilters: ContextRulesFilters;
  ContextRulesOrderBy: ContextRulesOrderBy;
  DateTime: Scalars['DateTime']['output'];
  DateTimeFilter: DateTimeFilter;
  DeviceRegistration: Omit<DeviceRegistration, 'device'> & { device: ResolversParentTypes['Devices'] };
  DeviceSummary: DeviceSummary;
  Devices: Device;
  DevicesFilters: DevicesFilters;
  DevicesOrderBy: DevicesOrderBy;
  DevicesPlatformEnumFilter: DevicesPlatformEnumFilter;
  Float: Scalars['Float']['output'];
  FloatFilter: FloatFilter;
  InnerOrder: InnerOrder;
  Int: Scalars['Int']['output'];
  IntFilter: IntFilter;
  MagicLinkRequest: MagicLinkRequest;
  MergeRules: MergeRule;
  MergeRulesFilters: MergeRulesFilters;
  MergeRulesOrderBy: MergeRulesOrderBy;
  Mutation: Record<PropertyKey, never>;
  PingInput: PingInput;
  Query: Record<PropertyKey, never>;
  String: Scalars['String']['output'];
  StringFilter: StringFilter;
  Summaries: Summary;
  SummariesFilters: SummariesFilters;
  SummariesListRelationFilter: SummariesListRelationFilter;
  SummariesOrderBy: SummariesOrderBy;
};

export type ActivitiesResolvers<ContextType = Context, ParentType extends ResolversParentTypes['Activities'] = ResolversParentTypes['Activities']> = {
  activeSeconds?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  app?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  category?: Resolver<Maybe<ResolversTypes['Categories']>, ParentType, ContextType, Partial<ActivitiesCategoryArgs>>;
  categoryId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  categorySource?: Resolver<Maybe<ResolversTypes['ActivitiesCategorySourceEnum']>, ParentType, ContextType>;
  closedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  context?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  cursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  device?: Resolver<Maybe<ResolversTypes['Devices']>, ParentType, ContextType, Partial<ActivitiesDeviceArgs>>;
  deviceId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  lastActiveAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  rolledUp?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  startedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  title?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type AppContextSummaryResolvers<ContextType = Context, ParentType extends ResolversParentTypes['AppContextSummary'] = ResolversParentTypes['AppContextSummary']> = {
  app?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  context?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  seconds?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
};

export type AuthSessionResolvers<ContextType = Context, ParentType extends ResolversParentTypes['AuthSession'] = ResolversParentTypes['AuthSession']> = {
  token?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  userId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type CategoriesResolvers<ContextType = Context, ParentType extends ResolversParentTypes['Categories'] = ResolversParentTypes['Categories']> = {
  activities?: Resolver<Array<ResolversTypes['Activities']>, ParentType, ContextType, Partial<CategoriesActivitiesArgs>>;
  color?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  cursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  rules?: Resolver<Array<ResolversTypes['CategoryRules']>, ParentType, ContextType, Partial<CategoriesRulesArgs>>;
  userId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type CategoryDaySummaryResolvers<ContextType = Context, ParentType extends ResolversParentTypes['CategoryDaySummary'] = ResolversParentTypes['CategoryDaySummary']> = {
  categoryId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  color?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  day?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  seconds?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
};

export type CategoryRulesResolvers<ContextType = Context, ParentType extends ResolversParentTypes['CategoryRules'] = ResolversParentTypes['CategoryRules']> = {
  appPattern?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  category?: Resolver<Maybe<ResolversTypes['Categories']>, ParentType, ContextType, Partial<CategoryRulesCategoryArgs>>;
  categoryId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  contextPattern?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  cursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  priority?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  titlePattern?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  userId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type ContextRulesResolvers<ContextType = Context, ParentType extends ResolversParentTypes['ContextRules'] = ResolversParentTypes['ContextRules']> = {
  appPattern?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  cursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  priority?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  titlePattern?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  userId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type DeviceRegistrationResolvers<ContextType = Context, ParentType extends ResolversParentTypes['DeviceRegistration'] = ResolversParentTypes['DeviceRegistration']> = {
  apiKey?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  device?: Resolver<ResolversTypes['Devices'], ParentType, ContextType>;
};

export type DeviceSummaryResolvers<ContextType = Context, ParentType extends ResolversParentTypes['DeviceSummary'] = ResolversParentTypes['DeviceSummary']> = {
  deviceId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  platform?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  seconds?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
};

export type DevicesResolvers<ContextType = Context, ParentType extends ResolversParentTypes['Devices'] = ResolversParentTypes['Devices']> = {
  activities?: Resolver<Array<ResolversTypes['Activities']>, ParentType, ContextType, Partial<DevicesActivitiesArgs>>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  cursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  lastSeenAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  platform?: Resolver<ResolversTypes['DevicesPlatformEnum'], ParentType, ContextType>;
  summaries?: Resolver<Array<ResolversTypes['Summaries']>, ParentType, ContextType, Partial<DevicesSummariesArgs>>;
  userId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type MagicLinkRequestResolvers<ContextType = Context, ParentType extends ResolversParentTypes['MagicLinkRequest'] = ResolversParentTypes['MagicLinkRequest']> = {
  ok?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  token?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type MergeRulesResolvers<ContextType = Context, ParentType extends ResolversParentTypes['MergeRules'] = ResolversParentTypes['MergeRules']> = {
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  cursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  fromApp?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  fromContext?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  toApp?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  toContext?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  userId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type MutationResolvers<ContextType = Context, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  applyCategoryRules?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  applyMergeRules?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  assignActivity?: Resolver<ResolversTypes['Activities'], ParentType, ContextType, RequireFields<MutationAssignActivityArgs, 'activityId'>>;
  createCategory?: Resolver<ResolversTypes['Categories'], ParentType, ContextType, RequireFields<MutationCreateCategoryArgs, 'name'>>;
  createCategoryRule?: Resolver<ResolversTypes['CategoryRules'], ParentType, ContextType, RequireFields<MutationCreateCategoryRuleArgs, 'categoryId'>>;
  createContextRule?: Resolver<ResolversTypes['ContextRules'], ParentType, ContextType, RequireFields<MutationCreateContextRuleArgs, 'titlePattern'>>;
  createMergeRule?: Resolver<ResolversTypes['MergeRules'], ParentType, ContextType, RequireFields<MutationCreateMergeRuleArgs, 'fromApp' | 'toApp'>>;
  deleteCategory?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteCategoryArgs, 'id'>>;
  deleteCategoryRule?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteCategoryRuleArgs, 'id'>>;
  deleteContextRule?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteContextRuleArgs, 'id'>>;
  deleteDevice?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteDeviceArgs, 'id'>>;
  deleteMergeRule?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteMergeRuleArgs, 'id'>>;
  mergeDevice?: Resolver<ResolversTypes['Devices'], ParentType, ContextType, RequireFields<MutationMergeDeviceArgs, 'id' | 'intoId'>>;
  recordPing?: Resolver<Maybe<ResolversTypes['Activities']>, ParentType, ContextType, RequireFields<MutationRecordPingArgs, 'capturedAt' | 'idleSeconds'>>;
  recordPings?: Resolver<ResolversTypes['Int'], ParentType, ContextType, RequireFields<MutationRecordPingsArgs, 'pings'>>;
  registerDevice?: Resolver<ResolversTypes['DeviceRegistration'], ParentType, ContextType, RequireFields<MutationRegisterDeviceArgs, 'name' | 'platform'>>;
  renameDevice?: Resolver<ResolversTypes['Devices'], ParentType, ContextType, RequireFields<MutationRenameDeviceArgs, 'id' | 'name'>>;
  requestMagicLink?: Resolver<ResolversTypes['MagicLinkRequest'], ParentType, ContextType, RequireFields<MutationRequestMagicLinkArgs, 'email'>>;
  rotateDeviceKey?: Resolver<ResolversTypes['DeviceRegistration'], ParentType, ContextType, RequireFields<MutationRotateDeviceKeyArgs, 'id'>>;
  sessionFromDeviceKey?: Resolver<ResolversTypes['AuthSession'], ParentType, ContextType>;
  signIn?: Resolver<ResolversTypes['AuthSession'], ParentType, ContextType, RequireFields<MutationSignInArgs, 'email' | 'password'>>;
  signOut?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  signUp?: Resolver<ResolversTypes['AuthSession'], ParentType, ContextType, RequireFields<MutationSignUpArgs, 'email' | 'name' | 'password'>>;
  updateCategoryRule?: Resolver<ResolversTypes['CategoryRules'], ParentType, ContextType, RequireFields<MutationUpdateCategoryRuleArgs, 'categoryId' | 'id'>>;
  updateContextRule?: Resolver<ResolversTypes['ContextRules'], ParentType, ContextType, RequireFields<MutationUpdateContextRuleArgs, 'id' | 'titlePattern'>>;
  verifyMagicLink?: Resolver<ResolversTypes['AuthSession'], ParentType, ContextType, RequireFields<MutationVerifyMagicLinkArgs, 'token'>>;
};

export type QueryResolvers<ContextType = Context, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  activities?: Resolver<Array<ResolversTypes['Activities']>, ParentType, ContextType, Partial<QueryActivitiesArgs>>;
  appSummary?: Resolver<Array<ResolversTypes['AppContextSummary']>, ParentType, ContextType, RequireFields<QueryAppSummaryArgs, 'from' | 'to'>>;
  categories?: Resolver<Array<ResolversTypes['Categories']>, ParentType, ContextType, Partial<QueryCategoriesArgs>>;
  categoryRules?: Resolver<Array<ResolversTypes['CategoryRules']>, ParentType, ContextType, Partial<QueryCategoryRulesArgs>>;
  categorySummary?: Resolver<Array<ResolversTypes['CategoryDaySummary']>, ParentType, ContextType, RequireFields<QueryCategorySummaryArgs, 'from' | 'to'>>;
  contextRules?: Resolver<Array<ResolversTypes['ContextRules']>, ParentType, ContextType, Partial<QueryContextRulesArgs>>;
  deviceSummary?: Resolver<Array<ResolversTypes['DeviceSummary']>, ParentType, ContextType, RequireFields<QueryDeviceSummaryArgs, 'from' | 'to'>>;
  devices?: Resolver<Array<ResolversTypes['Devices']>, ParentType, ContextType, Partial<QueryDevicesArgs>>;
  me?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  mergeRules?: Resolver<Array<ResolversTypes['MergeRules']>, ParentType, ContextType, Partial<QueryMergeRulesArgs>>;
};

export type SummariesResolvers<ContextType = Context, ParentType extends ResolversParentTypes['Summaries'] = ResolversParentTypes['Summaries']> = {
  app?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  categoryId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  context?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  cursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  day?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  device?: Resolver<Maybe<ResolversTypes['Devices']>, ParentType, ContextType, Partial<SummariesDeviceArgs>>;
  deviceId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  seconds?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
};

export type Resolvers<ContextType = Context> = {
  Activities?: ActivitiesResolvers<ContextType>;
  AppContextSummary?: AppContextSummaryResolvers<ContextType>;
  AuthSession?: AuthSessionResolvers<ContextType>;
  Categories?: CategoriesResolvers<ContextType>;
  CategoryDaySummary?: CategoryDaySummaryResolvers<ContextType>;
  CategoryRules?: CategoryRulesResolvers<ContextType>;
  ContextRules?: ContextRulesResolvers<ContextType>;
  DateTime?: GraphQLScalarType;
  DeviceRegistration?: DeviceRegistrationResolvers<ContextType>;
  DeviceSummary?: DeviceSummaryResolvers<ContextType>;
  Devices?: DevicesResolvers<ContextType>;
  MagicLinkRequest?: MagicLinkRequestResolvers<ContextType>;
  MergeRules?: MergeRulesResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  Summaries?: SummariesResolvers<ContextType>;
};

