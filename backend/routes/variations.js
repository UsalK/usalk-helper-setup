import express from 'express';
import { exportTemplatesToSeed } from '../services/TemplateSync.js';
import db, { getActiveShop, DISABLED_PROFILE_IDS } from '../db/db.js';

const router = express.Router();

/** DB satırını API biçimine çevirir (JSON kolonları parse edilmiş halde). */
const parseProfile = (p) => ({
  ...p,
  sizes: p.sizes ? JSON.parse(p.sizes) : [],
  frames: p.frames ? JSON.parse(p.frames) : [],
  combinations: p.combinations ? JSON.parse(p.combinations) : [],
  template_ids: p.template_ids ? JSON.parse(p.template_ids) : [],
  kind: p.kind || 'single',
  panel_count: p.panel_count || 1,
  panel_ratio: p.panel_ratio || p.ratio,
  price_grouping: p.price_grouping || 'none'
});

/** Fiyat matrisi gruplama tercihi; gecersiz deger gelirse gruplama kapali sayilir. */
const resolvePriceGrouping = (body, existing) => {
  const value = body.price_grouping ?? existing?.price_grouping ?? 'none';
  return value === 'frames' ? 'frames' : 'none';
};

/** Panel alanları gövdede yoksa mevcut satırdan korunur. */
const resolvePanelFields = (body, existing) => {
  const kind = body.kind || existing?.kind || 'single';
  const panelCount = Number(body.panel_count || existing?.panel_count || (kind === 'set' ? 2 : 1));
  const panelRatio = body.panel_ratio || existing?.panel_ratio || body.ratio;
  return { kind, panelCount, panelRatio };
};

// Get all profiles
router.get('/', (req, res, next) => {
  try {
    const activeShop = getActiveShop();
    const stmt = db.prepare('SELECT * FROM variation_profiles WHERE shop_id = ? ORDER BY ratio ASC');
    const profiles = stmt.all(activeShop.shop_id)
      .filter(p => !DISABLED_PROFILE_IDS.includes(p.id));
    res.json(profiles.map(parseProfile));
  } catch (err) {
    next(err);
  }
});

// Create or update profile
router.post('/', (req, res, next) => {
  try {
    const { id, name, ratio, sizes, frames, combinations, template_ids } = req.body;
    const activeShop = getActiveShop();
    const existing = db.prepare('SELECT * FROM variation_profiles WHERE id = ? AND shop_id = ?')
      .get(id, activeShop.shop_id);
    const { kind, panelCount, panelRatio } = resolvePanelFields(req.body, existing);
    const priceGrouping = resolvePriceGrouping(req.body, existing);

    const stmt = db.prepare(`
      INSERT INTO variation_profiles
        (id, shop_id, name, ratio, sizes, frames, combinations, template_ids, kind, panel_count, panel_ratio, price_grouping)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shop_id, id) DO UPDATE SET
        name = EXCLUDED.name,
        ratio = EXCLUDED.ratio,
        sizes = EXCLUDED.sizes,
        frames = EXCLUDED.frames,
        combinations = EXCLUDED.combinations,
        template_ids = EXCLUDED.template_ids,
        kind = EXCLUDED.kind,
        panel_count = EXCLUDED.panel_count,
        panel_ratio = EXCLUDED.panel_ratio,
        price_grouping = EXCLUDED.price_grouping
    `);
    stmt.run(
      id,
      activeShop.shop_id,
      name,
      ratio,
      JSON.stringify(sizes || []),
      JSON.stringify(frames || []),
      JSON.stringify(combinations || []),
      JSON.stringify(template_ids || []),
      kind,
      panelCount,
      panelRatio,
      priceGrouping
    );
    exportTemplatesToSeed();
    res.json({
      id, shop_id: activeShop.shop_id, name, ratio, sizes, frames, combinations, template_ids,
      kind, panel_count: panelCount, panel_ratio: panelRatio, price_grouping: priceGrouping
    });
  } catch (err) {
    next(err);
  }
});

// Update profile
router.put('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, ratio, sizes, frames, combinations, template_ids } = req.body;
    const activeShop = getActiveShop();
    const existing = db.prepare('SELECT * FROM variation_profiles WHERE id = ? AND shop_id = ?')
      .get(id, activeShop.shop_id);
    const { kind, panelCount, panelRatio } = resolvePanelFields(req.body, existing);
    const priceGrouping = resolvePriceGrouping(req.body, existing);

    const stmt = db.prepare(`
      UPDATE variation_profiles
      SET name = ?, ratio = ?, sizes = ?, frames = ?, combinations = ?, template_ids = ?,
          kind = ?, panel_count = ?, panel_ratio = ?, price_grouping = ?
      WHERE id = ? AND shop_id = ?
    `);
    stmt.run(
      name,
      ratio,
      JSON.stringify(sizes || []),
      JSON.stringify(frames || []),
      JSON.stringify(combinations || []),
      JSON.stringify(template_ids || []),
      kind,
      panelCount,
      panelRatio,
      priceGrouping,
      id,
      activeShop.shop_id
    );
    exportTemplatesToSeed();
    res.json({
      id, shop_id: activeShop.shop_id, name, ratio, sizes, frames, combinations, template_ids,
      kind, panel_count: panelCount, panel_ratio: panelRatio, price_grouping: priceGrouping
    });
  } catch (err) {
    next(err);
  }
});

// Delete profile
router.delete('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const activeShop = getActiveShop();
    const stmt = db.prepare('DELETE FROM variation_profiles WHERE id = ? AND shop_id = ?');
    stmt.run(id, activeShop.shop_id);
    exportTemplatesToSeed();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
