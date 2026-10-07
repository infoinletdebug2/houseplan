import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { XenitionError } from '@xenition/sdk';
import { AppError, engineError, requestId, type FieldError } from './lib';
import { CalcError } from './logic/calc';

/**
 * The one error handler: on the root app, on the /api/v1 mount AND as the
 * first line of every router's build(). `defineRouter()` installs the SDK's
 * generic onError on each router, and a sub-app's handler wins for every
 * route inside it; without this every platform error would reach the phone
 * as "Upstream request failed".
 *
 * Shape (BRD §10.1, CONTRACT §0):
 *   {error: {code, message, fields: {field: message}, field_errors: [...], request_id, retryable}}
 * No stack traces, ever.
 */
export function handleError(err: Error, c: Context) {
  if (err instanceof CalcError) {
    return send(c, err.code === 'DOUBLE_COUNT' ? 422 : 422, err.code, err.message, err.fields.map((field) => ({ field, message: err.message })));
  }
  const mapped = engineError(err);
  if (mapped instanceof AppError) return send(c, mapped.status, mapped.code, mapped.message, mapped.fieldErrors, mapped.retryable);
  if (mapped instanceof XenitionError) {
    const [code, status, message] = mapPlatformError(mapped);
    return send(c, status, code, message, undefined, status >= 500);
  }
  if (err instanceof HTTPException) {
    const status = err.status;
    if (status === 401) return send(c, 401, 'AUTH_TOKEN_EXPIRED', 'Sign in again to continue.');
    if (status === 429) {
      c.header('Retry-After', '60');
      return send(c, 429, 'RATE_LIMIT_EXCEEDED', 'Too many attempts. Wait a moment and try again.', undefined, true);
    }
    if (status === 403) return send(c, 403, 'FORBIDDEN', 'You do not have access to that.');
    return send(c, status, 'HTTP_ERROR', err.message || 'Request failed.');
  }
  console.error('unhandled:', requestId(c), err instanceof Error ? err.stack : err);
  return send(c, 500, 'INTERNAL_SERVER_ERROR', 'Something went wrong on our side. Try again in a moment.', undefined, true);
}

export function send(c: Context, status: number, code: string, message: string, fieldErrors?: FieldError[], retryable = false) {
  const fields: Record<string, string> = {};
  for (const f of fieldErrors ?? []) fields[f.field] = f.message ?? 'Invalid.';
  const error: Record<string, unknown> = { code, message, fields, request_id: requestId(c), retryable };
  if (fieldErrors?.length) error.field_errors = fieldErrors;
  return c.json({ error }, status as 400);
}

/** Platform codes are mapped, never passed through: the app branches on OUR codes. */
function mapPlatformError(err: XenitionError): [code: string, status: number, message: string] {
  switch (err.code) {
    case 'AUTH_INVALID_CREDENTIALS':
      return ['AUTH_INVALID_CREDENTIALS', 401, 'That email and password do not match.'];
    case 'AUTH_INVALID_TOKEN':
    case 'AUTH_EXPIRED_TOKEN':
      return ['AUTH_TOKEN_EXPIRED', 401, 'Sign in again to continue.'];
    case 'AUTH_EMAIL_EXISTS':
      return ['AUTH_EMAIL_TAKEN', 409, 'There is already an account with that email. Sign in instead.'];
    case 'AUTH_WEAK_PASSWORD':
      return ['VALIDATION_ERROR', 400, 'Choose a stronger password: at least 12 characters.'];
    case 'AUTH_PROVIDER_NOT_CONFIGURED':
      return ['AUTH_PROVIDER_NOT_CONFIGURED', 412, 'That sign-in method is not set up for this app yet.'];
    case 'AUTH_FORBIDDEN':
      return ['FORBIDDEN', 403, 'You do not have access to that.'];
    case 'NOT_FOUND':
      return ['NOT_FOUND', 404, 'That is not here.'];
    case 'VALIDATION_ERROR':
      return ['VALIDATION_ERROR', 400, 'Some of those details are not valid.'];
    case 'CONFLICT':
      return ['CONFLICT', 409, 'This changed on another device. Refresh and try again.'];
    case 'RATE_LIMITED':
      return ['RATE_LIMIT_EXCEEDED', 429, 'Too many attempts. Wait a moment and try again.'];
    default:
      if (/sign-in is not configured|not configured for this app/i.test(err.message)) {
        return ['AUTH_PROVIDER_NOT_CONFIGURED', 412, 'That sign-in method is not set up for this app yet.'];
      }
      console.error('platform error:', err.code, err.message);
      return ['UPSTREAM_UNAVAILABLE', 503, 'We could not reach the service behind this. Try again in a moment.'];
  }
}
