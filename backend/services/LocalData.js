import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

// Exclusive creation: even concurrent first starts cannot overwrite user files.
export function createMissingFile(path, content) {
  fs.mkdirSync(dirname(path), { recursive: true });
  try {
    fs.writeFileSync(path, content, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

export function initializeLocalData(root = PROJECT_ROOT) {
  const localDir = join(root, 'backend/db/local-state');
  for (const relative of ['backend/db', 'backend/db/agent-seo', 'backend/db/local-state',
    'storage/uploads', 'storage/mockups', 'storage/templates', 'storage/exports', 'logs']) {
    fs.mkdirSync(join(root, relative), { recursive: true });
  }
  createMissingFile(join(root, 'backend/.env'),
    '# Local configuration. Never commit this file.\n' +
    'ETSY_CLIENT_ID=\nETSY_CLIENT_SECRET=\nETSY_REDIRECT_URI=\nOPENROUTER_API_KEY=\n');

  // Preserve legacy exports for manual recovery, but never import another
  // installation's shop IDs or overwrite the authoritative local database.
  for (const name of ['templates_seed.json', 'profiles_seed.json']) {
    const legacy = join(root, 'backend/config', name);
    const archived = join(localDir, 'legacy', name);
    if (fs.existsSync(legacy) && !fs.existsSync(archived)) {
      createMissingFile(archived, fs.readFileSync(legacy));
    }
  }
  createMissingFile(join(localDir, 'README.txt'),
    'Local template/profile exports; database.db is authoritative.\n' +
    'These files are not automatically imported on startup.\n' +
    'legacy/ preserves old exports for manual recovery only.\n');
  return localDir;
}

export function writeLocalJSON(path, value, { onlyIfMissing = false } = {}) {
  const contents = JSON.stringify(value, null, 2) + '\n';
  if (onlyIfMissing) return createMissingFile(path, contents);
  fs.mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, path);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return true;
}
