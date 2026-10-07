import type { Context } from 'hono';
import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';
import { AppError, audit, body, created, env, hmac, isUuid, notFound, ok, oneOf, safeEqual, sdk, sha256, sha256Bytes, sql, sqlOne, userId, uuid } from '../lib';
import { requireActive, requirePaid, requireVerified } from '../middleware';
import { serverKey } from '../billing';
import { DOWNLOAD_TTL_SECONDS, MAX_UPLOAD_BYTES, fileBucket } from '../config';
import { limitsOf } from './public';

/**
 * Private attachments (BRD §6.12, CONTRACT §11).
 *
 * The platform's storage buckets are served from a public CDN path, so the
 * worker never stores a readable file there: every object is encrypted with
 * AES-GCM under a per-file key derived from a server secret, under an
 * unguessable key, and is only ever handed out through a 10-minute HMAC link
 * on this worker that decrypts on the way out. The client's file name and
 * MIME type are never trusted: the bytes decide the type.
 */

type Mime = 'image/jpeg' | 'image/png' | 'image/heic' | 'application/pdf';
const EXT: Record<Mime, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'application/pdf': 'pdf' };
const ATTACHMENT_TYPES = ['receipt', 'quote', 'photo', 'progress', 'document', 'rate_source'] as const;
export const TARGET_TYPES = ['quote', 'cost', 'payment', 'phase', 'rate', 'procurement', 'room'] as const;
type Target = (typeof TARGET_TYPES)[number];

/** What the bytes are, from their magic numbers. */
export function sniff(b: Uint8Array): Mime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return 'image/png';
  if (b.length >= 5 && String.fromCharCode(...b.slice(0, 5)) === '%PDF-') return 'application/pdf';
  if (b.length >= 12 && String.fromCharCode(...b.slice(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...b.slice(8, 12));
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
  }
  return null;
}

/** PDFs that can run code or carry files are refused (no scanner on the platform: refuse what we cannot vet). */
export function dangerousPdf(b: Uint8Array): string | null {
  // Byte-for-byte latin1 (Workers' TextDecoder is utf-8 only).
  let text = '';
  for (let i = 0; i < b.length; i += 8192) text += String.fromCharCode(...b.subarray(i, i + 8192));
  for (const marker of ['/JavaScript', '/JS', '/Launch', '/EmbeddedFile', '/RichMedia', '/XFA']) {
    const re = new RegExp(marker.replace('/', '\\/') + '(?![A-Za-z])');
    if (re.test(text)) return marker;
  }
  return null;
}

/** True when a JPEG's Exif block still carries a GPS IFD (tag 0x8825). The app re-encodes photos, which drops it. */
export function jpegHasGps(b: Uint8Array): boolean {
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1]!;
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0xe1 && len > 14 && String.fromCharCode(...b.slice(i + 4, i + 8)) === 'Exif') {
      const t = i + 10;
      const little = b[t] === 0x49 && b[t + 1] === 0x49;
      const u16 = (o: number) => (little ? b[o]! | (b[o + 1]! << 8) : (b[o]! << 8) | b[o + 1]!);
      const u32 = (o: number) => (little ? (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0 : ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0);
      const ifd = t + u32(t + 4);
      if (ifd + 2 > b.length) return false;
      const count = u16(ifd);
      for (let e = 0; e < count; e++) {
        const at = ifd + 2 + e * 12;
        if (at + 12 > b.length) break;
        if (u16(at) === 0x8825) return true;
      }
      return false;
    }
    i += 2 + len;
  }
  return false;
}

/* ══ encryption at rest ══════════════════════════════════════════════════ */

