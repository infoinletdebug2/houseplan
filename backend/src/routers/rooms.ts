import type { Context } from 'hono';
import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';
import {
  AppError,
  allowOnly,
  audit,
  body,
  created,
  decimal,
  fn,
  ifMatch,
  integer,
  notFound,
  ok,
  oneOf,
  optionalBody,
  proj,
  requiredText,
  sql,
  sqlOne,
  text,
  uuid,
  uuidField,
  versionConflict,
} from '../lib';
import { idempotency, requireActive, requirePaid, requireProject, requireVerified } from '../middleware';
import { ROOM_TYPES } from '../catalogue';
import { roomGeometry } from '../logic/calc';
import { dec, loadRooms } from '../views';
import { limitsOf } from './projects';

/**
 * Rooms, openings and geometry (CONTRACT §5, BRD §6.3). Dimensions are
 * stored in metres (the app converts imperial entry). A geometry change bumps
 * `geometry_revision` and flags dependent DRAFT lines stale; frozen revisions
 * and saved calculations are never rewritten (AC13).
 */

const DIMS = ['length_m', 'width_m', 'height_m', 'manual_floor_area_m2', 'manual_wall_area_m2', 'manual_perimeter_m'] as const;
const BOUNDS: Record<(typeof DIMS)[number], number> = {
  length_m: 100,
  width_m: 100,
  height_m: 20,
  manual_floor_area_m2: 10000,
  manual_wall_area_m2: 20000,
  manual_perimeter_m: 1000,
};
const ROOM_FIELDS = ['name', 'room_type', 'storey_index', ...DIMS, 'measurement_source', 'note'] as const;

async function oneRoom(c: Context, roomId: string) {
  const [room] = await loadRooms(c, proj(c).id, roomId);
  if (!room) throw notFound('That room is not here.');
  return room;
}

/** Throws a 422 CalcError when openings exceed a surface or cut-outs exceed the floor (BRD §6.3 validation). */
function validateGeometry(room: { [k in (typeof DIMS)[number]]?: string | null }, openings: Array<{ opening_type: 'door' | 'window' | 'floor_cutout'; width_m: string | null; height_m: string | null; floor_cutout_area_m2: string | null; count: number }>) {
  roomGeometry({
    length_m: room.length_m ?? null,
    width_m: room.width_m ?? null,
    height_m: room.height_m ?? null,
    manual_floor_area_m2: room.manual_floor_area_m2 ?? null,
    manual_wall_area_m2: room.manual_wall_area_m2 ?? null,
    manual_perimeter_m: room.manual_perimeter_m ?? null,
    openings,
  });
}

async function geometryChanged(c: Context, roomId: string, reason: string): Promise<number> {
  await sql(c, `UPDATE hp__room SET geometry_revision = geometry_revision + 1, updated_at = now() WHERE project_id = $1::uuid AND id = $2::uuid`, [proj(c).id, roomId]);
  const r = await fn<{ stale_lines: number }>(c, 'hp_mark_stale', { project_id: proj(c).id, room_id: roomId, reason });
  return Number(r.stale_lines ?? 0);
}

function parseOpening(b: Record<string, unknown>, current?: { opening_type: string; wall_label: string | null; width_m: string | null; height_m: string | null; floor_cutout_area_m2: string | null; count: number }) {
  const type = b.opening_type === undefined && current ? (current.opening_type as 'door' | 'window' | 'floor_cutout') : oneOf(b.opening_type, ['door', 'window', 'floor_cutout'] as const, 'opening_type');
  const pick = (k: 'width_m' | 'height_m' | 'floor_cutout_area_m2', max: number) => (b[k] === undefined && current ? current[k] : decimal(b[k], k, { positive: true, max }));
  const o = {
    opening_type: type,
    wall_label: b.wall_label === undefined && current ? current.wall_label : text(b.wall_label, 'wall_label', { max: 64 }),
    width_m: type === 'floor_cutout' ? null : pick('width_m', 20),
    height_m: type === 'floor_cutout' ? null : pick('height_m', 20),
    floor_cutout_area_m2: type === 'floor_cutout' ? pick('floor_cutout_area_m2', 10000) : null,
    count: b.count === undefined && current ? current.count : integer(b.count ?? 1, 'count', { min: 1, max: 99 })!,
  };
  if (type === 'floor_cutout' && !o.floor_cutout_area_m2) throw new AppError('VALIDATION_ERROR', 'Enter the cut-out area.', 400, [{ field: 'floor_cutout_area_m2', message: 'Required.' }]);
  if (type !== 'floor_cutout' && (!o.width_m || !o.height_m)) throw new AppError('VALIDATION_ERROR', 'Enter the width and height.', 400, [{ field: o.width_m ? 'height_m' : 'width_m', message: 'Required.' }]);
  return o;
}

