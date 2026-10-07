import { Hono } from 'hono';
import { readEnvVar } from '@xenition/sdk/hono';
import { CONTACT_EMAIL, PRIVACY, TERMS, type LegalDoc } from './legal';
import { ADMIN_CONSOLE_JS } from './site-admin';

/**
 * The public website, served by the same worker (CONTRACT §15): landing, the
 * legal texts the stores link to, support, the account-deletion page Google
 * Play requires, the operator console, and the Apple/Android app-link files.
 *
 * Self-contained HTML: one CSS block, inline SVG drawings, Google Fonts for
 * the two typefaces. No invented ratings, user counts or testimonials.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const BUNDLE_ID = 'com.xenition.houseplan';
const DESCRIPTION = 'Know the likely cost of your house, understand the cost of choices, and track the money still needed to finish.';

/** The mark: a roof line over a plan grid. */
const MARK = (size = 30) =>
  `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#17332E"/><path d="M7 15.5 16 8l9 7.5" fill="none" stroke="#F4EFE7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 14.5V24h12v-9.5" fill="none" stroke="#F4EFE7" stroke-width="2" stroke-linejoin="round"/><path d="M16 24v-5.5M10 19h12" stroke="#4FB39B" stroke-width="1.6" stroke-linecap="round"/></svg>`;

/** The signature element: a 5 m × 4 m room drawn as a blueprint, with dimension lines, a door swing and a window. */
const FLOOR_PLAN = `<svg class="plan" viewBox="0 0 420 340" role="img" aria-label="A drawing of a five by four metre room with a door and a window">
  <defs><pattern id="hp-grid" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M14 0H0V14" fill="none" stroke="currentColor" stroke-opacity=".09" stroke-width="1"/></pattern>
  <marker id="hp-tick" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 2 10 5 0 8z" fill="#17332E"/></marker></defs>
  <rect width="420" height="340" fill="url(#hp-grid)" style="color:#17332E"/>
  <line x1="70" y1="40" x2="350" y2="40" stroke="#17332E" stroke-width="1.2" marker-start="url(#hp-tick)" marker-end="url(#hp-tick)"/>
  <line x1="70" y1="32" x2="70" y2="48" stroke="#17332E"/><line x1="350" y1="32" x2="350" y2="48" stroke="#17332E"/>
  <rect x="200" y="30" width="22" height="20" fill="#F4EFE7"/><text x="211" y="45" text-anchor="middle" font-family="Inter,sans-serif" font-size="14" fill="#17332E">5 m</text>
  <line x1="384" y1="66" x2="384" y2="290" stroke="#17332E" stroke-width="1.2" marker-start="url(#hp-tick)" marker-end="url(#hp-tick)"/>
  <line x1="376" y1="66" x2="392" y2="66" stroke="#17332E"/><line x1="376" y1="290" x2="392" y2="290" stroke="#17332E"/>
  <text x="400" y="182" font-family="Inter,sans-serif" font-size="14" fill="#17332E" transform="rotate(90 400 182)" text-anchor="middle">4 m</text>
  <rect x="70" y="66" width="280" height="224" fill="#FBF8F3" stroke="#17332E" stroke-width="7"/>
  <g stroke="#17332E" stroke-opacity=".12" stroke-width="1">${Array.from({ length: 7 }, (_, i) => `<line x1="74" y1="${96 + i * 28}" x2="346" y2="${96 + i * 28}"/>`).join('')}</g>
  <rect x="346" y="130" width="8" height="80" fill="#FBF8F3" stroke="#17332E" stroke-width="1.5"/><line x1="350" y1="130" x2="350" y2="210" stroke="#17332E" stroke-width="1"/>
  <rect x="110" y="286" width="46" height="8" fill="#FBF8F3"/><path d="M112 290V244A44 44 0 0 1 156 288" fill="none" stroke="#17332E" stroke-width="1.4"/>
  <rect x="150" y="150" width="120" height="56" rx="12" fill="#17332E"/><text x="210" y="174" text-anchor="middle" font-family="Inter,sans-serif" font-size="12" fill="#CFE3DC">Net floor area</text>
  <text x="210" y="196" text-anchor="middle" font-family="Newsreader,Georgia,serif" font-size="20" font-weight="600" fill="#F4EFE7">20 m²</text>
</svg>`;

