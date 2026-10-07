import sharp from 'sharp';
import { readdirSync } from 'node:fs';
const [dir, out, cols = '8'] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const W = 240, H = 520, C = Number(cols);
const rows = Math.ceil(files.length / C);
const comps = [];
for (const [i, f] of files.entries()) {
  const img = await sharp(`${dir}/${f}`).resize(W, H, { fit: 'cover', position: 'top' }).png().toBuffer();
  comps.push({ input: img, left: (i % C) * (W + 10), top: Math.floor(i / C) * (H + 34) });
  comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="30"><text x="4" y="20" font-family="Arial" font-size="15" fill="#888">${f.replace('.png', '')}</text></svg>`), left: (i % C) * (W + 10), top: Math.floor(i / C) * (H + 34) + H + 2 });
}
await sharp({ create: { width: C * (W + 10), height: rows * (H + 34), channels: 3, background: '#555' } }).composite(comps).jpeg({ quality: 80 }).toFile(out);
console.log(out);
