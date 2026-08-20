/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
class DocumentString extends String {}
/**
 * Runtime value is a String subclass; typed as `string` so the document
 * constants below flow into the string-typed Requester.
 */
const TypedDocumentString = DocumentString as unknown as new (value: string) => string;

export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** A date-time string at UTC, such as 2007-12-03T10:15:30Z, compliant with the `date-time` format outlined in section 5.6 of the RFC 3339 profile of the ISO 8601 standard for representation of dates and times using the Gregorian calendar. */
  DateTime: { input: string; output: string; }
};

export type Activities = {
  __typename?: 'Activities';
  activeSeconds: Scalars['Float']['output'];
  app: Scalars['String']['output'];
  category?: Maybe<Categories>;
  categoryId?: Maybe<Scalars['String']['output']>;
  categorySource?: Maybe<ActivitiesCategorySourceEnum>;
  /** DateTime */
  closedAt?: Maybe<Scalars['DateTime']['output']>;
  context?: Maybe<Scalars['String']['output']>;
  device?: Maybe<Devices>;
  deviceId: Scalars['String']['output'];
  id: Scalars['String']['output'];
  /** DateTime */
  lastActiveAt: Scalars['DateTime']['output'];
  rolledUp: Scalars['Boolean']['output'];
  /** DateTime */
  startedAt: Scalars['DateTime']['output'];
  title?: Maybe<Scalars['String']['output']>;
};


export type ActivitiesCategoryArgs = {
  where?: InputMaybe<CategoriesFilters>;
};


export type ActivitiesDeviceArgs = {
  where?: InputMaybe<DevicesFilters>;
};

export type ActivitiesCategorySourceEnum =
  /** Value: manual */
  | 'manual'
  /** Value: rule */
  | 'rule';

export type ActivitiesCategorySourceEnumFilter = {
  OR?: InputMaybe<Array<ActivitiesCategorySourceEnumFilterOr>>;
  eq?: InputMaybe<ActivitiesCategorySourceEnum>;
  gt?: InputMaybe<ActivitiesCategorySourceEnum>;
  gte?: InputMaybe<ActivitiesCategorySourceEnum>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  inArray?: InputMaybe<Array<ActivitiesCategorySourceEnum>>;
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  lt?: InputMaybe<ActivitiesCategorySourceEnum>;
  lte?: InputMaybe<ActivitiesCategorySourceEnum>;
  ne?: InputMaybe<ActivitiesCategorySourceEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  notInArray?: InputMaybe<Array<ActivitiesCategorySourceEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
};

export type ActivitiesCategorySourceEnumFilterOr = {
  eq?: InputMaybe<ActivitiesCategorySourceEnum>;
  gt?: InputMaybe<ActivitiesCategorySourceEnum>;
  gte?: InputMaybe<ActivitiesCategorySourceEnum>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  inArray?: InputMaybe<Array<ActivitiesCategorySourceEnum>>;
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  lt?: InputMaybe<ActivitiesCategorySourceEnum>;
  lte?: InputMaybe<ActivitiesCategorySourceEnum>;
  ne?: InputMaybe<ActivitiesCategorySourceEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  notInArray?: InputMaybe<Array<ActivitiesCategorySourceEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
};

export type ActivitiesFilters = {
  OR?: InputMaybe<Array<ActivitiesFiltersOr>>;
  activeSeconds?: InputMaybe<StringFilter>;
  app?: InputMaybe<StringFilter>;
  categoryId?: InputMaybe<IdFilter>;
  categorySource?: InputMaybe<ActivitiesCategorySourceEnumFilter>;
  closedAt?: InputMaybe<DateTimeFilter>;
  context?: InputMaybe<StringFilter>;
  deviceId?: InputMaybe<IdFilter>;
  id?: InputMaybe<IdFilter>;
  lastActiveAt?: InputMaybe<DateTimeFilter>;
  rolledUp?: InputMaybe<BooleanFilter>;
  startedAt?: InputMaybe<DateTimeFilter>;
  title?: InputMaybe<StringFilter>;
};

export type ActivitiesFiltersOr = {
  activeSeconds?: InputMaybe<StringFilter>;
  app?: InputMaybe<StringFilter>;
  categoryId?: InputMaybe<IdFilter>;
  categorySource?: InputMaybe<ActivitiesCategorySourceEnumFilter>;
  closedAt?: InputMaybe<DateTimeFilter>;
  context?: InputMaybe<StringFilter>;
  deviceId?: InputMaybe<IdFilter>;
  id?: InputMaybe<IdFilter>;
  lastActiveAt?: InputMaybe<DateTimeFilter>;
  rolledUp?: InputMaybe<BooleanFilter>;
  startedAt?: InputMaybe<DateTimeFilter>;
  title?: InputMaybe<StringFilter>;
};

