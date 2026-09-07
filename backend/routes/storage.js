import express from 'express';
import { join, dirname, resolve, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import db from '../db/db.js';

const router = express.Router();
const __dirname = dirname(fileURLToPath(import.meta.url));

const STORAGE_ROOT = resolve(__dirname, '../..', 'storage');

// Bu klasörlerin içine ASLA girilmez. Ham görseller, upscale çıktıları, şablon
// arka planları ve tema dosyaları burada durur ve geri getirilemez.
const PROTECTED_DIR_NAMES = new Set([
  'uploads', 'upload', 'upload2', 'upload3',
  'upscaled', 'templates', 'theme', 'exports', 'db', 'digital_files'
]);

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * Bir yolun gerçekten silinebilir bir mockup yolu olduğunu doğrular.
 * Üç koşul birden sağlanmazsa hata fırlatır:
 *   1) storage/ kökünün altında olmalı (path traversal koruması)
 *   2) yol parçalarından biri tam olarak "mockups" olmalı
 *   3) hiçbir parça korumalı klasör adı olmamalı
 */
export function assertDeletableMockupPath(target) {
  const abs = resolve(target);
  const rel = relative(STORAGE_ROOT, abs);

  if (rel === '' || rel.startsWith('..') || resolve(STORAGE_ROOT, rel) !== abs) {
    throw new Error(`Güvenlik: storage kökü dışındaki yol reddedildi -> ${target}`);
  }

  const parts = rel.split(sep).filter(Boolean);

  if (!parts.some(p => p.toLowerCase() === 'mockups')) {
    throw new Error(`Güvenlik: "mockups" içermeyen yol reddedildi -> ${rel}`);
  }

  for (const p of parts) {
    if (PROTECTED_DIR_NAMES.has(p.toLowerCase())) {
      throw new Error(`Güvenlik: korumalı klasör "${p}" içeren yol reddedildi -> ${rel}`);
    }
  }

  return abs;
}

/**
 * Diskteki tüm mockup köklerini bulur. Yalnızca bilinen konumlara bakar;
 * storage/ altında serbest gezinme yapmaz.
 *   storage/mockups                (eski düzen)
 *   storage/<MagazaAdi>/mockups    (eski düzen)
 *   storage/etsy/<MagazaAdi>/mockups
 *   storage/shopify/<MagazaAdi>/mockups
 */
function findMockupRoots() {
  const roots = [];

  const pushIfDir = (p, platform, shop) => {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        roots.push({ path: p, platform, shop });
      }
    } catch { /* erişilemeyen yolu atla */ }
  };

  pushIfDir(join(STORAGE_ROOT, 'mockups'), 'legacy', '(eski)');

  const listDirs = (base) => {
    try {
      if (!fs.existsSync(base)) return [];
      return fs.readdirSync(base, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    } catch {
      return [];
    }
  };

  // storage/<MagazaAdi>/mockups  — platform klasörleri ve korumalı adlar hariç
  for (const name of listDirs(STORAGE_ROOT)) {
    const lower = name.toLowerCase();
    if (lower === 'etsy' || lower === 'shopify' || lower === 'mockups') continue;
    if (PROTECTED_DIR_NAMES.has(lower)) continue;
    pushIfDir(join(STORAGE_ROOT, name, 'mockups'), 'legacy', name);
  }

  for (const platform of ['etsy', 'shopify']) {
    const base = join(STORAGE_ROOT, platform);
    for (const shop of listDirs(base)) {
      pushIfDir(join(base, shop, 'mockups'), platform, shop);
    }
  }

  return roots;
}

function isImage(filename) {
  const lower = filename.toLowerCase();
  return IMAGE_EXT.some(ext => lower.endsWith(ext));
}

/** Tek bir ürün mockup klasörünü ölçer. Alt klasörlere inmez. */
function measureProductDir(dirPath) {
  let bytes = 0;
  let files = 0;
  let newestMtime = 0;

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return { bytes, files, newestMtime };
  }

  for (const entry of entries) {
    if (!entry.isFile() || !isImage(entry.name)) continue;
    try {
      const st = fs.statSync(join(dirPath, entry.name));
      bytes += st.size;
      files += 1;
      if (st.mtimeMs > newestMtime) newestMtime = st.mtimeMs;
    } catch { /* okunamayan dosyayı atla */ }
  }

  return { bytes, files, newestMtime };
}

/** DB'deki tüm ürünlerin id -> {status, title, shop_id} haritası. */
function loadProductIndex() {
  const map = new Map();
  try {
    const rows = db.prepare('SELECT id, status, title, shop_id, etsy_listing_id FROM products').all();
    for (const r of rows) map.set(r.id, r);
  } catch (err) {
    console.error('[Storage] Ürün tablosu okunamadı:', err.message);
  }
  return map;
}

/**
 * Tüm mockup klasörlerini tarayıp her ürün klasörünü kategorize eder.
 * Kategoriler:
 *   live    -> ürün Etsy/Shopify'a yüklenmiş (status 'live'), mockup'lar artık yedek
 *   orphan  -> klasör var ama DB'de böyle bir ürün yok
 *   draft   -> ürün hâlâ taslak, mockup'lar gerekli olabilir
 */
