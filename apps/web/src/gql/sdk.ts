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

export type DevicesPlatformEnum =
  /** Value: android */
  | 'android'
  /** Value: linux */
  | 'linux'
  /** Value: macos */
  | 'macos'
  /** Value: windows */
  | 'windows';

export type RequestMagicLinkMutationVariables = Exact<{
  email: string;
}>;


export type RequestMagicLinkMutation = { requestMagicLink: { token: string | null } };

export type VerifyMagicLinkMutationVariables = Exact<{
  token: string;
}>;


export type VerifyMagicLinkMutation = { verifyMagicLink: { token: string } };

export type SignOutMutationVariables = Exact<{ [key: string]: never; }>;


export type SignOutMutation = { signOut: boolean };

export type CategorySummaryQueryVariables = Exact<{
  from: string;
  to: string;
  deviceId?: string | null | undefined;
}>;


export type CategorySummaryQuery = { categorySummary: Array<{ day: string, categoryId: string | null, name: string | null, color: string | null, seconds: number }> };

export type AppSummaryQueryVariables = Exact<{
  from: string;
  to: string;
  deviceId?: string | null | undefined;
}>;


export type AppSummaryQuery = { appSummary: Array<{ app: string, context: string | null, seconds: number }> };

export type DeviceSummaryQueryVariables = Exact<{
  from: string;
  to: string;
}>;


export type DeviceSummaryQuery = { deviceSummary: Array<{ deviceId: string, name: string, platform: string, seconds: number }> };

export type RecentActivitiesQueryVariables = Exact<{
  limit?: number | null | undefined;
}>;


export type RecentActivitiesQuery = { activities: Array<{ app: string, title: string | null, context: string | null }> };

export type CategoriesQueryVariables = Exact<{ [key: string]: never; }>;


export type CategoriesQuery = { categories: Array<{ id: string, name: string, color: string | null }> };

export type CategoryRulesQueryVariables = Exact<{ [key: string]: never; }>;


export type CategoryRulesQuery = { categoryRules: Array<{ id: string, categoryId: string, appPattern: string | null, titlePattern: string | null, contextPattern: string | null, priority: number }> };

export type ContextRulesQueryVariables = Exact<{ [key: string]: never; }>;


export type ContextRulesQuery = { contextRules: Array<{ id: string, appPattern: string | null, titlePattern: string, priority: number }> };

export type DevicesQueryVariables = Exact<{ [key: string]: never; }>;


export type DevicesQuery = { devices: Array<{ id: string, name: string, platform: DevicesPlatformEnum, createdAt: string, lastSeenAt: string | null }> };

export type CreateCategoryMutationVariables = Exact<{
  name: string;
  color?: string | null | undefined;
}>;


export type CreateCategoryMutation = { createCategory: { id: string } };

export type DeleteCategoryMutationVariables = Exact<{
  id: string;
}>;


export type DeleteCategoryMutation = { deleteCategory: boolean };

export type CreateCategoryRuleMutationVariables = Exact<{
  categoryId: string;
  appPattern?: string | null | undefined;
  titlePattern?: string | null | undefined;
  contextPattern?: string | null | undefined;
  priority?: number | null | undefined;
}>;


export type CreateCategoryRuleMutation = { createCategoryRule: { id: string } };

export type UpdateCategoryRuleMutationVariables = Exact<{
  id: string;
  categoryId: string;
  appPattern?: string | null | undefined;
  titlePattern?: string | null | undefined;
  contextPattern?: string | null | undefined;
  priority?: number | null | undefined;
}>;


export type UpdateCategoryRuleMutation = { updateCategoryRule: { id: string } };

export type DeleteCategoryRuleMutationVariables = Exact<{
  id: string;
}>;


export type DeleteCategoryRuleMutation = { deleteCategoryRule: boolean };

