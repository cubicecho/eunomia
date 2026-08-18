import { z } from 'zod';

export const platformSchema = z.enum(['windows', 'macos', 'linux', 'android']);
export type Platform = z.infer<typeof platformSchema>;

// The wire format (decided 2026-08-16): agents are stateless and send pings —
// "this is what the device looks like right now" — every ~10s and on focus
// change. The server folds each ping into per-device activity intervals inline
// (extend the open interval on match, close-and-swap on change); see
// apps/server/src/activity/fold.ts. Null app = foreground app undetectable.
export const activityPingSchema = z.object({
  capturedAt: z.iso.datetime(),
  app: z.string().min(1).nullable(),
  title: z.string().nullable(),
  idleSeconds: z.number().int().nonnegative(),
});
export type ActivityPing = z.infer<typeof activityPingSchema>;