export type ActivitiesOrderBy = {
  activeSeconds?: InputMaybe<InnerOrder>;
  app?: InputMaybe<InnerOrder>;
  categoryId?: InputMaybe<InnerOrder>;
  categorySource?: InputMaybe<InnerOrder>;
  closedAt?: InputMaybe<InnerOrder>;
  context?: InputMaybe<InnerOrder>;
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
  OR?: InputMaybe<Array<BooleanFilterOr>>;
  eq?: InputMaybe<Scalars['Boolean']['input']>;
  gt?: InputMaybe<Scalars['Boolean']['input']>;
  gte?: InputMaybe<Scalars['Boolean']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  inArray?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  lt?: InputMaybe<Scalars['Boolean']['input']>;
  lte?: InputMaybe<Scalars['Boolean']['input']>;
  ne?: InputMaybe<Scalars['Boolean']['input']>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  notInArray?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
};

export type BooleanFilterOr = {
  eq?: InputMaybe<Scalars['Boolean']['input']>;
  gt?: InputMaybe<Scalars['Boolean']['input']>;
  gte?: InputMaybe<Scalars['Boolean']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  inArray?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  lt?: InputMaybe<Scalars['Boolean']['input']>;
  lte?: InputMaybe<Scalars['Boolean']['input']>;
  ne?: InputMaybe<Scalars['Boolean']['input']>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  notInArray?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
};

export type Categories = {
  __typename?: 'Categories';
  activities: Array<Activities>;
  color?: Maybe<Scalars['String']['output']>;
  /** DateTime */
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  rules: Array<CategoryRules>;
  user?: Maybe<User>;
  userId: Scalars['String']['output'];
};


export type CategoriesActivitiesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<ActivitiesOrderBy>;
  where?: InputMaybe<ActivitiesFilters>;
};


export type CategoriesRulesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<CategoryRulesOrderBy>;
  where?: InputMaybe<CategoryRulesFilters>;
};


export type CategoriesUserArgs = {
  where?: InputMaybe<UserFilters>;
};

export type CategoriesFilters = {
  OR?: InputMaybe<Array<CategoriesFiltersOr>>;
  color?: InputMaybe<StringFilter>;
  createdAt?: InputMaybe<DateTimeFilter>;
  id?: InputMaybe<IdFilter>;
  name?: InputMaybe<StringFilter>;
  userId?: InputMaybe<IdFilter>;
};

export type CategoriesFiltersOr = {
  color?: InputMaybe<StringFilter>;
  createdAt?: InputMaybe<DateTimeFilter>;
  id?: InputMaybe<IdFilter>;
  name?: InputMaybe<StringFilter>;
  userId?: InputMaybe<IdFilter>;
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
  /** DateTime */
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  priority: Scalars['Int']['output'];
  titlePattern?: Maybe<Scalars['String']['output']>;
  user?: Maybe<User>;
  userId: Scalars['String']['output'];
};


export type CategoryRulesCategoryArgs = {
  where?: InputMaybe<CategoriesFilters>;
};


export type CategoryRulesUserArgs = {
  where?: InputMaybe<UserFilters>;
};

export type CategoryRulesFilters = {
  OR?: InputMaybe<Array<CategoryRulesFiltersOr>>;
  appPattern?: InputMaybe<StringFilter>;
  categoryId?: InputMaybe<IdFilter>;
  contextPattern?: InputMaybe<StringFilter>;
  createdAt?: InputMaybe<DateTimeFilter>;
  id?: InputMaybe<IdFilter>;
  priority?: InputMaybe<StringFilter>;
  titlePattern?: InputMaybe<StringFilter>;
  userId?: InputMaybe<IdFilter>;
};

export type CategoryRulesFiltersOr = {
  appPattern?: InputMaybe<StringFilter>;
  categoryId?: InputMaybe<IdFilter>;
  contextPattern?: InputMaybe<StringFilter>;
  createdAt?: InputMaybe<DateTimeFilter>;
  id?: InputMaybe<IdFilter>;
  priority?: InputMaybe<StringFilter>;
  titlePattern?: InputMaybe<StringFilter>;
  userId?: InputMaybe<IdFilter>;
};