export type CreateContextRuleMutationVariables = Exact<{
  appPattern?: string | null | undefined;
  titlePattern: string;
  priority?: number | null | undefined;
}>;


export type CreateContextRuleMutation = { createContextRule: { id: string } };

export type UpdateContextRuleMutationVariables = Exact<{
  id: string;
  appPattern?: string | null | undefined;
  titlePattern: string;
  priority?: number | null | undefined;
}>;


export type UpdateContextRuleMutation = { updateContextRule: { id: string } };

export type DeleteContextRuleMutationVariables = Exact<{
  id: string;
}>;


export type DeleteContextRuleMutation = { deleteContextRule: boolean };

export type ApplyCategoryRulesMutationVariables = Exact<{ [key: string]: never; }>;


export type ApplyCategoryRulesMutation = { applyCategoryRules: number };

export type RenameDeviceMutationVariables = Exact<{
  id: string;
  name: string;
}>;


export type RenameDeviceMutation = { renameDevice: { id: string } };

export type MergeDeviceMutationVariables = Exact<{
  id: string;
  intoId: string;
}>;


export type MergeDeviceMutation = { mergeDevice: { id: string } };

export type DeleteDeviceMutationVariables = Exact<{
  id: string;
}>;


export type DeleteDeviceMutation = { deleteDevice: boolean };

export type MergeRulesQueryVariables = Exact<{ [key: string]: never; }>;


export type MergeRulesQuery = { mergeRules: Array<{ id: string, fromApp: string, fromContext: string | null, toApp: string, toContext: string | null }> };

export type CreateMergeRuleMutationVariables = Exact<{
  fromApp: string;
  fromContext?: string | null | undefined;
  toApp: string;
  toContext?: string | null | undefined;
}>;


export type CreateMergeRuleMutation = { createMergeRule: { id: string } };

export type DeleteMergeRuleMutationVariables = Exact<{
  id: string;
}>;


export type DeleteMergeRuleMutation = { deleteMergeRule: boolean };

export type ApplyMergeRulesMutationVariables = Exact<{ [key: string]: never; }>;


export type ApplyMergeRulesMutation = { applyMergeRules: number };


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
export const SignOutDocument = new TypedDocumentString(`
    mutation SignOut {
  signOut
}
    `);
export const CategorySummaryDocument = new TypedDocumentString(`
    query CategorySummary($from: String!, $to: String!, $deviceId: String) {
  categorySummary(from: $from, to: $to, deviceId: $deviceId) {
    day
    categoryId
    name
    color
    seconds
  }
}
    `);
export const AppSummaryDocument = new TypedDocumentString(`
    query AppSummary($from: String!, $to: String!, $deviceId: String) {
  appSummary(from: $from, to: $to, deviceId: $deviceId) {
    app
    context
    seconds
  }
}
    `);
export const DeviceSummaryDocument = new TypedDocumentString(`
    query DeviceSummary($from: String!, $to: String!) {
  deviceSummary(from: $from, to: $to) {
    deviceId
    name
    platform
    seconds
  }
}
    `);
export const RecentActivitiesDocument = new TypedDocumentString(`
    query RecentActivities($limit: Int) {
  activities(limit: $limit, orderBy: {startedAt: {direction: desc, priority: 1}}) {
    app
    title
    context
  }
}
    `);
export const CategoriesDocument = new TypedDocumentString(`
    query Categories {
  categories {
    id
    name
    color
  }
}
    `);
export const CategoryRulesDocument = new TypedDocumentString(`
    query CategoryRules {
  categoryRules {
    id
    categoryId
    appPattern
    titlePattern
    contextPattern
    priority
  }
}
    `);
export const ContextRulesDocument = new TypedDocumentString(`
    query ContextRules {
  contextRules {
    id
    appPattern
    titlePattern
    priority
  }
}
    `);
export const DevicesDocument = new TypedDocumentString(`
    query Devices {
  devices {
    id
    name
    platform
    createdAt
    lastSeenAt
  }
}
    `);
