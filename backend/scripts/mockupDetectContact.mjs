// Tespit sonuçlarını görselleştiren kontak sayfası.
// Yeşil = kayıtlı (elle ayarlanmış) alan, turuncu = 1. aday, mavi = diğer adaylar.

import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'path';
import fs from 'fs';

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';

// backend/scripts -> proje koku
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.env.OUT_DIR || '.';

import { createCanvas, loadImage } from '@napi-rs/canvas';

globalThis.document = { createElement: () => createCanvas(1, 1) };
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);

const { analyzeMockup } = await import(pathToFileURL(join(ROOT, 'frontend/src/utils/mockupDetect.js')).href + '?v=' + Date.now());

const db = new DatabaseSync(join(ROOT, 'backend/db/database.db'));
const rows = db.prepare('SELECT name, type, config, background_path FROM templates').all();

const wanted = process.argv.slice(2).filter(a => !a.startsWith('--'));
const cols = 4;
const cell = 380;

const seen = new Set();
const items = [];
for (const row of rows) {
  if (row.type === 'static' || !row.background_path) continue;
  let cfg; try { cfg = JSON.parse(row.config); } catch { continue; }
  const slots = Array.isArray(cfg.slots) && cfg.slots.length ? cfg.slots : [{ placement: cfg.placement, corners: cfg.corners }];
  if (slots.length !== 1) continue;

  let truth = row.type === 'perspective' ? (slots[0].corners || cfg.corners) : null;
  if (!truth) {
    const p = slots[0].placement || cfg.placement;
    if (p) truth = {
      tl: { x: p.x, y: p.y }, tr: { x: p.x + p.width, y: p.y },
      br: { x: p.x + p.width, y: p.y + p.height }, bl: { x: p.x, y: p.y + p.height }
    };
  }
  if (!truth?.tl) continue;

  const abs = join(ROOT, row.background_path);
  if (!fs.existsSync(abs)) continue;

  if (wanted.length) {
    if (!wanted.includes(row.name)) continue;
  } else {
    const key = fs.statSync(abs).size + ':' + Math.round(truth.tl.x * 1e4);
    if (seen.has(key)) continue;
    seen.add(key);
  }
  items.push({ row, truth, abs });
}

const limit = wanted.length ? items.length : Number(process.env.LIMIT || 16);
const offset = Number(process.env.OFFSET || 0);
const step = Math.max(1, Math.floor(items.length / limit));
const sample = wanted.length ? items : items.filter((_, i) => (i - offset) % step === 0 && i >= offset).slice(0, limit);

const rowsN = Math.ceil(sample.length / cols);
const sheet = createCanvas(cols * cell, rowsN * cell);
const sctx = sheet.getContext('2d');
sctx.fillStyle = '#0b0f19';
sctx.fillRect(0, 0, sheet.width, sheet.height);

const drawQuad = (ctx, q, ox, oy, s, color, width) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(ox + q.tl.x * s, oy + q.tl.y * s);
  ctx.lineTo(ox + q.tr.x * s, oy + q.tr.y * s);
  ctx.lineTo(ox + q.br.x * s, oy + q.br.y * s);
  ctx.lineTo(ox + q.bl.x * s, oy + q.bl.y * s);
  ctx.closePath();
  ctx.stroke();
};

const cornerErr = (a, b) => {
  let sum = 0;
  for (const k of ['tl', 'tr', 'br', 'bl']) sum += Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y);
  return sum / 4;
};

for (let idx = 0; idx < sample.length; idx++) {
  const it = sample[idx];
  const img = await loadImage(it.abs);
  const res = await analyzeMockup(img, { maxCandidates: 3 });

  const cx = (idx % cols) * cell;
  const cy = Math.floor(idx / cols) * cell;
  const inner = cell - 20;
  const scale = Math.min(inner / img.width, inner / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const ox = cx + (cell - dw) / 2;
  const oy = cy + 18 + (cell - 18 - dh) / 2;

  sctx.drawImage(img, ox, oy, dw, dh);

  res.candidates.slice(1).forEach(c => drawQuad(sctx, c.corners, ox, oy, dw, 'rgba(56,189,248,0.75)', 1.5));
  drawQuad(sctx, it.truth, ox, oy, dw, '#22c55e', 2.5);
  if (res.candidates[0]) drawQuad(sctx, res.candidates[0].corners, ox, oy, dw, '#f59e0b', 2.5);

  const err = res.candidates[0] ? cornerErr(res.candidates[0].corners, it.truth) : null;
  sctx.fillStyle = err === null ? '#ef4444' : (err < 0.02 ? '#22c55e' : err < 0.06 ? '#eab308' : '#ef4444');
  sctx.font = 'bold 13px sans-serif';
  sctx.fillText(`${it.row.name} · ${err === null ? 'ADAY YOK' : err.toFixed(3)} · n=${res.candidates.length}`, cx + 8, cy + 14);
}

const file = join(OUT, process.env.NAME || 'contact.png');
fs.writeFileSync(file, sheet.toBuffer('image/png'));
console.log('yazıldı:', file, `${sample.length} şablon`);
