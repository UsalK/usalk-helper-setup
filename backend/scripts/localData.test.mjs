import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const backend = join(dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'usalk-local-data-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ['db/db.js', 'db/schema.sql', 'services/LocalData.js', 'services/TemplateSync.js']) {
    const dest = join(root, 'backend', file);
    fs.mkdirSync(dirname(dest), { recursive: true });
    fs.copyFileSync(join(backend, file), dest);
  }
  fs.writeFileSync(join(root, 'backend/package.json'), '{"type":"module"}');
  return root;
}
function boot(root, extra = '') {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import db from './db/db.js'; ${extra}; db.close();`], {
    cwd: join(root, 'backend'), encoding: 'utf8', timeout: 15000,
    env: { ...process.env, SHOPIFY_SHOP: '', SHOPIFY_CLIENT_ID: '', SHOPIFY_CLIENT_SECRET: '' }
  });
  assert.equal(result.status, 0, result.stderr);
}
function open(root) { return new DatabaseSync(join(root, 'backend/db/database.db')); }
function legacy(root, name, value) {
  const path = join(root, 'backend/config', name);
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(value));
  return path;
}
function digest(db, table) {
  const rows = db.prepare(`SELECT * FROM ${table}`).all().map(row => JSON.stringify(row)).sort();
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

test('fresh installation generates local files without accounts, prices or foreign seed imports', t => {
  const root = fixture(t);
  const seed = legacy(root, 'templates_seed.json', [{ id: 'foreign', shop_id: 'someone-else' }]);
  boot(root);
  const db = open(root);
  for (const table of ['etsy_auth', 'shopify_auth', 'templates', 'products', 'settings']) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  }
  assert.ok(db.prepare('SELECT count(*) AS n FROM variation_profiles').get().n > 0);
  assert.ok(db.prepare('SELECT combinations FROM variation_profiles').all().every(p => p.combinations === '[]'));
  db.close();
  for (const path of ['backend/.env', 'backend/db/local-state/templates.json', 'backend/db/local-state/profiles.json', 'storage/mockups', 'backend/db/agent-seo']) {
    assert.ok(fs.existsSync(join(root, path)), path);
  }
  assert.equal(fs.readFileSync(seed, 'utf8'), fs.readFileSync(join(root, 'backend/db/local-state/legacy/templates_seed.json'), 'utf8'));
});

test('repeated startup preserves settings, custom profile metadata, disabled profiles, env and storage', t => {
  const root = fixture(t);
  boot(root);
  const db = open(root);
  db.prepare("INSERT INTO settings VALUES ('default_shop', 'custom', ?)").run('"keep me"');
  db.exec("UPDATE variation_profiles SET name = 'Custom set name', ratio = 'custom', combinations = '[{\"price\":123}]' WHERE id = 'set_of_2_1_2'");
  db.exec("INSERT INTO variation_profiles (shop_id,id,name) VALUES ('default_shop','double_1_2','Preserve legacy')");
  const before = digest(db, 'variation_profiles');
  db.close();
  const env = join(root, 'backend/.env');
  const artwork = join(root, 'storage/original.png');
  fs.writeFileSync(env, 'CUSTOM_SETTING=keep-this\n');
  fs.writeFileSync(artwork, 'original bytes');
  legacy(root, 'profiles_seed.json', [{ id: 'set_of_2_1_2', name: 'overwrite attempt' }]);
  boot(root);
  boot(root);
  const after = open(root);
  assert.equal(digest(after, 'variation_profiles'), before);
  assert.equal(after.prepare("SELECT value FROM settings WHERE key = 'custom'").get().value, '"keep me"');
  after.close();
  assert.equal(fs.readFileSync(env, 'utf8'), 'CUSTOM_SETTING=keep-this\n');
  assert.equal(fs.readFileSync(artwork, 'utf8'), 'original bytes');
});

test('exports write only local files, and a deleted template is not resurrected from an export', t => {
  const root = fixture(t);
  const seed = legacy(root, 'templates_seed.json', []);
  boot(root, `db.exec("INSERT INTO templates (id, name, type) VALUES ('test', 'Local', 'flat')");
    const {exportTemplatesToSeed} = await import('./services/TemplateSync.js'); exportTemplatesToSeed();`);
  assert.equal(JSON.parse(fs.readFileSync(join(root, 'backend/db/local-state/templates.json')))[0].id, 'test');
  assert.equal(fs.readFileSync(seed, 'utf8'), '[]');
  const db = open(root);
  db.exec('DELETE FROM templates');
  db.close();
  boot(root);
  const after = open(root);
  assert.equal(after.prepare('SELECT count(*) AS n FROM templates').get().n, 0);
  after.close();
});

test('existing installation copy retains every protected record across two starts', { skip: !process.env.LOCAL_DATA_TEST_DB }, t => {
  const root = fixture(t);
  fs.copyFileSync(process.env.LOCAL_DATA_TEST_DB, join(root, 'backend/db/database.db'));
  const tables = ['settings', 'etsy_auth', 'shopify_auth', 'templates', 'variation_profiles', 'products'];
  const db = open(root);
  const before = Object.fromEntries(tables.map(table => [table, digest(db, table)]));
  db.close();
  boot(root);
  boot(root);
  const after = open(root);
  for (const table of tables) assert.equal(digest(after, table), before[table], `Existing ${table} records changed`);
  after.close();
});
