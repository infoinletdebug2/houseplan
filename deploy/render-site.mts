/**
 * Render the worker's public pages to static HTML for the deploy pipeline
 * (it serves frontend/ from the same Worker; /api/* and /health go to the
 * worker first). Prints a JSON map of { file: html } to stdout.
 *
 *   cd backend && npx tsx ../deploy/render-site.mts
 */
import { existsSync, readFileSync } from 'node:fs';
import { site } from '../backend/src/site';

/** `/img/<name>.jpg` → a data URL from deploy/site-img/ (the pipeline ships text only). */
const IMG = new URL('./site-img/', import.meta.url);
function inlineImages(html: string): string {
  return html.replace(/\/img\/([a-z0-9-]+\.jpg)/g, (_, file: string) => {
    const path = new URL(file, IMG);
    if (!existsSync(path)) throw new Error(`missing deploy/site-img/${file}`);
    return `data:image/jpeg;base64,${readFileSync(path).toString('base64')}`;
  });
}

/** Internal links point at clean paths (`/privacy`), which the pipeline serves from public/<path>/index.html. */
export const PAGES: Record<string, string> = {
  'index.html': '/',
  'public/privacy/index.html': '/privacy',
  'public/terms/index.html': '/terms',
  'public/support/index.html': '/support',
  'public/delete-account/index.html': '/delete-account',
  'public/admin/index.html': '/admin',
  'public/.well-known/apple-app-site-association': '/.well-known/apple-app-site-association',
  'public/.well-known/assetlinks.json': '/.well-known/assetlinks.json',
};

const out: Record<string, string> = {};
for (const [file, path] of Object.entries(PAGES)) {
  const res = await site.request(path, {}, process.env as Record<string, string>);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  out[file] = file.endsWith('.html') ? inlineImages(await res.text()) : await res.text();
}
process.stdout.write(JSON.stringify(out));
