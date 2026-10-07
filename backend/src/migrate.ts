import { createHash } from 'node:crypto';
import { XenitionClient } from '@xenition/sdk';
import { APP_MIGRATIONS } from './schema';
import { fromProcess, productCatalog } from './config';
import { CATALOGUE_SEED } from './catalogue';

/**
 * The deploy step: once per deploy, before traffic. Idempotent; an applied
 * migration's SQL is never edited. Engine functions carry a hash of their
 * SQL in the id, so an edited function is a new migration that replaces it.
 *
 * Seeds only what BRD §9.7 allows: currencies, catalogue specifications and
 * calculator versions. No construction rates.
 */
async function main(): Promise<void> {
  const key = process.env.XENITION_API_KEY;
  if (!key) throw new Error('migrate: XENITION_API_KEY (a service key) is required.');
  const client = new XenitionClient(key, { baseUrl: process.env.XENITION_API_URL });

  process.stdout.write(`applying ${APP_MIGRATIONS.length} migrations… `);
  const result = await client.migrations.apply(APP_MIGRATIONS);
  console.log(`${result.applied.length} applied, ${result.skipped.length} already present`);
  for (const id of result.applied) console.log(`  + ${id}`);

  for (const module of ['billing', 'notifications'] as const) {
    process.stdout.write(`enabling ${module}… `);
    await client.modules.enable(module);
    console.log('ok');
  }

  const catalog = productCatalog(fromProcess);
  process.stdout.write(`declaring ${catalog.length} products… `);
  for (const product of catalog) await client.modules.billing.defineProduct(product);
  console.log('ok');

  process.stdout.write(`catalogue: ${CATALOGUE_SEED.length} specifications… `);
  for (const item of CATALOGUE_SEED) {
    await client.query.raw(
      `INSERT INTO hp__catalogue_item (id, code, category_code, name, kind, unit, specification)
       VALUES (gen_random_uuid(), $1::text, $2::text, $3::text, $4::text, $5::text, $6::jsonb)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, unit = EXCLUDED.unit, specification = EXCLUDED.specification, updated_at = now()`,
      [item.code, item.category, item.name, item.kind, item.unit, JSON.stringify(item.specification)],
    );
  }
  console.log('ok');

  // The deploy pipeline can't install these as Worker secrets; store their
  // digests so the admin and job routes still open with the right value.
  for (const [name, envName, min] of [['admin', 'ADMIN_TOKEN', 24], ['jobs', 'JOB_SECRET', 16]] as const) {
    const value = process.env[envName]?.trim();
    if (!value || value.length < min) continue;
    const digest = createHash('sha256').update(value).digest('hex');
    await client.query.raw(
      `INSERT INTO hp__operator_secret (name, digest) VALUES ($1::text, $2::text)
       ON CONFLICT (name) DO UPDATE SET digest = EXCLUDED.digest, updated_at = now()`,
      [name, digest],
    );
    console.log(`stored the ${envName} digest`);
  }
  console.log('\ndone.');
}

main().catch((err) => {
  console.error('\nmigrate failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
