// Builds a self-contained HTML page comparing the palette candidates
// (design/palettes/<id>/*.png), with screenshots embedded as JPEG data URIs.
import sharp from 'sharp';
import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTES } from './palettes-data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(ROOT, 'design/palettes');
const SCREENS = [
  ['01-discover', 'Discovery'],
  ['12-onboarding-help', 'Onboarding'],
  ['20-paywall-list-price', 'Paywall'],
  ['33-settings', 'Settings'],
];

const shots = {};
for (const p of PALETTES) {
  shots[p.id] = [];
  for (const [file, label] of SCREENS) {
    const src = join(DIR, p.id, `${file}.png`);
    if (!existsSync(src)) continue;
    const buf = await sharp(src).resize(360, 768, { fit: 'cover', position: 'top' }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
    shots[p.id].push({ label, uri: `data:image/jpeg;base64,${buf.toString('base64')}` });
  }
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const swatch = (hex, name) => `<li><span style="background:${hex}"></span><b>${name}</b><code>${hex}</code></li>`;

const sections = PALETTES.map(
  (p) => `
  <section class="pal" id="palette-${p.id}">
    <header class="pal-head">
      <p class="letter" style="color:${p.c.primary}">${p.id}</p>
      <div class="pal-name">
        <h2>${esc(p.name)}</h2>
        <p>${esc(p.note)}</p>
      </div>
      <ul class="swatches">
        ${swatch(p.c.ground, 'Ground')}${swatch(p.c.ink, 'Headlines')}${swatch(p.c.primary, 'Main button')}${swatch(p.c.primaryTint, 'Highlight')}${swatch(p.c.night, 'Discovery')}
      </ul>
    </header>
    <div class="shots">
      ${shots[p.id].map((s) => `<figure><img src="${s.uri}" alt="${p.name}: ${s.label} screen" loading="lazy"><figcaption>${s.label}</figcaption></figure>`).join('')}
    </div>
  </section>`,
).join('');

const html = `<title>HousePlan Palette Choice</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,600&family=Inter:wght@400;500;600&display=swap">
<style>
/* Layout: one band per palette, its four real app screens in a row that wraps on phones. */
:root {
  --bg: #F5F4F2; --surface: #FFFFFF; --fg: #1E1D1B; --muted: #6A6762; --line: #E2DFDA;
  --display: 'Newsreader', Georgia, serif; --body: 'Inter', system-ui, -apple-system, sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #161615; --surface: #1F1E1D; --fg: #EFEDEA; --muted: #A29E98; --line: #33312F; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #161615; --surface: #1F1E1D; --fg: #EFEDEA; --muted: #A29E98; --line: #33312F; color-scheme: dark }
body { background: var(--bg); color: var(--fg); font-family: var(--body); }
.wrap { max-width: 1180px; margin: 0 auto; padding-inline: 20px; padding-block: 40px 64px; display: grid; gap: 28px; }
.intro h1 { font-family: var(--display); font-size: clamp(30px, 5vw, 44px); line-height: 1.05; margin: 0 0 10px; text-wrap: balance; }
.intro p { margin: 0; max-width: 62ch; color: var(--muted); font-size: 15.5px; line-height: 1.55; }
.pal { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 22px; display: grid; gap: 18px; }
.pal-head { display: grid; grid-template-columns: auto 1fr; gap: 6px 18px; align-items: center; }
.letter { font-family: var(--display); font-size: 56px; line-height: 1; margin: 0; grid-row: span 2; }
.pal-name { min-width: 0; }
.pal-name h2 { margin: 0; font-size: 20px; font-weight: 600; }
.pal-name p { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
.swatches { grid-column: 2; list-style: none; padding: 0; margin: 6px 0 0; display: flex; flex-wrap: wrap; gap: 10px 16px; }
.swatches li { display: grid; grid-template-columns: 28px auto; grid-template-rows: auto auto; column-gap: 8px; align-items: center; font-size: 12px; }
.swatches span { grid-row: span 2; width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--line); }
.swatches b { font-weight: 500; }
.swatches code { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.shots { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
figure { margin: 0; display: grid; gap: 8px; }
figure img { width: 100%; aspect-ratio: 360 / 768; object-fit: cover; object-position: top; border-radius: 14px; border: 1px solid var(--line); display: block; max-width: 100%; }
figcaption { font-size: 13px; color: var(--muted); text-align: center; }
@media (max-width: 760px) { .shots { grid-template-columns: repeat(2, minmax(0, 1fr)); } .letter { font-size: 44px; } }
.foot { color: var(--muted); font-size: 14px; line-height: 1.55; max-width: 62ch; }
</style>
<main class="wrap">
  <div class="intro">
    <h1>Pick a colour for HousePlan</h1>
    <p>Four palettes, each shown on the same four real app screens: discovery, onboarding, the paywall and settings. Tell me the letter you like (A, B, C or D), or mix them, for example "B but with the C button colour".</p>
  </div>
  ${sections}
  <p class="foot">Photos stay the same in every option; once you choose, the remaining photos and the Codex design boards are made in that palette, and the app, website and PDF reports switch to it. Warnings (unpriced, pending) and over-budget colours stay separate from the main button in every option.</p>
</main>`;

writeFileSync(join(DIR, 'palette-choice.html'), html);
console.log('page →', join(DIR, 'palette-choice.html'), Math.round(html.length / 1024), 'KB');
