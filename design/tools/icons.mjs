// Renders the HousePlan app icon, Android adaptive icon, splash mark and favicon
// from one SVG mark (the same drawing as mobile/src/ui/Mark.tsx), in the
// cream / espresso / burnt-orange palette.
//   cd design/tools && node icons.mjs
import sharp from 'sharp';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '../../mobile/assets');
const ESPRESSO = '#2A1E17';
const NIGHT = '#1F1611';
const CREAM = '#FBF4EA';
const ORANGE = '#C4561F';
const APRICOT = '#F5A270';

/** The mark on a 32-unit grid, placed at (x, y) with scale s. */
const mark = (x, y, s, line, accent) => `
  <g transform="translate(${x} ${y}) scale(${s})" fill="none">
    <path d="M5 15.5 16 6l11 9.5" stroke="${line}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8 13.5V24h16V13.5" stroke="${line}" stroke-width="2.6" stroke-linejoin="round"/>
    <rect x="13.6" y="17.4" width="4.8" height="6.6" rx="0.8" fill="${accent}"/>
    <path d="M8 28h16M8 26.6v2.8M24 26.6v2.8" stroke="${accent}" stroke-width="1.6" stroke-linecap="round"/>
  </g>`;

/** A faint blueprint grid, the app's signature texture. */
const grid = (size, step, color) => {
  let lines = '';
  for (let v = step; v < size; v += step) lines += `<path d="M${v} 0V${size}M0 ${v}H${size}" stroke="${color}" stroke-width="2"/>`;
  return lines;
};

const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><radialGradient id="hp-glow" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#3A2A20"/><stop offset="1" stop-color="${NIGHT}"/></radialGradient></defs>
  <rect width="1024" height="1024" fill="url(#hp-glow)"/>
  ${grid(1024, 64, 'rgba(251,244,234,0.05)')}
  ${mark(192, 172, 20, CREAM, APRICOT)}
</svg>`;

// Android adaptive foreground: the mark inside the 66% safe zone, transparent around it.
const adaptive = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${mark(272, 252, 15, CREAM, APRICOT)}</svg>`;
const splash = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${mark(64, 56, 12, CREAM, APRICOT)}</svg>`;
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="20" fill="${ESPRESSO}"/>${mark(8, 6, 2.5, CREAM, ORANGE)}</svg>`;

await sharp(Buffer.from(icon)).png().toFile(join(out, 'icon.png'));
await sharp(Buffer.from(adaptive)).png().toFile(join(out, 'adaptive-icon.png'));
await sharp(Buffer.from(splash)).png().toFile(join(out, 'splash-icon.png'));
await sharp(Buffer.from(favicon)).resize(48, 48).png().toFile(join(out, 'favicon.png'));
console.log('icons rendered →', out);
