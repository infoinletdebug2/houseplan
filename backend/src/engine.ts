import type { Migration } from '@xenition/sdk';

/**
 * PL/pgSQL for everything that must change several rows atomically
 * (BRD §10.4). One `raw()` call is one statement in its own transaction and
 * the gateway has no interactive transactions, so each multi-row business
 * operation is ONE function taking and returning jsonb.
 *
 * Rules every function follows:
 *  - the project id always comes from the worker's ownership check, and
 *    every row is matched on (project_id, id);
 *  - roots are locked `FOR UPDATE` in id order before aggregate checks
 *    (BRD §9.7), so concurrent posts serialise instead of over-allocating;
 *  - domain errors are raised as `HPERR{json}`; lib.ts maps them.
 *
 * Each function's migration id carries a hash of its SQL: an edited function
 * ships as a new migration that replaces the old one.
 */

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** `RAISE EXCEPTION` with the HPERR envelope. Messages must not contain double quotes. */
const err = (code: string, status: number, message: string) => `RAISE EXCEPTION 'HPERR{"code":"${code}","status":${status},"message":"${message.replace(/'/g, "''")}"}'`;

const F: Array<[string, string]> = [
  /* ── guards ───────────────────────────────────────────────────────────── */
  [
    'hp_guard_frozen_line',
    `CREATE OR REPLACE FUNCTION hp_guard_frozen_line() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE st text;
BEGIN
  IF coalesce(current_setting('hp.erasure', true), 'off') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT status INTO st FROM hp__estimate_revision WHERE id = COALESCE(NEW.revision_id, OLD.revision_id);
  IF st = 'frozen' AND coalesce(current_setting('hp.copy', true), 'off') <> 'on' THEN
    ${err('REVISION_FROZEN', 409, 'A saved revision cannot change. Start a new draft to edit.')};
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.revision_id <> OLD.revision_id THEN
    ${err('REVISION_FROZEN', 409, 'A line cannot move between revisions.')};
  END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$`,
  ],
  [
    'hp_guard_frozen_line_trigger',
    `DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hp__estimate_line_frozen') THEN
    CREATE TRIGGER hp__estimate_line_frozen BEFORE INSERT OR UPDATE OR DELETE ON hp__estimate_line FOR EACH ROW EXECUTE FUNCTION hp_guard_frozen_line();
  END IF;
END $do$`,
  ],
  [
    'hp_guard_finance',
    `CREATE OR REPLACE FUNCTION hp_guard_finance() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF coalesce(current_setting('hp.erasure', true), 'off') = 'on' OR coalesce(current_setting('hp.engine', true), 'off') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      ${err('RECORD_POSTED', 409, 'Posted records are never deleted. Void it instead.')};
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' THEN
    ${err('RECORD_POSTED', 409, 'Posted records cannot be edited. Void it and enter a replacement.')};
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
    ${err('RECORD_POSTED', 409, 'New records start as drafts.')};
  END IF;
  RETURN NEW;
END $fn$`,
  ],
  [
    'hp_guard_finance_triggers',
    `DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hp__cost_record_guard') THEN
    CREATE TRIGGER hp__cost_record_guard BEFORE INSERT OR UPDATE OR DELETE ON hp__cost_record FOR EACH ROW EXECUTE FUNCTION hp_guard_finance();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hp__payment_guard') THEN
    CREATE TRIGGER hp__payment_guard BEFORE INSERT OR UPDATE OR DELETE ON hp__payment FOR EACH ROW EXECUTE FUNCTION hp_guard_finance();
  END IF;
END $do$`,
  ],
  [
    'hp_guard_allocation',
    `CREATE OR REPLACE FUNCTION hp_guard_allocation() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE st text;
BEGIN
  IF coalesce(current_setting('hp.erasure', true), 'off') = 'on' OR coalesce(current_setting('hp.engine', true), 'off') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_TABLE_NAME = 'hp__cost_allocation' THEN
    SELECT status INTO st FROM hp__cost_record WHERE id = COALESCE(NEW.cost_record_id, OLD.cost_record_id);
    IF st <> 'draft' THEN
      ${err('RECORD_POSTED', 409, 'Allocations of a posted invoice cannot change.')};
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  ${err('ENGINE_ONLY', 409, 'Payment allocations change only through the allocate action.')};
END $fn$`,
  ],
  [
    'hp_guard_allocation_triggers',
    `DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hp__cost_allocation_guard') THEN
    CREATE TRIGGER hp__cost_allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON hp__cost_allocation FOR EACH ROW EXECUTE FUNCTION hp_guard_allocation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hp__payment_allocation_guard') THEN
    CREATE TRIGGER hp__payment_allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON hp__payment_allocation FOR EACH ROW EXECUTE FUNCTION hp_guard_allocation();
  END IF;
END $do$`,
  ],

  /* ── estimates ────────────────────────────────────────────────────────── */
  [
    'hp_recalc_revision',
    `CREATE OR REPLACE FUNCTION hp_recalc_revision(rev uuid) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE r record; base bigint; agg record; unresolved int;
BEGIN
  SELECT * INTO r FROM hp__estimate_revision WHERE id = rev;
  IF NOT FOUND OR r.status <> 'draft' THEN RETURN; END IF;
  SELECT
    count(*) FILTER (WHERE l.included AND c.inclusion <> 'excluded')::int AS lines,
    count(*) FILTER (WHERE l.included AND NOT l.deferred AND c.inclusion <> 'excluded' AND l.gross_minor IS NULL)::int AS missing,
    coalesce(sum(l.net_minor) FILTER (WHERE l.included AND NOT l.deferred AND c.inclusion = 'included'), 0)::bigint AS net,
    coalesce(sum(l.tax_minor) FILTER (WHERE l.included AND NOT l.deferred AND c.inclusion = 'included'), 0)::bigint AS tax,
    coalesce(sum(l.gross_minor) FILTER (WHERE l.included AND NOT l.deferred AND c.inclusion = 'included'), 0)::bigint AS gross,
    coalesce(sum(l.gross_minor) FILTER (WHERE l.included AND l.deferred AND c.inclusion = 'included'), 0)::bigint AS deferred,
    coalesce(sum(l.gross_minor) FILTER (WHERE l.included AND NOT l.deferred AND c.inclusion = 'included' AND c.category_code = ANY (r.contingency_codes)), 0)::bigint AS base
  INTO agg
  FROM hp__estimate_line l JOIN hp__project_category c ON c.id = l.category_id
  WHERE l.revision_id = rev;
  SELECT count(*)::int INTO unresolved FROM hp__project_category WHERE project_id = r.project_id AND inclusion = 'undecided';
  base := agg.base;
  UPDATE hp__estimate_revision SET
    line_count = agg.lines, missing_line_count = agg.missing, unresolved_category_count = unresolved,
    net_known_minor = agg.net, tax_known_minor = agg.tax, gross_known_minor = agg.gross, deferred_minor = agg.deferred,
    contingency_base_minor = base,
    reserve_minor = round(base::numeric * contingency_percent / 100)::bigint,
    updated_at = now()
  WHERE id = rev;
END $fn$`,
  ],
  [
    'hp_line_write',
    `CREATE OR REPLACE FUNCTION hp_line_write(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE r record; l record; op text := p->>'op'; lid uuid := (p->>'line_id')::uuid; d jsonb := coalesce(p->'line', '{}'::jsonb);
BEGIN
  SELECT * INTO r FROM hp__estimate_revision WHERE project_id = (p->>'project_id')::uuid AND id = (p->>'revision_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That revision is not here.')}; END IF;
  IF r.status <> 'draft' THEN ${err('REVISION_FROZEN', 409, 'A saved revision cannot change. Start a new draft to edit.')}; END IF;
  IF p ? 'expected_revision_version' AND (p->>'expected_revision_version')::int <> r.version THEN
    ${err('VERSION_CONFLICT', 409, 'This draft changed on another device. Refresh and try again.')};
  END IF;
  IF op = 'insert' THEN
    IF (SELECT count(*) FROM hp__estimate_line WHERE revision_id = r.id) >= coalesce((p->>'max_lines')::int, 2000) THEN
      ${err('LIMIT_REACHED', 409, 'This revision already has the most lines a revision can hold.')};
    END IF;
    INSERT INTO hp__estimate_line (id, project_id, revision_id, category_id, room_id, phase_id, calculation_id, mode, label, unit, quantity, net_unit_price, tax_rate,
      extras_net_minor, extras, net_minor, tax_minor, gross_minor, rate_origin, benchmark_rate_id, user_rate_id, rate_snapshot, price_date, stale_override, included,
      deferred, zero_cost_reason, source_revision, note, sort_index)
    VALUES (lid, r.project_id, r.id, (d->>'category_id')::uuid, (d->>'room_id')::uuid, (d->>'phase_id')::uuid, (d->>'calculation_id')::uuid, d->>'mode', d->>'label', d->>'unit',
      (d->>'quantity')::numeric, (d->>'net_unit_price')::numeric, coalesce((d->>'tax_rate')::numeric, 0), coalesce((d->>'extras_net_minor')::bigint, 0), coalesce(d->'extras', '[]'::jsonb),
      (d->>'net_minor')::bigint, (d->>'tax_minor')::bigint, (d->>'gross_minor')::bigint, coalesce(d->>'rate_origin', 'none'), (d->>'benchmark_rate_id')::uuid, (d->>'user_rate_id')::uuid,
      d->'rate_snapshot', (d->>'price_date')::date, coalesce((d->>'stale_override')::boolean, false), coalesce((d->>'included')::boolean, true), coalesce((d->>'deferred')::boolean, false),
      d->>'zero_cost_reason', (d->>'source_revision')::int, d->>'note',
      coalesce((d->>'sort_index')::int, (SELECT coalesce(max(sort_index), 0) + 10 FROM hp__estimate_line WHERE revision_id = r.id)));
  ELSIF op = 'update' THEN
    SELECT * INTO l FROM hp__estimate_line WHERE project_id = r.project_id AND revision_id = r.id AND id = lid FOR UPDATE;
    IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That line is not here.')}; END IF;
    IF (p->>'expected_version')::int IS DISTINCT FROM l.version THEN
      ${err('VERSION_CONFLICT', 409, 'This line changed on another device. Refresh and try again.')};
    END IF;
    UPDATE hp__estimate_line SET category_id = (d->>'category_id')::uuid, room_id = (d->>'room_id')::uuid, phase_id = (d->>'phase_id')::uuid, calculation_id = (d->>'calculation_id')::uuid,
      mode = d->>'mode', label = d->>'label', unit = d->>'unit', quantity = (d->>'quantity')::numeric, net_unit_price = (d->>'net_unit_price')::numeric,
      tax_rate = coalesce((d->>'tax_rate')::numeric, 0), extras_net_minor = coalesce((d->>'extras_net_minor')::bigint, 0), extras = coalesce(d->'extras', '[]'::jsonb),
      net_minor = (d->>'net_minor')::bigint, tax_minor = (d->>'tax_minor')::bigint, gross_minor = (d->>'gross_minor')::bigint, rate_origin = coalesce(d->>'rate_origin', 'none'),
      benchmark_rate_id = (d->>'benchmark_rate_id')::uuid, user_rate_id = (d->>'user_rate_id')::uuid, rate_snapshot = d->'rate_snapshot', price_date = (d->>'price_date')::date,
      stale_override = coalesce((d->>'stale_override')::boolean, false), included = coalesce((d->>'included')::boolean, true), deferred = coalesce((d->>'deferred')::boolean, false),
      zero_cost_reason = d->>'zero_cost_reason', note = d->>'note', sort_index = coalesce((d->>'sort_index')::int, l.sort_index),
      stale = false, stale_reason = NULL, version = l.version + 1, updated_at = now()
    WHERE id = lid;
  ELSIF op = 'delete' THEN
    SELECT * INTO l FROM hp__estimate_line WHERE project_id = r.project_id AND revision_id = r.id AND id = lid FOR UPDATE;
    IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That line is not here.')}; END IF;
    IF (p->>'expected_version')::int IS DISTINCT FROM l.version THEN
      ${err('VERSION_CONFLICT', 409, 'This line changed on another device. Refresh and try again.')};
    END IF;
    IF EXISTS (SELECT 1 FROM hp__quote_line WHERE estimate_line_id = lid) THEN
      UPDATE hp__quote_line SET estimate_line_id = NULL WHERE estimate_line_id = lid;
    END IF;
    DELETE FROM hp__estimate_line WHERE id = lid;
  ELSE
    ${err('VALIDATION_ERROR', 400, 'Unknown line operation.')};
  END IF;
  UPDATE hp__estimate_revision SET version = version + 1 WHERE id = r.id;
  PERFORM hp_recalc_revision(r.id);
  RETURN jsonb_build_object('line_id', lid, 'revision_version', r.version + 1);
END $fn$`,
  ],
  [
    'hp_revision_settings',
    `CREATE OR REPLACE FUNCTION hp_revision_settings(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM hp__estimate_revision WHERE project_id = (p->>'project_id')::uuid AND id = (p->>'revision_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That revision is not here.')}; END IF;
  IF r.status <> 'draft' THEN ${err('REVISION_FROZEN', 409, 'A saved revision cannot change. Start a new draft to edit.')}; END IF;
  IF (p->>'expected_version')::int IS DISTINCT FROM r.version THEN
    ${err('VERSION_CONFLICT', 409, 'This draft changed on another device. Refresh and try again.')};
  END IF;
  UPDATE hp__estimate_revision SET
    contingency_percent = coalesce((p->>'contingency_percent')::numeric, contingency_percent),
    contingency_codes = CASE WHEN p ? 'contingency_codes' THEN ARRAY(SELECT jsonb_array_elements_text(p->'contingency_codes')) ELSE contingency_codes END,
    title = coalesce(p->>'title', title),
    version = version + 1
  WHERE id = r.id;
  PERFORM hp_recalc_revision(r.id);
  RETURN jsonb_build_object('revision_id', r.id, 'version', r.version + 1);
END $fn$`,
  ],
  [
    'hp_freeze_revision',
    `CREATE OR REPLACE FUNCTION hp_freeze_revision(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE r record; snap jsonb;
BEGIN
  SELECT * INTO r FROM hp__estimate_revision WHERE project_id = (p->>'project_id')::uuid AND id = (p->>'revision_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That revision is not here.')}; END IF;
  IF r.status <> 'draft' THEN ${err('REVISION_FROZEN', 409, 'This revision is already saved.')}; END IF;
  IF (p->>'expected_version')::int IS DISTINCT FROM r.version THEN
    ${err('VERSION_CONFLICT', 409, 'This draft changed on another device. Refresh and try again.')};
  END IF;
  IF EXISTS (SELECT 1 FROM hp__estimate_line WHERE revision_id = r.id AND stale) THEN
    ${err('STALE_LINES', 409, 'Some lines depend on a room or rate that changed. Review them before saving.')};
  END IF;
  PERFORM hp_recalc_revision(r.id);
  SELECT jsonb_agg(jsonb_build_object('id', id, 'code', category_code, 'name', display_name, 'inclusion', inclusion) ORDER BY order_index) INTO snap
    FROM hp__project_category WHERE project_id = r.project_id;
  UPDATE hp__estimate_revision SET status = 'frozen', frozen_at = now(), category_snapshot = snap, version = version + 1 WHERE id = r.id;
  UPDATE hp__estimate_pointer SET draft_revision_id = NULL, version = version + 1, updated_at = now() WHERE project_id = r.project_id AND draft_revision_id = r.id;
  RETURN jsonb_build_object('revision_id', r.id, 'version', r.version + 1);
END $fn$`,
  ],
  [
    'hp_set_pointer',
    `CREATE OR REPLACE FUNCTION hp_set_pointer(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE r record; which text := p->>'which';
BEGIN
  SELECT * INTO r FROM hp__estimate_revision WHERE project_id = (p->>'project_id')::uuid AND id = (p->>'revision_id')::uuid;
  IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That revision is not here.')}; END IF;
  IF r.status <> 'frozen' THEN ${err('REVISION_NOT_FROZEN', 409, 'Save the revision before using it as current or baseline.')}; END IF;
  IF r.kind <> 'current' THEN ${err('SCENARIO_REVISION', 409, 'A scenario becomes current only by adopting it.')}; END IF;
  PERFORM 1 FROM hp__estimate_pointer WHERE project_id = r.project_id FOR UPDATE;
  IF which = 'baseline' THEN
    UPDATE hp__estimate_pointer SET baseline_revision_id = r.id, version = version + 1, updated_at = now() WHERE project_id = r.project_id;
  ELSIF which = 'current' THEN
    UPDATE hp__estimate_pointer SET current_revision_id = r.id, version = version + 1, updated_at = now() WHERE project_id = r.project_id;
  ELSE
    ${err('VALIDATION_ERROR', 400, 'Choose current or baseline.')};
  END IF;
  RETURN jsonb_build_object('revision_id', r.id, 'which', which);
END $fn$`,
  ],
  [
    'hp_copy_lines',
    `CREATE OR REPLACE FUNCTION hp_copy_lines(src uuid, dst uuid) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('hp.copy', 'on', true);
  INSERT INTO hp__estimate_line (id, project_id, revision_id, category_id, room_id, phase_id, calculation_id, mode, label, unit, quantity, net_unit_price, tax_rate,
    extras_net_minor, extras, net_minor, tax_minor, gross_minor, rate_origin, benchmark_rate_id, user_rate_id, rate_snapshot, price_date, stale_override, included,
    deferred, zero_cost_reason, source_revision, stale, stale_reason, note, sort_index)
  SELECT gen_random_uuid(), project_id, dst, category_id, room_id, phase_id, calculation_id, mode, label, unit, quantity, net_unit_price, tax_rate,
    extras_net_minor, extras, net_minor, tax_minor, gross_minor, rate_origin, benchmark_rate_id, user_rate_id, rate_snapshot, price_date, stale_override, included,
    deferred, zero_cost_reason, source_revision, stale, stale_reason, note, sort_index
  FROM hp__estimate_line WHERE revision_id = src;
  PERFORM set_config('hp.copy', 'off', true);
END $fn$`,
  ],
  [
    'hp_fork_revision',
    `CREATE OR REPLACE FUNCTION hp_fork_revision(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE s record; ptr record; nid uuid := (p->>'new_id')::uuid; num int; kind text := coalesce(p->>'kind', 'current');
BEGIN
  SELECT * INTO ptr FROM hp__estimate_pointer WHERE project_id = (p->>'project_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That project is not here.')}; END IF;
  IF kind = 'current' AND ptr.draft_revision_id IS NOT NULL THEN
    RAISE EXCEPTION 'HPERR{"code":"DRAFT_EXISTS","status":409,"message":"This project already has a draft. Keep editing it or save it first.","field":"%"}', ptr.draft_revision_id;
  END IF;
  SELECT * INTO s FROM hp__estimate_revision WHERE project_id = ptr.project_id AND id = (p->>'source_revision_id')::uuid;
  IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That revision is not here.')}; END IF;
  IF s.status <> 'frozen' THEN ${err('REVISION_NOT_FROZEN', 409, 'Start new drafts and scenarios from a saved revision.')}; END IF;
  SELECT coalesce(max(revision_number), 0) + 1 INTO num FROM hp__estimate_revision WHERE project_id = ptr.project_id;
  INSERT INTO hp__estimate_revision (id, project_id, revision_number, status, parent_revision_id, kind, title, contingency_percent, contingency_codes)
  VALUES (nid, ptr.project_id, num, 'draft', s.id, kind, coalesce(nullif(p->>'title', ''), 'Revision ' || num), s.contingency_percent, s.contingency_codes);
  PERFORM hp_copy_lines(s.id, nid);
  PERFORM hp_recalc_revision(nid);
  IF kind = 'current' THEN
    UPDATE hp__estimate_pointer SET draft_revision_id = nid, version = version + 1, updated_at = now() WHERE project_id = ptr.project_id;
  END IF;
  RETURN jsonb_build_object('revision_id', nid, 'revision_number', num);
END $fn$`,
  ],
  [
    'hp_adopt_scenario',
    `CREATE OR REPLACE FUNCTION hp_adopt_scenario(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE sc record; sr record; nid uuid := (p->>'new_id')::uuid; num int;
BEGIN
  SELECT * INTO sc FROM hp__scenario WHERE project_id = (p->>'project_id')::uuid AND id = (p->>'scenario_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That scenario is not here.')}; END IF;
  IF sc.adopted_revision_id IS NOT NULL THEN ${err('ALREADY_ADOPTED', 409, 'This scenario was already adopted.')}; END IF;
  SELECT * INTO sr FROM hp__estimate_revision WHERE id = sc.scenario_revision_id;
  IF sr.status <> 'frozen' THEN ${err('REVISION_NOT_FROZEN', 409, 'Save the scenario before adopting it.')}; END IF;
  PERFORM 1 FROM hp__estimate_pointer WHERE project_id = sc.project_id FOR UPDATE;
  SELECT coalesce(max(revision_number), 0) + 1 INTO num FROM hp__estimate_revision WHERE project_id = sc.project_id;
  INSERT INTO hp__estimate_revision (id, project_id, revision_number, status, parent_revision_id, kind, title, net_known_minor, tax_known_minor, gross_known_minor, deferred_minor,
    contingency_percent, contingency_codes, contingency_base_minor, reserve_minor, line_count, missing_line_count, unresolved_category_count, category_snapshot, frozen_at)
  VALUES (nid, sc.project_id, num, 'draft', sr.id, 'current', 'Adopted: ' || sc.title, sr.net_known_minor, sr.tax_known_minor, sr.gross_known_minor, sr.deferred_minor,
    sr.contingency_percent, sr.contingency_codes, sr.contingency_base_minor, sr.reserve_minor, sr.line_count, sr.missing_line_count, sr.unresolved_category_count, sr.category_snapshot, now());
  PERFORM hp_copy_lines(sr.id, nid);
  UPDATE hp__estimate_revision SET status = 'frozen' WHERE id = nid;
  UPDATE hp__estimate_pointer SET current_revision_id = nid, version = version + 1, updated_at = now() WHERE project_id = sc.project_id;
  UPDATE hp__scenario SET adopted_revision_id = nid, adopted_at = now(), version = version + 1, updated_at = now() WHERE id = sc.id;
  RETURN jsonb_build_object('revision_id', nid, 'revision_number', num);
END $fn$`,
  ],
  [
    'hp_mark_stale',
    `CREATE OR REPLACE FUNCTION hp_mark_stale(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE n int;
BEGIN
  UPDATE hp__estimate_line l SET stale = true, stale_reason = p->>'reason', updated_at = now()
  FROM hp__estimate_revision r
  WHERE r.id = l.revision_id AND r.status = 'draft' AND l.project_id = (p->>'project_id')::uuid
    AND ((p ? 'room_id' AND l.room_id = (p->>'room_id')::uuid) OR (p ? 'user_rate_id' AND l.user_rate_id = (p->>'user_rate_id')::uuid));
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE hp__procurement_item SET source_stale = true, updated_at = now()
  WHERE project_id = (p->>'project_id')::uuid AND p ? 'room_id' AND status <> 'planned'
    AND calculation_id IN (SELECT id FROM hp__calculation WHERE room_id = (p->>'room_id')::uuid);
  RETURN jsonb_build_object('stale_lines', n);
END $fn$`,
  ],

  /* ── projects ─────────────────────────────────────────────────────────── */
  [
    'hp_create_project',
    `CREATE OR REPLACE FUNCTION hp_create_project(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE pid uuid := (p->>'id')::uuid; rid uuid := gen_random_uuid(); c jsonb; ph jsonb; ln jsonb; cat uuid;
BEGIN
  INSERT INTO hp__project (id, owner_user_id, name, type, country_code, region_id, postal_code, private_address, currency, unit_system, price_entry, area_m2, storeys,
    target_budget_minor, planned_start, planned_end, finish_tier, cover)
  VALUES (pid, p->>'owner_user_id', p->>'name', p->>'type', p->>'country_code', (p->>'region_id')::uuid, p->>'postal_code', p->>'private_address', p->>'currency',
    p->>'unit_system', coalesce(p->>'price_entry', 'exclusive'), (p->>'area_m2')::numeric, (p->>'storeys')::smallint, (p->>'target_budget_minor')::bigint,
    (p->>'planned_start')::date, (p->>'planned_end')::date, p->>'finish_tier', coalesce(p->>'cover', 'new-build'));
  FOR c IN SELECT * FROM jsonb_array_elements(p->'categories') LOOP
    INSERT INTO hp__project_category (id, project_id, category_code, display_name, inclusion, order_index)
    VALUES (gen_random_uuid(), pid, c->>'code', c->>'name', c->>'inclusion', (c->>'order')::smallint);
  END LOOP;
  FOR ph IN SELECT * FROM jsonb_array_elements(coalesce(p->'phases', '[]'::jsonb)) LOOP
    INSERT INTO hp__phase (id, project_id, category_id, name, order_index)
    VALUES (gen_random_uuid(), pid, (SELECT id FROM hp__project_category WHERE project_id = pid AND category_code = ph->>'code'), ph->>'name', (ph->>'order')::smallint);
  END LOOP;
  INSERT INTO hp__estimate_revision (id, project_id, revision_number, status, kind, title, contingency_percent, contingency_codes)
  VALUES (rid, pid, 1, 'draft', 'current', 'First estimate', 10, ARRAY(SELECT jsonb_array_elements_text(p->'contingency_codes')));
  FOR ln IN SELECT * FROM jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) LOOP
    SELECT id INTO cat FROM hp__project_category WHERE project_id = pid AND category_code = ln->>'code';
    INSERT INTO hp__estimate_line (id, project_id, revision_id, category_id, mode, label, unit, sort_index, note)
    VALUES (gen_random_uuid(), pid, rid, cat, 'allowance', ln->>'label', 'item', (ln->>'order')::int, ln->>'note');
  END LOOP;
  INSERT INTO hp__estimate_pointer (project_id, draft_revision_id) VALUES (pid, rid);
  PERFORM hp_recalc_revision(rid);
  RETURN jsonb_build_object('project_id', pid, 'revision_id', rid);
END $fn$`,
  ],
  [
    'hp_duplicate_project',
    `CREATE OR REPLACE FUNCTION hp_duplicate_project(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE src record; pid uuid := (p->>'new_id')::uuid; rid uuid := gen_random_uuid(); srcrev uuid; ptr record;
BEGIN
  SELECT * INTO src FROM hp__project WHERE id = (p->>'source_id')::uuid AND owner_user_id = p->>'owner_user_id' AND deleted_at IS NULL;
  IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That project is not here.')}; END IF;
  INSERT INTO hp__project (id, owner_user_id, name, type, country_code, region_id, currency, unit_system, price_entry, area_m2, storeys, target_budget_minor,
    planned_start, planned_end, finish_tier, cover)
  VALUES (pid, src.owner_user_id, p->>'name', src.type, src.country_code, src.region_id, coalesce(p->>'currency', src.currency), src.unit_system, src.price_entry,
    src.area_m2, src.storeys, CASE WHEN coalesce(p->>'currency', src.currency) = src.currency THEN src.target_budget_minor END, src.planned_start, src.planned_end, src.finish_tier, src.cover);
  CREATE TEMP TABLE IF NOT EXISTS hp_map (old uuid PRIMARY KEY, new uuid NOT NULL) ON COMMIT DROP;
  DELETE FROM hp_map;
  INSERT INTO hp_map SELECT id, gen_random_uuid() FROM hp__project_category WHERE project_id = src.id;
  INSERT INTO hp_map SELECT id, gen_random_uuid() FROM hp__room WHERE project_id = src.id AND deleted_at IS NULL;
  INSERT INTO hp_map SELECT id, gen_random_uuid() FROM hp__phase WHERE project_id = src.id;
  INSERT INTO hp__project_category (id, project_id, category_code, display_name, inclusion, order_index, note)
    SELECT m.new, pid, category_code, display_name, inclusion, order_index, note FROM hp__project_category c JOIN hp_map m ON m.old = c.id WHERE c.project_id = src.id;
  INSERT INTO hp__phase (id, project_id, category_id, name, order_index, planned_start, planned_end, note)
    SELECT m.new, pid, (SELECT new FROM hp_map WHERE old = ph.category_id), name, order_index, planned_start, planned_end, note FROM hp__phase ph JOIN hp_map m ON m.old = ph.id WHERE ph.project_id = src.id;
  INSERT INTO hp__room (id, project_id, storey_index, name, room_type, length_m, width_m, height_m, manual_floor_area_m2, manual_wall_area_m2, manual_perimeter_m, measurement_source, note)
    SELECT m.new, pid, storey_index, name, room_type, length_m, width_m, height_m, manual_floor_area_m2, manual_wall_area_m2, manual_perimeter_m, measurement_source, note
    FROM hp__room r JOIN hp_map m ON m.old = r.id WHERE r.project_id = src.id;
  INSERT INTO hp__room_opening (id, project_id, room_id, opening_type, wall_label, width_m, height_m, floor_cutout_area_m2, count)
    SELECT gen_random_uuid(), pid, m.new, opening_type, wall_label, width_m, height_m, floor_cutout_area_m2, count FROM hp__room_opening o JOIN hp_map m ON m.old = o.room_id WHERE o.project_id = src.id;
  SELECT * INTO ptr FROM hp__estimate_pointer WHERE project_id = src.id;
  srcrev := coalesce(ptr.draft_revision_id, ptr.current_revision_id, (SELECT id FROM hp__estimate_revision WHERE project_id = src.id AND kind = 'current' ORDER BY revision_number DESC LIMIT 1));
  INSERT INTO hp__estimate_revision (id, project_id, revision_number, status, kind, title, contingency_percent, contingency_codes)
    SELECT rid, pid, 1, 'draft', 'current', 'Copied estimate', contingency_percent, contingency_codes FROM hp__estimate_revision WHERE id = srcrev;
  INSERT INTO hp__estimate_line (id, project_id, revision_id, category_id, room_id, phase_id, mode, label, unit, quantity, net_unit_price, tax_rate, extras_net_minor, extras,
    net_minor, tax_minor, gross_minor, rate_origin, user_rate_id, rate_snapshot, price_date, included, deferred, zero_cost_reason, note, sort_index)
  SELECT gen_random_uuid(), pid, rid, (SELECT new FROM hp_map WHERE old = l.category_id), (SELECT new FROM hp_map WHERE old = l.room_id), (SELECT new FROM hp_map WHERE old = l.phase_id),
    CASE WHEN l.mode = 'quote' THEN 'allowance' ELSE l.mode END, l.label, l.unit, l.quantity, l.net_unit_price, l.tax_rate, l.extras_net_minor, l.extras,
    CASE WHEN p ? 'currency' AND p->>'currency' <> src.currency THEN NULL ELSE l.net_minor END,
    CASE WHEN p ? 'currency' AND p->>'currency' <> src.currency THEN NULL ELSE l.tax_minor END,
    CASE WHEN p ? 'currency' AND p->>'currency' <> src.currency THEN NULL ELSE l.gross_minor END,
    CASE WHEN p ? 'currency' AND p->>'currency' <> src.currency THEN 'none' WHEN l.rate_origin = 'quote' THEN 'user_entered' ELSE l.rate_origin END,
    CASE WHEN p ? 'currency' AND p->>'currency' <> src.currency THEN NULL ELSE l.user_rate_id END,
    l.rate_snapshot, l.price_date, l.included, l.deferred, l.zero_cost_reason, l.note, l.sort_index
  FROM hp__estimate_line l WHERE l.revision_id = srcrev AND (l.room_id IS NULL OR EXISTS (SELECT 1 FROM hp_map WHERE old = l.room_id));
  INSERT INTO hp__estimate_pointer (project_id, draft_revision_id) VALUES (pid, rid);
  PERFORM hp_recalc_revision(rid);
  RETURN jsonb_build_object('project_id', pid, 'revision_id', rid);
END $fn$`,
  ],

  /* ── quotes → commitments ─────────────────────────────────────────────── */
  [
    'hp_accept_quote',
    `CREATE OR REPLACE FUNCTION hp_accept_quote(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE q record; pr record; a jsonb; ql record; total bigint := 0; cid uuid := (p->>'commitment_id')::uuid; amt bigint; remaining int;
BEGIN
  SELECT * INTO q FROM hp__quote WHERE project_id = (p->>'project_id')::uuid AND id = (p->>'quote_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That quote is not here.')}; END IF;
  IF q.status NOT IN ('received','part_accepted') THEN ${err('INVALID_STATE', 409, 'Only a received quote can be accepted.')}; END IF;
  SELECT * INTO pr FROM hp__project WHERE id = q.project_id FOR UPDATE;
  IF q.currency <> pr.currency THEN ${err('CURRENCY_MISMATCH', 422, 'The quote currency must match the project currency.')}; END IF;
  IF q.valid_until IS NOT NULL AND q.valid_until < (p->>'today')::date AND coalesce(p->>'stale_reason', '') = '' THEN
    ${err('QUOTE_EXPIRED', 409, 'This quote has expired. Confirm the supplier still honours it to accept it.')};
  END IF;
  IF jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 THEN ${err('VALIDATION_ERROR', 400, 'Choose at least one line to accept.')}; END IF;
  PERFORM set_config('hp.engine', 'on', true);
  INSERT INTO hp__commitment (id, project_id, owner_user_id, supplier_id, quote_id, reference, title, currency, agreed_gross_minor, scope_note, stale_terms_reason)
  VALUES (cid, q.project_id, q.owner_user_id, q.supplier_id, q.id, q.reference, coalesce(nullif(p->>'title', ''), q.title), q.currency, 1, q.included_scope, nullif(p->>'stale_reason', ''));
  FOR a IN SELECT * FROM jsonb_array_elements(p->'lines') LOOP
    SELECT * INTO ql FROM hp__quote_line WHERE project_id = q.project_id AND quote_id = q.id AND id = (a->>'quote_line_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'One of those lines is not on this quote.')}; END IF;
    IF NOT ql.included THEN ${err('VALIDATION_ERROR', 400, 'An excluded line cannot be accepted.')}; END IF;
    IF ql.accepted_gross_minor IS NOT NULL THEN ${err('ALREADY_ACCEPTED', 409, 'One of those lines was already accepted.')}; END IF;
    amt := coalesce((a->>'amount_gross_minor')::bigint, ql.gross_minor);
    IF amt <= 0 OR amt > ql.gross_minor THEN ${err('VALIDATION_ERROR', 400, 'An approved amount must be above zero and at most the quoted line.')}; END IF;
    INSERT INTO hp__commitment_allocation (id, project_id, commitment_id, category_id, agreed_gross_minor, quote_line_id)
    VALUES (gen_random_uuid(), q.project_id, cid, ql.category_id, amt, ql.id);
    UPDATE hp__quote_line SET accepted_gross_minor = amt WHERE id = ql.id;
    total := total + amt;
  END LOOP;
  UPDATE hp__commitment SET agreed_gross_minor = total WHERE id = cid;
  SELECT count(*) INTO remaining FROM hp__quote_line WHERE quote_id = q.id AND included AND accepted_gross_minor IS NULL;
  UPDATE hp__quote SET status = CASE WHEN remaining = 0 THEN 'accepted' ELSE 'part_accepted' END, accepted_at = coalesce(accepted_at, now()), version = version + 1, updated_at = now()
  WHERE id = q.id;
  UPDATE hp__project SET currency_locked_at = coalesce(currency_locked_at, now()) WHERE id = q.project_id;
  RETURN jsonb_build_object('commitment_id', cid, 'agreed_gross_minor', total::text, 'quote_status', CASE WHEN remaining = 0 THEN 'accepted' ELSE 'part_accepted' END);
END $fn$`,
  ],

  /* ── costs ────────────────────────────────────────────────────────────── */
  [
    'hp_cost_write',
    `CREATE OR REPLACE FUNCTION hp_cost_write(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE cr record; d jsonb := p->'cost'; a jsonb; cid uuid := (p->>'cost_id')::uuid;
BEGIN
  IF p->>'op' = 'insert' THEN
    INSERT INTO hp__cost_record (id, project_id, owner_user_id, supplier_id, reference, type, record_date, currency, net_minor, tax_minor, gross_minor, original_cost_id, replacement_for_id, note, created_by)
    VALUES (cid, (p->>'project_id')::uuid, p->>'owner_user_id', (d->>'supplier_id')::uuid, d->>'reference', d->>'type', (d->>'record_date')::date, d->>'currency',
      (d->>'net_minor')::bigint, (d->>'tax_minor')::bigint, (d->>'gross_minor')::bigint, (d->>'original_cost_id')::uuid, (d->>'replacement_for_id')::uuid, d->>'note', p->>'owner_user_id');
  ELSE
    SELECT * INTO cr FROM hp__cost_record WHERE project_id = (p->>'project_id')::uuid AND id = cid FOR UPDATE;
    IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That record is not here.')}; END IF;
    IF cr.status <> 'draft' THEN ${err('RECORD_POSTED', 409, 'Posted records cannot be edited. Void it and enter a replacement.')}; END IF;
    IF (p->>'expected_version')::int IS DISTINCT FROM cr.version THEN
      ${err('VERSION_CONFLICT', 409, 'This record changed on another device. Refresh and try again.')};
    END IF;
    IF p->>'op' = 'delete' THEN
      DELETE FROM hp__cost_allocation WHERE cost_record_id = cid;
      DELETE FROM hp__cost_record WHERE id = cid;
      RETURN jsonb_build_object('deleted', true);
    END IF;
    UPDATE hp__cost_record SET supplier_id = (d->>'supplier_id')::uuid, reference = d->>'reference', type = d->>'type', record_date = (d->>'record_date')::date,
      net_minor = (d->>'net_minor')::bigint, tax_minor = (d->>'tax_minor')::bigint, gross_minor = (d->>'gross_minor')::bigint, original_cost_id = (d->>'original_cost_id')::uuid,
      replacement_for_id = (d->>'replacement_for_id')::uuid, note = d->>'note', version = version + 1, updated_at = now()
    WHERE id = cid;
  END IF;
  IF p ? 'allocations' THEN
    DELETE FROM hp__cost_allocation WHERE cost_record_id = cid;
    FOR a IN SELECT * FROM jsonb_array_elements(p->'allocations') LOOP
      INSERT INTO hp__cost_allocation (id, project_id, cost_record_id, category_id, commitment_id, amount_gross_minor, credit_effect)
      VALUES (gen_random_uuid(), (p->>'project_id')::uuid, cid, (a->>'category_id')::uuid, (a->>'commitment_id')::uuid, (a->>'amount_gross_minor')::bigint, a->>'credit_effect');
    END LOOP;
  END IF;
  RETURN jsonb_build_object('cost_id', cid);
END $fn$`,
  ],
  [
    'hp_post_cost',
    `CREATE OR REPLACE FUNCTION hp_post_cost(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE cr record; pr record; orig record; alloc_sum bigint; credits bigint; bad int; over jsonb;
BEGIN
  SELECT * INTO cr FROM hp__cost_record WHERE project_id = (p->>'project_id')::uuid AND id = (p->>'cost_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That record is not here.')}; END IF;
  IF cr.status <> 'draft' THEN ${err('RECORD_POSTED', 409, 'This record is already posted.')}; END IF;
  IF (p->>'expected_version')::int IS DISTINCT FROM cr.version THEN
    ${err('VERSION_CONFLICT', 409, 'This record changed on another device. Refresh and try again.')};
  END IF;
  SELECT * INTO pr FROM hp__project WHERE id = cr.project_id FOR UPDATE;
  IF cr.currency <> pr.currency THEN ${err('CURRENCY_MISMATCH', 422, 'The record currency must match the project currency.')}; END IF;
  SELECT coalesce(sum(amount_gross_minor), 0) INTO alloc_sum FROM hp__cost_allocation WHERE cost_record_id = cr.id;
  IF alloc_sum <> cr.gross_minor THEN
    ${err('ALLOCATION_MISMATCH', 422, 'Split the full gross amount across categories before posting.')};
  END IF;
  SELECT count(*) INTO bad FROM hp__cost_allocation WHERE cost_record_id = cr.id AND ((cr.type = 'credit' AND amount_gross_minor > 0) OR (cr.type <> 'credit' AND amount_gross_minor < 0));
  IF bad > 0 THEN ${err('VALIDATION_ERROR', 400, 'Every allocation must have the same sign as the record.')}; END IF;
  SELECT count(*) INTO bad FROM hp__cost_allocation a JOIN hp__commitment m ON m.id = a.commitment_id WHERE a.cost_record_id = cr.id AND m.status = 'cancelled';
  IF bad > 0 THEN ${err('INVALID_STATE', 409, 'One allocation points at a cancelled commitment.')}; END IF;
  IF cr.type = 'credit' THEN
    SELECT * INTO orig FROM hp__cost_record WHERE project_id = cr.project_id AND id = cr.original_cost_id FOR UPDATE;
    IF NOT FOUND OR orig.status <> 'posted' OR orig.type = 'credit' THEN
      ${err('VALIDATION_ERROR', 400, 'A credit must point at a posted invoice or expense.')};
    END IF;
    IF orig.supplier_id IS DISTINCT FROM cr.supplier_id THEN ${err('VALIDATION_ERROR', 400, 'A credit must come from the same supplier as the original invoice.')}; END IF;
    SELECT coalesce(sum(gross_minor), 0) INTO credits FROM hp__cost_record WHERE original_cost_id = orig.id AND status = 'posted' AND type = 'credit';
    IF orig.gross_minor + credits + cr.gross_minor < 0 THEN
      ${err('CREDIT_TOO_LARGE', 422, 'Credits cannot take the original invoice below zero.')};
    END IF;
    SELECT count(*) INTO bad FROM hp__cost_allocation WHERE cost_record_id = cr.id AND commitment_id IS NOT NULL AND credit_effect IS NULL;
    IF bad > 0 THEN ${err('CREDIT_EFFECT_REQUIRED', 400, 'Say whether the credit reduces the agreed work or the work is still owed.')}; END IF;
  END IF;
  PERFORM set_config('hp.engine', 'on', true);
  UPDATE hp__cost_record SET status = 'posted', posted_at = now(), version = version + 1, updated_at = now() WHERE id = cr.id;
  UPDATE hp__project SET currency_locked_at = coalesce(currency_locked_at, now()) WHERE id = cr.project_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('commitment_id', x.commitment_id, 'over_minor', x.over::text)), '[]'::jsonb) INTO over FROM (
    SELECT m.id AS commitment_id,
      (SELECT coalesce(sum(ca.amount_gross_minor), 0) FROM hp__cost_allocation ca JOIN hp__cost_record c2 ON c2.id = ca.cost_record_id
         WHERE ca.commitment_id = m.id AND c2.status = 'posted' AND (ca.credit_effect IS DISTINCT FROM 'reduce_obligation'))
      - m.agreed_gross_minor - (SELECT coalesce(sum(amount_delta_minor), 0) FROM hp__commitment_adjustment WHERE commitment_id = m.id AND status = 'posted') AS over
    FROM hp__commitment m WHERE m.id IN (SELECT commitment_id FROM hp__cost_allocation WHERE cost_record_id = cr.id)) x WHERE x.over > 0;
  RETURN jsonb_build_object('cost_id', cr.id, 'over_invoiced', over);
END $fn$`,
  ],
  [
    'hp_void_cost',
    `CREATE OR REPLACE FUNCTION hp_void_cost(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE cr record; detached bigint;
BEGIN
  SELECT * INTO cr FROM hp__cost_record WHERE project_id = (p->>'project_id')::uuid AND id = (p->>'cost_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That record is not here.')}; END IF;
  IF cr.status <> 'posted' THEN ${err('INVALID_STATE', 409, 'Only a posted record can be voided. Delete a draft instead.')}; END IF;
  IF EXISTS (SELECT 1 FROM hp__cost_record WHERE original_cost_id = cr.id AND status = 'posted') THEN
    ${err('HAS_CREDITS', 409, 'Void the credits against this invoice first.')};
  END IF;
  PERFORM 1 FROM hp__payment WHERE id IN (SELECT payment_id FROM hp__payment_allocation WHERE cost_record_id = cr.id) ORDER BY id FOR UPDATE;
  SELECT coalesce(sum(amount_minor), 0) INTO detached FROM hp__payment_allocation WHERE cost_record_id = cr.id;
  PERFORM set_config('hp.engine', 'on', true);
  DELETE FROM hp__payment_allocation WHERE cost_record_id = cr.id;
  UPDATE hp__cost_record SET status = 'void', voided_at = now(), void_reason = p->>'reason', version = version + 1, updated_at = now() WHERE id = cr.id;
  RETURN jsonb_build_object('cost_id', cr.id, 'detached_payments_minor', detached::text);
END $fn$`,
  ],

  /* ── payments ─────────────────────────────────────────────────────────── */
  [
    'hp_check_payment_allocations',
    `CREATE OR REPLACE FUNCTION hp_check_payment_allocations(pay record, allocs jsonb) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE a jsonb; c record; total bigint := 0; amt bigint; paid bigint; credits bigint;
BEGIN
  IF pay.type <> 'outgoing' AND jsonb_array_length(coalesce(allocs, '[]'::jsonb)) > 0 THEN
    ${err('VALIDATION_ERROR', 400, 'Refunds are linked to the original payment, not to invoices.')};
  END IF;
  -- lock every target invoice in id order (BRD 9.7) before any balance check
  PERFORM 1 FROM hp__cost_record WHERE project_id = pay.project_id
    AND id IN (SELECT (x->>'cost_record_id')::uuid FROM jsonb_array_elements(coalesce(allocs, '[]'::jsonb)) x) ORDER BY id FOR UPDATE;
  FOR a IN SELECT * FROM jsonb_array_elements(coalesce(allocs, '[]'::jsonb)) LOOP
    amt := (a->>'amount_minor')::bigint;
    IF amt IS NULL OR amt <= 0 THEN ${err('VALIDATION_ERROR', 400, 'Each allocation must be above zero.')}; END IF;
    SELECT * INTO c FROM hp__cost_record WHERE project_id = pay.project_id AND id = (a->>'cost_record_id')::uuid;
    IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'One of those invoices is not in this project.')}; END IF;
    IF c.status <> 'posted' OR c.type = 'credit' THEN ${err('VALIDATION_ERROR', 400, 'Payments can only be allocated to posted invoices and expenses.')}; END IF;
    SELECT coalesce(sum(pa.amount_minor), 0) INTO paid FROM hp__payment_allocation pa JOIN hp__payment pm ON pm.id = pa.payment_id
      WHERE pa.cost_record_id = c.id AND pm.status = 'posted' AND pa.payment_id <> pay.id;
    SELECT coalesce(sum(gross_minor), 0) INTO credits FROM hp__cost_record WHERE original_cost_id = c.id AND status = 'posted' AND type = 'credit';
    IF amt > c.gross_minor + credits - paid THEN
      ${err('OVER_ALLOCATED', 409, 'That is more than the open balance of the invoice.')};
    END IF;
    total := total + amt;
  END LOOP;
  IF total > pay.amount_minor THEN ${err('OVER_ALLOCATED', 409, 'Allocations cannot add up to more than the payment.')}; END IF;
END $fn$`,
  ],
  [
    'hp_post_payment',
    `CREATE OR REPLACE FUNCTION hp_post_payment(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE pay record; pr record; orig record; refunded bigint; a jsonb;
BEGIN
  SELECT * INTO pay FROM hp__payment WHERE project_id = (p->>'project_id')::uuid AND id = (p->>'payment_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That payment is not here.')}; END IF;
  IF pay.status <> 'draft' THEN ${err('RECORD_POSTED', 409, 'This payment is already posted.')}; END IF;
  IF (p->>'expected_version')::int IS DISTINCT FROM pay.version THEN
    ${err('VERSION_CONFLICT', 409, 'This payment changed on another device. Refresh and try again.')};
  END IF;
  SELECT * INTO pr FROM hp__project WHERE id = pay.project_id FOR UPDATE;
  IF pay.currency <> pr.currency THEN ${err('CURRENCY_MISMATCH', 422, 'The payment currency must match the project currency.')}; END IF;
  IF pay.commitment_id IS NOT NULL AND EXISTS (SELECT 1 FROM hp__commitment WHERE id = pay.commitment_id AND status = 'cancelled') THEN
    ${err('INVALID_STATE', 409, 'That commitment was cancelled.')};
  END IF;
  IF pay.type = 'refund' THEN
    SELECT * INTO orig FROM hp__payment WHERE project_id = pay.project_id AND id = pay.original_payment_id FOR UPDATE;
    IF NOT FOUND OR orig.status <> 'posted' OR orig.type <> 'outgoing' THEN ${err('VALIDATION_ERROR', 400, 'A refund must point at a posted payment.')}; END IF;
    IF orig.supplier_id IS DISTINCT FROM pay.supplier_id THEN ${err('VALIDATION_ERROR', 400, 'A refund must come from the supplier that was paid.')}; END IF;
    SELECT coalesce(sum(amount_minor), 0) INTO refunded FROM hp__payment WHERE original_payment_id = orig.id AND type = 'refund' AND status = 'posted';
    IF refunded + pay.amount_minor > orig.amount_minor THEN ${err('REFUND_TOO_LARGE', 422, 'Refunds cannot add up to more than the original payment.')}; END IF;
  END IF;
  PERFORM hp_check_payment_allocations(pay, p->'allocations');
  PERFORM set_config('hp.engine', 'on', true);
  FOR a IN SELECT * FROM jsonb_array_elements(coalesce(p->'allocations', '[]'::jsonb)) LOOP
    INSERT INTO hp__payment_allocation (id, project_id, payment_id, cost_record_id, amount_minor)
    VALUES (gen_random_uuid(), pay.project_id, pay.id, (a->>'cost_record_id')::uuid, (a->>'amount_minor')::bigint);
  END LOOP;
  UPDATE hp__payment SET status = 'posted', posted_at = now(), version = version + 1, updated_at = now() WHERE id = pay.id;
  UPDATE hp__project SET currency_locked_at = coalesce(currency_locked_at, now()) WHERE id = pay.project_id;
  RETURN jsonb_build_object('payment_id', pay.id);
END $fn$`,
  ],
  [
    'hp_allocate_payment',
    `CREATE OR REPLACE FUNCTION hp_allocate_payment(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE pay record; a jsonb; before jsonb;
BEGIN
  SELECT * INTO pay FROM hp__payment WHERE project_id = (p->>'project_id')::uuid AND id = (p->>'payment_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That payment is not here.')}; END IF;
  IF pay.status <> 'posted' OR pay.type <> 'outgoing' THEN ${err('INVALID_STATE', 409, 'Only a posted outgoing payment can be allocated.')}; END IF;
  IF (p->>'expected_version')::int IS DISTINCT FROM pay.version THEN
    ${err('VERSION_CONFLICT', 409, 'This payment changed on another device. Refresh and try again.')};
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('cost_record_id', cost_record_id, 'amount_minor', amount_minor::text)), '[]'::jsonb) INTO before FROM hp__payment_allocation WHERE payment_id = pay.id;
  PERFORM hp_check_payment_allocations(pay, p->'allocations');
  PERFORM set_config('hp.engine', 'on', true);
  DELETE FROM hp__payment_allocation WHERE payment_id = pay.id;
  FOR a IN SELECT * FROM jsonb_array_elements(coalesce(p->'allocations', '[]'::jsonb)) LOOP
    INSERT INTO hp__payment_allocation (id, project_id, payment_id, cost_record_id, amount_minor)
    VALUES (gen_random_uuid(), pay.project_id, pay.id, (a->>'cost_record_id')::uuid, (a->>'amount_minor')::bigint);
  END LOOP;
  UPDATE hp__payment SET version = version + 1, updated_at = now() WHERE id = pay.id;
  RETURN jsonb_build_object('payment_id', pay.id, 'before', before);
END $fn$`,
  ],
  [
    'hp_void_payment',
    `CREATE OR REPLACE FUNCTION hp_void_payment(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE pay record;
BEGIN
  SELECT * INTO pay FROM hp__payment WHERE project_id = (p->>'project_id')::uuid AND id = (p->>'payment_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That payment is not here.')}; END IF;
  IF pay.status <> 'posted' THEN ${err('INVALID_STATE', 409, 'Only a posted payment can be voided. Delete a draft instead.')}; END IF;
  IF EXISTS (SELECT 1 FROM hp__payment WHERE original_payment_id = pay.id AND status = 'posted') THEN
    ${err('HAS_REFUNDS', 409, 'Void the refunds of this payment first.')};
  END IF;
  PERFORM set_config('hp.engine', 'on', true);
  DELETE FROM hp__payment_allocation WHERE payment_id = pay.id;
  UPDATE hp__payment SET status = 'void', voided_at = now(), void_reason = p->>'reason', version = version + 1, updated_at = now() WHERE id = pay.id;
  RETURN jsonb_build_object('payment_id', pay.id);
END $fn$`,
  ],
  [
    'hp_payment_write',
    `CREATE OR REPLACE FUNCTION hp_payment_write(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE pay record; d jsonb := p->'payment'; pid uuid := (p->>'payment_id')::uuid;
BEGIN
  IF p->>'op' = 'insert' THEN
    INSERT INTO hp__payment (id, project_id, owner_user_id, supplier_id, type, amount_minor, currency, payment_date, method, commitment_id, original_payment_id, reference, note, created_by)
    VALUES (pid, (p->>'project_id')::uuid, p->>'owner_user_id', (d->>'supplier_id')::uuid, d->>'type', (d->>'amount_minor')::bigint, d->>'currency', (d->>'payment_date')::date,
      coalesce(d->>'method', 'bank'), (d->>'commitment_id')::uuid, (d->>'original_payment_id')::uuid, d->>'reference', d->>'note', p->>'owner_user_id');
    RETURN jsonb_build_object('payment_id', pid);
  END IF;
  SELECT * INTO pay FROM hp__payment WHERE project_id = (p->>'project_id')::uuid AND id = pid FOR UPDATE;
  IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That payment is not here.')}; END IF;
  IF pay.status <> 'draft' THEN ${err('RECORD_POSTED', 409, 'Posted payments cannot be edited. Void it and enter a replacement.')}; END IF;
  IF (p->>'expected_version')::int IS DISTINCT FROM pay.version THEN
    ${err('VERSION_CONFLICT', 409, 'This payment changed on another device. Refresh and try again.')};
  END IF;
  IF p->>'op' = 'delete' THEN
    DELETE FROM hp__payment WHERE id = pid;
    RETURN jsonb_build_object('deleted', true);
  END IF;
  UPDATE hp__payment SET supplier_id = (d->>'supplier_id')::uuid, type = d->>'type', amount_minor = (d->>'amount_minor')::bigint, payment_date = (d->>'payment_date')::date,
    method = coalesce(d->>'method', 'bank'), commitment_id = (d->>'commitment_id')::uuid, original_payment_id = (d->>'original_payment_id')::uuid, reference = d->>'reference',
    note = d->>'note', version = version + 1, updated_at = now()
  WHERE id = pid;
  RETURN jsonb_build_object('payment_id', pid);
END $fn$`,
  ],

  /* ── forecast and dashboard (BRD §6.9) ────────────────────────────────── */
  [
    'hp_dashboard',
    `CREATE OR REPLACE FUNCTION hp_dashboard(pid uuid, fid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $fn$
DECLARE pr record; ptr record; fc record; cats jsonb; a_total bigint; c_total bigint; u_total bigint; u_missing int; undecided int; over_total bigint; paid bigint; refunds bigint; advances bigint; est record; last_change timestamptz; reserve bigint; result jsonb;
BEGIN
  SELECT * INTO pr FROM hp__project WHERE id = pid;
  SELECT * INTO ptr FROM hp__estimate_pointer WHERE project_id = pid;
  IF fid IS NULL THEN
    SELECT * INTO fc FROM hp__forecast_version WHERE project_id = pid AND status = 'confirmed' ORDER BY version_number DESC LIMIT 1;
  ELSE
    SELECT * INTO fc FROM hp__forecast_version WHERE project_id = pid AND id = fid;
  END IF;
  reserve := coalesce(fc.remaining_reserve_minor, 0);

  WITH c AS (
    SELECT id, category_code, display_name, inclusion, order_index FROM hp__project_category WHERE project_id = pid
  ), est_lines AS (
    SELECT l.category_id, sum(l.gross_minor) FILTER (WHERE l.included AND NOT l.deferred) AS gross, count(*) FILTER (WHERE l.included AND NOT l.deferred AND l.gross_minor IS NULL) AS missing
    FROM hp__estimate_line l WHERE l.revision_id = coalesce(ptr.current_revision_id, ptr.draft_revision_id) GROUP BY l.category_id
  ), actual AS (
    SELECT a.category_id, sum(a.amount_gross_minor) AS amt FROM hp__cost_allocation a JOIN hp__cost_record r ON r.id = a.cost_record_id
    WHERE r.project_id = pid AND r.status = 'posted' GROUP BY a.category_id
  ), obligation AS (
    SELECT x.category_id, sum(greatest(x.agreed + x.adj - x.invoiced, 0)) AS remaining, sum(greatest(x.invoiced - x.agreed - x.adj, 0)) AS over
    FROM (
      SELECT k.commitment_id, k.category_id,
        coalesce((SELECT sum(agreed_gross_minor) FROM hp__commitment_allocation WHERE commitment_id = k.commitment_id AND category_id = k.category_id), 0) AS agreed,
        coalesce((SELECT sum(amount_delta_minor) FROM hp__commitment_adjustment WHERE commitment_id = k.commitment_id AND category_id = k.category_id AND status = 'posted'), 0) AS adj,
        -- a credit that cancels work lowers the obligation and the invoiced amount alike, so it is left out of both;
        -- a credit for work still owed lowers only the invoiced amount and so reopens the obligation (BRD 6.9)
        coalesce((SELECT sum(ca.amount_gross_minor) FROM hp__cost_allocation ca JOIN hp__cost_record cr ON cr.id = ca.cost_record_id
                  WHERE ca.commitment_id = k.commitment_id AND ca.category_id = k.category_id AND cr.status = 'posted' AND ca.credit_effect IS DISTINCT FROM 'reduce_obligation'), 0) AS invoiced
      FROM (
        SELECT DISTINCT m.id AS commitment_id, x.category_id FROM hp__commitment m
        JOIN (SELECT commitment_id, category_id FROM hp__commitment_allocation UNION SELECT commitment_id, category_id FROM hp__commitment_adjustment UNION SELECT ca.commitment_id, ca.category_id FROM hp__cost_allocation ca JOIN hp__cost_record cr ON cr.id = ca.cost_record_id WHERE ca.commitment_id IS NOT NULL AND cr.status = 'posted') x ON x.commitment_id = m.id
        WHERE m.project_id = pid AND m.status = 'active'
      ) k
    ) x GROUP BY x.category_id
  ), u AS (
    SELECT category_id, uncommitted_remaining_minor AS amt, confirmed, basis_note FROM hp__forecast_input WHERE forecast_id = fc.id
  )
  SELECT jsonb_agg(jsonb_build_object(
      'category_id', c.id, 'code', c.category_code, 'name', c.display_name, 'inclusion', c.inclusion,
      'estimate_minor', (e.gross)::text, 'estimate_missing', coalesce(e.missing, 0),
      'actual_minor', coalesce(a.amt, 0)::text,
      'committed_remaining_minor', coalesce(o.remaining, 0)::text,
      'over_invoiced_minor', coalesce(o.over, 0)::text,
      'uncommitted_minor', (u.amt)::text, 'uncommitted_confirmed', coalesce(u.confirmed, false), 'basis_note', u.basis_note,
      'suggested_uncommitted_minor', CASE WHEN e.gross IS NULL THEN NULL ELSE greatest(e.gross - coalesce(a.amt, 0) - coalesce(o.remaining, 0), 0)::text END
    ) ORDER BY c.order_index),
    coalesce(sum(coalesce(a.amt, 0)), 0)::bigint AS a_total,
    coalesce(sum(coalesce(o.remaining, 0)), 0)::bigint AS c_total,
    coalesce(sum(u.amt) FILTER (WHERE c.inclusion = 'included'), 0)::bigint AS u_total,
    count(*) FILTER (WHERE c.inclusion = 'included' AND u.amt IS NULL)::int AS u_missing,
    count(*) FILTER (WHERE c.inclusion = 'undecided')::int AS undecided,
    coalesce(sum(o.over), 0)::bigint AS over_total
  INTO cats, a_total, c_total, u_total, u_missing, undecided, over_total
  FROM c LEFT JOIN est_lines e ON e.category_id = c.id LEFT JOIN actual a ON a.category_id = c.id LEFT JOIN obligation o ON o.category_id = c.id
       LEFT JOIN u ON u.category_id = c.id;

  SELECT coalesce(sum(amount_minor) FILTER (WHERE type = 'outgoing'), 0), coalesce(sum(amount_minor) FILTER (WHERE type = 'refund'), 0)
    INTO paid, refunds FROM hp__payment WHERE project_id = pid AND status = 'posted';
  SELECT coalesce(sum(pm.amount_minor - coalesce((SELECT sum(amount_minor) FROM hp__payment_allocation WHERE payment_id = pm.id), 0)
                      - coalesce((SELECT sum(amount_minor) FROM hp__payment rf WHERE rf.original_payment_id = pm.id AND rf.status = 'posted'), 0)), 0)
    INTO advances FROM hp__payment pm WHERE pm.project_id = pid AND pm.status = 'posted' AND pm.type = 'outgoing';
  SELECT * INTO est FROM hp__estimate_revision WHERE id = coalesce(ptr.current_revision_id, ptr.draft_revision_id);
  SELECT greatest(
      (SELECT max(greatest(posted_at, voided_at)) FROM hp__cost_record WHERE project_id = pid),
      (SELECT max(greatest(posted_at, voided_at)) FROM hp__payment WHERE project_id = pid),
      (SELECT max(accepted_at) FROM hp__commitment WHERE project_id = pid),
      (SELECT max(updated_at) FROM hp__commitment WHERE project_id = pid AND status <> 'active'),
      (SELECT max(created_at) FROM hp__commitment_adjustment WHERE project_id = pid)) INTO last_change;

  result := jsonb_build_object(
    'project_id', pid,
    'currency', trim(pr.currency),
    'target_budget_minor', pr.target_budget_minor::text,
    'estimate', CASE WHEN est.id IS NULL THEN NULL ELSE jsonb_build_object(
        'revision_id', est.id, 'revision_number', est.revision_number, 'status', est.status, 'is_current', est.id = ptr.current_revision_id,
        'gross_known_minor', est.gross_known_minor::text, 'reserve_minor', est.reserve_minor::text,
        'total_with_reserve_minor', (est.gross_known_minor + est.reserve_minor)::text,
        'missing_line_count', est.missing_line_count, 'unresolved_category_count', est.unresolved_category_count, 'line_count', est.line_count,
        'complete', est.missing_line_count = 0 AND est.unresolved_category_count = 0) END,
    'baseline_revision_id', ptr.baseline_revision_id,
    'current_revision_id', ptr.current_revision_id,
    'draft_revision_id', ptr.draft_revision_id,
    'actual_minor', a_total::text,
    'committed_remaining_minor', c_total::text,
    'over_invoiced_minor', over_total::text,
    'paid_minor', (paid - refunds)::text,
    'paid_out_minor', paid::text,
    'refunds_minor', refunds::text,
    'unallocated_advances_minor', advances::text,
    'categories', coalesce(cats, '[]'::jsonb),
    'forecast', CASE WHEN fc.id IS NULL THEN jsonb_build_object('status', 'none') ELSE jsonb_build_object(
        'forecast_id', fc.id, 'version_number', fc.version_number, 'status', fc.status, 'confirmed_at', fc.confirmed_at,
        'review_required', fc.status = 'confirmed' AND last_change IS NOT NULL AND last_change > fc.confirmed_at,
        'uncommitted_minor', u_total::text, 'missing_inputs', u_missing,
        'remaining_reserve_minor', reserve::text,
        'excluding_reserve_minor', (a_total + c_total + u_total)::text,
        'total_minor', (a_total + c_total + u_total + reserve)::text,
        'cash_still_needed_minor', (a_total + c_total + u_total + reserve - (paid - refunds))::text,
        'budget_variance_minor', CASE WHEN pr.target_budget_minor IS NULL THEN NULL ELSE (pr.target_budget_minor - (a_total + c_total + u_total + reserve))::text END,
        'complete', u_missing = 0 AND undecided = 0) END,
    'undecided_categories', undecided,
    'computed_at', now());
  RETURN result;
END $fn$`,
  ],
  [
    'hp_confirm_forecast',
    `CREATE OR REPLACE FUNCTION hp_confirm_forecast(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE fc record; snap jsonb;
BEGIN
  SELECT * INTO fc FROM hp__forecast_version WHERE project_id = (p->>'project_id')::uuid AND id = (p->>'forecast_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN ${err('NOT_FOUND', 404, 'That forecast is not here.')}; END IF;
  IF fc.status <> 'draft' THEN ${err('INVALID_STATE', 409, 'This forecast is already confirmed.')}; END IF;
  IF (p->>'expected_version')::int IS DISTINCT FROM fc.version THEN
    ${err('VERSION_CONFLICT', 409, 'This forecast changed on another device. Refresh and try again.')};
  END IF;
  UPDATE hp__forecast_input SET confirmed = true, updated_at = now() WHERE forecast_id = fc.id AND uncommitted_remaining_minor IS NOT NULL;
  snap := hp_dashboard(fc.project_id, fc.id);
  UPDATE hp__forecast_version SET status = 'confirmed', confirmed_at = now(), total_snapshot = snap, version = version + 1, updated_at = now() WHERE id = fc.id;
  RETURN jsonb_build_object('forecast_id', fc.id, 'snapshot', snap);
END $fn$`,
  ],

  /* ── erasure ──────────────────────────────────────────────────────────── */
  [
    'hp_purge_project',
    `CREATE OR REPLACE FUNCTION hp_purge_project(pid uuid) RETURNS text[] LANGUAGE plpgsql AS $fn$
DECLARE keys text[];
BEGIN
  PERFORM set_config('hp.erasure', 'on', true);
  SELECT coalesce(array_agg(storage_key), '{}') INTO keys FROM hp__attachment WHERE project_id = pid;
  DELETE FROM hp__attachment_link WHERE project_id = pid OR attachment_id IN (SELECT id FROM hp__attachment WHERE project_id = pid);
  DELETE FROM hp__attachment WHERE project_id = pid;
  DELETE FROM hp__ai_quota WHERE request_id IN (SELECT id FROM hp__ai_request WHERE project_id = pid);
  DELETE FROM hp__ai_request WHERE project_id = pid;
  DELETE FROM hp__export_job WHERE project_id = pid;
  DELETE FROM hp__notice WHERE project_id = pid;
  DELETE FROM hp__delivery WHERE project_id = pid;
  DELETE FROM hp__procurement_item WHERE project_id = pid;
  DELETE FROM hp__forecast_input WHERE project_id = pid;
  DELETE FROM hp__forecast_version WHERE project_id = pid;
  DELETE FROM hp__payment_allocation WHERE project_id = pid;
  UPDATE hp__payment SET original_payment_id = NULL WHERE project_id = pid;
  DELETE FROM hp__payment WHERE project_id = pid;
  DELETE FROM hp__cost_allocation WHERE project_id = pid;
  UPDATE hp__cost_record SET original_cost_id = NULL, replacement_for_id = NULL WHERE project_id = pid;
  DELETE FROM hp__cost_record WHERE project_id = pid;
  DELETE FROM hp__commitment_adjustment WHERE project_id = pid;
  DELETE FROM hp__commitment_allocation WHERE project_id = pid;
  DELETE FROM hp__commitment WHERE project_id = pid;
  DELETE FROM hp__quote_line WHERE project_id = pid;
  UPDATE hp__quote SET parent_quote_id = NULL WHERE project_id = pid;
  DELETE FROM hp__quote WHERE project_id = pid;
  DELETE FROM hp__scenario WHERE project_id = pid;
  DELETE FROM hp__estimate_pointer WHERE project_id = pid;
  DELETE FROM hp__estimate_line WHERE project_id = pid;
  DELETE FROM hp__estimate_revision WHERE project_id = pid;
  DELETE FROM hp__calculation WHERE project_id = pid;
  DELETE FROM hp__room_opening WHERE project_id = pid;
  DELETE FROM hp__room WHERE project_id = pid;
  DELETE FROM hp__phase WHERE project_id = pid;
  DELETE FROM hp__project_category WHERE project_id = pid;
  DELETE FROM hp__audit_event WHERE project_id = pid;
  UPDATE hp__profile SET last_project_id = NULL WHERE last_project_id = pid;
  DELETE FROM hp__project WHERE id = pid;
  RETURN keys;
END $fn$`,
  ],
  [
    'hp_erase_user',
    `CREATE OR REPLACE FUNCTION hp_erase_user(uid text) RETURNS text[] LANGUAGE plpgsql AS $fn$
DECLARE keys text[] := '{}'; pid uuid;
BEGIN
  PERFORM set_config('hp.erasure', 'on', true);
  FOR pid IN SELECT id FROM hp__project WHERE owner_user_id = uid LOOP
    keys := keys || hp_purge_project(pid);
  END LOOP;
  keys := keys || coalesce((SELECT array_agg(storage_key) FROM hp__attachment WHERE owner_user_id = uid), '{}');
  DELETE FROM hp__attachment_link WHERE owner_user_id = uid;
  DELETE FROM hp__attachment WHERE owner_user_id = uid;
  DELETE FROM hp__user_rate WHERE owner_user_id = uid;
  DELETE FROM hp__supplier WHERE owner_user_id = uid;
  DELETE FROM hp__ai_quota WHERE user_id = uid;
  DELETE FROM hp__ai_request WHERE owner_user_id = uid;
  DELETE FROM hp__export_job WHERE owner_user_id = uid;
  DELETE FROM hp__notice WHERE user_id = uid;
  DELETE FROM hp__consent_event WHERE user_id = uid;
  DELETE FROM hp__review_prompt WHERE user_id = uid;
  DELETE FROM hp__idempotency WHERE user_id = uid;
  DELETE FROM hp__legal_acceptance WHERE user_id = uid;
  DELETE FROM hp__trial_claim WHERE user_id = uid;
  UPDATE hp__support_request SET user_id = NULL, email = NULL, message = '[erased]', diagnostics = NULL WHERE user_id = uid;
  UPDATE hp__audit_event SET owner_user_id = NULL, data = NULL, summary = 'Account erased' WHERE owner_user_id = uid;
  DELETE FROM hp__profile WHERE user_id = uid;
  RETURN keys;
END $fn$`,
  ],
];

export const ENGINE_MIGRATIONS: Migration[] = F.map(([name, sql]) => ({ id: `hp/fn_${name}_${hash(sql)}`, sql }));