const ICON: Record<string, string> = {
  budget: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />',
  compare: '<path d="M8 3v18M16 3v18M3 8h5M16 16h5" />',
  finish: '<path d="M3 21h18M5 21V9l7-5 7 5v12M10 21v-6h4v6" />',
  quote: '<path d="M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6M10 17h6" />',
  rooms: '<path d="M3 3h18v18H3zM3 12h9V3M12 21v-5h9" />',
  lock: '<path d="M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />',
};
const icon = (name: string, color: string) =>
  `<span class="disc" style="background:${color}1f;color:${color}"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg></span>`;

const CSS = `
:root{--ground:#F4EFE7;--surface:#FBF8F3;--line:#E4DDD1;--brand:#17332E;--ink:#10241F;--accent:#2C7A69;--text:#17231F;--muted:#5F6B66;--amber:#B7791F;--amberBg:#FBEFD9;--rose:#B5545C}
@media (prefers-color-scheme:dark){:root{--ground:#121816;--surface:#1A2220;--line:#2A3431;--brand:#CFE3DC;--text:#E9EEEC;--muted:#9AA6A1;--accent:#4FB39B;--amberBg:#3A2E18}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--ground);color:var(--text);font:16px/1.65 Inter,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:inherit}h1,h2,h3{font-family:Newsreader,Georgia,serif;font-weight:600;margin:0;letter-spacing:-.015em;color:var(--brand)}
p{margin:0}.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.top{display:flex;align-items:center;justify-content:space-between;height:76px}
.brand{display:flex;align-items:center;gap:10px;font:600 21px Newsreader,Georgia,serif;color:var(--brand);text-decoration:none}
.top nav{display:flex;gap:22px;font-size:15px}.top nav a{text-decoration:none;color:var(--muted)}.top nav a:hover{color:var(--text)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 22px;border-radius:14px;font-weight:600;text-decoration:none;border:0;cursor:pointer;font-size:15px}
.btn.primary{background:var(--accent);color:#fff}.btn.ghost{background:transparent;border:1.5px solid var(--line);color:var(--text)}
.hero{display:grid;grid-template-columns:1.05fr .95fr;gap:48px;align-items:center;padding:36px 0 72px}
.chip{display:inline-flex;align-items:center;gap:8px;padding:7px 14px;border-radius:999px;background:var(--surface);border:1px solid var(--line);font-size:13.5px;color:var(--muted)}
.hero h1{font-size:clamp(42px,6vw,72px);line-height:1.02;margin:18px 0 18px}
.hero .lede{font-size:19px;color:var(--muted);max-width:520px}
.hero .ctas{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}
.honest{margin-top:16px;font-size:14px;color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:28px;padding:22px}
.plan{width:100%;height:auto;display:block;border-radius:18px}
.result{display:grid;grid-template-columns:1fr auto auto;gap:10px 14px;margin-top:16px;font-size:15px;align-items:center}
.result b{font-variant-numeric:tabular-nums}.badge{font-size:12px;padding:4px 10px;border-radius:999px;background:#2C7A6914;color:var(--accent);justify-self:end}
.sample{font-size:12px;color:var(--muted);margin-top:10px}
.money{background:#17332E;color:#F4EFE7;border-radius:28px;padding:30px;display:grid;grid-template-columns:1.2fr 2fr;gap:28px;align-items:center}
.money .hero-n{font:600 52px/1 Newsreader,Georgia,serif}.money small{display:block;color:#CFE3DC;font-size:14px;margin-bottom:6px}
.money .four{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;border-left:1px solid #ffffff22;padding-left:24px}
.money .four b{display:block;font:600 22px Newsreader,Georgia,serif;margin-top:4px}
section{padding:64px 0}section h2{font-size:clamp(30px,4vw,46px);line-height:1.08;max-width:760px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:34px}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:22px}
.tile h3{font-size:21px;margin:14px 0 6px}.tile p{color:var(--muted);font-size:15px}
.disc{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:50%}
.meter{height:12px;border-radius:999px;background:var(--line);position:relative;margin:16px 0 10px}
.meter i{position:absolute;inset:0 30% 0 0;border-radius:999px;background:var(--accent)}
.meter em{position:absolute;left:70%;top:-5px;width:22px;height:22px;border-radius:50%;background:var(--surface);border:3px solid var(--accent);transform:translateX(-50%)}
.warn{display:flex;gap:10px;align-items:center;font-size:14.5px;color:var(--muted)}.warn:before{content:"!";display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--amber);color:#fff;font-weight:700;font-size:12px;flex:none}
.price{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:30px;max-width:640px}
.price .tile b{font:600 30px Newsreader,Georgia,serif;color:var(--brand)}
.fine{font-size:13.5px;color:var(--muted);margin-top:14px;max-width:640px}
footer{border-top:1px solid var(--line);padding:30px 0 50px;color:var(--muted);font-size:14px}
footer .wrap{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}footer a{margin-right:18px}
.doc{max-width:760px;padding:24px 0 70px}.doc h1{font-size:clamp(36px,5vw,52px);margin:10px 0 6px}
.doc .meta{color:var(--muted);font-size:14px}.doc h2{font-size:26px;margin:34px 0 10px}.doc p{margin:0 0 12px}
.draft{background:var(--amberBg);color:var(--text);padding:12px 16px;border-radius:14px;font-size:14.5px;margin:18px 0}
.summary{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:18px 22px;margin:22px 0}.summary li{margin:6px 0}
form.support{display:grid;gap:14px;max-width:560px;margin-top:22px}
label{font-weight:600;font-size:14px;display:grid;gap:6px}
input,select,textarea{font:inherit;padding:12px 14px;border-radius:12px;border:1.5px solid var(--line);background:var(--surface);color:var(--text);min-height:48px}
textarea{min-height:140px}.ok{color:var(--accent);font-weight:600}.err{color:var(--rose);font-weight:600}
ol.steps li{margin:8px 0}
@media (max-width:860px){.hero{grid-template-columns:1fr;gap:28px}.grid3{grid-template-columns:1fr}.money{grid-template-columns:1fr}.money .four{grid-template-columns:repeat(2,1fr);border-left:0;padding-left:0}.top nav a.hide{display:none}.price{grid-template-columns:1fr}}
`;

