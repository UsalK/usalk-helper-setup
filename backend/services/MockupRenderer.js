/**
 * Sunucu tarafı mockup render motoru.
 *
 * BulkUpload.jsx içindeki tarayıcı render mantığının birebir portudur. Aynı
 * Canvas 2D API'si (@napi-rs/canvas) kullanıldığı için çizim çağrıları,
 * yerleşim hesapları, gölge/çerçeve parametreleri ve JPEG kalitesi
 * değişmemiştir. Şablon config'leri (placement, corners, shadow, frame,
 * compatible_ratios) aynı şekilde okunur — Şablon Stüdyosu tarafında
 * hiçbir değişiklik gerekmez.
 *
 * Tek fark I/O katmanı:
 *   - görseller HTTP yerine diskten okunur
 *   - çıktı /api/mockup/save yerine doğrudan diske yazılır
 */

import { createCanvas, loadImage as loadCanvasImage } from '@napi-rs/canvas';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import db, { getProductStorageFolder, DISABLED_PROFILE_IDS, isSetProfileId } from '../db/db.js';
import { warpImageFast } from './warpFast.js';
import { getMockupOutputSize } from './mockupOutput.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../..');

// storage/... göreli yolunu diskteki mutlak yola çevirir
function resolveStoragePath(relPath) {
  if (!relPath) return null;
  return join(PROJECT_ROOT, relPath.replace(/\\/g, '/'));
}

/**
 * Şablon arka planı önbelleği.
 *
 * Şablon arka planları ortalama 6 MB, bazıları 26 MB PNG. Her ürün için
 * aynı 15-20 şablon tekrar tekrar diskten okunup decode ediliyordu; 800 ürünlük
 * bir işte bu on binlerce büyük PNG okuması demek — SSD'yi %100'e kilitleyen
 * asıl sebep buydu. Decode edilmiş görseller bellekte tutulur, toplam
 * piksel bütçesi aşılınca en eski kayıt düşürülür (LRU).
 */
// Hafif faz zamanlayıcı. MOCKUP_PROFILE=1 ile açılır; kapalıyken maliyeti yok.
const PROFILE = process.env.MOCKUP_PROFILE === '1';
const phase = { decode: 0, bgDraw: 0, warp: 0, flat: 0, encode: 0, write: 0 };
const tick = () => (PROFILE ? Date.now() : 0);
const add = (k, t0) => { if (PROFILE) phase[k] += Date.now() - t0; };

export function readProfile() {
  const total = Object.values(phase).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(
    Object.entries(phase).map(([k, v]) => [k, { ms: v, pct: +(v / total * 100).toFixed(1) }])
  );
}
export function resetProfile() {
  for (const k of Object.keys(phase)) phase[k] = 0;
}

const bgCache = new Map();
let bgCachePixels = 0;
// Varsayılan bütçe ~260 MP (≈1 GB RGBA). Worker'lar başlarken kendi paylarına
// düşen değeri setCacheBudget ile bildirir, böylece N worker toplamda
// makineyi boğmaz.
let BG_CACHE_MAX_PIXELS = 260_000_000;

export function setCacheBudget(pixels) {
  BG_CACHE_MAX_PIXELS = Math.max(20_000_000, pixels);
}

function cacheGet(key) {
  const hit = bgCache.get(key);
  if (!hit) return null;
  // LRU: erişilen kaydı sona taşı
  bgCache.delete(key);
  bgCache.set(key, hit);
  return hit;
}

function cachePut(key, img) {
  const px = img.width * img.height;
  if (px > BG_CACHE_MAX_PIXELS) return; // tek başına bütçeyi aşan görseli tutma
  bgCache.set(key, img);
  bgCachePixels += px;

  while (bgCachePixels > BG_CACHE_MAX_PIXELS && bgCache.size > 1) {
    const oldestKey = bgCache.keys().next().value;
    const oldest = bgCache.get(oldestKey);
    bgCache.delete(oldestKey);
    bgCachePixels -= oldest.width * oldest.height;
  }
}

export function clearMockupCache() {
  bgCache.clear();
  bgCachePixels = 0;
}