export const roomsRouter = defineRouter({
  name: 'rooms',

  build(app, { requireAuth }) {
    app.onError(handleError);
    const project = [requireAuth, requireActive, requireVerified, requirePaid, requireProject] as const;

    app.get('/projects/:id/rooms', ...project, async (c) => ok(c, await loadRooms(c, proj(c).id)));

    async function assertRoomLimit(c: Context) {
      const limit = (await limitsOf(c)).rooms_per_project;
      const row = await sqlOne<{ n: number }>(c, `SELECT count(*)::int AS n FROM hp__room WHERE project_id = $1::uuid AND deleted_at IS NULL`, [proj(c).id]);
      if (Number(row?.n ?? 0) >= limit) throw new AppError('LIMIT_REACHED', `A project can hold ${limit} rooms.`, 409);
    }

    app.post('/projects/:id/rooms', ...project, idempotency, async (c) => {
      const b = await body(c);
      allowOnly(b, [...ROOM_FIELDS]);
      await assertRoomLimit(c);
      const dims: Record<string, string | null> = {};
      for (const k of DIMS) dims[k] = decimal(b[k], k, { positive: true, max: BOUNDS[k] });
      validateGeometry(dims, []);
      const id = uuid();
      await sql(
        c,
        `INSERT INTO hp__room (id, project_id, storey_index, name, room_type, length_m, width_m, height_m, manual_floor_area_m2, manual_wall_area_m2, manual_perimeter_m, measurement_source, note)
         VALUES ($1::uuid, $2::uuid, $3::smallint, $4::text, $5::text, $6::numeric, $7::numeric, $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12::text, $13::text)`,
        [
          id,
          proj(c).id,
          integer(b.storey_index ?? 0, 'storey_index', { min: -3, max: 20 }),
          requiredText(b.name, 'name', 80),
          oneOf(b.room_type, ROOM_TYPES, 'room_type', 'other'),
          dims.length_m,
          dims.width_m,
          dims.height_m,
          dims.manual_floor_area_m2,
          dims.manual_wall_area_m2,
          dims.manual_perimeter_m,
          oneOf(b.measurement_source, ['measured', 'manual', 'assumed'] as const, 'measurement_source', dims.manual_floor_area_m2 || dims.manual_wall_area_m2 ? 'manual' : 'measured'),
          text(b.note, 'note', { max: 500 }),
        ],
      );
      return created(c, await oneRoom(c, id));
    });

    app.post('/projects/:id/rooms/:roomId/duplicate', ...project, idempotency, async (c) => {
      const b = await optionalBody(c);
      allowOnly(b, ['name']);
      await assertRoomLimit(c);
      const src = await oneRoom(c, uuidField(c.req.param('roomId'), 'room_id')!);
      const id = uuid();
      await sql(
        c,
        `INSERT INTO hp__room (id, project_id, storey_index, name, room_type, length_m, width_m, height_m, manual_floor_area_m2, manual_wall_area_m2, manual_perimeter_m, measurement_source, note)
         SELECT $1::uuid, project_id, storey_index, $3::text, room_type, length_m, width_m, height_m, manual_floor_area_m2, manual_wall_area_m2, manual_perimeter_m, measurement_source, note
         FROM hp__room WHERE project_id = $2::uuid AND id = $4::uuid`,
        [id, proj(c).id, text(b.name, 'name', { max: 80 }) ?? `${src.name} (copy)`.slice(0, 80), src.id],
      );
      await sql(
        c,
        `INSERT INTO hp__room_opening (id, project_id, room_id, opening_type, wall_label, width_m, height_m, floor_cutout_area_m2, count)
         SELECT gen_random_uuid(), project_id, $3::uuid, opening_type, wall_label, width_m, height_m, floor_cutout_area_m2, count FROM hp__room_opening WHERE project_id = $1::uuid AND room_id = $2::uuid`,
        [proj(c).id, src.id, id],
      );
      return created(c, await oneRoom(c, id));
    });

    app.patch('/projects/:id/rooms/:roomId', ...project, async (c) => {
      const b = await body(c);
      const expected = ifMatch(c, b);
      allowOnly(b, [...ROOM_FIELDS, 'expected_version']);
      const cur = await oneRoom(c, uuidField(c.req.param('roomId'), 'room_id')!);
      const dims: Record<string, string | null> = {};
      let geometryTouched = false;
      for (const k of DIMS) {
        if (b[k] === undefined) dims[k] = cur[k];
        else {
          dims[k] = decimal(b[k], k, { positive: true, max: BOUNDS[k] });
          if (dims[k] !== cur[k] && dec(dims[k]) !== cur[k]) geometryTouched = true;
        }
      }
      validateGeometry(dims, cur.openings);
      const row = await sqlOne(
        c,
        `UPDATE hp__room SET name = $4::text, room_type = $5::text, storey_index = $6::smallint, length_m = $7::numeric, width_m = $8::numeric, height_m = $9::numeric,
           manual_floor_area_m2 = $10::numeric, manual_wall_area_m2 = $11::numeric, manual_perimeter_m = $12::numeric, measurement_source = $13::text, note = $14::text,
           version = version + 1, updated_at = now()
         WHERE project_id = $1::uuid AND id = $2::uuid AND version = $3::int AND deleted_at IS NULL RETURNING id`,
        [
          proj(c).id,
          cur.id,
          expected,
          b.name === undefined ? cur.name : requiredText(b.name, 'name', 80),
          b.room_type === undefined ? cur.room_type : oneOf(b.room_type, ROOM_TYPES, 'room_type'),
          b.storey_index === undefined ? cur.storey_index : integer(b.storey_index, 'storey_index', { required: true, min: -3, max: 20 }),
          dims.length_m,
          dims.width_m,
          dims.height_m,
          dims.manual_floor_area_m2,
          dims.manual_wall_area_m2,
          dims.manual_perimeter_m,
          b.measurement_source === undefined ? cur.measurement_source : oneOf(b.measurement_source, ['measured', 'manual', 'assumed'] as const, 'measurement_source'),
          b.note === undefined ? cur.note : text(b.note, 'note', { max: 500 }),
        ],
      );
      if (!row) throw versionConflict();
      const stale = geometryTouched ? await geometryChanged(c, cur.id, `${cur.name} measurements changed`) : 0;
      return ok(c, await oneRoom(c, cur.id), 200, { stale_lines: stale });
    });

    /**
     * A room still referenced by a saved revision or calculation is hidden,
     * never erased, so history keeps its meaning; draft lines that use it are
     * flagged stale. An unused room is removed with its openings.
     */
    app.delete('/projects/:id/rooms/:roomId', ...project, async (c) => {
      const b = await optionalBody(c);
      const expected = ifMatch(c, b);
      const cur = await oneRoom(c, uuidField(c.req.param('roomId'), 'room_id')!);
      if (cur.version !== expected) throw versionConflict();
      const used = await sqlOne<{ n: number }>(
        c,
        `SELECT ((SELECT count(*) FROM hp__estimate_line WHERE project_id = $1::uuid AND room_id = $2::uuid)
               + (SELECT count(*) FROM hp__calculation WHERE project_id = $1::uuid AND room_id = $2::uuid))::int AS n`,
        [proj(c).id, cur.id],
      );
      if (Number(used?.n ?? 0) > 0) {
        await sql(c, `UPDATE hp__room SET deleted_at = now(), version = version + 1, updated_at = now() WHERE project_id = $1::uuid AND id = $2::uuid`, [proj(c).id, cur.id]);
        const stale = await fn<{ stale_lines: number }>(c, 'hp_mark_stale', { project_id: proj(c).id, room_id: cur.id, reason: `${cur.name} was removed` });
        await audit(c, { project_id: proj(c).id, action: 'room.hide', entity_type: 'room', entity_id: cur.id, summary: `Removed ${cur.name}; kept for saved estimates.` });
        return ok(c, { deleted: true, hidden: true }, 200, { stale_lines: Number(stale.stale_lines ?? 0) });
      }
      await sql(c, `DELETE FROM hp__room_opening WHERE project_id = $1::uuid AND room_id = $2::uuid`, [proj(c).id, cur.id]);
      await sql(c, `DELETE FROM hp__room WHERE project_id = $1::uuid AND id = $2::uuid`, [proj(c).id, cur.id]);
      return ok(c, { deleted: true, hidden: false });
    });

    /* ── openings ─────────────────────────────────────────────────────── */

    app.post('/projects/:id/rooms/:roomId/openings', ...project, idempotency, async (c) => {
      const b = await body(c);
      allowOnly(b, ['opening_type', 'wall_label', 'width_m', 'height_m', 'floor_cutout_area_m2', 'count']);
      const cur = await oneRoom(c, uuidField(c.req.param('roomId'), 'room_id')!);
      if (cur.openings.length >= 60) throw new AppError('LIMIT_REACHED', 'A room can hold 60 openings.', 409);
      const o = parseOpening(b);
      validateGeometry(cur, [...cur.openings, o]);
      await sql(
        c,
        `INSERT INTO hp__room_opening (id, project_id, room_id, opening_type, wall_label, width_m, height_m, floor_cutout_area_m2, count)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::numeric, $7::numeric, $8::numeric, $9::smallint)`,
        [uuid(), proj(c).id, cur.id, o.opening_type, o.wall_label, o.width_m, o.height_m, o.floor_cutout_area_m2, o.count],
      );
      const stale = await geometryChanged(c, cur.id, `${cur.name} openings changed`);
      return created(c, await oneRoom(c, cur.id), { stale_lines: stale });
    });

    app.patch('/projects/:id/rooms/:roomId/openings/:openingId', ...project, async (c) => {
      const b = await body(c);
      const expected = ifMatch(c, b);
      allowOnly(b, ['opening_type', 'wall_label', 'width_m', 'height_m', 'floor_cutout_area_m2', 'count', 'expected_version']);
      const cur = await oneRoom(c, uuidField(c.req.param('roomId'), 'room_id')!);
      const openingId = uuidField(c.req.param('openingId'), 'opening_id')!;
      const existing = cur.openings.find((o) => o.id === openingId);
      if (!existing) throw notFound('That opening is not here.');
      const o = parseOpening(b, existing);
      validateGeometry(cur, cur.openings.map((x) => (x.id === openingId ? { ...o } : x)));
      const row = await sqlOne(
        c,
        `UPDATE hp__room_opening SET opening_type = $5::text, wall_label = $6::text, width_m = $7::numeric, height_m = $8::numeric, floor_cutout_area_m2 = $9::numeric, count = $10::smallint,
           version = version + 1, updated_at = now() WHERE project_id = $1::uuid AND room_id = $2::uuid AND id = $3::uuid AND version = $4::int RETURNING id`,
        [proj(c).id, cur.id, openingId, expected, o.opening_type, o.wall_label, o.width_m, o.height_m, o.floor_cutout_area_m2, o.count],
      );
      if (!row) throw versionConflict();
      const stale = await geometryChanged(c, cur.id, `${cur.name} openings changed`);
      return ok(c, await oneRoom(c, cur.id), 200, { stale_lines: stale });
    });

    app.delete('/projects/:id/rooms/:roomId/openings/:openingId', ...project, async (c) => {
      const cur = await oneRoom(c, uuidField(c.req.param('roomId'), 'room_id')!);
      const openingId = uuidField(c.req.param('openingId'), 'opening_id')!;
      const row = await sqlOne(c, `DELETE FROM hp__room_opening WHERE project_id = $1::uuid AND room_id = $2::uuid AND id = $3::uuid RETURNING id`, [proj(c).id, cur.id, openingId]);
      if (!row) throw notFound('That opening is not here.');
      const stale = await geometryChanged(c, cur.id, `${cur.name} openings changed`);
      return ok(c, await oneRoom(c, cur.id), 200, { stale_lines: stale });
    });
  },
});
