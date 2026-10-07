// Renders the same app screens in several palette candidates so the owner can
// choose. For each palette: temporarily swap the current colours across
// mobile/app + mobile/src, export the web build against the harness stub,
// shoot a few screens, then restore the source from git. Finally a labelled
// comparison sheet per screen and one overview sheet.
//   cd design/tools && node palettes.mjs
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MOBILE = join(ROOT, 'mobile');
const OUT = join(ROOT, 'design/palettes');

// The colours the app uses today (palette A), as keys.
const KEYS = {
  ground: '#FBF4EA', ground2: '#F4E9DA', surface: '#FFFBF5', line: '#EADFCF', ink: '#2A1E17', muted: '#7A6A5D', faint: '#A99A8C',
  brandTint: '#F1E6DA', onBrandSoft: '#C9B6A4', night: '#1F1611', primary: '#C4561F', primary2: '#A8461A', primaryTint: '#FBE4D6',
  onPrimarySoft: '#F6C9AE', gold2: '#E9A27A', goldInk: '#9A3F14', apricot: '#F5A270', bar2: '#E08A4F', bar4: '#F2C3A2',
};

export const PALETTES = [
  { id: 'A', name: 'Cream & burnt orange', note: 'Warm, homely, timber and terracotta', c: { ...KEYS } },
  {
    id: 'B', name: 'Navy & clay', note: 'Architectural, calm, trustworthy',
    c: { ground: '#F6F3EE', ground2: '#ECE6DD', surface: '#FFFFFF', line: '#E2DCD2', ink: '#14213D', muted: '#5E6677', faint: '#9AA0AD', brandTint: '#E6E9F0', onBrandSoft: '#AEB8CC', night: '#0E1830', primary: '#B5532D', primary2: '#96431F', primaryTint: '#F6E1D6', onPrimarySoft: '#F0C4AE', gold2: '#DE9A7C', goldInk: '#8A3C1C', apricot: '#E8A383', bar2: '#D0754C', bar4: '#EFC4AE' },
  },
  {
    id: 'C', name: 'Aubergine & raspberry', note: 'Bold, editorial, memorable',
    c: { ground: '#FAF5F2', ground2: '#F1E8E4', surface: '#FFFFFF', line: '#E8DCD8', ink: '#3A1F3D', muted: '#75626F', faint: '#A897A2', brandTint: '#EFE3EE', onBrandSoft: '#C7AFC4', night: '#24122A', primary: '#B8436B', primary2: '#993357', primaryTint: '#F7DDE6', onPrimarySoft: '#EFB9CB', gold2: '#DE93AD', goldInk: '#8A2C4C', apricot: '#E79AB6', bar2: '#CF6E90', bar4: '#F0C3D3' },
  },
  {
    id: 'D', name: 'Charcoal & saffron', note: 'Modern, high contrast, construction-site energy',
    c: { ground: '#F7F5F0', ground2: '#EDEAE2', surface: '#FFFFFF', line: '#E3DFD6', ink: '#1F2328', muted: '#61666D', faint: '#9A9EA4', brandTint: '#E8E9EB', onBrandSoft: '#AEB3B9', night: '#15181C', primary: '#B97D10', primary2: '#9A680C', primaryTint: '#F8EBCF', onPrimarySoft: '#EED29A', gold2: '#E2B85F', goldInk: '#7E5508', apricot: '#EDC26A', bar2: '#D49A2E', bar4: '#F1DCAA' },
  },
];

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
const SCREENS = ['01-discover', '12-onboarding-build', '20-paywall-list-price', '33-settings'];
const LABELS = { '01-discover': 'Discovery', '12-onboarding-build': 'Onboarding', '20-paywall-list-price': 'Paywall', '33-settings': 'Settings' };

function walk(d, out = []) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|json)$/.test(n)) out.push(p);
  }
  return out;
}