async function loadImage(relPath, { cache = false } = {}) {
  const abs = resolveStoragePath(relPath);
  if (!abs || !fs.existsSync(abs)) {
    throw new Error(`Görsel bulunamadı: ${relPath}`);
  }

  if (cache) {
    const hit = cacheGet(abs);
    if (hit) return hit;
    const t0 = tick();
    const img = await loadCanvasImage(abs);
    add('decode', t0);
    cachePut(abs, img);
    return img;
  }

  const t0 = tick();
  const out = await loadCanvasImage(abs);
  add('decode', t0);
  return out;
}

/**
 * Oran anahtarını panel oranı + panel sayısına ayırır.
 * '2:3'    → { ratio: 0.667, panelCount: 1 }
 * '1:2x2'  → { ratio: 0.5,   panelCount: 2 }   (her paneli 1:2 olan ikili set)
 */
const parseRatioKey = (ratioStr) => {
  if (!ratioStr) return { ratio: 1, panelCount: 1 };
  const [base, countPart] = String(ratioStr).split('x');
  const panelCount = countPart ? Math.max(1, parseInt(countPart, 10) || 1) : 1;
  const parts = base.split(':');
  if (parts.length === 2) {
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (Number.isFinite(w) && Number.isFinite(h) && h !== 0) {
      return { ratio: w / h, panelCount };
    }
  }
  return { ratio: 1, panelCount };
};

/** Bir oran anahtarının tek panel en/boy oranı. */
const parseRatio = (ratioStr) => parseRatioKey(ratioStr).ratio;

/** Oran anahtarı çok panelli bir seti mi tanımlıyor? */
const isSetRatioKey = (ratioStr) => parseRatioKey(ratioStr).panelCount > 1;

const getLockedPlacement = (px, py, pw, ph, targetRatio) => {
  const currentRatio = pw / ph;
  let finalW = pw;
  let finalH = ph;
  if (currentRatio > targetRatio) {
    finalW = ph * targetRatio;
  } else {
    finalH = pw / targetRatio;
  }
  const finalX = px + (pw - finalW) / 2;
  const finalY = py + (ph - finalH) / 2;
  return { x: finalX, y: finalY, width: finalW, height: finalH };
};