function shell(title: string, description: string, body: string, extraHead = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="theme-color" content="#17332E">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(MARK(32))}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Newsreader:opsz,wght@6..72,600&display=swap" rel="stylesheet">
<style>${CSS}</style>${extraHead}</head><body>
<header class="wrap top"><a class="brand" href="/">${MARK()}HousePlan</a><nav><a class="hide" href="/#how">How it works</a><a class="hide" href="/#price">Price</a><a href="/support">Support</a></nav></header>
${body}
<footer><div class="wrap"><div><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/support">Support</a><a href="/delete-account">Delete account</a></div><div>HousePlan · planning estimates, not quotations</div></div></footer>
</body></html>`;
}

function landing(): string {
  const body = `<main>
<div class="wrap hero">
  <div>
    <span class="chip">For new builds, extensions and renovations</span>
    <h1>Know what your house will really cost.</h1>
    <p class="lede">Plan the full budget category by category, compare finishes before you buy, and track the money still needed to finish while you build.</p>
    <div class="ctas"><a class="btn primary" href="#price">See the plans</a><a class="btn ghost" href="#how">How it works</a></div>
    <p class="honest">iPhone app. Subscription required. No free trial.</p>
  </div>
  <div class="card">
    ${FLOOR_PLAN}
    <div class="result"><span>With 10% waste</span><b>22 m²</b><span class="badge">Calculated</span><span>Packs to buy</span><b>10</b><span class="badge">Calculated</span><span>Material + labour</span><b>€540</b><span class="badge">Your rates</span></div>
    <p class="sample">Sample calculation with example inputs, not a local price.</p>
  </div>
