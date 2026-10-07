import type { Context } from 'hono';
import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';
import {
  AppError,
  allowOnly,
  audit,
  body,
  created,
  dateField,
  decimal,
  fn,
  ifMatch,
  integer,
  invalid,
  isUuid,
  minor,
  notFound,
  ok,
  oneOf,
  optionalBody,
  proj,
  requiredText,
  sql,
  sqlOne,
  text,
  userId,
  uuid,
  uuidField,
  versionConflict,
} from '../lib';
import { idempotency, profileOf, requireActive, requirePaid, requireProject, requireVerified } from '../middleware';
import { CATEGORIES, DEFAULT_CONTINGENCY_CODES, PHASES, STARTER_LINES, type Inclusion, type ProjectType } from '../catalogue';
import { DEFAULT_LIMITS, PROJECT_RECOVERY_DAYS, type Limits } from '../config';
import { CATEGORY_COLUMNS, PHASE_COLUMNS, PROJECT_COLUMNS, PROJECT_FROM, categoryView, loadProject, phaseView, projectView } from '../views';
import { requireActionToken } from './auth';

/**
 * Projects, the scope checklist and build phases (CONTRACT §4, BRD §6.1,
 * §6.2, §6.10). All projects belong to one user; the project is resolved
 * from (path id, caller) on every request by `requireProject`.
 */

/** Configuration-backed limits (BRD §2.2): code defaults, overridable by the operator in hp__app_config 'limits'. */
export async function limitsOf(c: Context): Promise<Limits> {
  const memo = c.get('hp:limits' as never) as Limits | undefined;
  if (memo) return memo;
  const row = await sqlOne<{ value: unknown }>(c, `SELECT value::text AS value FROM hp__app_config WHERE key = 'limits'`).catch(() => null);
  const override = row?.value && typeof row.value === 'object' ? (row.value as Partial<Limits>) : {};
  const limits = { ...DEFAULT_LIMITS, ...override };
  c.set('hp:limits' as never, limits as never);
  return limits;
}

async function activeCount(c: Context, owner: string): Promise<number> {
  const row = await sqlOne<{ n: number }>(c, `SELECT count(*)::int AS n FROM hp__project WHERE owner_user_id = $1::text AND deleted_at IS NULL AND archived_at IS NULL`, [owner]);
  return Number(row?.n ?? 0);
}

async function assertUnderProjectLimit(c: Context, owner: string): Promise<void> {
  const limit = (await limitsOf(c)).active_projects;
  if ((await activeCount(c, owner)) >= limit) {
    throw new AppError('LIMIT_REACHED', `You already have ${limit} active projects. Archive one to start another.`, 409);
  }
}

const TYPES = ['new_build', 'extension', 'renovation'] as const;
const TIERS = ['economical', 'standard', 'premium'] as const;
const COVERS = ['new-build', 'extension', 'renovation', 'modern', 'cottage', 'townhouse'] as const;

async function checkCurrency(c: Context, code: string, field = 'currency'): Promise<string> {
  const cur = code.toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur) || !(await sqlOne(c, `SELECT 1 FROM hp__currency WHERE code = $1::char(3)`, [cur]))) {
    throw invalid('That currency is not supported.', field, 'Unsupported currency.');
  }
  return cur;
}

function countryCode(v: unknown): string {
  const cc = requiredText(v, 'country_code', 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) throw invalid('Use a two-letter country code.', 'country_code', 'Two letters, e.g. US.');
  return cc;
}

async function checkRegion(c: Context, regionId: unknown, country: string): Promise<string | null> {
  const id = uuidField(regionId, 'region_id', false);
  if (!id) return null;
  const row = await sqlOne(c, `SELECT 1 FROM hp__region WHERE id = $1::uuid AND country_code = $2::char(2) AND active`, [id, country]);
  if (!row) throw invalid('That region is not in this country.', 'region_id', 'Unknown region.');
  return id;
}

function datesInOrder(start: string | null, end: string | null) {
  if (start && end && end < start) throw invalid('The finish date must be after the start date.', 'planned_end', 'Before the start.');
}

const PROJECT_FIELDS = [
  'name', 'type', 'country_code', 'region_id', 'postal_code', 'private_address', 'currency', 'unit_system', 'price_entry', 'area_m2', 'storeys',
  'target_budget_minor', 'planned_start', 'planned_end', 'finish_tier', 'cover',
] as const;

