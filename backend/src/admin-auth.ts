import type { Context, MiddlewareHandler } from 'hono';
import { AppError, readEnvVar, safeEqual, sha256, sqlOne } from './lib';

/**
 * Operator authentication for /admin/* and /internal/*. The deploy pipeline
 * cannot install secrets, so `npm run migrate` stores the SHA-256 digest of
 * ADMIN_TOKEN / JOB_SECRET in hp__operator_secret; the worker compares the
 * presented token's digest against it (or against the env value when set).
 */
async function tokenMatches(c: Context, presented: string | undefined, name: 'admin' | 'jobs', envName: string, min: number): Promise<boolean> {
  if (!presented || presented.length < min) return false;
  const fromEnv = readEnvVar(c, envName);
  if (fromEnv && fromEnv.length >= min) return safeEqual(presented, fromEnv);
  const row = await sqlOne<{ digest: string }>(c, `SELECT digest FROM hp__operator_secret WHERE name = $1::text`, [name]);
  return Boolean(row) && safeEqual(await sha256(presented), row!.digest);
}

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  if (!(await tokenMatches(c, c.req.header('x-admin-token')?.trim(), 'admin', 'ADMIN_TOKEN', 24))) {
    throw new AppError('FORBIDDEN', 'Operator access only.', 403);
  }
  c.set('hp:admin' as never, true as never);
  await next();
};

export const requireJobSecret: MiddlewareHandler = async (c, next) => {
  if (!(await tokenMatches(c, c.req.header('x-job-secret')?.trim(), 'jobs', 'JOB_SECRET', 16))) {
    throw new AppError('FORBIDDEN', 'Job secret required.', 403);
  }
  await next();
};
