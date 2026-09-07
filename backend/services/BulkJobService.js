/**
 * Toplu listing değiştirme iş kuyruğu.
 *
 * İş tamamen sunucuda çalışır: durum SQLite'ta tutulur, worker bir Node
 * döngüsüdür. Tarayıcıyı kapatmak, F5 atmak veya sekme değiştirmek işi
 * etkilemez. Sunucu yeniden başlarsa yarım kalan işler otomatik devam eder.
 *
 * Her görsel için çalıştırılan adımlar mevcut pipeline'ların aynısıdır:
 *   1) görseli storage/<platform>/<magaza>/uploads altına al (multer ile aynı isim şeması)
 *   2) products tablosuna taslak kayıt aç
 *   3) en-boy oranına göre varyasyon profilini eşle
 *   4) MockupRenderer ile şablonlardan mockup üret
 *   5) KimiService.generateSEO ile başlık/açıklama/etiket doldur
 *   6) ListingUploadService.uploadProductToEtsy ile Etsy'ye yükle
 */

import fs from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import db, { getActiveShop, getPlatformUploadPath, getSetProfileInfo } from '../db/db.js';
import { matchProfileForImage } from './MockupRenderer.js';
import { getMockupPool } from './MockupPool.js';
import { generateSEO } from './KimiService.js';
import { uploadProductToEtsy } from './ListingUploadService.js';
import { updateListingFromProduct } from './ListingUpdateService.js';
import { updateListing, getShopSections } from './EtsyService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../..');

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

// Aynı anda işlenecek ürün sayısı. Mockup render'ı zaten worker havuzunda
// paralel; buradaki sınır esas olarak Etsy API'sine aynı anda kaç yükleme
// gideceğini belirler.
const ITEM_CONCURRENCY = 3;

// ---------------------------------------------------------------- şema

db.exec(`
  CREATE TABLE IF NOT EXISTS bulk_jobs (
    id TEXT PRIMARY KEY,
    shop_id TEXT,
    type TEXT DEFAULT 'bulk_replace',
    status TEXT DEFAULT 'running',
    source_folder TEXT,
    config TEXT,
    total_items INTEGER DEFAULT 0,
    done_items INTEGER DEFAULT 0,
    failed_items INTEGER DEFAULT 0,
    current_step TEXT,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS bulk_job_items (
    id TEXT PRIMARY KEY,
    job_id TEXT,
    source_path TEXT,
    file_name TEXT,
    product_id TEXT,
    listing_id TEXT,
    target_listing_id TEXT,
    status TEXT DEFAULT 'pending',
    step TEXT,
    error TEXT,
    position INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_job_items_job ON bulk_job_items(job_id, status)`);

// Güncelleme modu sonradan eklendi; mevcut kurulumlarda kolonu tamamla
try { db.exec('ALTER TABLE bulk_job_items ADD COLUMN target_listing_id TEXT'); } catch { /* zaten var */ }

// ---------------------------------------------------------------- yardımcılar

function isImageFile(name) {
  return IMAGE_EXT.includes(extname(name).toLowerCase());
}