async function fileKey(c: Context, id: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${await serverKey(c, 'download')}:file:${id}`));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function seal(c: Context, id: string, bytes: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await fileKey(c, id), bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

export async function unseal(c: Context, id: string, sealed: Uint8Array): Promise<Uint8Array> {
  const iv = sealed.slice(0, 12);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await fileKey(c, id), sealed.slice(12)));
}

/* ══ ownership of link targets (strict allowlist; never trust target_id alone) ══ */

const TARGET_TABLE: Record<Exclude<Target, 'rate'>, string> = {
  quote: 'hp__quote',
  cost: 'hp__cost_record',
  payment: 'hp__payment',
  phase: 'hp__phase',
  procurement: 'hp__procurement_item',
  room: 'hp__room',
};

/** The project a target belongs to (null for a private rate), or 404 if the caller does not own it. */
async function resolveTarget(c: Context, type: Target, id: string): Promise<{ projectId: string | null }> {
  if (!isUuid(id)) throw notFound('That record is not here.');
  const uid = userId(c);
  if (type === 'rate') {
    const r = await sqlOne(c, `SELECT 1 FROM hp__user_rate WHERE id = $1::uuid AND owner_user_id = $2::text`, [id, uid]);
    if (!r) throw notFound('That record is not here.');
    return { projectId: null };
  }
  const row = await sqlOne<{ project_id: string }>(
    c,
    `SELECT t.project_id FROM ${TARGET_TABLE[type]} t JOIN hp__project p ON p.id = t.project_id
     WHERE t.id = $1::uuid AND p.owner_user_id = $2::text AND p.deleted_at IS NULL`,
    [id, uid],
  );
  if (!row) throw notFound('That record is not here.');
  return { projectId: row.project_id };
}

async function linkCount(c: Context, type: Target, id: string): Promise<number> {
  const r = await sqlOne<{ n: number }>(c, `SELECT count(*)::int AS n FROM hp__attachment_link WHERE target_type = $1::text AND target_id = $2::uuid`, [type, id]);
  return Number(r?.n ?? 0);
}

const COLUMNS = `a.id, a.project_id, a.mime, a.size_bytes, a.original_name, a.scan_status, a.attachment_type, to_json(a.created_at)#>>'{}' AS created_at`;

function present(r: Record<string, unknown>) {
  return { ...r, size_bytes: Number(r.size_bytes) };
}

async function signedUrl(c: Context, id: string): Promise<{ url: string; expires_at: string }> {
  const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS;
  const sig = await hmac(await serverKey(c, 'download'), `file.${id}.${exp}`);
  const origin = new URL(c.req.url).origin;
  return { url: `${origin}/api/v1/files/${id}?exp=${exp}&sig=${sig}`, expires_at: new Date(exp * 1000).toISOString() };
}

/** Delete one stored object; "not found" counts as deleted. */
export async function deleteStored(c: Context, key: string): Promise<void> {
  await sdk(c)
    .storage.delete(key, { bucket: fileBucket(env(c)) })
    .catch((e: unknown) => {
      if (!/not found/i.test(e instanceof Error ? e.message : String(e))) throw e;
    });
}

export const filesRouter = defineRouter({
  name: 'files',

  build(app, { requireAuth, rateLimit }) {
    app.onError(handleError);
    const account = [requireAuth, requireActive] as const;
    const paid = [requireAuth, requireActive, requireVerified, requirePaid] as const;

    app.post('/attachments', ...paid, rateLimit(60), async (c) => {
      const form = await c.req.parseBody().catch(() => {
        throw new AppError('VALIDATION_ERROR', 'Send the file as multipart/form-data.', 400);
      });
      const file = form.file;
      if (!(file instanceof File)) throw new AppError('VALIDATION_ERROR', 'Attach a file in the "file" field.', 400, [{ field: 'file', message: 'Required.' }]);
      if (file.size <= 0) throw new AppError('VALIDATION_ERROR', 'That file is empty.', 400, [{ field: 'file', message: 'Empty.' }]);
      if (file.size > MAX_UPLOAD_BYTES) throw new AppError('FILE_TOO_LARGE', 'Files can be up to 20 MB.', 413, [{ field: 'file', message: 'At most 20 MB.' }]);
      const kind = oneOf(form.attachment_type, ATTACHMENT_TYPES, 'attachment_type');
      const uid = userId(c);

      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = sniff(bytes);
      if (!mime) throw new AppError('UNSUPPORTED_FILE', 'Use a JPEG, PNG, HEIC photo or a PDF.', 415, [{ field: 'file', message: 'Unsupported type.' }]);
      const declared = (file.type || '').toLowerCase();
      const compatible = !declared || declared === 'application/octet-stream' || declared === mime || (mime === 'image/heic' && declared === 'image/heif') || (mime === 'image/jpeg' && declared === 'image/jpg');
      if (!compatible) throw new AppError('FILE_REJECTED', 'This file is not what it says it is.', 422, [{ field: 'file', message: `Declared ${declared}, contents are ${mime}.` }]);
      if (mime === 'application/pdf') {
        const bad = dangerousPdf(bytes);
        if (bad) throw new AppError('FILE_REJECTED', 'This PDF contains scripts or embedded files, so it cannot be stored. Save it as a plain PDF and try again.', 422, [{ field: 'file', message: `Contains ${bad}.` }]);
      }
      if (mime === 'image/jpeg' && jpegHasGps(bytes)) {
        throw new AppError('FILE_REJECTED', 'This photo still carries its location. Update the app and add it again.', 422, [{ field: 'file', message: 'GPS data present.' }]);
      }

      // Optional project and target: both resolved from the caller's own records.
      let projectId: string | null = null;
      let target: { type: Target; id: string } | null = null;
      if (form.target_type !== undefined && form.target_type !== '') {
        const type = oneOf(form.target_type, TARGET_TYPES, 'target_type');
        const id = String(form.target_id ?? '');
        projectId = (await resolveTarget(c, type, id)).projectId;
        target = { type, id: id.toLowerCase() };
      }
      if (form.project_id !== undefined && form.project_id !== '') {
        const pid = String(form.project_id);
        if (!isUuid(pid)) throw notFound('That project is not here.');
        if (projectId && projectId !== pid.toLowerCase()) throw notFound('That record is not in this project.');
        const p = await sqlOne(c, `SELECT 1 FROM hp__project WHERE id = $1::uuid AND owner_user_id = $2::text AND deleted_at IS NULL AND archived_at IS NULL`, [pid, uid]);
        if (!p) throw notFound('That project is not here.');
        projectId = pid.toLowerCase();
      }
      const limits = await limitsOf(c);
      if (target && (await linkCount(c, target.type, target.id)) >= limits.attachments_per_record) {
        throw new AppError('LIMIT_REACHED', `A record can hold up to ${limits.attachments_per_record} files.`, 409);
      }
      const used = await sqlOne<{ n: string }>(c, `SELECT coalesce(sum(size_bytes), 0)::text AS n FROM hp__attachment WHERE owner_user_id = $1::text AND deleted_at IS NULL`, [uid]);
      if (Number(used?.n ?? 0) + file.size > limits.attachment_bytes_per_user) throw new AppError('LIMIT_REACHED', 'Your file storage is full (5 GB). Delete files you no longer need.', 409);

      const id = uuid();
      const owner = (await sha256(`owner:${uid}`)).slice(0, 20);
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('');
      const key = `att/${owner}/${id}-${nonce}.bin`;
      const digest = await sha256Bytes(bytes);
      await sdk(c).storage.upload(await seal(c, id, bytes), key, { contentType: 'application/octet-stream', bucket: fileBucket(env(c)) });
      // A display label only; downloads are named by type and id, never by this.
      const label = typeof file.name === 'string' ? file.name.replace(/[^\w .()-]+/g, '_').slice(0, 120) || null : null;
      try {
        await sql(
          c,
          `INSERT INTO hp__attachment (id, owner_user_id, project_id, storage_key, mime, size_bytes, sha256, original_name, scan_status, attachment_type)
           VALUES ($1::uuid, $2::text, $3::uuid, $4::text, $5::text, $6::int, $7::text, $8::text, 'clean', $9::text)`,
          [id, uid, projectId, key, mime, file.size, digest, label, kind],
        );
        if (target) {
          await sql(
            c,
            `INSERT INTO hp__attachment_link (id, owner_user_id, attachment_id, project_id, target_type, target_id) VALUES ($1::uuid, $2::text, $3::uuid, $4::uuid, $5::text, $6::uuid)`,
            [uuid(), uid, id, projectId, target.type, target.id],
          );
        }
      } catch (error) {
        await deleteStored(c, key).catch(() => undefined);
        throw error;
      }
      const row = await sqlOne<Record<string, unknown>>(c, `SELECT ${COLUMNS} FROM hp__attachment a WHERE a.id = $1::uuid`, [id]);
      return created(c, present(row!));
    });

    app.post('/attachments/:attachmentId/links', ...paid, async (c) => {
      const b = await body(c);
      const uid = userId(c);
      const id = c.req.param('attachmentId');
      if (!isUuid(id)) throw notFound('That file is not here.');
      const a = await sqlOne<{ project_id: string | null }>(c, `SELECT project_id FROM hp__attachment WHERE id = $1::uuid AND owner_user_id = $2::text AND deleted_at IS NULL`, [id, uid]);
      if (!a) throw notFound('That file is not here.');
      const type = oneOf(b.target_type, TARGET_TYPES, 'target_type');
      const targetId = String(b.target_id ?? '');
      const { projectId } = await resolveTarget(c, type, targetId);
      if (a.project_id && projectId && a.project_id !== projectId) throw notFound('That record is not in the same project as the file.');
      const limits = await limitsOf(c);
      if ((await linkCount(c, type, targetId)) >= limits.attachments_per_record) throw new AppError('LIMIT_REACHED', `A record can hold up to ${limits.attachments_per_record} files.`, 409);
      await sql(
        c,
        `INSERT INTO hp__attachment_link (id, owner_user_id, attachment_id, project_id, target_type, target_id) VALUES ($1::uuid, $2::text, $3::uuid, $4::uuid, $5::text, $6::uuid)
         ON CONFLICT (attachment_id, target_type, target_id) DO NOTHING`,
        [uuid(), uid, id, projectId ?? a.project_id, type, targetId.toLowerCase()],
      );
      return ok(c, { linked: true });
    });

    app.get('/attachments', ...paid, async (c) => {
      const uid = userId(c);
      const type = c.req.query('target_type');
      const targetId = c.req.query('target_id');
      if (type || targetId) {
        const t = oneOf(type, TARGET_TYPES, 'target_type');
        await resolveTarget(c, t, targetId ?? '');
        return ok(
          c,
          (
            await sql<Record<string, unknown>>(
              c,
              `SELECT ${COLUMNS} FROM hp__attachment a JOIN hp__attachment_link l ON l.attachment_id = a.id
               WHERE a.owner_user_id = $1::text AND a.deleted_at IS NULL AND l.target_type = $2::text AND l.target_id = $3::uuid ORDER BY a.created_at`,
              [uid, t, targetId],
            )
          ).map(present),
        );
      }
      const pid = c.req.query('project_id');
      return ok(
        c,
        (
          await sql<Record<string, unknown>>(
            c,
            `SELECT ${COLUMNS} FROM hp__attachment a WHERE a.owner_user_id = $1::text AND a.deleted_at IS NULL AND ($2::uuid IS NULL OR a.project_id = $2::uuid)
             ORDER BY a.created_at DESC LIMIT 200`,
            [uid, pid && isUuid(pid) ? pid : null],
          )
        ).map(present),
      );
    });

    app.get('/attachments/:attachmentId/download-url', ...account, async (c) => {
      const id = c.req.param('attachmentId');
      if (!isUuid(id)) throw notFound('That file is not here.');
      const a = await sqlOne(c, `SELECT 1 FROM hp__attachment WHERE id = $1::uuid AND owner_user_id = $2::text AND deleted_at IS NULL AND scan_status = 'clean'`, [id, userId(c)]);
      if (!a) throw notFound('That file is not here.');
      return ok(c, await signedUrl(c, id));
    });

    /** No bearer: the signature IS the authorisation, for ten minutes, for this one file. */
    app.get('/files/:attachmentId', rateLimit(120), async (c) => {
      const id = c.req.param('attachmentId');
      const exp = Number(c.req.query('exp') ?? 0);
      const sig = c.req.query('sig') ?? '';
      const now = Math.floor(Date.now() / 1000);
      const denied = () => new AppError('LINK_EXPIRED', 'This download link has expired. Open the file again in the app.', 403);
      if (!isUuid(id) || !Number.isInteger(exp) || exp < now || exp > now + DOWNLOAD_TTL_SECONDS + 5 || !/^[0-9a-f]{64}$/.test(sig)) throw denied();
      if (!safeEqual(await hmac(await serverKey(c, 'download'), `file.${id}.${exp}`), sig)) throw denied();
      const a = await sqlOne<{ storage_key: string; mime: Mime; attachment_type: string }>(
        c,
        `SELECT storage_key, mime, attachment_type FROM hp__attachment WHERE id = $1::uuid AND deleted_at IS NULL AND scan_status = 'clean'`,
        [id],
      );
      if (!a) throw notFound('That file is not here.');
      const link = await sdk(c).storage.download(a.storage_key, { bucket: fileBucket(env(c)), expiresInSeconds: 60 });
      const res = await fetch(`${link.url}${link.url.includes('?') ? '&' : '?'}v=${id}`);
      if (!res.ok) throw new AppError('UPSTREAM_UNAVAILABLE', 'The file could not be fetched right now. Try again in a moment.', 503, undefined, true);
      const plain = await unseal(c, id, new Uint8Array(await res.arrayBuffer()));
      return new Response(plain, {
        headers: {
          'content-type': a.mime,
          'content-disposition': `attachment; filename="houseplan-${a.attachment_type}-${id.slice(0, 8)}.${EXT[a.mime]}"`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    });

    app.delete('/attachments/:attachmentId', ...account, async (c) => {
      const id = c.req.param('attachmentId');
      const uid = userId(c);
      if (!isUuid(id)) throw notFound('That file is not here.');
      const a = await sqlOne<{ storage_key: string }>(c, `SELECT storage_key FROM hp__attachment WHERE id = $1::uuid AND owner_user_id = $2::text AND deleted_at IS NULL`, [id, uid]);
      if (!a) throw notFound('That file is not here.');
      // BRD §6.9: financial evidence is never deleted while it backs a posted record.
      const locked = await sqlOne(
        c,
        `SELECT 1 FROM hp__attachment_link l
         LEFT JOIN hp__cost_record cr ON l.target_type = 'cost' AND cr.id = l.target_id
         LEFT JOIN hp__payment pm ON l.target_type = 'payment' AND pm.id = l.target_id
         LEFT JOIN hp__quote q ON l.target_type = 'quote' AND q.id = l.target_id
         WHERE l.attachment_id = $1::uuid AND (cr.status IN ('posted','void') OR pm.status IN ('posted','void') OR q.status IN ('accepted','part_accepted'))
         LIMIT 1`,
        [id],
      );
      if (locked) throw new AppError('EVIDENCE_LOCKED', 'This file is evidence for a posted record or an accepted quote, so it is kept.', 409);
      await sql(c, `DELETE FROM hp__attachment_link WHERE attachment_id = $1::uuid`, [id]);
      await sql(c, `UPDATE hp__attachment SET deleted_at = now() WHERE id = $1::uuid`, [id]);
      await deleteStored(c, a.storage_key).catch((e) => console.error('storage delete failed:', e instanceof Error ? e.message : e));
      await audit(c, { action: 'attachment.delete', entity_type: 'attachment', entity_id: id, summary: 'File deleted' });
      return ok(c, { deleted: true });
    });
  },
});