</div>
<div class="wrap"><div class="money">
  <div><small>Cash still needed (sample)</small><div class="hero-n">€60,000</div></div>
  <div class="four"><div><small>Estimated</small><b>€100k</b></div><div><small>Committed</small><b>€20k</b></div><div><small>Billed</small><b>€50k</b></div><div><small>Paid</small><b>€40k</b></div></div>
</div></div>
<section id="how"><div class="wrap">
  <h2>Every cost of the house, with nothing quietly left at zero.</h2>
  <div class="grid3">
    <div class="tile">${icon('budget', '#C99A45')}<h3>The whole-house budget</h3><p>Nineteen categories from land and permits to landscaping. Each one is included, excluded or still undecided, and unpriced lines stay visible.</p></div>
    <div class="tile">${icon('rooms', '#7F9A7A')}<h3>Measured, not guessed</h3><p>Draw each room from its dimensions. Calculators turn floors, walls and doorways into packs, cans and lengths, using the products you choose.</p></div>
    <div class="tile">${icon('compare', '#5F7896')}<h3>Compare before you buy</h3><p>Copy a saved estimate, swap oak for vinyl, and see the difference by category, with the trade-offs written down.</p></div>
    <div class="tile">${icon('quote', '#5F7896')}<h3>Quotes to commitments</h3><p>Enter supplier quotes, compare them line by line, and accept all or part. Deposits, invoices and payments stay separate.</p></div>
    <div class="tile">${icon('finish', '#C9785F')}<h3>Cost to finish</h3><p>Actual spending, remaining commitments and the work not yet ordered add up to an honest forecast and the cash still needed.</p></div>
    <div class="tile">${icon('lock', '#3F5E57')}<h3>Private by default</h3><p>Your projects are yours. No sharing, no selling, no address on exports unless you ask. Export or delete everything any time.</p></div>
  </div>
  <div class="card" style="margin-top:22px"><h3 style="font-size:22px">Budget completeness</h3><div class="meter"><i></i><em></em></div><p class="warn">Known subtotal · 3 unpriced lines · 2 undecided categories (sample)</p></div>
</div></section>
<section id="price"><div class="wrap">
  <h2>One plan, every feature.</h2>
  <div class="price">
    <div class="tile"><p>Yearly</p><b>billed yearly</b><p>The full charge is taken once a year.</p></div>
    <div class="tile"><p>Monthly</p><b>billed monthly</b><p>Cancel any time in your store settings.</p></div>
  </div>
  <p class="fine">Prices are shown in the app in your local currency, exactly as the App Store returns them. Payment starts immediately; there is no free trial. Subscriptions renew automatically until you cancel in your store settings. Estimates are planning figures based on what you enter, not quotations or professional advice.</p>
</div></section>
</main>`;
  return shell('HousePlan: house budget, materials and build tracker', DESCRIPTION, body);
}

function legalPage(doc: LegalDoc): string {
  const sections = doc.sections.map((s) => `<h2>${esc(s.heading)}</h2>${s.body.map((p) => `<p>${esc(p)}</p>`).join('')}`).join('');
  const body = `<main class="wrap doc"><h1>${esc(doc.title)}</h1><p class="meta">Version ${esc(doc.version)} · Updated ${esc(doc.updated)}</p>
