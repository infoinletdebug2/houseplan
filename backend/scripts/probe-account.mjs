// Probe platform capabilities Fork C relies on: account deletion without a password,
// storage upload/download/delete, ai.chat with a json schema. Run: node --env-file=.dev.vars scripts/probe-account.mjs
import { XenitionClient } from '@xenition/sdk';

const client = new XenitionClient(process.env.XENITION_API_KEY, { baseUrl: process.env.XENITION_API_URL });
const out = (k, v) => console.log(k.padEnd(28), typeof v === 'string' ? v : JSON.stringify(v).slice(0, 300));

try {
  const email = `probe+${Date.now()}@houseplan.test`;
  const auth = await client.auth.register({ email, password: 'probe-Password-1234', name: 'Probe' });
  out('register', 'ok');
  try {
    const r = await client.auth.deleteAccount(auth.token);
    out('deleteAccount no password', r);
  } catch (e) {
    out('deleteAccount no password', `FAIL ${e.code} ${e.message}`);
    const r = await client.auth.deleteAccount(auth.token, { password: 'probe-Password-1234' });
    out('deleteAccount with password', r);
  }
  try {
    await client.auth.login({ email, password: 'probe-Password-1234' });
    out('login after delete', 'STILL WORKS');
  } catch (e) {
    out('login after delete', `refused ${e.code}`);
  }
} catch (e) {
  out('account probe', `FAIL ${e.code} ${e.message}`);
}

try {
  const key = `probe/${Date.now()}/a.txt`;
  const up = await client.storage.upload(new TextEncoder().encode('hello houseplan'), key, { contentType: 'text/plain', bucket: 'default' });
  out('upload', { path: up.path, size: up.size, url: up.url });
  const dl = await client.storage.download(key, { bucket: 'default', expiresInSeconds: 60 });
  const res = await fetch(dl.url);
  out('download', `${res.status} ${(await res.text()).slice(0, 40)}`);
  await client.storage.delete(key, { bucket: 'default' });
  const dl2 = await client.storage.download(key, { bucket: 'default', expiresInSeconds: 60 }).catch((e) => ({ url: null, err: e.message }));
  out('download after delete', dl2.url ? `${(await fetch(dl2.url + '?v=' + Date.now())).status}` : dl2.err);
} catch (e) {
  out('storage', `FAIL ${e.code} ${e.message}`);
}

try {
  const r = await client.ai.chat(
    [
      { role: 'system', content: 'Reply with JSON.' },
      { role: 'user', content: 'Give a one-sentence summary of why a house budget needs contingency.' },
    ],
    { responseFormat: { type: 'json_schema', name: 'probe', schema: { type: 'object', additionalProperties: false, properties: { summary: { type: 'string' } }, required: ['summary'] } }, maxTokens: 200, temperature: 0 },
  );
  out('ai.chat', { model: r.model, content: r.message.content, usage: r.usage });
} catch (e) {
  out('ai.chat', `FAIL ${e.code} ${e.message}`);
}