export type CategoryRulesOrderBy = {
  appPattern?: InputMaybe<InnerOrder>;
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
  /** DateTime */
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  priority: Scalars['Int']['output'];
  titlePattern: Scalars['String']['output'];
  user?: Maybe<User>;
  userId: Scalars['String']['output'];
};


export type ContextRulesUserArgs = {
  where?: InputMaybe<UserFilters>;
};

export type ContextRulesFilters = {
  OR?: InputMaybe<Array<ContextRulesFiltersOr>>;
  appPattern?: InputMaybe<StringFilter>;
  createdAt?: InputMaybe<DateTimeFilter>;
  id?: InputMaybe<IdFilter>;
  priority?: InputMaybe<StringFilter>;
  titlePattern?: InputMaybe<StringFilter>;
  userId?: InputMaybe<IdFilter>;
};

export type ContextRulesFiltersOr = {
  appPattern?: InputMaybe<StringFilter>;
  createdAt?: InputMaybe<DateTimeFilter>;
  id?: InputMaybe<IdFilter>;
  priority?: InputMaybe<StringFilter>;
  titlePattern?: InputMaybe<StringFilter>;
  userId?: InputMaybe<IdFilter>;
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
  OR?: InputMaybe<Array<DateTimeFilterOr>>;
  /** DateTime */
  eq?: InputMaybe<Scalars['DateTime']['input']>;
  /** DateTime */
  gt?: InputMaybe<Scalars['DateTime']['input']>;
  /** DateTime */
  gte?: InputMaybe<Scalars['DateTime']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Array<DateTime> */
  inArray?: InputMaybe<Array<Scalars['DateTime']['input']>>;
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** DateTime */
  lt?: InputMaybe<Scalars['DateTime']['input']>;
  /** DateTime */
  lte?: InputMaybe<Scalars['DateTime']['input']>;
  /** DateTime */
  ne?: InputMaybe<Scalars['DateTime']['input']>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Array<DateTime> */
  notInArray?: InputMaybe<Array<Scalars['DateTime']['input']>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
};

export type DateTimeFilterOr = {
  /** DateTime */
  eq?: InputMaybe<Scalars['DateTime']['input']>;
  /** DateTime */
  gt?: InputMaybe<Scalars['DateTime']['input']>;
  /** DateTime */
  gte?: InputMaybe<Scalars['DateTime']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Array<DateTime> */
  inArray?: InputMaybe<Array<Scalars['DateTime']['input']>>;
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  /** DateTime */
  lt?: InputMaybe<Scalars['DateTime']['input']>;
  /** DateTime */
  lte?: InputMaybe<Scalars['DateTime']['input']>;
  /** DateTime */
  ne?: InputMaybe<Scalars['DateTime']['input']>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Array<DateTime> */
  notInArray?: InputMaybe<Array<Scalars['DateTime']['input']>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
};

export type DeviceRegistration = {
  __typename?: 'DeviceRegistration';
  apiKey: Scalars['String']['output'];
  device: Devices;
};

export type Devices = {
  __typename?: 'Devices';
  activities: Array<Activities>;
  /** DateTime */
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  platform: DevicesPlatformEnum;
  summaries: Array<Summaries>;
  user?: Maybe<User>;
  userId: Scalars['String']['output'];
};


export type DevicesActivitiesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<ActivitiesOrderBy>;
  where?: InputMaybe<ActivitiesFilters>;
};


export type DevicesSummariesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<SummariesOrderBy>;
  where?: InputMaybe<SummariesFilters>;
};


export type DevicesUserArgs = {
  where?: InputMaybe<UserFilters>;
};

export type DevicesFilters = {
  OR?: InputMaybe<Array<DevicesFiltersOr>>;
  createdAt?: InputMaybe<DateTimeFilter>;
  id?: InputMaybe<IdFilter>;
  name?: InputMaybe<StringFilter>;
  platform?: InputMaybe<DevicesPlatformEnumFilter>;
  userId?: InputMaybe<IdFilter>;
};

export type DevicesFiltersOr = {
  createdAt?: InputMaybe<DateTimeFilter>;
  id?: InputMaybe<IdFilter>;
  name?: InputMaybe<StringFilter>;
  platform?: InputMaybe<DevicesPlatformEnumFilter>;
  userId?: InputMaybe<IdFilter>;
};