${doc.draft ? '<p class="draft">Draft pending review by a qualified legal professional.</p>' : ''}
<div class="summary"><strong>In short</strong><ul>${doc.summary.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>${sections}
<p class="meta">Questions: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p></main>`;
  return shell(`${doc.title} · HousePlan`, `${doc.title} for the HousePlan app.`, body);
}

function supportPage(): string {
  const body = `<main class="wrap doc"><h1>Support</h1><p class="meta">We answer by email, usually within two working days.</p>
<p style="margin-top:16px">In the app, Settings → Support sends your request with your account attached. If you cannot sign in, use this form.</p>
<form class="support" id="support">
<label>Your email<input name="email" type="email" required autocomplete="email"></label>
<label>Topic<select name="topic"><option value="account">Account or sign-in</option><option value="billing">Subscription or billing</option><option value="bug">Something is not working</option><option value="privacy">Privacy or my data</option><option value="question">A question</option><option value="other">Something else</option></select></label>
<label>Subject<input name="subject" required maxlength="200"></label>
<label>Message<textarea name="message" required maxlength="4000"></textarea></label>
<button class="btn primary" type="submit">Send request</button><p id="status" role="status"></p></form>
<p class="meta" style="margin-top:20px">Or email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>. Please never send passwords.</p></main>
<script>
document.getElementById('support').addEventListener('submit',async function(e){e.preventDefault();var f=new FormData(this),s=document.getElementById('status');s.className='';s.textContent='Sending…';
try{var r=await fetch('/api/v1/support',{method:'POST',headers:{'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify({email:f.get('email'),topic:f.get('topic'),subject:f.get('subject'),message:f.get('message'),consent_diagnostics:false})});
var j=await r.json();if(r.ok){s.className='ok';s.textContent='Sent. We will reply to '+f.get('email')+'.';this.reset()}else{s.className='err';s.textContent=(j.error&&j.error.message)||'That did not send. Try again.'}}catch(_){s.className='err';s.textContent='No connection. Try again.'}});
</script>`;
  return shell('Support · HousePlan', 'Get help with HousePlan.', body);
}

function deletePage(): string {
  const body = `<main class="wrap doc"><h1>Delete your HousePlan account</h1><p class="meta">You can delete your account yourself, with or without an active subscription.</p>
<h2>In the app</h2><ol class="steps"><li>Open HousePlan and sign in.</li><li>Go to Settings and tap <strong>Delete account</strong>.</li><li>Optionally export your data first.</li><li>Confirm it is you: your password, or the confirmation word if you sign in with Apple or Google.</li><li>Tap <strong>Delete my account</strong>.</li></ol>
<h2>What is deleted</h2><p>Your account, profile, projects, rooms, estimates, rates, suppliers, quotes, costs, payments, forecasts, purchase lists, attachments, exports and advice history. Sign-in sessions end immediately. Live data is removed within 7 days and backup copies expire within 30 days. Minimal records the law requires us to keep (such as purchase evidence) are kept separately and only as long as required.</p>
<p class="draft"><strong>Deleting your account does not cancel your subscription.</strong> Cancel it in your App Store or Google Play subscription settings so you are not charged again.</p>
<h2>Cannot sign in?</h2><p>Send a request from the <a href="/support">support page</a> using the email on your account, with the topic "Privacy or my data". We will confirm it is you before deleting anything. You never need to email us to delete an account you can sign in to.</p></main>`;
  return shell('Delete your account · HousePlan', 'How to delete your HousePlan account and data.', body);
}

function adminPage(): string {
  const body = `<main class="wrap doc" style="max-width:1120px"><h1>Operator console</h1><p class="meta">Every action is audited. The token stays in this tab only (session storage).</p>
<div id="app"><p>Loading…</p></div></main>
<script>${ADMIN_CONSOLE_JS}</script>`;
  return shell('Operator console · HousePlan', 'HousePlan operations.', body, '<meta name="robots" content="noindex,nofollow">');
}

export const site = new Hono();

site.get('/', (c) => c.html(landing()));
site.get('/privacy', (c) => c.html(legalPage(PRIVACY)));
site.get('/terms', (c) => c.html(legalPage(TERMS)));
site.get('/support', (c) => c.html(supportPage()));
site.get('/delete-account', (c) => c.html(deletePage()));
site.get('/admin', (c) => {
  c.header('x-robots-tag', 'noindex');
  c.header('cache-control', 'no-store');
  return c.html(adminPage());
});

/** Universal links: the app opens houseplan.xenition.com/app/* paths. */
site.get('/.well-known/apple-app-site-association', (c) => {
  const team = readEnvVar(c, 'APPLE_TEAM_ID') ?? 'TEAMID';
  return c.json({ applinks: { apps: [], details: [{ appIDs: [`${team}.${BUNDLE_ID}`], components: [{ '/': '/app/*' }] }] } });
});

site.get('/.well-known/assetlinks.json', (c) => {
  const fingerprints = (readEnvVar(c, 'ANDROID_SHA256_FINGERPRINTS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return c.json([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: BUNDLE_ID, sha256_cert_fingerprints: fingerprints } }]);
});