const drawRealisticFrame = (ctx, x, y, w, h, style, thickness) => {
  if (!style || style === 'stretched') return;

  const t = parseFloat(thickness) || 4;

  const itl = { x: x, y: y };
  const itr = { x: x + w, y: y };
  const ibr = { x: x + w, y: y + h };
  const ibl = { x: x, y: y + h };

  const otl = { x: x - t, y: y - t };
  const otr = { x: x + w + t, y: y - t };
  const obr = { x: x + w + t, y: y + h + t };
  const obl = { x: x - t, y: y + h + t };

  const drawTrapezoid = (p1, p2, p3, p4, fillStyle) => {
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
  };

  const drawWoodGrains = (p1, p2, p3, p4, isHorizontal, darkColor) => {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.clip();

    ctx.strokeStyle = darkColor;
    ctx.lineWidth = 1;

    const minX = Math.min(p1.x, p2.x, p3.x, p4.x);
    const maxX = Math.max(p1.x, p2.x, p3.x, p4.x);
    const minY = Math.min(p1.y, p2.y, p3.y, p4.y);
    const maxY = Math.max(p1.y, p2.y, p3.y, p4.y);

    if (isHorizontal) {
      const height = maxY - minY;
      const steps = Math.max(3, Math.floor(height / 2.5));
      for (let i = 0; i < steps; i++) {
        const yOffset = minY + (i / steps) * height + Math.random() * 1.5;
        ctx.beginPath();
        ctx.moveTo(minX, yOffset);
        ctx.bezierCurveTo(
          minX + (maxX - minX) * 0.25, yOffset - 1,
          minX + (maxX - minX) * 0.75, yOffset + 1,
          maxX, yOffset
        );
        ctx.stroke();
      }
    } else {
      const width = maxX - minX;
      const steps = Math.max(3, Math.floor(width / 2.5));
      for (let i = 0; i < steps; i++) {
        const xOffset = minX + (i / steps) * width + Math.random() * 1.5;
        ctx.beginPath();
        ctx.moveTo(xOffset, minY);
        ctx.bezierCurveTo(
          xOffset - 1, minY + (maxY - minY) * 0.25,
          xOffset + 1, minY + (maxY - minY) * 0.75,
          xOffset, maxY
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  if (style === 'black_frame') {
    const gTop = ctx.createLinearGradient(otl.x, otl.y, itl.x, itl.y);
    gTop.addColorStop(0, '#374151');
    gTop.addColorStop(1, '#111827');
    drawTrapezoid(otl, otr, itr, itl, gTop);

    const gLeft = ctx.createLinearGradient(otl.x, otl.y, itl.x, itl.y);
    gLeft.addColorStop(0, '#1f2937');
    gLeft.addColorStop(1, '#0f172a');
    drawTrapezoid(otl, obl, ibl, itl, gLeft);

    const gBottom = ctx.createLinearGradient(obl.x, obl.y, ibl.x, ibl.y);
    gBottom.addColorStop(0, '#0f172a');
    gBottom.addColorStop(1, '#020617');
    drawTrapezoid(obl, obr, ibr, ibl, gBottom);

    const gRight = ctx.createLinearGradient(otr.x, otr.y, itr.x, itr.y);
    gRight.addColorStop(0, '#0f172a');
    gRight.addColorStop(1, '#020617');
    drawTrapezoid(otr, obr, ibr, itr, gRight);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  } else if (style === 'white_frame') {
    drawTrapezoid(otl, otr, itr, itl, '#f8fafc');
    drawTrapezoid(otl, obl, ibl, itl, '#f1f5f9');
    drawTrapezoid(obl, obr, ibr, ibl, '#cbd5e1');
    drawTrapezoid(otr, obr, ibr, itr, '#e2e8f0');

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - t, y - t, w + 2 * t, h + 2 * t);
    ctx.strokeRect(x, y, w, h);
  } else if (style === 'gold_frame') {
    const gTop = ctx.createLinearGradient(otl.x, otl.y, otr.x, otr.y);
    gTop.addColorStop(0, '#c5a059');
    gTop.addColorStop(0.3, '#fdf5e6');
    gTop.addColorStop(0.5, '#aa7c11');
    gTop.addColorStop(0.7, '#fdf5e6');
    gTop.addColorStop(1, '#c5a059');
    drawTrapezoid(otl, otr, itr, itl, gTop);

    const gLeft = ctx.createLinearGradient(otl.x, otl.y, obl.x, obl.y);
    gLeft.addColorStop(0, '#c5a059');
    gLeft.addColorStop(0.5, '#aa7c11');
    gLeft.addColorStop(1, '#8c6308');
    drawTrapezoid(otl, obl, ibl, itl, gLeft);

    const gBottom = ctx.createLinearGradient(obl.x, obl.y, obr.x, obr.y);
    gBottom.addColorStop(0, '#8c6308');
    gBottom.addColorStop(0.5, '#c5a059');
    gBottom.addColorStop(1, '#5a3f00');
    drawTrapezoid(obl, obr, ibr, ibl, gBottom);

    const gRight = ctx.createLinearGradient(otr.x, otr.y, obr.x, obr.y);
    gRight.addColorStop(0, '#c5a059');
    gRight.addColorStop(0.5, '#aa7c11');
    gRight.addColorStop(1, '#5a3f00');
    drawTrapezoid(otr, obr, ibr, itr, gRight);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - t + 0.5, y - t + 0.5, w + 2 * t - 1, h + 2 * t - 1);
  } else if (style === 'silver_frame') {
    const gTop = ctx.createLinearGradient(otl.x, otl.y, otr.x, otr.y);
    gTop.addColorStop(0, '#94a3b8');
    gTop.addColorStop(0.3, '#f8fafc');
    gTop.addColorStop(0.5, '#64748b');
    gTop.addColorStop(0.7, '#f8fafc');
    gTop.addColorStop(1, '#94a3b8');
    drawTrapezoid(otl, otr, itr, itl, gTop);

    const gLeft = ctx.createLinearGradient(otl.x, otl.y, obl.x, obl.y);
    gLeft.addColorStop(0, '#94a3b8');
    gLeft.addColorStop(0.5, '#64748b');
    gLeft.addColorStop(1, '#475569');
    drawTrapezoid(otl, obl, ibl, itl, gLeft);

    const gBottom = ctx.createLinearGradient(obl.x, obl.y, obr.x, obr.y);
    gBottom.addColorStop(0, '#475569');
    gBottom.addColorStop(0.5, '#cbd5e1');
    gBottom.addColorStop(1, '#334155');
    drawTrapezoid(obl, obr, ibr, ibl, gBottom);

    const gRight = ctx.createLinearGradient(otr.x, otr.y, obr.x, obr.y);
    gRight.addColorStop(0, '#94a3b8');
    gRight.addColorStop(0.5, '#64748b');
    gRight.addColorStop(1, '#334155');
    drawTrapezoid(otr, obr, ibr, itr, gRight);
  } else if (style === 'natural_wood') {
    drawTrapezoid(otl, otr, itr, itl, '#dfb17b');
    drawTrapezoid(otl, obl, ibl, itl, '#d2a26c');
    drawTrapezoid(obl, obr, ibr, ibl, '#bd8d58');
    drawTrapezoid(otr, obr, ibr, itr, '#bd8d58');

    drawWoodGrains(otl, otr, itr, itl, true, 'rgba(90, 60, 30, 0.08)');
    drawWoodGrains(otl, obl, ibl, itl, false, 'rgba(90, 60, 30, 0.08)');
    drawWoodGrains(obl, obr, ibr, ibl, true, 'rgba(90, 60, 30, 0.08)');
    drawWoodGrains(otr, obr, ibr, itr, false, 'rgba(90, 60, 30, 0.08)');
  } else if (style === 'walnut') {
    drawTrapezoid(otl, otr, itr, itl, '#5c4033');
    drawTrapezoid(otl, obl, ibl, itl, '#4e3629');
    drawTrapezoid(obl, obr, ibr, ibl, '#3d2b1f');
    drawTrapezoid(otr, obr, ibr, itr, '#3d2b1f');

    drawWoodGrains(otl, otr, itr, itl, true, 'rgba(30, 15, 5, 0.15)');
    drawWoodGrains(otl, obl, ibl, itl, false, 'rgba(30, 15, 5, 0.15)');
    drawWoodGrains(obl, obr, ibr, ibl, true, 'rgba(30, 15, 5, 0.15)');
    drawWoodGrains(otr, obr, ibr, itr, false, 'rgba(30, 15, 5, 0.15)');
  }

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(otl.x, otl.y); ctx.lineTo(itl.x, itl.y);
  ctx.moveTo(otr.x, otr.y); ctx.lineTo(itr.x, itr.y);
  ctx.moveTo(obr.x, obr.y); ctx.lineTo(ibr.x, ibr.y);
  ctx.moveTo(obl.x, obl.y); ctx.lineTo(ibl.x, ibl.y);
  ctx.stroke();
};

// Kademeli küçültme: tek adımda büyük oranda küçültmek bulanıklık ve
// aliasing yaratıyor, bu yüzden yarıya bölerek iniyoruz.
const getStepScaledCanvas = (img, targetW, targetH) => {
  let srcCanvas = img;
  let w = img.width;
  let h = img.height;

  while (w > targetW * 2 && h > targetH * 2) {
    w = Math.floor(w / 2);
    h = Math.floor(h / 2);
    const tempCanvas = createCanvas(w, h);
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.imageSmoothingEnabled = true;
    tempCtx.imageSmoothingQuality = 'high';
    tempCtx.drawImage(srcCanvas, 0, 0, w, h);
    srcCanvas = tempCanvas;
  }

  const finalCanvas = createCanvas(targetW, targetH);
  const finalCtx = finalCanvas.getContext('2d');
  finalCtx.imageSmoothingEnabled = true;
  finalCtx.imageSmoothingQuality = 'high';
  finalCtx.drawImage(srcCanvas, 0, 0, targetW, targetH);
  return finalCanvas;
};

/**
 * Perspektif şablonlar için ürün görselini BİR KEZ ölçekler.
 *
 * Önceden her şablonun hedef dörtgeni için ayrı bir ölçekleme yapılıyordu:
 * tipik bir üründe 11 farklı boyut, her biri için kademeli küçültme artı
 * ~15 MB'lık bir piksel tamponu. Oysa homografi kaynağın köşelerini hedef
 * dörtgenin köşelerine eşlediği için kaynağın boyutu sonucu değiştirmez,
 * yalnızca örnekleme çözünürlüğünü belirler.
 *
 * Bu yüzden en büyük hedef dörtgeni karşılayacak tek bir ölçek üretilip
 * tüm şablonlarda paylaşılır. Görselin en-boy oranı korunur; zaten yeterince
 * küçükse orijinal doğrudan kullanılır.
 */
function buildSharedPreScale(productImg, maxQuadW, maxQuadH) {
  if (maxQuadW <= 0 || maxQuadH <= 0) return productImg;

  // Görselin her iki boyutu da gerekenden en az 2 kat büyükse küçültmeye değer;
  // aksi halde orijinali kullanmak hem daha hızlı hem daha kaliteli.
  const scale = Math.max(maxQuadW / productImg.width, maxQuadH / productImg.height);
  if (scale >= 0.5) return productImg;

  const targetW = Math.max(1, Math.ceil(productImg.width * scale));
  const targetH = Math.max(1, Math.ceil(productImg.height * scale));
  return getStepScaledCanvas(productImg, targetW, targetH);
}

const drawCoverImage = (ctx, img, x, y, w, h) => {
  let srcImage = img;
  const targetW = Math.ceil(w);
  const targetH = Math.ceil(h);

  if (img.width > targetW * 2 || img.height > targetH * 2) {
    srcImage = getStepScaledCanvas(img, targetW, targetH);
  }

  const imgRatio = srcImage.width / srcImage.height;
  const targetRatio = w / h;
  let sx, sy, sw, sh;
  if (imgRatio > targetRatio) {
    sh = srcImage.height;
    sw = sh * targetRatio;
    sx = (srcImage.width - sw) / 2;
    sy = 0;
  } else {
    sw = srcImage.width;
    sh = sw / targetRatio;
    sx = 0;
    sy = (srcImage.height - sh) / 2;
  }
  ctx.drawImage(srcImage, sx, sy, sw, sh, x, y, w, h);
};

const DEFAULT_PLACEMENT = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
const DEFAULT_CORNERS = {
  tl: { x: 0.25, y: 0.25 }, tr: { x: 0.75, y: 0.25 },
  br: { x: 0.75, y: 0.75 }, bl: { x: 0.25, y: 0.75 }
};

/**
 * Şablonun panel yerleşimlerini döner.
 *
 * Set of 2 gibi çok panelli şablonlar config.slots dizisini kullanır
 * ([{ placement }, { placement }] ya da [{ corners }, { corners }]).
 * Tek panelli klasik şablonlarda config.placement / config.corners okunur,
 * yani eski şablonlar hiç değişmeden çalışmaya devam eder.
 */
function getTemplateSlots(config) {
  if (Array.isArray(config.slots) && config.slots.length > 0) return config.slots;
  return [{ placement: config.placement, corners: config.corners }];
}

/**
 * Set şablonlarında her panele hangi görselin gireceğini belirler.
 *   'split'     → tek görsel panel sayısı kadar dikey dilime bölünür
 *                 (soldaki dilim sol panele, sağdaki sağ panele)
 *   'duplicate' → aynı görsel her panelde tekrarlanır
 */
function buildPanelSources(img, count, mode) {
  if (count <= 1) return [img];
  if (mode === 'duplicate') return new Array(count).fill(img);

  const sliceW = Math.floor(img.width / count);
  if (sliceW < 1) return new Array(count).fill(img);

  const sources = [];
  for (let i = 0; i < count; i++) {
    const w = (i === count - 1) ? (img.width - sliceW * i) : sliceW;
    const slice = createCanvas(w, img.height);
    const sctx = slice.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, sliceW * i, 0, w, img.height, 0, 0, w, img.height);
    sources.push(slice);
  }
  return sources;
}

/** Mockup'ı /api/mockup/save ile aynı yol mantığıyla diske yazar. */
function saveMockupToDisk(productId, templateId, ratio, buffer) {
  const subPath = getProductStorageFolder(productId);
  const productMockupDir = join(PROJECT_ROOT, 'storage', subPath, 'mockups', productId);
  if (!fs.existsSync(productMockupDir)) {
    fs.mkdirSync(productMockupDir, { recursive: true });
  }

  const cleanRatio = ratio.replace(':', '-');
  const fileName = `${templateId}_${cleanRatio}.jpg`;
  fs.writeFileSync(join(productMockupDir, fileName), buffer);

  return `storage/${subPath.replace(/\\/g, '/')}/mockups/${productId}/${fileName}`;
}

/**
 * Bir ürün için uyumlu tüm şablonlardan mockup üretir.
 * BulkUpload.jsx'teki generateMockupsForProduct ile aynı şablon seçimi,
 * aynı çizim sırası ve aynı JPEG kalitesi (0.95) kullanılır.
 *
 * @returns {Promise<string[]>} üretilen mockup'ların storage'a göreli yolları
 */
export async function generateMockupsForProduct(product, options = {}) {
  const { onProgress = null, shouldCancel = null } = options;

  if (!product.variation_profile_id) {
    throw new Error('Varyasyon profili seçilmemiş.');
  }

  const shopId = product.shop_id;

  const templates = db.prepare('SELECT * FROM templates WHERE shop_id = ?').all(shopId)
    .map(t => ({ ...t, config: JSON.parse(t.config || '{}') }));

  const profileRow = db.prepare('SELECT * FROM variation_profiles WHERE id = ? AND shop_id = ?')
    .get(product.variation_profile_id, shopId);

  const profile = profileRow
    ? { ...profileRow, template_ids: JSON.parse(profileRow.template_ids || '[]') }
    : null;

  const productTpls = profile
    ? templates.filter(t => {
        if (profile.template_ids && profile.template_ids.includes(t.id)) return true;
        const tplRatios = (t.config.compatible_ratios && t.config.compatible_ratios.length > 0)
          ? t.config.compatible_ratios
          : ['2:3'];
        return tplRatios.includes(profile.ratio);
      })
    : templates;

  const mockupTpls = productTpls.filter(t => t.type !== 'static');
  const staticTpls = productTpls.filter(t => t.type === 'static');

  if (mockupTpls.length === 0 && staticTpls.length === 0) {
    throw new Error('Uyumlu şablon veya statik görsel bulunamadı.');
  }

  // Şablon dosyası ve önbelleği orijinal boyutta kalır; yalnızca çıktı büyür.
  // Eski uzun kenar üst sınırı ve büyütme katsayısı artık kullanılmaz.
  const readSetting = (key, fallback) => {
    try {
      const row = db.prepare('SELECT value FROM settings WHERE shop_id = ? AND key = ?').get(shopId, key);
      if (row) {
        const v = Number(JSON.parse(row.value));
        if (Number.isFinite(v)) return v;
      }
    } catch { /* ayar yoksa varsayılan */ }
    return fallback;
  };

  const minShortEdge = readSetting('mockup_min_short_edge_px', 2000);

  let jpegQuality = readSetting('mockup_jpeg_quality', 92);
  if (jpegQuality < 70) jpegQuality = 70;
  if (jpegQuality > 100) jpegQuality = 100;

  const generated = [];
  let done = 0;
  const totalEstimate = mockupTpls.length + staticTpls.length;

  // 1. Normal mockup'lar
  if (mockupTpls.length > 0) {
    const productImg = await loadImage(product.image_path);

    // Perspektif şablonların en büyük hedef dörtgenini önden bul ki ürün
    // görselini tek seferde, hepsine yetecek çözünürlükte ölçekleyelim.
    let maxQuadW = 0;
    let maxQuadH = 0;
    for (const tpl of mockupTpls) {
      if (tpl.type === 'flat') continue;
      let bg;
      try {
        bg = await loadImage(tpl.background_path, { cache: true });
      } catch {
        continue;
      }
      const output = getMockupOutputSize(bg.width, bg.height, minShortEdge);
      for (const slot of getTemplateSlots(tpl.config)) {
        const c = slot.corners || DEFAULT_CORNERS;
        const xs = [c.tl.x, c.tr.x, c.br.x, c.bl.x].map(v => v * output.width);
        const ys = [c.tl.y, c.tr.y, c.br.y, c.bl.y].map(v => v * output.height);
        maxQuadW = Math.max(maxQuadW, Math.ceil(Math.max(...xs) - Math.min(...xs)));
        maxQuadH = Math.max(maxQuadH, Math.ceil(Math.max(...ys) - Math.min(...ys)));
      }
    }

    const sharedPreScale = buildSharedPreScale(productImg, maxQuadW, maxQuadH);

    for (const tpl of mockupTpls) {
      if (shouldCancel && shouldCancel()) break;

      let bgImg;
      try {
        bgImg = await loadImage(tpl.background_path, { cache: true });
      } catch (bgErr) {
        console.warn(`[Mockup] Şablon arka planı atlandı (${tpl.name}): ${bgErr.message}`);
        done++;
        continue;
      }

      const ratios = (tpl.config.compatible_ratios && tpl.config.compatible_ratios.length > 0)
        ? tpl.config.compatible_ratios
        : ['2:3'];

      // Panel yerlesimleri ve her panele girecek gorsel. Tek panelli sablonlarda
      // tek elemanli bir dizi oldugu icin akis eskisiyle birebir ayni kalir.
      const slots = getTemplateSlots(tpl.config);
      const setSource = tpl.config.set_source === 'duplicate' ? 'duplicate' : 'split';
      const flatSources = buildPanelSources(productImg, slots.length, setSource);
      const warpSources = buildPanelSources(sharedPreScale, slots.length, setSource);

      for (const ratio of ratios) {
        if (profile && ratio !== profile.ratio) continue;

        // Kısa kenarı tamamla; büyük şablonları küçültme. Normalize edilmiş
        // yerleşim ve köşeler doğrudan bu çıktı boyutuna uygulanır.
        const { width: W, height: H } = getMockupOutputSize(bgImg.width, bgImg.height, minShortEdge);
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const tBg = tick();
        ctx.drawImage(bgImg, 0, 0, W, H);
        add('bgDraw', tBg);

        // Oran anahtari '1:2x2' gibi olabilir; kilitlenecek oran tek panelinkidir.
        const targetRatioVal = parseRatio(ratio);

        if (tpl.type === 'flat') {
          const tFlat = tick();
          const editorWidth = tpl.config.editorWidth || 800;
          const scaleFactor = W / editorWidth;
          const shadow = tpl.config.shadow || { enabled: false };
          const frame = tpl.config.frame || { style: 'stretched', thickness: 3 };

          slots.forEach((slot, slotIdx) => {
            const placement = slot.placement || DEFAULT_PLACEMENT;
            const px = placement.x * W;
            const py = placement.y * H;
            const pw = placement.width * W;
            const ph = placement.height * H;

            const { x: finalX, y: finalY, width: finalW, height: finalH } =
              getLockedPlacement(px, py, pw, ph, targetRatioVal);

            if (shadow.enabled) {
              ctx.save();
              ctx.shadowColor = `rgba(0, 0, 0, ${(parseFloat(shadow.opacity) || 3) / 10})`;
              ctx.shadowBlur = (parseFloat(shadow.blur) || 5) * scaleFactor;
              const dist = (parseFloat(shadow.distance) || 5) * scaleFactor;
              if (shadow.sides === 'all' || shadow.sides === 'bottom') ctx.shadowOffsetY = dist;
              if (shadow.sides === 'all' || shadow.sides === 'right') ctx.shadowOffsetX = dist;
              if (shadow.sides === 'left') ctx.shadowOffsetX = -dist;
              if (shadow.sides === 'top') ctx.shadowOffsetY = -dist;

              const t = (frame.style !== 'stretched') ? (parseFloat(frame.thickness) || 3) * scaleFactor : 0;
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(finalX - t, finalY - t, finalW + 2 * t, finalH + 2 * t);
              ctx.restore();
            }

            ctx.save();
            ctx.beginPath();
            ctx.rect(finalX, finalY, finalW, finalH);
            ctx.clip();
            drawCoverImage(ctx, flatSources[slotIdx] || productImg, finalX, finalY, finalW, finalH);
            ctx.restore();

            if (frame.style !== 'stretched') {
              const thickness = (parseFloat(frame.thickness) || 3) * scaleFactor;
              drawRealisticFrame(ctx, finalX, finalY, finalW, finalH, frame.style, thickness);
            }
          });
          add('flat', tFlat);
        } else {
          // Tum perspektif sablonlar ayni on-olcegi paylasir (yukarida bir kez uretildi)
          const tWarp = tick();
          slots.forEach((slot, slotIdx) => {
            const corners = slot.corners || DEFAULT_CORNERS;
            const tl = { x: corners.tl.x * W, y: corners.tl.y * H };
            const tr = { x: corners.tr.x * W, y: corners.tr.y * H };
            const br = { x: corners.br.x * W, y: corners.br.y * H };
            const bl = { x: corners.bl.x * W, y: corners.bl.y * H };
            warpImageFast(ctx, warpSources[slotIdx] || sharedPreScale, [tl, tr, br, bl]);
          });
          add('warp', tWarp);
        }

        const tEnc = tick();
        const buffer = canvas.toBuffer('image/jpeg', jpegQuality);
        add('encode', tEnc);
        const tW = tick();
        generated.push(saveMockupToDisk(product.id, tpl.id, ratio, buffer));
        add('write', tW);
      }

      done++;
      if (onProgress) onProgress({ done, total: totalEstimate, template: tpl.name });
    }
  }

  // 2. Statik şablonlar da aynı kısa kenar kuralıyla çıktı üretir.
  for (const tpl of staticTpls) {
    if (shouldCancel && shouldCancel()) break;
    try {
      const staticImg = await loadImage(tpl.background_path, { cache: true });
      const ratios = (tpl.config.compatible_ratios && tpl.config.compatible_ratios.length > 0)
        ? tpl.config.compatible_ratios
        : ['2:3'];

      for (const ratio of ratios) {
        if (profile && ratio !== profile.ratio) continue;

        const { width: sW, height: sH } = getMockupOutputSize(staticImg.width, staticImg.height, minShortEdge);

        const canvas = createCanvas(sW, sH);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(staticImg, 0, 0, sW, sH);

        const buffer = canvas.toBuffer('image/jpeg', jpegQuality);
        generated.push(saveMockupToDisk(product.id, `static_${tpl.id}`, ratio, buffer));
      }
    } catch (staticErr) {
      console.error('Static template copy failed:', staticErr.message);
    }
    done++;
    if (onProgress) onProgress({ done, total: totalEstimate, template: tpl.name });
  }

  return generated;
}

/**
 * Görsel en-boy oranına en yakın varyasyon profilini seçer.
 * BulkUpload'daki matchProfileForImage ile aynı mantık.
 */
export async function matchProfileForImage(imageRelPath, shopId) {
  const img = await loadImage(imageRelPath);
  const imgRatio = img.width / img.height;

  // Set profilleri (ikili panel vb.) otomatik eşleştirmeye girmez; oranları tek
  // panelin oranıdır ve tek panelli profillerle çakışır. Kullanıcı bilerek seçer.
  const profiles = db.prepare('SELECT id, ratio, kind FROM variation_profiles WHERE shop_id = ?').all(shopId)
    .filter(p => !DISABLED_PROFILE_IDS.includes(p.id))
    .filter(p => p.kind !== 'set' && !isSetProfileId(p.id) && !isSetRatioKey(p.ratio));

  let closestProfile = null;
  let minDiff = Infinity;
  for (const profile of profiles) {
    const diff = Math.abs(imgRatio - parseRatio(profile.ratio));
    if (diff < minDiff) {
      minDiff = diff;
      closestProfile = profile;
    }
  }
  return closestProfile ? closestProfile.id : null;
}

export { parseRatio, parseRatioKey, isSetRatioKey, getLockedPlacement, drawRealisticFrame };
