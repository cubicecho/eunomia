import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthHost } from '../auth-host.ts';
import { oidcApiAudience } from './config.ts';

// OAuth 2.0 Protected Resource Metadata (RFC 9728): how an agent that holds no
// credential yet learns which authorization server issues tokens for this API,
// and which audience to ask for. Heautou reads it too, under the `client_uri`
// pairing registered, to offer its admin eunomia's API. The authorization
// server is the provider in effect, read per request, so pairing one shows
// here without a restart.

/** The well-known path RFC 9728 names. */
export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';

/** What this API calls itself in its metadata. */
const RESOURCE_NAME = 'eunomia';

export interface ProtectedResourceMetadata {
  /** The API audience a token must be issued for. */
  resource: string;
  /** The provider's issuer, or none while there is no provider. */
  authorization_servers: string[];
  bearer_methods_supported: ['header'];
  resource_name: string;
}

/** The metadata as it stands now. */
export function protectedResourceMetadata(host: AuthHost): ProtectedResourceMetadata {
  const oidc = host.oidc();
  return {
    resource: oidcApiAudience(),
    authorization_servers: oidc === null ? [] : [oidc.issuer],
    bearer_methods_supported: ['header'],
    resource_name: RESOURCE_NAME,
  };
}

/**
 * Answers the metadata at the well-known path, and at that path followed by
 * the resource's own path (`/.well-known/oauth-protected-resource/graphql`),
 * which is where RFC 9728 §3.1 has a client look for a resource that has a
 * path. Reports whether it answered. Mount before the static handler, whose
 * SPA fallback would answer both.
 */
export function createProtectedResourceHandler(host: AuthHost) {
  const audience = oidcApiAudience();
  const resourcePath = URL.canParse(audience) ? new URL(audience).pathname.replace(/\/+$/, '') : '';
  const paths = new Set([PROTECTED_RESOURCE_PATH]);
  if (resourcePath !== '') paths.add(`${PROTECTED_RESOURCE_PATH}${resourcePath}`);
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (!paths.has(path) || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(protectedResourceMetadata(host)));
    return true;
  };
}
