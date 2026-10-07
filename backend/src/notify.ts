import type { Context } from 'hono';
import { sdk, sqlOne } from './lib';

/**
 * Notifications go through the platform's notifications module: one call
 * writes the in-app inbox row AND pushes to the person's registered phones,
 * honouring their per-category preferences and quiet hours. Push credentials
 * live on the platform; the app holds none.
 *
 * BRD §6.13: push text never carries the address or money amounts, and a
 * notification never fails the request (or job) that caused it.
 */

export type Category = 'quotes' | 'phases' | 'materials' | 'budget' | 'exports' | 'account';

export interface Note {
  category: Category;
  title: string;
  body: string;
  /** `route` is the screen the app opens on tap, e.g. /project/<id>/quotes/<qid>. */
  data: { project_id?: string | null; route?: string; [k: string]: unknown };
  channels?: Array<'in_app' | 'push'>;
}

export function background(c: Context, work: Promise<unknown>): void {
  const guarded = work.catch((error) => console.error('background task failed:', error instanceof Error ? error.message : error));
  try {
    c.executionCtx.waitUntil(guarded);
  } catch {
    // Node dev server: no execution context; the promise already runs.
    void guarded;
  }
}

/** Strip anything that looks like money from push copy (BRD §6.13). */
function scrub(text: string): string {
  return text.replace(/[$€£¥₹]\s?[\d,.]+|\b\d[\d,.]*\s?(USD|EUR|GBP|CAD|AUD)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
}

export async function notifyNow(c: Context, userId: string, note: Note): Promise<boolean> {
  try {
    await sdk(c).modules.notifications.notify({
      userId,
      category: note.category,
      title: scrub(note.title).slice(0, 120),
      body: scrub(note.body).slice(0, 400),
      data: note.data,
      channels: note.channels ?? ['in_app', 'push'],
    });
    return true;
  } catch (error) {
    console.error('notify failed:', note.category, error instanceof Error ? error.message : error);
    return false;
  }
}

export function notify(c: Context, userId: string, note: Note): void {
  background(c, notifyNow(c, userId, note));
}

/**
 * Send once per dedupe key (hp__notice). The key is claimed first, so two
 * job runs can never both send; a failed send frees the key for next time.
 */
export async function notifyOnce(c: Context, userId: string, dedupeKey: string, kind: string, projectId: string | null, note: Note): Promise<boolean> {
  const claimed = await sqlOne<{ dedupe_key: string }>(
    c,
    `INSERT INTO hp__notice (dedupe_key, user_id, project_id, kind) VALUES ($1::text, $2::text, $3::uuid, $4::text)
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING dedupe_key`,
    [dedupeKey, userId, projectId, kind],
  );
  if (!claimed) return false;
  const sent = await notifyNow(c, userId, note);
  if (!sent) await sqlOne(c, `DELETE FROM hp__notice WHERE dedupe_key = $1::text RETURNING dedupe_key`, [dedupeKey]).catch(() => null);
  return sent;
}