export type DevicesOrderBy = {
  createdAt?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  name?: InputMaybe<InnerOrder>;
  platform?: InputMaybe<InnerOrder>;
  userId?: InputMaybe<InnerOrder>;
};

export type DevicesPlatformEnum =
  /** Value: android */
  | 'android'
  /** Value: linux */
  | 'linux'
  /** Value: macos */
  | 'macos'
  /** Value: windows */
  | 'windows';

export type DevicesPlatformEnumFilter = {
  OR?: InputMaybe<Array<DevicesPlatformEnumFilterOr>>;
  eq?: InputMaybe<DevicesPlatformEnum>;
  gt?: InputMaybe<DevicesPlatformEnum>;
  gte?: InputMaybe<DevicesPlatformEnum>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  inArray?: InputMaybe<Array<DevicesPlatformEnum>>;
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  lt?: InputMaybe<DevicesPlatformEnum>;
  lte?: InputMaybe<DevicesPlatformEnum>;
  ne?: InputMaybe<DevicesPlatformEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  notInArray?: InputMaybe<Array<DevicesPlatformEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
};

export type DevicesPlatformEnumFilterOr = {
  eq?: InputMaybe<DevicesPlatformEnum>;
  gt?: InputMaybe<DevicesPlatformEnum>;
  gte?: InputMaybe<DevicesPlatformEnum>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  inArray?: InputMaybe<Array<DevicesPlatformEnum>>;
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  lt?: InputMaybe<DevicesPlatformEnum>;
  lte?: InputMaybe<DevicesPlatformEnum>;
  ne?: InputMaybe<DevicesPlatformEnum>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  notInArray?: InputMaybe<Array<DevicesPlatformEnum>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
};

export type IdFilter = {
  OR?: InputMaybe<Array<IdFilterOr>>;
  eq?: InputMaybe<Scalars['String']['input']>;
  gt?: InputMaybe<Scalars['String']['input']>;
  gte?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  inArray?: InputMaybe<Array<Scalars['String']['input']>>;
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  lt?: InputMaybe<Scalars['String']['input']>;
  lte?: InputMaybe<Scalars['String']['input']>;
  ne?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  notInArray?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type IdFilterOr = {
  eq?: InputMaybe<Scalars['String']['input']>;
  gt?: InputMaybe<Scalars['String']['input']>;
  gte?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  inArray?: InputMaybe<Array<Scalars['String']['input']>>;
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  lt?: InputMaybe<Scalars['String']['input']>;
  lte?: InputMaybe<Scalars['String']['input']>;
  ne?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  notInArray?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type InnerOrder = {
  direction: OrderDirection;
  /** Priority of current field */
  priority: Scalars['Int']['input'];
};

export type MagicLinkRequest = {
  __typename?: 'MagicLinkRequest';
  ok: Scalars['Boolean']['output'];
  token?: Maybe<Scalars['String']['output']>;
};

export type Mutation = {
  __typename?: 'Mutation';
  applyCategoryRules: Scalars['Int']['output'];
  assignActivity: Activities;
  createCategory: Categories;
  createCategoryRule: CategoryRules;
  createContextRule: ContextRules;
  deleteCategory: Scalars['Boolean']['output'];
  deleteCategoryRule: Scalars['Boolean']['output'];
  deleteContextRule: Scalars['Boolean']['output'];
  deleteDevice: Scalars['Boolean']['output'];
  recordPing?: Maybe<Activities>;
  registerDevice: DeviceRegistration;
  renameDevice: Devices;
  requestMagicLink: MagicLinkRequest;
  signIn: AuthSession;
  signOut: Scalars['Boolean']['output'];
  signUp: AuthSession;
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


export type MutationRecordPingArgs = {
  app?: InputMaybe<Scalars['String']['input']>;
  capturedAt: Scalars['String']['input'];
  context?: InputMaybe<Scalars['String']['input']>;
  deviceId?: InputMaybe<Scalars['String']['input']>;
  idleSeconds: Scalars['Int']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
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


export type MutationSignInArgs = {
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
};


export type MutationSignUpArgs = {
  email: Scalars['String']['input'];
  name: Scalars['String']['input'];
  password: Scalars['String']['input'];
};


export type MutationVerifyMagicLinkArgs = {
  token: Scalars['String']['input'];
};

/** Order by direction */
export type OrderDirection =
  /** Ascending order */
  | 'asc'
  /** Descending order */
  | 'desc';

export type Query = {
  __typename?: 'Query';
  activities: Array<Activities>;
  appSummary: Array<AppContextSummary>;
  categories: Array<Categories>;
  categoryRules: Array<CategoryRules>;
  categorySummary: Array<CategoryDaySummary>;
  contextRules: Array<ContextRules>;
  devices: Array<Devices>;
  me?: Maybe<Scalars['String']['output']>;
};


export type QueryActivitiesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<ActivitiesOrderBy>;
  where?: InputMaybe<ActivitiesFilters>;
};


export type QueryAppSummaryArgs = {
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
};


export type QueryCategoriesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<CategoriesOrderBy>;
  where?: InputMaybe<CategoriesFilters>;
};


export type QueryCategoryRulesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<CategoryRulesOrderBy>;
  where?: InputMaybe<CategoryRulesFilters>;
};


export type QueryCategorySummaryArgs = {
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
};


export type QueryContextRulesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<ContextRulesOrderBy>;
  where?: InputMaybe<ContextRulesFilters>;
};