export const CreateCategoryDocument = new TypedDocumentString(`
    mutation CreateCategory($name: String!, $color: String) {
  createCategory(name: $name, color: $color) {
    id
  }
}
    `);
export const DeleteCategoryDocument = new TypedDocumentString(`
    mutation DeleteCategory($id: String!) {
  deleteCategory(id: $id)
}
    `);
export const CreateCategoryRuleDocument = new TypedDocumentString(`
    mutation CreateCategoryRule($categoryId: String!, $appPattern: String, $titlePattern: String, $contextPattern: String, $priority: Int) {
  createCategoryRule(
    categoryId: $categoryId
    appPattern: $appPattern
    titlePattern: $titlePattern
    contextPattern: $contextPattern
    priority: $priority
  ) {
    id
  }
}
    `);
export const UpdateCategoryRuleDocument = new TypedDocumentString(`
    mutation UpdateCategoryRule($id: String!, $categoryId: String!, $appPattern: String, $titlePattern: String, $contextPattern: String, $priority: Int) {
  updateCategoryRule(
    id: $id
    categoryId: $categoryId
    appPattern: $appPattern
    titlePattern: $titlePattern
    contextPattern: $contextPattern
    priority: $priority
  ) {
    id
  }
}
    `);
export const DeleteCategoryRuleDocument = new TypedDocumentString(`
    mutation DeleteCategoryRule($id: String!) {
  deleteCategoryRule(id: $id)
}
    `);
export const CreateContextRuleDocument = new TypedDocumentString(`
    mutation CreateContextRule($appPattern: String, $titlePattern: String!, $priority: Int) {
  createContextRule(
    appPattern: $appPattern
    titlePattern: $titlePattern
    priority: $priority
  ) {
    id
  }
}
    `);
export const UpdateContextRuleDocument = new TypedDocumentString(`
    mutation UpdateContextRule($id: String!, $appPattern: String, $titlePattern: String!, $priority: Int) {
  updateContextRule(
    id: $id
    appPattern: $appPattern
    titlePattern: $titlePattern
    priority: $priority
  ) {
    id
  }
}
    `);
export const DeleteContextRuleDocument = new TypedDocumentString(`
    mutation DeleteContextRule($id: String!) {
  deleteContextRule(id: $id)
}
    `);
export const ApplyCategoryRulesDocument = new TypedDocumentString(`
    mutation ApplyCategoryRules {
  applyCategoryRules
}
    `);
export const RenameDeviceDocument = new TypedDocumentString(`
    mutation RenameDevice($id: String!, $name: String!) {
  renameDevice(id: $id, name: $name) {
    id
  }
}
    `);
export const MergeDeviceDocument = new TypedDocumentString(`
    mutation MergeDevice($id: String!, $intoId: String!) {
  mergeDevice(id: $id, intoId: $intoId) {
    id
  }
}
    `);
export const DeleteDeviceDocument = new TypedDocumentString(`
    mutation DeleteDevice($id: String!) {
  deleteDevice(id: $id)
}
    `);
export const MergeRulesDocument = new TypedDocumentString(`
    query MergeRules {
  mergeRules {
    id
    fromApp
    fromContext
    toApp
    toContext
  }
}
    `);
export const CreateMergeRuleDocument = new TypedDocumentString(`
    mutation CreateMergeRule($fromApp: String!, $fromContext: String, $toApp: String!, $toContext: String) {
  createMergeRule(
    fromApp: $fromApp
    fromContext: $fromContext
    toApp: $toApp
    toContext: $toContext
  ) {
    id
  }
}
    `);
export const DeleteMergeRuleDocument = new TypedDocumentString(`
    mutation DeleteMergeRule($id: String!) {
  deleteMergeRule(id: $id)
}
    `);
