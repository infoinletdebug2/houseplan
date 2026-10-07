/** Stub: scheduled jobs are being built. */
export function internalJobToken(env: Record<string, unknown>): string {
  return typeof env.JOB_SECRET === 'string' ? env.JOB_SECRET : '';
}
