import { createHmac } from 'node:crypto';
import type { IceServerConfig } from '@parley/shared';
import type { Config } from './config.js';

/**
 * Builds the ICE server list for a participant. TURN credentials use the coturn
 * `use-auth-secret` scheme: short-lived, derived from a shared secret, never stored.
 */
export function iceServersFor(
  config: Config,
  participantId: string,
  now = Date.now(),
): IceServerConfig[] {
  const servers: IceServerConfig[] = [];
  if (config.STUN_URLS.length > 0) servers.push({ urls: config.STUN_URLS });
  if (config.TURN_URLS.length > 0 && config.TURN_SECRET) {
    const expiry = Math.floor(now / 1000) + config.TURN_CREDENTIAL_TTL_SECONDS;
    const username = `${expiry}:${participantId}`;
    const credential = createHmac('sha1', config.TURN_SECRET).update(username).digest('base64');
    servers.push({ urls: config.TURN_URLS, username, credential });
  }
  return servers;
}