export type QueryDevicesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<DevicesOrderBy>;
  where?: InputMaybe<DevicesFilters>;
};

export type StringFilter = {
  OR?: InputMaybe<Array<StringFilterOr>>;
  eq?: InputMaybe<Scalars['String']['input']>;
  gt?: InputMaybe<Scalars['String']['input']>;
  gte?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  inArray?: InputMaybe<Array<Scalars['String']['input']>>;
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  lt?: InputMaybe<Scalars['String']['input']>;
  lte?: InputMaybe<Scalars['String']['input']>;
  ne?: InputMaybe<Scalars['String']['input']>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  notInArray?: InputMaybe<Array<Scalars['String']['input']>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
};

export type StringFilterOr = {
  eq?: InputMaybe<Scalars['String']['input']>;
  gt?: InputMaybe<Scalars['String']['input']>;
  gte?: InputMaybe<Scalars['String']['input']>;
  ilike?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  inArray?: InputMaybe<Array<Scalars['String']['input']>>;
  isNotNull?: InputMaybe<Scalars['Boolean']['input']>;
  isNull?: InputMaybe<Scalars['Boolean']['input']>;
  like?: InputMaybe<Scalars['String']['input']>;
  lt?: InputMaybe<Scalars['String']['input']>;
  lte?: InputMaybe<Scalars['String']['input']>;
  ne?: InputMaybe<Scalars['String']['input']>;
  notIlike?: InputMaybe<Scalars['String']['input']>;
  /** Array<undefined> */
  notInArray?: InputMaybe<Array<Scalars['String']['input']>>;
  notLike?: InputMaybe<Scalars['String']['input']>;
};

export type Summaries = {
  __typename?: 'Summaries';
  app: Scalars['String']['output'];
  categoryId?: Maybe<Scalars['String']['output']>;
  context?: Maybe<Scalars['String']['output']>;
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
  OR?: InputMaybe<Array<SummariesFiltersOr>>;
  app?: InputMaybe<StringFilter>;
  categoryId?: InputMaybe<IdFilter>;
  context?: InputMaybe<StringFilter>;
  day?: InputMaybe<StringFilter>;
  deviceId?: InputMaybe<IdFilter>;
  id?: InputMaybe<IdFilter>;
  seconds?: InputMaybe<StringFilter>;
};

export type SummariesFiltersOr = {
  app?: InputMaybe<StringFilter>;
  categoryId?: InputMaybe<IdFilter>;
  context?: InputMaybe<StringFilter>;
  day?: InputMaybe<StringFilter>;
  deviceId?: InputMaybe<IdFilter>;
  id?: InputMaybe<IdFilter>;
  seconds?: InputMaybe<StringFilter>;
};

export type SummariesOrderBy = {
  app?: InputMaybe<InnerOrder>;
  categoryId?: InputMaybe<InnerOrder>;
  context?: InputMaybe<InnerOrder>;
  day?: InputMaybe<InnerOrder>;
  deviceId?: InputMaybe<InnerOrder>;
  id?: InputMaybe<InnerOrder>;
  seconds?: InputMaybe<InnerOrder>;
};

export type User = {
  __typename?: 'User';
  categories: Array<Categories>;
  categoryRules: Array<CategoryRules>;
  contextRules: Array<ContextRules>;
  /** DateTime */
  createdAt: Scalars['DateTime']['output'];
  devices: Array<Devices>;
  email: Scalars['String']['output'];
  emailVerified: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
  image?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  /** DateTime */
  updatedAt: Scalars['DateTime']['output'];
};


