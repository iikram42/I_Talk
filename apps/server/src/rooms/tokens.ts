import { createHash, randomBytes } from 'node:crypto';

/** 128-bit public room identifier (22 base64url chars). Not a secret on its own. */
export function newRoomId(): string {
  return randomBytes(16).toString('base64url');
}

/** 256-bit secret (43 base64url chars) used for invitations and participant sessions. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Tokens carry 256 bits of entropy, so a fast hash is sufficient; we store only the hash so a
 * database leak does not expose usable invitations or sessions.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