function scanMockups() {
  const productIndex = loadProductIndex();
  const roots = findMockupRoots();
  const items = [];

  for (const root of roots) {
    let productDirs;
    try {
      productDirs = fs.readdirSync(root.path, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    } catch {
      continue;
    }

    for (const productId of productDirs) {
      const dirPath = join(root.path, productId);
      const { bytes, files, newestMtime } = measureProductDir(dirPath);
      if (files === 0) continue;

      const product = productIndex.get(productId);
      let category;
      if (!product) category = 'orphan';
      else if (product.status === 'live') category = 'live';
      else category = 'draft';

      items.push({
        productId,
        path: dirPath,
        relPath: relative(STORAGE_ROOT, dirPath).split(sep).join('/'),
        platform: root.platform,
        shop: root.shop,
        category,
        title: product?.title || null,
        status: product?.status || null,
        etsyListingId: product?.etsy_listing_id || null,
        files,
        bytes,
        newestMtime,
        ageDays: newestMtime ? Math.floor((Date.now() - newestMtime) / 86400000) : null
      });
    }
  }

  return items;
}

function summarize(items) {
  const empty = () => ({ files: 0, bytes: 0, folders: 0 });
  const totals = { all: empty(), live: empty(), orphan: empty(), draft: empty() };

  for (const it of items) {
    totals.all.files += it.files;
    totals.all.bytes += it.bytes;
    totals.all.folders += 1;
    const bucket = totals[it.category];
    bucket.files += it.files;
    bucket.bytes += it.bytes;
    bucket.folders += 1;
  }

  return totals;
}

/**
 * GET /api/storage/mockup-stats
 * Mockup klasörlerinin dökümünü döner. Hiçbir şey silmez.
 */
router.get('/mockup-stats', (req, res, next) => {
  try {
    const items = scanMockups();
    const totals = summarize(items);

    // En büyükten küçüğe, listeyi makul tut
    const sorted = [...items].sort((a, b) => b.bytes - a.bytes);

    res.json({
      storageRoot: STORAGE_ROOT,
      protectedDirs: [...PROTECTED_DIR_NAMES],
      totals,
      scannedRoots: findMockupRoots().map(r => relative(STORAGE_ROOT, r.path).split(sep).join('/')),
      items: sorted.slice(0, 500),
      itemCount: items.length
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/storage/mockup-cleanup
 * Body: {
 *   categories: ['live','orphan']   // 'draft' bilerek varsayılan dışında
 *   olderThanDays?: number           // yalnızca bu kadar gün dokunulmamışlar
 *   productIds?: string[]            // verilirse sadece bunlar
 *   dryRun?: boolean                 // true ise sadece raporlar, silmez
 * }
 * Yalnızca mockup görselleri ve boşalan mockup klasörleri silinir.
 * uploads / UPSCALED / templates / theme klasörlerine hiçbir koşulda dokunulmaz.
 */
router.post('/mockup-cleanup', (req, res, next) => {
  try {
    const {
      categories = ['live', 'orphan'],
      olderThanDays = null,
      productIds = null,
      dryRun = false
    } = req.body || {};

    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ error: 'En az bir kategori seçilmelidir.' });
    }

    const allowed = new Set(['live', 'orphan', 'draft']);
    for (const c of categories) {
      if (!allowed.has(c)) {
        return res.status(400).json({ error: `Geçersiz kategori: ${c}` });
      }
    }

    const idFilter = Array.isArray(productIds) && productIds.length > 0
      ? new Set(productIds.map(String))
      : null;

    const items = scanMockups().filter(it => {
      if (!categories.includes(it.category)) return false;
      if (idFilter && !idFilter.has(it.productId)) return false;
      if (olderThanDays !== null && olderThanDays !== undefined) {
        const days = Number(olderThanDays);
        if (!Number.isNaN(days) && days > 0) {
          if (it.ageDays === null || it.ageDays < days) return false;
        }
      }
      return true;
    });

    let deletedFiles = 0;
    let freedBytes = 0;
    let deletedFolders = 0;
    const errors = [];

    for (const it of items) {
      let safeDir;
      try {
        safeDir = assertDeletableMockupPath(it.path);
      } catch (guardErr) {
        // Güvenlik kontrolünden geçemeyen yol atlanır, asla silinmez.
        errors.push({ path: it.relPath, error: guardErr.message });
        continue;
      }

      let entries;
      try {
        entries = fs.readdirSync(safeDir, { withFileTypes: true });
      } catch (readErr) {
        errors.push({ path: it.relPath, error: readErr.message });
        continue;
      }

      let removedHere = 0;
      for (const entry of entries) {
        if (!entry.isFile() || !isImage(entry.name)) continue;
        const filePath = join(safeDir, entry.name);
        try {
          const size = fs.statSync(filePath).size;
          if (!dryRun) fs.unlinkSync(filePath);
          deletedFiles += 1;
          freedBytes += size;
          removedHere += 1;
        } catch (delErr) {
          errors.push({ path: `${it.relPath}/${entry.name}`, error: delErr.message });
        }
      }

      // Klasör tamamen boşaldıysa kaldır (içinde başka bir şey varsa dokunma)
      if (!dryRun && removedHere > 0) {
        try {
          if (fs.readdirSync(safeDir).length === 0) {
            fs.rmdirSync(safeDir);
            deletedFolders += 1;
          }
        } catch { /* klasör kalsın, sorun değil */ }
      }
    }

    console.log(
      `[Storage Cleanup]${dryRun ? ' (DRY RUN)' : ''} ` +
      `${deletedFiles} mockup dosyası, ${(freedBytes / 1024 / 1024).toFixed(1)} MB, ` +
      `${deletedFolders} klasör. Kategoriler: ${categories.join(', ')}`
    );

    res.json({
      success: true,
      dryRun,
      categories,
      olderThanDays: olderThanDays ?? null,
      affectedFolders: items.length,
      deletedFiles,
      deletedFolders,
      freedBytes,
      errors
    });
  } catch (err) {
    next(err);
  }
});

export default router;
