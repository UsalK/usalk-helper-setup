/**
 * Çok panelli set şablonlarında panel eşleştirmesini ölçer.
 *
 * Kullanıcının elle yerleştirdiği panelleri yer gerçeği kabul eder; otomatik
 * tanımanın bulduğu seriyi soldan sağa aynı panellerle karşılaştırır.
 *
 * Kullanım (backend/ içinden):
 *   node scripts/panelRowTest.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import { join, resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

globalThis.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') throw new Error('unsupported ' + tag);
    return createCanvas(1, 1);
  }
};
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);

const { detectMockupQuads } = await import(
  pathToFileURL(join(ROOT, 'frontend/src/utils/mockupDetect.js')).href + '?v=' + Date.now()
);
const { pickPanelRow } = await import(
  pathToFileURL(join(ROOT, 'frontend/src/utils/panelRow.js')).href + '?v=' + Date.now()
);

const db = new DatabaseSync(join(ROOT, 'backend/db/database.db'));
const rows = db.prepare("SELECT name, type, config, background_path FROM templates WHERE background_path <> ''").all();

/** Panelin sınırlayıcı kutusundan köşe yapısı üretir (flat şablonlar için). */
const cornersOfSlot = (slot) => {
  if (slot.corners) return slot.corners;
  const p = slot.placement;
  if (!p) return null;
  return {
    tl: { x: p.x, y: p.y },
    tr: { x: p.x + p.width, y: p.y },
    br: { x: p.x + p.width, y: p.y + p.height },
    bl: { x: p.x, y: p.y + p.height }
  };
};

const centerX = (c) => (c.tl.x + c.tr.x + c.br.x + c.bl.x) / 4;
const cornerErr = (a, b) => {
  let sum = 0;
  for (const k of ['tl', 'tr', 'br', 'bl']) sum += Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y);
  return sum / 4;
};

const seen = new Set();
const cases = [];
for (const r of rows) {
  let cfg;
  try { cfg = JSON.parse(r.config); } catch { continue; }
  const slots = Array.isArray(cfg.slots) ? cfg.slots : [];
  if (slots.length < 2) continue;

  const truth = slots.map(cornersOfSlot).filter(Boolean);
  if (truth.length !== slots.length) continue;

  const abs = join(ROOT, r.background_path);
  if (!fs.existsSync(abs)) continue;

  const key = fs.statSync(abs).size + ':' + slots.length;
  if (seen.has(key)) continue;
  seen.add(key);

  // Yer gerçeği de soldan sağa sıralanır
  truth.sort((a, b) => centerX(a) - centerX(b));
  cases.push({ name: r.name, type: r.type, count: slots.length, truth, abs });
}

console.log(`Çok panelli benzersiz şablon: ${cases.length}\n`);

let matched = 0, missed = 0, wrong = 0;
for (const c of cases) {
  const img = await loadImage(resolve(c.abs));
  const candidates = await detectMockupQuads(img, { maxCandidates: 8 });
  const row = pickPanelRow(candidates, c.count);

  if (!row) {
    missed++;
    console.log(`  ✗ seri bulunamadı   ${String(c.count)}p ${c.type.padEnd(11)} ${c.name}  (${candidates.length} aday)`);
    continue;
  }

  const errs = row.panels.map((p, i) => cornerErr(p.corners, c.truth[i]));
  const worst = Math.max(...errs);
  if (worst < 0.06) {
    matched++;
    console.log(`  ✓ hata=${worst.toFixed(3)}      ${String(c.count)}p ${c.type.padEnd(11)} ${c.name}`);
  } else {
    wrong++;
    console.log(`  ~ hata=${worst.toFixed(3)}      ${String(c.count)}p ${c.type.padEnd(11)} ${c.name}  [${errs.map(e => e.toFixed(2)).join(' ')}]`);
  }
}

const total = cases.length || 1;
console.log(`\n✓ paneller doğru oturdu : ${matched}/${cases.length} (${(matched / total * 100).toFixed(0)}%)`);
console.log(`~ seri bulundu ama kaymış: ${wrong}/${cases.length}`);
console.log(`✗ seri bulunamadı        : ${missed}/${cases.length}`);