function touchJob(jobId, fields = {}) {
  const sets = ['updated_at = CURRENT_TIMESTAMP'];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  vals.push(jobId);
  db.prepare(`UPDATE bulk_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function touchItem(itemId, fields = {}) {
  const sets = ['updated_at = CURRENT_TIMESTAMP'];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  vals.push(itemId);
  db.prepare(`UPDATE bulk_job_items SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function isCancelled(jobId) {
  const row = db.prepare('SELECT status FROM bulk_jobs WHERE id = ?').get(jobId);
  return !row || row.status === 'cancelled';
}

/**
 * Görseli mevcut yükleme klasörüne kopyalar ve products tablosuna taslak açar.
 * Dosya adı şeması multer'daki ile birebir aynıdır (product-<ts>-<rand>.<ext>),
 * böylece klasör düzeni bozulmaz.
 */
function ingestImage(sourcePath, shopId, platform = 'etsy') {
  const subPath = getPlatformUploadPath(platform);
  const destDir = join(PROJECT_ROOT, 'storage', subPath, 'uploads');
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const ext = extname(sourcePath).replace('.', '') || 'jpg';
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const fileName = `product-${uniqueSuffix}.${ext}`;
  fs.copyFileSync(sourcePath, join(destDir, fileName));

  const imagePath = `storage/${subPath.replace(/\\/g, '/')}/uploads/${fileName}`;
  const id = uuidv4();
  const title = basename(sourcePath).replace(/\.[^/.]+$/, '').substring(0, 140);

  db.prepare(
    'INSERT INTO products (id, shop_id, image_path, title, tags, description, ai_attributes, template_ids, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    shopId,
    imagePath,
    title,
    JSON.stringify([]),
    '',
    JSON.stringify({ visual_style: [], occasion: [], holiday: [], room: [] }),
    JSON.stringify([]),
    'draft'
  );

  return { id, imagePath, title };
}

// ---------------------------------------------------------------- iş kurulumu

/**
 * Yeni bir toplu iş oluşturur.
 *
 * İki mod vardır:
 *   'create' — her görsel için YENİ listing açılır
 *   'update' — her görsel, eşleştirildiği MEVCUT listing'i yerinde günceller
 *              (listing ID, URL, yaş ve satış geçmişi korunur)
 *
 * @param {object} opts
 *   sourceFolder — görsellerin bulunduğu klasör (mutlak yol)
 *   filePaths    — ya da doğrudan dosya listesi
 *   mode         — 'create' | 'update'
 *   targetListingIds — 'update' modunda güncellenecek listing'ler; görsellerle
 *                      sırayla eşleştirilir (1. görsel -> 1. listing)
 *   config       — { listing_state, auto_section, shipping_profile_id, ... }
 */
export function createJob({ sourceFolder = null, filePaths = null, config = {}, mode = 'create', targetListingIds = null }) {
  const activeShop = getActiveShop();
  if (!activeShop || activeShop.shop_id === 'default_shop') {
    throw new Error('Etsy mağazası bağlı değil.');
  }

  let files = [];

  if (Array.isArray(filePaths) && filePaths.length > 0) {
    files = filePaths.filter(f => fs.existsSync(f) && isImageFile(f));
  } else if (sourceFolder) {
    if (!fs.existsSync(sourceFolder) || !fs.statSync(sourceFolder).isDirectory()) {
      throw new Error(`Klasör bulunamadı: ${sourceFolder}`);
    }
    files = fs.readdirSync(sourceFolder)
      .filter(isImageFile)
      .map(f => join(sourceFolder, f))
      .filter(f => fs.statSync(f).isFile());
  } else {
    throw new Error('Kaynak klasör veya dosya listesi verilmelidir.');
  }

  if (files.length === 0) {
    throw new Error('Seçilen konumda yüklenebilir görsel bulunamadı (jpg, jpeg, png, webp).');
  }

  files.sort();

  // Güncelleme modunda görseller hedef listing'lerle sırayla eşleştirilir.
  // Sayılar tutmazsa küçük olan kadar iş yapılır, fazlası yok sayılır.
  let targets = [];
  if (mode === 'update') {
    if (!Array.isArray(targetListingIds) || targetListingIds.length === 0) {
      throw new Error('Güncelleme modu için güncellenecek listing seçilmelidir.');
    }
    targets = targetListingIds.map(String);

    if (files.length > targets.length) {
      files = files.slice(0, targets.length);
    } else if (targets.length > files.length) {
      targets = targets.slice(0, files.length);
    }
  }

  const jobId = uuidv4();

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO bulk_jobs (id, shop_id, type, status, source_folder, config, total_items, current_step)
      VALUES (?, ?, ?, 'running', ?, ?, ?, 'Kuyruğa alındı')
    `).run(
      jobId,
      activeShop.shop_id,
      mode === 'update' ? 'bulk_update' : 'bulk_replace',
      sourceFolder || '(dosya seçimi)',
      JSON.stringify(config),
      files.length
    );

    const insItem = db.prepare(`
      INSERT INTO bulk_job_items (id, job_id, source_path, file_name, status, position, target_listing_id)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `);
    files.forEach((f, i) => insItem.run(uuidv4(), jobId, f, basename(f), i, mode === 'update' ? targets[i] : null));

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  console.log(`[BulkJob] Yeni iş: ${jobId} — mod=${mode}, ${files.length} görsel`);
  startWorker();
  return getJob(jobId);
}

export function getJob(jobId) {
  const job = db.prepare('SELECT * FROM bulk_jobs WHERE id = ?').get(jobId);
  if (!job) return null;
  const items = db.prepare('SELECT * FROM bulk_job_items WHERE job_id = ? ORDER BY position').all(jobId);
  return {
    ...job,
    config: job.config ? JSON.parse(job.config) : {},
    items
  };
}

export function listActiveJobs() {
  const jobs = db.prepare(`
    SELECT * FROM bulk_jobs
    WHERE status IN ('running', 'cancelled')
       OR (status IN ('completed','error') AND finished_at > datetime('now','-1 day'))
    ORDER BY created_at DESC
  `).all();

  return jobs.map(j => ({
    ...j,
    config: j.config ? JSON.parse(j.config) : {},
    items: db.prepare(
      `SELECT id, file_name, status, step, error, product_id, listing_id, position
       FROM bulk_job_items WHERE job_id = ? ORDER BY position`
    ).all(j.id)
  }));
}

export function cancelJob(jobId) {
  const job = db.prepare('SELECT * FROM bulk_jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error('İş bulunamadı.');
  if (job.status !== 'running') return getJob(jobId);

  touchJob(jobId, { status: 'cancelled', current_step: 'İptal edildi', finished_at: new Date().toISOString() });
  db.prepare(`UPDATE bulk_job_items SET status = 'cancelled' WHERE job_id = ? AND status = 'pending'`).run(jobId);
  console.log(`[BulkJob] İş iptal edildi: ${jobId}`);
  return getJob(jobId);
}

// ---------------------------------------------------------------- worker

let workerRunning = false;

/**
 * Tek bir görseli baştan sona işler.
 * Her adım tamamlandığında DB'ye yazılır, böylece sunucu çökse bile
 * nerede kalındığı bellidir.
 */
async function processItem(job, item, config) {
  const shopId = job.shop_id;

  // 1) Görseli içeri al + taslak ürün aç
  touchItem(item.id, { status: 'processing', step: 'Görsel alınıyor' });
  let productId = item.product_id;

  if (!productId) {
    if (!fs.existsSync(item.source_path)) {
      throw new Error(`Kaynak dosya bulunamadı: ${item.source_path}`);
    }
    const created = ingestImage(item.source_path, shopId, 'etsy');
    productId = created.id;
    touchItem(item.id, { product_id: productId });
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw new Error('Ürün kaydı oluşturulamadı.');

  // 2) Varyasyon profilini en-boy oranına göre eşle
  if (!product.variation_profile_id) {
    touchItem(item.id, { step: 'Varyasyon profili eşleniyor' });
    const profileId = config.variation_profile_id
      || await matchProfileForImage(product.image_path, shopId);

    if (!profileId) throw new Error('Görsel oranına uygun varyasyon profili bulunamadı.');

    db.prepare('UPDATE products SET variation_profile_id = ? WHERE id = ?').run(profileId, productId);
    product.variation_profile_id = profileId;
  }

  if (config.shop_section_id && !product.shop_section_id) {
    db.prepare('UPDATE products SET shop_section_id = ? WHERE id = ?').run(config.shop_section_id, productId);
    product.shop_section_id = config.shop_section_id;
  }

  if (isCancelled(job.id)) return { cancelled: true };

  // GÜNCELLEME MODU: yeni listing açmak yerine mevcut olanı yerinde yeniler.
  // Mockup ve SEO üretimi aynı pipeline, sadece sonuç PATCH edilir.
  if (item.target_listing_id) {
    const result = await updateListingFromProduct({
      listingId: item.target_listing_id,
      productId,
      autoSection: !!config.auto_section,
      shopSectionId: config.shop_section_id || null,
      targetMarket: config.target_market || 'US/UK',
      shopStyle: config.shop_style || 'vintage poster, art deco',
      dryRun: !!config.dry_run,
      agentOptions: {
        requestKey: `bulk:${job.id}:${item.id}`,
        context: { type: 'bulk_update', jobId: job.id, productId, listingId: item.target_listing_id, dryRun: !!config.dry_run, uploadAfterCompletion: !config.dry_run },
        isCancelled: () => isCancelled(job.id),
        onWaiting: ({ message }) => touchItem(item.id, { step: message })
      },
      onStep: (s) => touchItem(item.id, { step: s })
    });

    touchItem(item.id, {
      status: 'done',
      step: result.dryRun
        ? `Deneme — #${item.target_listing_id} için içerik hazır, gönderilmedi`
        : `Güncellendi${result.section_title ? ' → ' + result.section_title : ''}`,
      listing_id: String(result.listing_id)
    });
    return { listingId: result.listing_id, updated: !result.dryRun };
  }

  // 3) Mockup üret — ayrı bir worker thread'de, ana thread bloklanmaz
  touchItem(item.id, { step: 'Mockup üretiliyor' });
  const mockups = await getMockupPool().render(product, {
    onProgress: ({ done, total }) => touchItem(item.id, { step: `Mockup ${done}/${total}` })
  });
  console.log(`[BulkJob] ${item.file_name}: ${mockups.length} mockup üretildi.`);

  if (isCancelled(job.id)) return { cancelled: true };

  // 4) AI SEO
  touchItem(item.id, { step: 'SEO içeriği yazılıyor' });
  const imageAbs = join(PROJECT_ROOT, product.image_path);

  // Otomatik bölüm seçimi açıksa mağaza bölümleri AI'a gönderilir
  let sections = null;
  if (config.auto_section) {
    try {
      sections = await getShopSections();
    } catch (err) {
      console.warn('[BulkJob] Mağaza bölümleri alınamadı, otomatik seçim atlanıyor:', err.message);
    }
  }

  // Çok panelli profillerde SEO metni set diliyle yazılır
  const setInfo = getSetProfileInfo(product.variation_profile_id, shopId);

  const seo = await generateSEO(
    imageAbs,
    config.target_market || 'US/UK',
    config.shop_style || 'vintage poster, art deco',
    shopId,
    'etsy',
    sections,
    setInfo,
    {
      requestKey: `bulk:${job.id}:${item.id}`,
      context: { type: 'bulk_create', jobId: job.id, productId, dryRun: !!config.dry_run, listingState: config.listing_state || 'configured_default', uploadAfterCompletion: !config.dry_run },
      isCancelled: () => isCancelled(job.id),
      onWaiting: ({ message }) => touchItem(item.id, { step: message })
    }
  );

  // AI bir bölüm seçtiyse ürüne yaz; yükleme adımı bunu kullanır
  if (config.auto_section && seo.shop_section_id) {
    db.prepare('UPDATE products SET shop_section_id = ? WHERE id = ?')
      .run(String(seo.shop_section_id), productId);
    product.shop_section_id = String(seo.shop_section_id);
    touchItem(item.id, { step: `Bölüm seçildi: ${seo.shop_section_title}` });
  }

  db.prepare('UPDATE products SET title = ?, tags = ?, description = ?, ai_attributes = ? WHERE id = ?')
    .run(
      seo.title || product.title,
      JSON.stringify(seo.tags || []),
      seo.description || '',
      JSON.stringify({
        visual_style: seo.visual_style || [],
        occasion: seo.occasion || [],
        holiday: seo.holiday || [],
        room: seo.room || []
      }),
      productId
    );

  if (isCancelled(job.id)) return { cancelled: true };

  // Deneme modu: ürün, mockup ve SEO hazırlanır ama Etsy'ye gönderilmez.
  // Taslak, Toplu Yükleme Sihirbazı'nda elle incelenip yayınlanabilir.
  if (config.dry_run) {
    touchItem(item.id, { status: 'done', step: 'Deneme modu — taslak hazır, Etsy\'ye gönderilmedi' });
    return { dryRun: true, productId };
  }

  // 5) Etsy'ye yükle — mevcut pipeline ile birebir aynı fonksiyon
  touchItem(item.id, { step: "Etsy'ye yükleniyor" });
  const result = await uploadProductToEtsy({
    productId,
    shipping_profile_id: config.shipping_profile_id,
    return_policy_id: config.return_policy_id,
    shop_section_id: config.shop_section_id,
    listing_state: config.listing_state,
    readiness_state_id: config.readiness_state_id
  });

  touchItem(item.id, {
    status: 'done',
    step: 'Tamamlandı',
    listing_id: result.listing_id ? String(result.listing_id) : null
  });

  return { listingId: result.listing_id };
}

