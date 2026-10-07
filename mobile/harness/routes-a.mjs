/**
 * Fork M2's screens (estimating). They run LIVE against a worker seeded by
 * backend/scripts/seed-demo.mjs, whose ids land in harness/.demo.json; with
 * no seed file this list is empty, so stub runs skip it.
 *
 *   API=http://localhost:8811 node ../backend/scripts/seed-demo.mjs
 *   EXPO_PUBLIC_API_URL=http://localhost:8811 npx expo export --platform web --output-dir dist-web-a --clear
 *   HARNESS_DIST=dist-web-a HARNESS_WEB_PORT=8094 node harness/serve.mjs --web-only
 *   HARNESS_ROUTES=harness/routes-a.mjs HARNESS_WEB_PORT=8094 HARNESS_CDP_PORT=9234 HARNESS_SHOTS=shots-a HARNESS_PROFILE=.chrome-a node harness/shoot.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let demo = null;
try {
  demo = JSON.parse(readFileSync(fileURLToPath(new URL('.demo.json', import.meta.url)), 'utf8'));
} catch {
  demo = null;
}

const routes = (d) => {
  const p = `/project/${d.project_id}`;
  return [
    { path: '/projects', name: 'a01-projects', expect: ['Willow House', 'Garden flat renovation', 'of 5 active'], height: 1400 },
    { path: '/project/new', name: 'a02-new-project', expect: ['What are you building', 'Project currency'], height: 1100 },
    { path: p, name: 'a03-overview', expect: ['Willow House', 'Budget completeness', 'Estimated', 'Committed', 'Billed', 'Paid'], height: 2300 },
    { path: `${p}/scope`, name: 'a04-scope', expect: ['What the budget covers', 'Land purchase'], height: 1600 },
    { path: `${p}/settings`, name: 'a05-project-settings', expect: ['Delete project', 'Project currency'], height: 1500 },
    { path: `${p}/rooms`, name: 'a06-rooms', expect: ['Living room', 'Ground floor', 'First floor'], height: 1300 },
    { path: `${p}/rooms/${d.room_id}`, name: 'a07-room-editor', expect: ['Measurements', 'Doors and windows', 'Walls to finish'], height: 2200 },
    { path: `${p}/rooms/new`, name: 'a08-room-new', expect: ['Room name', 'Save the room first'], height: 1500 },
    { path: '/calculators', name: 'a09-calculators-tab', expect: ['Flooring', 'Paint', 'Your rate book'], height: 1400 },
    { path: `${p}/calculator`, name: 'a10-project-calculators', expect: ['Saved calculations', 'Oak flooring'], height: 1500 },
    { path: `${p}/calculator/flooring?room=${d.room_id}`, name: 'a11-calc-input', expect: ['Measure from a room', 'Living room', 'See the result'], height: 1900 },
    { path: `${p}/calculator/flooring?room=${d.room_id}&show=result&prefill=pack_area_m2:20;pack_price_net:89;labour_rate_net:3.5`, name: 'a12-calc-result', expect: ['Packs to buy', 'Add to estimate', 'Total'], height: 1700 },
    { path: `${p}/calculator/paint?show=result&prefill=net_surface_m2:860;coverage_m2_per_litre:400;can_size_litres:1`, name: 'a13-calc-paint-unpriced', expect: ['Cans to buy', 'Not priced'], height: 1500 },
    { path: '/rates', name: 'a14-rate-book', expect: ['Engineered oak', 'Your rate'] },
    { path: '/rates/edit?unit=pack', name: 'a15-rate-new', expect: ['Save rate', 'Priced per'], height: 1900 },
    { path: `${p}/estimate`, name: 'a16-estimate-draft', expect: ['Draft · revision', 'Known subtotal', 'Save revision'], height: 2000 },
    { path: `${p}/estimate?rev=${d.baseline_revision_id}`, name: 'a17-estimate-saved', expect: ['Saved · revision 1', 'baseline'], height: 1800 },
    { path: `${p}/estimate/line?rev=${d.draft_revision_id}`, name: 'a18-line-new', expect: ['How is it costed', 'Add line'], height: 1700 },
    { path: `${p}/revisions`, name: 'a19-revisions', expect: ['Revision 1', 'Baseline', 'Current', 'Draft'], height: 1300 },
    { path: `${p}/revisions/diff?from=${d.baseline_revision_id}&to=${d.current_revision_id}`, name: 'a20-diff', expect: ['What changes', 'Kitchen'], height: 1500 },
    { path: `${p}/scenarios`, name: 'a21-scenarios', expect: ['Oak floors to vinyl', 'Ready to compare'] },
    { path: `${p}/scenarios/${d.scenario_id}`, name: 'a22-compare', expect: ['What changes', 'The tradeoffs', 'Adopt scenario'], height: 1500 },
  ];
};

/** HARNESS_EMPTY=1 with an empty paid account in .demo.json (seed-demo.mjs EMPTY=1): the empty states. */
const empty = [
  { path: '/projects', name: 'a30-projects-empty', expect: ['Start your first project'] },
  { path: '/calculators', name: 'a31-calculators-empty', expect: ['Start a project first'] },
  { path: '/rates', name: 'a32-rates-empty', expect: ['Save your first rate'] },
];

// Only on a live run (HARNESS_ROUTES points here): the stub run must not try these ids.
export default demo && (process.env.HARNESS_ROUTES ?? "").includes("routes-a") ? (process.env.HARNESS_EMPTY === "1" ? empty : routes(demo)) : [];