export const ApplyMergeRulesDocument = new TypedDocumentString(`
    mutation ApplyMergeRules {
  applyMergeRules
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
    SignOut(variables?: SignOutMutationVariables, options?: C): Promise<SignOutMutation> {
      return requester<SignOutMutation, SignOutMutationVariables>(SignOutDocument, variables, options) as Promise<SignOutMutation>;
    },
    CategorySummary(variables: CategorySummaryQueryVariables, options?: C): Promise<CategorySummaryQuery> {
      return requester<CategorySummaryQuery, CategorySummaryQueryVariables>(CategorySummaryDocument, variables, options) as Promise<CategorySummaryQuery>;
    },
    AppSummary(variables: AppSummaryQueryVariables, options?: C): Promise<AppSummaryQuery> {
      return requester<AppSummaryQuery, AppSummaryQueryVariables>(AppSummaryDocument, variables, options) as Promise<AppSummaryQuery>;
    },
    DeviceSummary(variables: DeviceSummaryQueryVariables, options?: C): Promise<DeviceSummaryQuery> {
      return requester<DeviceSummaryQuery, DeviceSummaryQueryVariables>(DeviceSummaryDocument, variables, options) as Promise<DeviceSummaryQuery>;
    },
    RecentActivities(variables?: RecentActivitiesQueryVariables, options?: C): Promise<RecentActivitiesQuery> {
      return requester<RecentActivitiesQuery, RecentActivitiesQueryVariables>(RecentActivitiesDocument, variables, options) as Promise<RecentActivitiesQuery>;
    },
    Categories(variables?: CategoriesQueryVariables, options?: C): Promise<CategoriesQuery> {
      return requester<CategoriesQuery, CategoriesQueryVariables>(CategoriesDocument, variables, options) as Promise<CategoriesQuery>;
    },
    CategoryRules(variables?: CategoryRulesQueryVariables, options?: C): Promise<CategoryRulesQuery> {
      return requester<CategoryRulesQuery, CategoryRulesQueryVariables>(CategoryRulesDocument, variables, options) as Promise<CategoryRulesQuery>;
    },
    ContextRules(variables?: ContextRulesQueryVariables, options?: C): Promise<ContextRulesQuery> {
      return requester<ContextRulesQuery, ContextRulesQueryVariables>(ContextRulesDocument, variables, options) as Promise<ContextRulesQuery>;
    },
    Devices(variables?: DevicesQueryVariables, options?: C): Promise<DevicesQuery> {
      return requester<DevicesQuery, DevicesQueryVariables>(DevicesDocument, variables, options) as Promise<DevicesQuery>;
    },
    CreateCategory(variables: CreateCategoryMutationVariables, options?: C): Promise<CreateCategoryMutation> {
      return requester<CreateCategoryMutation, CreateCategoryMutationVariables>(CreateCategoryDocument, variables, options) as Promise<CreateCategoryMutation>;
    },
    DeleteCategory(variables: DeleteCategoryMutationVariables, options?: C): Promise<DeleteCategoryMutation> {
      return requester<DeleteCategoryMutation, DeleteCategoryMutationVariables>(DeleteCategoryDocument, variables, options) as Promise<DeleteCategoryMutation>;
    },
    CreateCategoryRule(variables: CreateCategoryRuleMutationVariables, options?: C): Promise<CreateCategoryRuleMutation> {
      return requester<CreateCategoryRuleMutation, CreateCategoryRuleMutationVariables>(CreateCategoryRuleDocument, variables, options) as Promise<CreateCategoryRuleMutation>;
    },
    UpdateCategoryRule(variables: UpdateCategoryRuleMutationVariables, options?: C): Promise<UpdateCategoryRuleMutation> {
      return requester<UpdateCategoryRuleMutation, UpdateCategoryRuleMutationVariables>(UpdateCategoryRuleDocument, variables, options) as Promise<UpdateCategoryRuleMutation>;
    },
    DeleteCategoryRule(variables: DeleteCategoryRuleMutationVariables, options?: C): Promise<DeleteCategoryRuleMutation> {
      return requester<DeleteCategoryRuleMutation, DeleteCategoryRuleMutationVariables>(DeleteCategoryRuleDocument, variables, options) as Promise<DeleteCategoryRuleMutation>;
    },
    CreateContextRule(variables: CreateContextRuleMutationVariables, options?: C): Promise<CreateContextRuleMutation> {
      return requester<CreateContextRuleMutation, CreateContextRuleMutationVariables>(CreateContextRuleDocument, variables, options) as Promise<CreateContextRuleMutation>;
    },
    UpdateContextRule(variables: UpdateContextRuleMutationVariables, options?: C): Promise<UpdateContextRuleMutation> {
      return requester<UpdateContextRuleMutation, UpdateContextRuleMutationVariables>(UpdateContextRuleDocument, variables, options) as Promise<UpdateContextRuleMutation>;
    },
    DeleteContextRule(variables: DeleteContextRuleMutationVariables, options?: C): Promise<DeleteContextRuleMutation> {
      return requester<DeleteContextRuleMutation, DeleteContextRuleMutationVariables>(DeleteContextRuleDocument, variables, options) as Promise<DeleteContextRuleMutation>;
    },
    ApplyCategoryRules(variables?: ApplyCategoryRulesMutationVariables, options?: C): Promise<ApplyCategoryRulesMutation> {
      return requester<ApplyCategoryRulesMutation, ApplyCategoryRulesMutationVariables>(ApplyCategoryRulesDocument, variables, options) as Promise<ApplyCategoryRulesMutation>;
    },
    RenameDevice(variables: RenameDeviceMutationVariables, options?: C): Promise<RenameDeviceMutation> {
      return requester<RenameDeviceMutation, RenameDeviceMutationVariables>(RenameDeviceDocument, variables, options) as Promise<RenameDeviceMutation>;
    },
    MergeDevice(variables: MergeDeviceMutationVariables, options?: C): Promise<MergeDeviceMutation> {
      return requester<MergeDeviceMutation, MergeDeviceMutationVariables>(MergeDeviceDocument, variables, options) as Promise<MergeDeviceMutation>;
    },
    DeleteDevice(variables: DeleteDeviceMutationVariables, options?: C): Promise<DeleteDeviceMutation> {
      return requester<DeleteDeviceMutation, DeleteDeviceMutationVariables>(DeleteDeviceDocument, variables, options) as Promise<DeleteDeviceMutation>;
    },
    MergeRules(variables?: MergeRulesQueryVariables, options?: C): Promise<MergeRulesQuery> {
      return requester<MergeRulesQuery, MergeRulesQueryVariables>(MergeRulesDocument, variables, options) as Promise<MergeRulesQuery>;
    },
    CreateMergeRule(variables: CreateMergeRuleMutationVariables, options?: C): Promise<CreateMergeRuleMutation> {
      return requester<CreateMergeRuleMutation, CreateMergeRuleMutationVariables>(CreateMergeRuleDocument, variables, options) as Promise<CreateMergeRuleMutation>;
    },
    DeleteMergeRule(variables: DeleteMergeRuleMutationVariables, options?: C): Promise<DeleteMergeRuleMutation> {
      return requester<DeleteMergeRuleMutation, DeleteMergeRuleMutationVariables>(DeleteMergeRuleDocument, variables, options) as Promise<DeleteMergeRuleMutation>;
    },
    ApplyMergeRules(variables?: ApplyMergeRulesMutationVariables, options?: C): Promise<ApplyMergeRulesMutation> {
      return requester<ApplyMergeRulesMutation, ApplyMergeRulesMutationVariables>(ApplyMergeRulesDocument, variables, options) as Promise<ApplyMergeRulesMutation>;
    }
  };
}
export type Sdk = ReturnType<typeof getSdk>;