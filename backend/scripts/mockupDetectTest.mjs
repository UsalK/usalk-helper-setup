// Otomatik köşe tanıma motorunu, kullanıcının elle ayarladığı gerçek
// şablonlara karşı ölçer. Tarayıcı API'lerini @napi-rs/canvas ile taklit eder.
//
// Kullanım: node detectTest.mjs [örneklem] [tip] [--v]

import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'path';
import fs from 'fs';

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';

// backend/scripts -> proje koku
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

import { createCanvas, loadImage } from '@napi-rs/canvas';

globalThis.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') throw new Error('unsupported ' + tag);
    return createCanvas(1, 1);
  }
};
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);

const { analyzeMockup } = await import(pathToFileURL(join(ROOT, 'frontend/src/utils/mockupDetect.js')).href + '?v=' + Date.now());
const { measureQuad } = await import(pathToFileURL(join(ROOT, 'frontend/src/utils/quadGeometry.js')).href + '?v=' + Date.now());

const db = new DatabaseSync(join(ROOT, 'backend/db/database.db'));
const rows = db.prepare('SELECT id, name, type, config, background_path FROM templates').all();

const args = process.argv.slice(2);
const limit = Number(args[0] || 25);
const onlyType = args[1] && !args[1].startsWith('--') ? args[1] : null;
const verbose = args.includes('--v');

const seen = new Set();
const candidates = [];
for (const row of rows) {
  let cfg;
  try { cfg = JSON.parse(row.config); } catch { continue; }
  if (!row.background_path || row.type === 'static') continue;
  if (onlyType && row.type !== onlyType) continue;

  const slots = Array.isArray(cfg.slots) && cfg.slots.length
    ? cfg.slots : [{ placement: cfg.placement, corners: cfg.corners }];
  if (slots.length !== 1) continue;

  let truth = null;
  if (row.type === 'perspective') {
    truth = slots[0].corners || cfg.corners;
  } else {
    const p = slots[0].placement || cfg.placement;
    if (p) truth = {
      tl: { x: p.x, y: p.y },
      tr: { x: p.x + p.width, y: p.y },
      br: { x: p.x + p.width, y: p.y + p.height },
      bl: { x: p.x, y: p.y + p.height }
    };
  }
  if (!truth || !truth.tl) continue;

  const abs = join(ROOT, row.background_path);
  if (!fs.existsSync(abs)) continue;

  // Aynı arka planın kopyalarını tekrar test etme
  const stat = fs.statSync(abs);
  const key = stat.size + ':' + Math.round(truth.tl.x * 1e4) + ':' + Math.round(truth.br.y * 1e4);
  if (seen.has(key)) continue;
  seen.add(key);

  candidates.push({ row, cfg, truth, abs });
}

const step = Math.max(1, Math.floor(candidates.length / limit));
const sample = candidates.filter((_, i) => i % step === 0).slice(0, limit);

console.log(`Toplam benzersiz şablon: ${candidates.length}, test edilen: ${sample.length}\n`);

const cornerErr = (a, b) => {
  let sum = 0;
  for (const k of ['tl', 'tr', 'br', 'bl']) sum += Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y);
  return sum / 4;
};

let hit = 0, inList = 0, rawOnly = 0, miss = 0, totalMs = 0;
let usable = 0, noCand = 0, wrong = 0;

for (const c of sample) {
  const img = await loadImage(c.abs);
  const t0 = Date.now();
  let res;
  try {
    res = await analyzeMockup(img, { maxCandidates: 4 });
  } catch (e) {
    console.log(`  ! HATA ${c.row.name}: ${e.message}`);
    miss++;
    continue;
  }
  const ms = Date.now() - t0;
  totalMs += ms;

  const errs = res.candidates.map(k => cornerErr(k.corners, c.truth));
  const bestIdx = errs.length ? errs.indexOf(Math.min(...errs)) : -1;
  const topErr = errs.length ? errs[0] : null;
  const bestErr = bestIdx >= 0 ? errs[bestIdx] : null;

  // Ham havuzda (elenmişler dahil) doğru dörtgen var mıydı?
  const rawErrs = res.all.map(k => cornerErr(k.corners, c.truth));
  const rawIdx = rawErrs.length ? rawErrs.indexOf(Math.min(...rawErrs)) : -1;
  const rawBest = rawIdx >= 0 ? rawErrs[rawIdx] : null;

  if (topErr === null) noCand++;
  else if (topErr < 0.06) usable++;
  else wrong++;

  let flag;
  if (topErr !== null && topErr < 0.02) { flag = '✓ '; hit++; }
  else if (bestErr !== null && bestErr < 0.02) { flag = `~${bestIdx + 1}`; inList++; }
  else if (rawBest !== null && rawBest < 0.02) { flag = 'E '; rawOnly++; }
  else { flag = '✗ '; miss++; }

  const m = topErr !== null ? measureQuad(res.candidates[0].corners, img.width, img.height) : null;
  const line = m
    ? `hata=${topErr.toFixed(4)} oran=${m.aspect.toFixed(3)}/${m.rawAspect.toFixed(3)} sapma=${(m.deviation * 100).toFixed(1)}% ${res.candidates[0].kind} n=${res.candidates.length}`
    : 'aday yok';
  console.log(`  ${flag} ${line} ${ms}ms  ${c.row.type.padEnd(11)} ${c.row.name}`);

  if (verbose && flag !== '✓ ') {
    const f = (v, d = 3) => (typeof v === 'number' ? v.toFixed(d) : '-');
    if (rawIdx >= 0) {
      const r = res.all[rawIdx];
      console.log(`       ham en yakın: hata=${f(rawBest, 4)} eleme=${r.reject || '-'} kaynak=${r.source} doluluk=${f(r.fillRatio, 2)} alan=${f(r.areaFrac)} puan=${f(r.score, 2)} dstk=${f(r.support?.min, 2)}/${f(r.support?.mean, 2)}`);
    } else {
      console.log('       ham havuz boş');
    }
    res.candidates.slice(0, 3).forEach((k, i) => {
      console.log(`       #${i + 1} puan=${f(k.score, 2)} hata=${f(errs[i])} ${k.kind}/${k.source} doluluk=${f(k.fillRatio, 2)} alan=${f(k.areaFrac)} dstk=${f(k.support?.min, 2)}/${f(k.support?.mean, 2)}`);
    });
  }
}

const total = sample.length;
const pct = (n) => `${n}/${total} (${(n / total * 100).toFixed(0)}%)`;
console.log(`\n✓  İlk aday doğru:        ${pct(hit)}`);
console.log(`~  Adaylar arasında:       ${pct(inList)}`);
console.log(`E  Bulundu ama elendi:     ${pct(rawOnly)}`);
console.log(`✗  Hiç bulunamadı:         ${pct(miss)}`);
console.log(`   Ortalama süre:          ${(totalMs / total).toFixed(0)}ms`);
console.log(`\n--- kullanılabilirlik (ilk aday) ---`);
console.log(`   İyi başlangıç (<0.06):  ${pct(usable)}`);
console.log(`   Aday üretilmedi:        ${pct(noCand)}`);
console.log(`   Yanlış yer (>=0.06):    ${pct(wrong)}`);
