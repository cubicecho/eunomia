// The generated contract: schema types, operation types, documents, getSdk.
export * from '@eunomia/gql/agent';
export {
  type AgentConfig,
  createRequester,
  createSdk,
  extractMagicToken,
  registerDevice,
  renameDevice,
  requestMagicLink,
  rotateDeviceKey,
  sessionFromDeviceKey,
  signOut,
  verifyMagicLink,
} from './api.ts';
export {
  parseConfig,
  parseConfigText,
  patchConfigText,
  type StoredConfig,
  serializeConfig,
} from './config.ts';
export {
  DEFAULT_LOG_RETENTION_DAYS,
  logRetentionDays,
  MIN_LOG_RETENTION_DAYS,
  Outbox,
  type OutboxOptions,
  type PingLogStore,
} from './outbox.ts';
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
  uploadBatch,
} from './upload.ts';
