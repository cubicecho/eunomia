// The generated contract: schema types, operation types, documents, getSdk.
export * from '@eunomia/gql/agent';
export {
  type AgentConfig,
  createRequester,
  createSdk,
  extractMagicToken,
  GraphQLRequestError,
  registerDevice,
  renameDevice,
  requestMagicLink,
  signOut,
  UNAUTHENTICATED,
  verifyMagicLink,
  withBearer,
} from './api.ts';
export {
  isComplete,
  type LocalApiConfig,
  parseConfig,
  parseConfigText,
  parseLocalApiConfig,
  parseSavedConfig,
  parseSavedConfigText,
  patchConfigText,
  type SavedConfig,
  type StoredConfig,
  serializeConfig,
} from './config.ts';
export {
  type AgentCredential,
  createTokenSource,
  createTokenSourceCache,
  parseCredential,
  SignedOutError,
  type TokenSource,
  type TokenSourceOptions,
} from './credential.ts';
export {
  DEVICE_CODE_GRANT,
  type DeviceAuthorization,
  DeviceFlowError,
  type DeviceSignIn,
  discoverProvider,
  fetchDeviceSignIn,
  type PollOptions,
  type ProviderEndpoints,
  pollDeviceToken,
  refreshTokens,
  startDeviceAuthorization,
  type TokenSet,
} from './device-flow.ts';
export {
  beginDeviceSignIn,
  type DeviceCode,
  type DeviceSignInOptions,
  deviceSignInProvider,
  type PendingDeviceSignIn,
} from './device-sign-in.ts';
export {
  createLocalApi,
  DEFAULT_LOCAL_API_PORT,
  type LocalApiOptions,
  type LocalRequest,
  type LocalResponse,
  MAX_LOCAL_BODY_BYTES,
} from './local-api.ts';
export {
  type AfkReport,
  BROWSER_APP,
  type BrowserReport,
  createLocalFeed,
  DEFAULT_REPORT_TTL_SECONDS,
  type FeedSource,
  hostOf,
  type LocalFeed,
  type LocalReport,
  MAX_REPORT_TTL_SECONDS,
  parseReport,
  type WindowReport,
} from './local-feed.ts';
export {
  DEFAULT_LOG_RETENTION_DAYS,
  logRetentionDays,
  MIN_LOG_RETENTION_DAYS,
  Outbox,
  type OutboxOptions,
  type PingLogStore,
} from './outbox.ts';
export {
  currentPause,
  isPausedAt,
  PAUSE_CHOICES,
  type PauseWindow,
  parsePauses,
  pause,
  prunePauses,
  resume,
} from './pause.ts';
export {
  DEFAULT_SYNC_INTERVAL_SECONDS,
  FLUSH_BATCH_SIZE,
  MIN_SYNC_INTERVAL_SECONDS,
  PING_INTERVAL_MS,
  type Ping,
  syncIntervalMs,
} from './ping.ts';
export {
  CAPTURE_LEVELS,
  type CaptureLevel,
  createSanitizer,
  DEFAULT_CAPTURE_LEVEL,
  isCaptureLevel,
  type PingSanitizer,
  type PrivacyConfig,
} from './privacy.ts';
export {
  type DeviceIdentity,
  normalizeServerUrl,
  type ProvisionInput,
  type ProvisionResult,
  provisionDevice,
} from './provision.ts';
export {
  CHECK_INTERVAL_MS,
  createSampler,
  HEARTBEAT_INTERVAL_MS,
  type Sample,
  type Sampler,
  type SamplerDeps,
  type SamplerStatus,
} from './sampler.ts';
export {
  initialSynthState,
  SYNTH_INTERVAL_MS,
  type SynthState,
  synthesizePings,
  type UsageEvent,
} from './synth.ts';
export {
  classifyFailure,
  createUploader,
  type Uploader,
  type UploaderStatus,
  type UploadResult,
  type UploadTarget,
  uploadBatch,
} from './upload.ts';
