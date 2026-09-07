import { join } from 'node:path';
import db from '../db/db.js';
import { initializeLocalData, writeLocalJSON } from './LocalData.js';

/** Local exports only. The database is authoritative; never restore on startup. */
export function exportTemplatesToSeed({ onlyIfMissing = false } = {}) {
  try {
    const directory = initializeLocalData();
    const templates = db.prepare('SELECT id, shop_id, name, type, config, background_path, created_at FROM templates').all();
    const profiles = db.prepare('SELECT id, shop_id, name, ratio, sizes, frames, combinations, template_ids, kind, panel_count, panel_ratio, created_at FROM variation_profiles').all();
    writeLocalJSON(join(directory, 'templates.json'), templates, { onlyIfMissing });
    writeLocalJSON(join(directory, 'profiles.json'), profiles, { onlyIfMissing });
    return { templateCount: templates.length, profileCount: profiles.length };
  } catch (error) {
    console.error('[LocalData] Local export failed:', error.message);
    return null;
  }
}

export function initializeLocalSnapshots() {
  return exportTemplatesToSeed({ onlyIfMissing: true });
}
