import type { ErrorCode } from '@parley/shared';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invite_invalid: 404,
  invite_expired: 410,
  invite_revoked: 410,
  room_ended: 410,
  room_full: 409,
  language_unsupported: 422,
  rate_limited: 429,
  internal: 500,
};

/** An error whose message is safe to show to the client. */
export class AppError extends Error {
  readonly statusCode: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.statusCode = STATUS[code];
  }
}