function apply(target) {
  const files = [...walk(join(MOBILE, 'app')), ...walk(join(MOBILE, 'src'))];
  // Two passes through unique placeholders so swaps never collide.
  for (const f of files) {
    let s = readFileSync(f, 'utf8');
    const before = s;
    for (const [k, hex] of Object.entries(KEYS)) {
      s = s.replace(new RegExp(hex, 'gi'), `@@${k}@@`).replace(new RegExp(`rgba\\(${rgb(hex)},`, 'g'), `@@rgba_${k}@@`);
    }
    for (const [k, hex] of Object.entries(target)) {
      s = s.split(`@@${k}@@`).join(hex).split(`@@rgba_${k}@@`).join(`rgba(${rgb(hex)},`);
    }
    if (s !== before) writeFileSync(f, s);
  }
}

mkdirSync(OUT, { recursive: true });
const sh = (cmd, opts = {}) => execSync(cmd, { cwd: MOBILE, stdio: 'pipe', encoding: 'utf8', maxBuffer: 50e6, ...opts });
try {
  for (const p of PALETTES) {
    console.log(`palette ${p.id}: ${p.name}`);
    if (p.id !== 'A') apply(p.c);
    sh('bash harness/run.sh --only=' + SCREENS.join(','), { env: { ...process.env, HARNESS_SHOTS: `shots-palette-${p.id}` } });
    sh('git checkout -- app src');
    mkdirSync(join(OUT, p.id), { recursive: true });
    for (const s of SCREENS) {
      const src = join(MOBILE, 'harness', `shots-palette-${p.id}`, `${s}.png`);
      if (existsSync(src)) copyFileSync(src, join(OUT, p.id, `${s}.png`));
    }
  }
} finally {
  sh('git checkout -- app src');
}

// Comparison sheet: one row per palette, one column per screen, with labels.
const W = 300;
const H = 640;
const LABEL_W = 260;
const HEAD = 70;
const composites = [];
for (const [ri, p] of PALETTES.entries()) {
  const y = HEAD + ri * (H + 30);
  composites.push({
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_W}" height="${H}">
      <rect width="${LABEL_W}" height="${H}" fill="#ffffff"/>
      <text x="24" y="70" font-family="Georgia" font-size="64" font-weight="700" fill="${p.c.ink}">${p.id}</text>
      <text x="24" y="120" font-family="Arial" font-size="22" font-weight="700" fill="#222">${p.name.replace('&', '&amp;')}</text>
      <text x="24" y="152" font-family="Arial" font-size="15" fill="#666">${p.note}</text>
      ${[p.c.ground, p.c.ink, p.c.primary, p.c.primaryTint, p.c.night].map((col, i) => `<rect x="${24 + i * 44}" y="180" width="36" height="36" rx="8" fill="${col}" stroke="#ddd"/>`).join('')}
    </svg>`),
    left: 0,
    top: y,
  });
  for (const [ci, s] of SCREENS.entries()) {
    const file = join(OUT, p.id, `${s}.png`);
    if (!existsSync(file)) continue;
    const img = await sharp(file).resize(W, H, { fit: 'cover', position: 'top' }).png().toBuffer();
    composites.push({ input: img, left: LABEL_W + ci * (W + 20), top: y });
  }
}
const header = `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_W + SCREENS.length * (W + 20)}" height="${HEAD}">
  ${SCREENS.map((s, i) => `<text x="${LABEL_W + i * (W + 20) + W / 2}" y="44" text-anchor="middle" font-family="Arial" font-size="24" font-weight="700" fill="#333">${LABELS[s]}</text>`).join('')}
</svg>`;
composites.push({ input: Buffer.from(header), left: 0, top: 0 });
await sharp({ create: { width: LABEL_W + SCREENS.length * (W + 20), height: HEAD + PALETTES.length * (H + 30), channels: 3, background: '#ffffff' } })
  .composite(composites)
  .jpeg({ quality: 88 })
  .toFile(join(OUT, 'compare.jpg'));
console.log('compare sheet →', join(OUT, 'compare.jpg'));
