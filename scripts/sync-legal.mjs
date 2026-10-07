#!/usr/bin/env node
// Copy the legal texts from the backend (the one source) into the app bundle,
// so the in-app Terms and Privacy screens are identical to the website.
//   node scripts/sync-legal.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'backend/src/legal.ts'), 'utf8');
const header = '// GENERATED from backend/src/legal.ts by scripts/sync-legal.mjs. Edit the backend copy, then run the script.\n';
const target = join(root, 'mobile/src/legal/content.ts');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, header + src);
console.log('legal texts synced → mobile/src/legal/content.ts');