/**
 * Seçilen eski listingleri Etsy'de inactive yapar.
 * Silme yapılmaz — kullanıcı isterse Etsy panelinden geri açabilir.
 */
async function retireListings(jobId, listingIds) {
  touchJob(jobId, { current_step: `${listingIds.length} eski listing devre dışı bırakılıyor` });
  let ok = 0;

  for (const listingId of listingIds) {
    if (isCancelled(jobId)) break;
    try {
      await updateListing(listingId, { state: 'inactive' });
      db.prepare('UPDATE etsy_analytics_cache SET state = ? WHERE listing_id = ?')
        .run('inactive', String(listingId));
      ok++;
      await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      console.error(`[BulkJob] Listing ${listingId} devre dışı bırakılamadı:`, err.response?.data || err.message);
    }
  }

  console.log(`[BulkJob] ${ok}/${listingIds.length} eski listing devre dışı bırakıldı.`);
}

async function runWorker() {
  if (workerRunning) return;
  workerRunning = true;

  try {
    while (true) {
      const job = db.prepare(`SELECT * FROM bulk_jobs WHERE status = 'running' ORDER BY created_at LIMIT 1`).get();
      if (!job) break;

      const config = job.config ? JSON.parse(job.config) : {};
      const item = db.prepare(
        `SELECT * FROM bulk_job_items WHERE job_id = ? AND status IN ('pending','processing') ORDER BY position LIMIT 1`
      ).get(job.id);

      if (!item) {
        const stats = db.prepare(
          `SELECT
             SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
             SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed
           FROM bulk_job_items WHERE job_id = ?`
        ).get(job.id);

        // Kullanıcı istediyse eski listingleri emekliye ayır.
        // Yalnızca en az bir yeni ürün başarıyla yüklendiyse ve deneme modu
        // kapalıysa çalışır; listing silinmez, sadece inactive yapılır.
        if (!config.dry_run && (stats.done || 0) > 0 && Array.isArray(config.retire_listing_ids) && config.retire_listing_ids.length > 0) {
          await retireListings(job.id, config.retire_listing_ids);
        }

        touchJob(job.id, {
          status: 'completed',
          current_step: 'Tamamlandı',
          done_items: stats.done || 0,
          failed_items: stats.failed || 0,
          finished_at: new Date().toISOString()
        });
        console.log(`[BulkJob] İş tamamlandı: ${job.id} (${stats.done} başarılı, ${stats.failed} hatalı)`);
        continue;
      }

      // Kayan pencere: bir ürün bitince hemen sıradaki alınır, böylece
      // "hepsini bekle sonra yeni grup" gecikmesi olmaz. Mockup render'ları
      // worker havuzunda paralel çalışırken diğer ürünlerin SEO/Etsy adımları
      // ilerler. Sınır esas olarak Etsy'ye aynı anda giden yükleme sayısıdır.
      const pending = db.prepare(
        `SELECT * FROM bulk_job_items WHERE job_id = ? AND status IN ('pending','processing')
         ORDER BY position`
      ).all(job.id);

      let cursor = 0;
      const runNext = async (slot) => {
        // Etsy çağrılarının aynı anda patlamaması için başlangıçta kademelendir
        if (slot > 0) await new Promise(r => setTimeout(r, slot * 600));

        while (cursor < pending.length) {
          if (isCancelled(job.id)) return;
          const it = pending[cursor++];

          touchJob(job.id, { current_step: `${it.file_name} işleniyor` });

          try {
            const res = await processItem(job, it, config);
            if (res.cancelled) {
              touchItem(it.id, { status: 'cancelled', step: 'İptal edildi' });
            }
          } catch (err) {
            if (err.code === 'AGENT_CANCELLED' || isCancelled(job.id)) {
              touchItem(it.id, { status: 'cancelled', step: 'İptal edildi' });
              return;
            }
            console.error(`[BulkJob] ${it.file_name} başarısız:`, err.response?.data || err.message);
            touchItem(it.id, {
              status: 'error',
              step: 'Hata',
              error: (err.response?.data ? JSON.stringify(err.response.data) : err.message).substring(0, 500)
            });
          }

          const s = db.prepare(
            `SELECT
               SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
               SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed
             FROM bulk_job_items WHERE job_id = ?`
          ).get(job.id);
          touchJob(job.id, { done_items: s.done || 0, failed_items: s.failed || 0 });
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(ITEM_CONCURRENCY, pending.length) }, (_, i) => runNext(i))
      );

      const stats = db.prepare(
        `SELECT
           SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed
         FROM bulk_job_items WHERE job_id = ?`
      ).get(job.id);
      touchJob(job.id, { done_items: stats.done || 0, failed_items: stats.failed || 0 });
    }
  } finally {
    workerRunning = false;
  }
}

export function startWorker() {
  if (workerRunning) return;
  runWorker().catch(err => {
    console.error('[BulkJob] Worker beklenmedik şekilde durdu:', err);
    workerRunning = false;
  });
}

/**
 * Sunucu açılışında yarım kalmış işleri devam ettirir.
 * 'processing' durumunda kalmış öğeler 'pending'e döndürülür ki
 * kaldığı yerden yeniden denensin.
 */
export function resumePendingJobs() {
  try {
    const stuck = db.prepare(
      `UPDATE bulk_job_items SET status = 'pending', step = 'Yeniden kuyruğa alındı'
       WHERE status = 'processing'`
    ).run();

    const running = db.prepare(`SELECT COUNT(*) AS c FROM bulk_jobs WHERE status = 'running'`).get();
    if (running.c > 0) {
      console.log(`[BulkJob] ${running.c} yarım kalmış iş devam ettiriliyor (${stuck.changes} öğe yeniden kuyruğa alındı).`);
      startWorker();
    }
  } catch (err) {
    console.error('[BulkJob] Yarım kalan işler devam ettirilemedi:', err.message);
  }
}