async function recalcDrafts(c: Context, projectId: string) {
  await sql(c, `SELECT hp_recalc_revision(id) FROM hp__estimate_revision WHERE project_id = $1::uuid AND status = 'draft'`, [projectId]);
}

export const projectsRouter = defineRouter({
  name: 'projects',

  build(app, { requireAuth }) {
    app.onError(handleError);
    const paid = [requireAuth, requireActive, requireVerified, requirePaid] as const;
    const project = [...paid, requireProject] as const;

    /* ── list and create ──────────────────────────────────────────────── */

    app.get('/projects', ...paid, async (c) => {
      const status = oneOf(c.req.query('status'), ['active', 'archived', 'deleted'] as const, 'status', 'active');
      const q = (c.req.query('q') ?? '').trim().slice(0, 80);
      const where =
        status === 'active'
          ? 'p.deleted_at IS NULL AND p.archived_at IS NULL'
          : status === 'archived'
            ? 'p.deleted_at IS NULL AND p.archived_at IS NOT NULL'
            : 'p.deleted_at IS NOT NULL AND p.purge_after > now()';
      const rows = await sql<Record<string, unknown>>(
        c,
        `SELECT ${PROJECT_COLUMNS} FROM ${PROJECT_FROM} WHERE p.owner_user_id = $1::text AND ${where} AND ($2::text = '' OR p.name ILIKE '%' || $2::text || '%')
         ORDER BY p.updated_at DESC, p.id LIMIT 100`,
        [userId(c), q],
      );
      const limits = await limitsOf(c);
      return ok(c, rows.map(projectView), 200, { limits: { active_projects: limits.active_projects, used: await activeCount(c, userId(c)) } });
    });

    app.post('/projects', ...paid, idempotency, async (c) => {
      const b = await body(c);
      allowOnly(b, [...PROJECT_FIELDS, 'inclusions']);
      const uid = userId(c);
      await assertUnderProjectLimit(c, uid);
      const name = requiredText(b.name, 'name', 80);
      const type = oneOf(b.type, TYPES, 'type') as ProjectType;
      const country = countryCode(b.country_code);
      const region = await checkRegion(c, b.region_id, country);
      const currency = await checkCurrency(c, requiredText(b.currency, 'currency', 3));
      const unitSystem = oneOf(b.unit_system, ['metric', 'imperial'] as const, 'unit_system');
      const priceEntry = oneOf(b.price_entry, ['exclusive', 'inclusive'] as const, 'price_entry', profileOf(c).price_entry);
      const area = decimal(b.area_m2, 'area_m2', { positive: true, max: 100000 });
      const storeys = integer(b.storeys, 'storeys', { required: true, min: 1, max: 20 })!;
      const target = minor(b.target_budget_minor, 'target_budget_minor');
      const start = dateField(b.planned_start, 'planned_start', false);
      const end = dateField(b.planned_end, 'planned_end', false);
      datesInOrder(start, end);
      const tier = oneOf(b.finish_tier, TIERS, 'finish_tier', 'standard');
      const cover = oneOf(b.cover, COVERS, 'cover', type === 'new_build' ? 'new-build' : type);
      const overrides = (b.inclusions ?? {}) as Record<string, unknown>;
      if (typeof overrides !== 'object' || Array.isArray(overrides)) throw invalid('Inclusions must map category codes to a choice.', 'inclusions');
      for (const [code, v] of Object.entries(overrides)) {
        if (!CATEGORIES.some((d) => d.code === code)) throw invalid(`Unknown category ${code}.`, 'inclusions');
        oneOf(v, ['included', 'excluded', 'undecided'] as const, 'inclusions');
      }
      const id = uuid();
      await fn(c, 'hp_create_project', {
        id,
        owner_user_id: uid,
        name,
        type,
        country_code: country,
        region_id: region,
        postal_code: text(b.postal_code, 'postal_code', { max: 20 }),
        private_address: text(b.private_address, 'private_address', { max: 300 }),
        currency,
        unit_system: unitSystem,
        price_entry: priceEntry,
        area_m2: area,
        storeys,
        target_budget_minor: target,
        planned_start: start,
        planned_end: end,
        finish_tier: tier,
        cover,
        categories: CATEGORIES.map((d, i) => ({ code: d.code, name: d.name, inclusion: (overrides[d.code] as Inclusion | undefined) ?? d.defaults[type], order: i + 1 })),
        phases: PHASES.map((p, i) => ({ name: p.name, code: p.code, order: i + 1 })),
        lines: STARTER_LINES[type].map((l, i) => ({ code: l.code, label: l.label, note: l.note, order: (i + 1) * 10 })),
        contingency_codes: DEFAULT_CONTINGENCY_CODES,
      });
      await sql(c, `UPDATE hp__profile SET last_project_id = $2::uuid, updated_at = now() WHERE user_id = $1::text`, [uid, id]);
      await audit(c, { project_id: id, action: 'project.create', entity_type: 'project', entity_id: id, summary: `Created project ${name}.` });
      return created(c, await loadProject(c, id, uid, { withAddress: true }));
    });

    /* ── one project ──────────────────────────────────────────────────── */

    app.get('/projects/:id', ...project, async (c) => ok(c, await loadProject(c, proj(c).id, userId(c), { withAddress: true })));

    app.patch('/projects/:id', ...project, async (c) => {
      const b = await body(c);
      const expected = ifMatch(c, b);
      allowOnly(b, [...PROJECT_FIELDS, 'expected_version']);
      const p = proj(c);
      const sets: string[] = [];
      const params: unknown[] = [p.id, expected];
      const set = (col: string, value: unknown, cast: string) => {
        params.push(value);
        sets.push(`${col} = $${params.length}::${cast}`);
      };
      if (b.name !== undefined) set('name', requiredText(b.name, 'name', 80), 'text');
      if (b.type !== undefined) set('type', oneOf(b.type, TYPES, 'type'), 'text');
      let country = p.countryCode;
      if (b.country_code !== undefined) {
        country = countryCode(b.country_code);
        set('country_code', country, 'char(2)');
      }
      if (b.region_id !== undefined) set('region_id', await checkRegion(c, b.region_id, country), 'uuid');
      else if (b.country_code !== undefined && country !== p.countryCode) set('region_id', null, 'uuid');
      if (b.postal_code !== undefined) set('postal_code', text(b.postal_code, 'postal_code', { max: 20 }), 'text');
      if (b.private_address !== undefined) set('private_address', text(b.private_address, 'private_address', { max: 300 }), 'text');
      if (b.currency !== undefined) {
        const cur = await checkCurrency(c, requiredText(b.currency, 'currency', 3));
        if (cur !== p.currency) {
          if (p.currencyLocked) {
            throw new AppError(
              'CURRENCY_LOCKED',
              'The currency is locked because money is already recorded in it. Duplicate the project into a new currency instead.',
              409,
              [{ field: 'currency', message: 'Locked after the first posted money.' }],
            );
          }
          set('currency', cur, 'char(3)');
        }
      }
      if (b.unit_system !== undefined) set('unit_system', oneOf(b.unit_system, ['metric', 'imperial'] as const, 'unit_system'), 'text');
      if (b.price_entry !== undefined) set('price_entry', oneOf(b.price_entry, ['exclusive', 'inclusive'] as const, 'price_entry'), 'text');
      if (b.area_m2 !== undefined) set('area_m2', decimal(b.area_m2, 'area_m2', { positive: true, max: 100000 }), 'numeric');
      if (b.storeys !== undefined) set('storeys', integer(b.storeys, 'storeys', { required: true, min: 1, max: 20 }), 'smallint');
      if (b.target_budget_minor !== undefined) set('target_budget_minor', minor(b.target_budget_minor, 'target_budget_minor'), 'bigint');
      if (b.planned_start !== undefined) set('planned_start', dateField(b.planned_start, 'planned_start', false), 'date');
      if (b.planned_end !== undefined) set('planned_end', dateField(b.planned_end, 'planned_end', false), 'date');
      if (b.finish_tier !== undefined) set('finish_tier', oneOf(b.finish_tier, TIERS, 'finish_tier'), 'text');
      if (b.cover !== undefined) set('cover', oneOf(b.cover, COVERS, 'cover'), 'text');
      if (sets.length) {
        const row = await sqlOne<{ id: string; planned_start: string | null; planned_end: string | null }>(
          c,
          `UPDATE hp__project SET ${sets.join(', ')}, version = version + 1, updated_at = now() WHERE id = $1::uuid AND version = $2::int
           RETURNING id, planned_start::text AS planned_start, planned_end::text AS planned_end`,
          params,
        ).catch((e) => {
          if (e instanceof AppError && e.code === 'DOMAIN_RULE') throw invalid('The finish date must be after the start date.', 'planned_end');
          throw e;
        });
        if (!row) throw versionConflict();
        await audit(c, { project_id: p.id, action: 'project.update', entity_type: 'project', entity_id: p.id, summary: `Updated ${Object.keys(b).filter((k) => k !== 'expected_version').join(', ')}.` });
      } else if (expected !== p.version) throw versionConflict();
      return ok(c, await loadProject(c, p.id, userId(c), { withAddress: true }));
    });

    /** BRD §6.1: re-authentication, confirmation and a 7-day recovery window before purge. */
    app.delete('/projects/:id', ...project, async (c) => {
      const b = await optionalBody(c);
      await requireActionToken(c, b.action_token);
      const expected = ifMatch(c, b);
      const p = proj(c);
      const row = await sqlOne<{ deleted_at: string; purge_after: string }>(
        c,
        `UPDATE hp__project SET deleted_at = now(), purge_after = now() + make_interval(days => $3::int), version = version + 1, updated_at = now()
         WHERE id = $1::uuid AND version = $2::int AND deleted_at IS NULL RETURNING deleted_at::text AS deleted_at, purge_after::text AS purge_after`,
        [p.id, expected, PROJECT_RECOVERY_DAYS],
      );
      if (!row) throw versionConflict();
      await sql(c, `UPDATE hp__profile SET last_project_id = NULL WHERE user_id = $1::text AND last_project_id = $2::uuid`, [userId(c), p.id]);
      await audit(c, { project_id: p.id, action: 'project.delete', entity_type: 'project', entity_id: p.id, summary: `Deleted ${p.name}; recoverable for ${PROJECT_RECOVERY_DAYS} days.` });
      return ok(c, row);
    });

    app.post('/projects/:id/restore', ...paid, async (c) => {
      const id = c.req.param('id');
      if (!isUuid(id)) throw notFound('That project is not here.');
      const uid = userId(c);
      const row = await sqlOne<{ id: string; archived_at: string | null }>(
        c,
        `SELECT id, archived_at::text AS archived_at FROM hp__project WHERE id = $1::uuid AND owner_user_id = $2::text AND deleted_at IS NOT NULL AND purge_after > now()`,
        [id, uid],
      );
      if (!row) throw notFound('That project can no longer be recovered.');
      if (!row.archived_at) await assertUnderProjectLimit(c, uid);
      await sql(c, `UPDATE hp__project SET deleted_at = NULL, purge_after = NULL, version = version + 1, updated_at = now() WHERE id = $1::uuid`, [id]);
      await audit(c, { project_id: id, action: 'project.restore', entity_type: 'project', entity_id: id, summary: 'Restored a deleted project.' });
      return ok(c, await loadProject(c, id, uid, { withAddress: true }));
    });

    app.post('/projects/:id/archive', ...project, async (c) => {
      const b = await body(c);
      allowOnly(b, ['archived']);
      if (typeof b.archived !== 'boolean') throw invalid('Expected archived true or false.', 'archived');
      const p = proj(c);
      if (!b.archived && p.archived) await assertUnderProjectLimit(c, userId(c));
      await sql(
        c,
        `UPDATE hp__project SET archived_at = CASE WHEN $2::boolean THEN coalesce(archived_at, now()) ELSE NULL END, version = version + 1, updated_at = now() WHERE id = $1::uuid`,
        [p.id, b.archived],
      );
      await audit(c, { project_id: p.id, action: b.archived ? 'project.archive' : 'project.unarchive', entity_type: 'project', entity_id: p.id, summary: b.archived ? 'Archived.' : 'Restored from the archive.' });
      return ok(c, await loadProject(c, p.id, userId(c), { withAddress: true }));
    });

    /** BRD §6.1: copies rooms, templates and a draft estimate — never payments, attachments or history. */
    app.post('/projects/:id/duplicate', ...project, idempotency, async (c) => {
      const b = await body(c);
      allowOnly(b, ['name', 'currency']);
      const uid = userId(c);
      await assertUnderProjectLimit(c, uid);
      const name = requiredText(b.name, 'name', 80);
      const currency = b.currency === undefined || b.currency === null ? undefined : await checkCurrency(c, requiredText(b.currency, 'currency', 3));
      const id = uuid();
      await fn(c, 'hp_duplicate_project', { source_id: proj(c).id, new_id: id, owner_user_id: uid, name, ...(currency ? { currency } : {}) });
      await audit(c, { project_id: id, action: 'project.duplicate', entity_type: 'project', entity_id: id, summary: `Duplicated from ${proj(c).name}.`, data: { source_id: proj(c).id } });
      return created(c, await loadProject(c, id, uid, { withAddress: true }));
    });

    /* ── scope checklist (BRD §6.2) ───────────────────────────────────── */

    app.get('/projects/:id/categories', ...project, async (c) => {
      const rows = await sql<Record<string, unknown>>(c, `SELECT ${CATEGORY_COLUMNS} FROM hp__project_category WHERE project_id = $1::uuid ORDER BY order_index`, [proj(c).id]);
      return ok(c, rows.map(categoryView));
    });

    app.patch('/projects/:id/categories', ...project, async (c) => {
      const b = await body(c);
      allowOnly(b, ['changes']);
      if (!Array.isArray(b.changes) || b.changes.length === 0 || b.changes.length > 19) throw invalid('Send the categories to change.', 'changes');
      const p = proj(c);
      // Validate everything first, then apply in one statement per row (each version-checked).
      const changes = b.changes.map((raw, i) => {
        const ch = (raw ?? {}) as Record<string, unknown>;
        allowOnly(ch, ['id', 'inclusion', 'note', 'display_name', 'expected_version']);
        return {
          id: uuidField(ch.id, `changes[${i}].id`)!,
          inclusion: ch.inclusion === undefined ? null : oneOf(ch.inclusion, ['included', 'excluded', 'undecided'] as const, 'inclusion'),
          note: ch.note === undefined ? undefined : text(ch.note, 'note', { max: 500 }),
          display_name: ch.display_name === undefined ? null : requiredText(ch.display_name, 'display_name', 80),
          expected: integer(ch.expected_version, 'expected_version', { required: true, min: 1 })!,
        };
      });
      for (const ch of changes) {
        const row = await sqlOne(
          c,
          `UPDATE hp__project_category SET inclusion = coalesce($3::text, inclusion), note = CASE WHEN $4::boolean THEN $5::text ELSE note END,
             display_name = coalesce($6::text, display_name), version = version + 1, updated_at = now()
           WHERE project_id = $1::uuid AND id = $2::uuid AND version = $7::int RETURNING id`,
          [p.id, ch.id, ch.inclusion, ch.note !== undefined, ch.note ?? null, ch.display_name, ch.expected],
        );
        if (!row) {
          const exists = await sqlOne(c, `SELECT 1 FROM hp__project_category WHERE project_id = $1::uuid AND id = $2::uuid`, [p.id, ch.id]);
          if (!exists) throw notFound('That category is not in this project.');
          throw versionConflict();
        }
      }
      await recalcDrafts(c, p.id);
      await audit(c, { project_id: p.id, action: 'categories.update', entity_type: 'project', entity_id: p.id, summary: `Changed ${changes.length} scope categories.` });
      const rows = await sql<Record<string, unknown>>(c, `SELECT ${CATEGORY_COLUMNS} FROM hp__project_category WHERE project_id = $1::uuid ORDER BY order_index`, [p.id]);
      return ok(c, rows.map(categoryView));
    });

    /* ── phases (BRD §6.10) ───────────────────────────────────────────── */

    async function phaseCategory(c: Context, raw: unknown): Promise<string | null> {
      const id = uuidField(raw, 'category_id', false);
      if (!id) return null;
      if (!(await sqlOne(c, `SELECT 1 FROM hp__project_category WHERE project_id = $1::uuid AND id = $2::uuid`, [proj(c).id, id]))) throw notFound('That category is not in this project.');
      return id;
    }

    async function loadPhase(c: Context, id: string) {
      const row = await sqlOne<Record<string, unknown>>(c, `SELECT ${PHASE_COLUMNS} FROM hp__phase ph WHERE ph.project_id = $1::uuid AND ph.id = $2::uuid`, [proj(c).id, id]);
      if (!row) throw notFound('That phase is not here.');
      return phaseView(row);
    }

    app.get('/projects/:id/phases', ...project, async (c) => {
      const rows = await sql<Record<string, unknown>>(c, `SELECT ${PHASE_COLUMNS} FROM hp__phase ph WHERE ph.project_id = $1::uuid ORDER BY ph.order_index, ph.created_at`, [proj(c).id]);
      return ok(c, rows.map(phaseView));
    });

    app.post('/projects/:id/phases', ...project, idempotency, async (c) => {
      const b = await body(c);
      allowOnly(b, ['name', 'category_id', 'planned_start', 'planned_end', 'note']);
      const start = dateField(b.planned_start, 'planned_start', false);
      const end = dateField(b.planned_end, 'planned_end', false);
      datesInOrder(start, end);
      const id = uuid();
      await sql(
        c,
        `INSERT INTO hp__phase (id, project_id, category_id, name, order_index, planned_start, planned_end, note)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, (SELECT coalesce(max(order_index), 0) + 1 FROM hp__phase WHERE project_id = $2::uuid), $5::date, $6::date, $7::text)`,
        [id, proj(c).id, await phaseCategory(c, b.category_id), requiredText(b.name, 'name', 80), start, end, text(b.note, 'note', { max: 500 })],
      );
      return created(c, await loadPhase(c, id));
    });

    app.patch('/projects/:id/phases/:phaseId', ...project, async (c) => {
      const b = await body(c);
      const expected = ifMatch(c, b);
      allowOnly(b, ['expected_version', 'status', 'progress_percent', 'planned_start', 'planned_end', 'actual_start', 'actual_end', 'note', 'name', 'category_id']);
      const id = uuidField(c.req.param('phaseId'), 'phase_id')!;
      const cur = await loadPhase(c, id);
      const next = {
        name: b.name === undefined ? cur.name : requiredText(b.name, 'name', 80),
        status: b.status === undefined ? cur.status : oneOf(b.status, ['planned', 'in_progress', 'blocked', 'completed'] as const, 'status'),
        progress: b.progress_percent === undefined ? cur.progress_percent : integer(b.progress_percent, 'progress_percent', { required: true, min: 0, max: 100 })!,
        planned_start: b.planned_start === undefined ? cur.planned_start : dateField(b.planned_start, 'planned_start', false),
        planned_end: b.planned_end === undefined ? cur.planned_end : dateField(b.planned_end, 'planned_end', false),
        actual_start: b.actual_start === undefined ? cur.actual_start : dateField(b.actual_start, 'actual_start', false),
        actual_end: b.actual_end === undefined ? cur.actual_end : dateField(b.actual_end, 'actual_end', false),
        note: b.note === undefined ? cur.note : text(b.note, 'note', { max: 500 }),
        category_id: b.category_id === undefined ? cur.category_id : await phaseCategory(c, b.category_id),
      };
      datesInOrder(next.planned_start, next.planned_end);
      if (next.actual_start && next.actual_end && next.actual_end < next.actual_start) throw invalid('The actual finish must be after the actual start.', 'actual_end');
      const row = await sqlOne(
        c,
        `UPDATE hp__phase SET name = $4::text, status = $5::text, progress_percent = $6::smallint, planned_start = $7::date, planned_end = $8::date,
           actual_start = $9::date, actual_end = $10::date, note = $11::text, category_id = $12::uuid, version = version + 1, updated_at = now()
         WHERE project_id = $1::uuid AND id = $2::uuid AND version = $3::int RETURNING id`,
        [proj(c).id, id, expected, next.name, next.status, next.progress, next.planned_start, next.planned_end, next.actual_start, next.actual_end, next.note, next.category_id],
      );
      if (!row) throw versionConflict();
      if (next.status !== cur.status) {
        await audit(c, { project_id: proj(c).id, action: 'phase.status', entity_type: 'phase', entity_id: id, summary: `${next.name}: ${cur.status} → ${next.status}.` });
      }
      return ok(c, await loadPhase(c, id));
    });

    /* ── activity ─────────────────────────────────────────────────────── */

    app.get('/projects/:id/activity', ...project, async (c) =>
      ok(
        c,
        await sql(
          c,
          `SELECT action, entity_type, entity_id, summary, created_at::text AS created_at FROM hp__audit_event
           WHERE project_id = $1::uuid AND owner_user_id = $2::text ORDER BY created_at DESC, id DESC LIMIT 100`,
          [proj(c).id, userId(c)],
        ),
      ),
    );
  },
});