export type UserCategoriesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<CategoriesOrderBy>;
  where?: InputMaybe<CategoriesFilters>;
};


export type UserCategoryRulesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<CategoryRulesOrderBy>;
  where?: InputMaybe<CategoryRulesFilters>;
};


export type UserContextRulesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<ContextRulesOrderBy>;
  where?: InputMaybe<ContextRulesFilters>;
};


export type UserDevicesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<DevicesOrderBy>;
  where?: InputMaybe<DevicesFilters>;
};

export type UserFilters = {
  OR?: InputMaybe<Array<UserFiltersOr>>;
  createdAt?: InputMaybe<DateTimeFilter>;
  email?: InputMaybe<StringFilter>;
  emailVerified?: InputMaybe<BooleanFilter>;
  id?: InputMaybe<IdFilter>;
  image?: InputMaybe<StringFilter>;
  name?: InputMaybe<StringFilter>;
  updatedAt?: InputMaybe<DateTimeFilter>;
};

export type UserFiltersOr = {
  createdAt?: InputMaybe<DateTimeFilter>;
  email?: InputMaybe<StringFilter>;
  emailVerified?: InputMaybe<BooleanFilter>;
  id?: InputMaybe<IdFilter>;
  image?: InputMaybe<StringFilter>;
  name?: InputMaybe<StringFilter>;
  updatedAt?: InputMaybe<DateTimeFilter>;
};

export type RequestMagicLinkMutationVariables = Exact<{
  email: string;
}>;


export type RequestMagicLinkMutation = { requestMagicLink: { token: string | null } };

export type VerifyMagicLinkMutationVariables = Exact<{
  token: string;
}>;


export type VerifyMagicLinkMutation = { verifyMagicLink: { token: string } };

export type RegisterDeviceMutationVariables = Exact<{
  name: string;
  platform: string;
}>;


export type RegisterDeviceMutation = { registerDevice: { apiKey: string, device: { id: string } } };

export type SignOutMutationVariables = Exact<{ [key: string]: never; }>;


export type SignOutMutation = { signOut: boolean };


export const RequestMagicLinkDocument = new TypedDocumentString(`
    mutation RequestMagicLink($email: String!) {
  requestMagicLink(email: $email) {
    token
  }
}
    `);
export const VerifyMagicLinkDocument = new TypedDocumentString(`
    mutation VerifyMagicLink($token: String!) {
  verifyMagicLink(token: $token) {
    token
  }
}
    `);
export const RegisterDeviceDocument = new TypedDocumentString(`
    mutation RegisterDevice($name: String!, $platform: String!) {
  registerDevice(name: $name, platform: $platform) {
    device {
      id
    }
    apiKey
  }
}
    `);
export const SignOutDocument = new TypedDocumentString(`
    mutation SignOut {
  signOut
}
    `);
export type Requester<C = {}> = <R, V>(doc: string, vars?: V, options?: C) => Promise<R> | AsyncIterable<R>
export function getSdk<C>(requester: Requester<C>) {
  return {
    RequestMagicLink(variables: RequestMagicLinkMutationVariables, options?: C): Promise<RequestMagicLinkMutation> {
      return requester<RequestMagicLinkMutation, RequestMagicLinkMutationVariables>(RequestMagicLinkDocument, variables, options) as Promise<RequestMagicLinkMutation>;
    },
    VerifyMagicLink(variables: VerifyMagicLinkMutationVariables, options?: C): Promise<VerifyMagicLinkMutation> {
      return requester<VerifyMagicLinkMutation, VerifyMagicLinkMutationVariables>(VerifyMagicLinkDocument, variables, options) as Promise<VerifyMagicLinkMutation>;
    },
    RegisterDevice(variables: RegisterDeviceMutationVariables, options?: C): Promise<RegisterDeviceMutation> {
      return requester<RegisterDeviceMutation, RegisterDeviceMutationVariables>(RegisterDeviceDocument, variables, options) as Promise<RegisterDeviceMutation>;
    },
    SignOut(variables?: SignOutMutationVariables, options?: C): Promise<SignOutMutation> {
      return requester<SignOutMutation, SignOutMutationVariables>(SignOutDocument, variables, options) as Promise<SignOutMutation>;
    }
  };
}
export type Sdk = ReturnType<typeof getSdk>;