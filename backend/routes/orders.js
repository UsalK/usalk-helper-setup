import express from 'express';
import fs from 'fs';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { basename, extname, join } from 'path';
import db, { getActiveShop, getShopStorageName } from '../db/db.js';
import * as EtsyService from '../services/EtsyService.js';
import { findSourceByListing, PROJECT_ROOT } from '../services/OrderSources.js';

const router = express.Router();

const PAGE_MAX = 100;
const CACHE_TTL_MS = 60 * 1000;
const MAX_PAGES = 30; // 3000 sipariş; mağaza büyürse burası tarih filtresine geçmeli

// Etsy Money nesnesi: { amount: 13780, divisor: 100, currency_code: 'USD' }
const money = (m) => (m ? { value: m.amount / m.divisor, currency: m.currency_code } : null);
const round2 = (n) => Math.round(n * 100) / 100;

// Etsy başlık ve varyasyon metinlerini HTML-kaçışlı gönderiyor: 36&quot;x20&quot;
const ENTITIES = { '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' };
const decode = (s) => (s == null ? s : String(s).replace(/&(quot|#39|apos|lt|gt|amp);/g, m => ENTITIES[m]));

// Kalemin siparişteki payı (fiyat × adet / sipariş toplamı). Kupon indirimi sipariş
// seviyesinde geliyor; kalem alanları (buyer_coupon, shop_coupon) aynı indirimi iki
// farklı biçimde tekrarlıyor (biri alıcının para biriminde) — toplanamaz, kullanmıyoruz.
function lineShare(t, r) {
  const total = money(r.total_price)?.value || 0;
  const line = (money(t.price)?.value || 0) * t.quantity;
  return total > 0 ? line / total : 0;
}

/**
 * Listede gösterilen durum grubu. Etsy'nin kendi durumları (paid/completed/canceled...)
 * iade ile iptali, kargo ile teslimi ayırmıyor.
 *   refunded  -> iade kaydı var (iptal edilip iade edilenler dahil)
 *   canceled  -> iptal, iade kaydı yok
 *   completed -> teslim edildi olarak işaretlenmiş
 *   shipped   -> kargolanmış, teslim işareti yok
 *   paid      -> ödenmiş, kargolanmamış
 */
function stateOf(r, deliveredIds) {
  const s = String(r.status).toLowerCase();
  if ((r.refunds || []).length || s.includes('refunded')) return 'refunded';
  if (s === 'canceled') return 'canceled';
  if (deliveredIds.has(r.receipt_id)) return 'completed';
  // Dijital siparişler "kargolandı" olur ama asla "teslim edildi" işaretlenmez;
  // indirme anında teslim sayılır.
  const txs = r.transactions || [];
  if (r.is_shipped && txs.length && txs.every(t => t.is_digital)) return 'completed';
  if (r.is_shipped) return 'shipped';
  return 'paid';
}

function toItem(t, imagesByListing, r) {
  const images = imagesByListing.get(t.listing_id) || [];
  const img = images.find(i => i.listing_image_id === t.listing_image_id) || images[0];
  const src = findSourceByListing(t.listing_id);
  const price = money(t.price);
  const couponValue = (money(r.discount_amt)?.value || 0) * lineShare(t, r);
  return {
    transaction_id: t.transaction_id,
    listing_id: t.listing_id,
    etsy_product_id: t.product_id,  // envanterde varyantın (boyut+çerçeve) kimliği
    title: decode(t.title),
    sku: t.sku || null,
    quantity: t.quantity,
    is_digital: Boolean(t.is_digital),
    variations: (t.variations || []).map(v => ({ name: decode(v.formatted_name), value: decode(v.formatted_value) })),
    price,                           // birim liste fiyatı
    coupon_discount: couponValue > 0 && price ? { value: round2(couponValue), currency: price.currency } : null, // kalemin toplam indirimi (tüm adetler)
    expected_ship_date: t.expected_ship_date || null,
    shipped_at: t.shipped_timestamp || null,
    etsy_image_url: img?.url_170x135 || img?.url_570xN || null,
    etsy_image_full_url: img?.url_fullxfull || img?.url_570xN || null,
    source: src.source,              // 'local' | 'missing' (DB'de var, diskte yok) | 'none' (listing DB'de yok)
    source_image_path: src.relPath,  // yalnızca dosya diskteyse dolu
    product_id: src.product?.id || null
  };
}

function toOrder(r, imagesByListing, deliveredIds) {
  const total = money(r.total_price);
  const discount = money(r.discount_amt);
  const refunds = (r.refunds || []).map(f => ({
    amount: money(f.amount),
    created_at: f.created_timestamp,
    reason: decode(f.reason) || null,
    note: decode(f.note_from_issuer) || null,
    status: f.status || null
  }));
  const refundedValue = refunds.reduce((sum, f) => sum + (f.amount?.value || 0), 0);
  return {
    receipt_id: r.receipt_id,
    created_at: r.create_timestamp,
    status: r.status,
    state: stateOf(r, deliveredIds),
    is_shipped: r.is_shipped,
    is_delivered: deliveredIds.has(r.receipt_id),
    customer_name: decode(r.name),
    grandtotal: money(r.grandtotal),
    total_price: total,
    // Etsy API kupon KODUNU vermiyor, yalnızca indirim tutarını; oranı biz hesaplıyoruz.
    discount: discount && discount.value > 0
      ? { ...discount, percent: total?.value ? Math.round((discount.value / total.value) * 100) : null }
      : null,
    refunds,
    refunded_total: refunds.length
      ? { value: round2(refundedValue), currency: refunds[0].amount?.currency || r.grandtotal?.currency_code }
      : null,
    items: (r.transactions || []).map(t => toItem(t, imagesByListing, r))
  };
}

function etsyError(err, res, next) {
  const status = err.response?.status;
  if (status === 401 || status === 403) {
    return res.status(403).json({
      code: 'missing_scope',
      error: 'Bu mağazanın siparişlerini okuma izni yok. Etsy Bağlantısı sayfasından mağazayı yeniden bağlayın (sipariş okuma izni yeni eklendi).',
      detail: err.response?.data?.error || null
    });
  }
  if (err.response?.data?.error) return next(new Error(`Etsy: ${err.response.data.error}`));
  next(err);
}

// ---------------------------------------------------------------------------
// Mağazanın tüm siparişleri + teslim edilenler, mağaza bazında kısa önbellek.
// Filtre/sıralama tüm siparişlere uygulanabilsin ve istatistikler aynı veriden
// hesaplansın diye liste de buradan beslenir.
// ---------------------------------------------------------------------------
const shopCache = new Map(); // shop_id -> { at, promise }

async function fetchAll(shopId, wasDelivered = null) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await EtsyService.getShopReceipts({ limit: 100, offset: page * 100, shopId, wasDelivered });
    const results = data.results || [];
    out.push(...results);
    if (out.length >= (data.count ?? 0) || !results.length) break;
  }
  return out;
}

async function buildShopData(shopId) {
  const [receipts, delivered] = await Promise.all([fetchAll(shopId), fetchAll(shopId, true)]);
  const deliveredIds = new Set(delivered.map(r => r.receipt_id));
  return { receipts, deliveredIds, stats: buildStats(receipts) };
}

function loadShop(shopId, force = false) {
  const hit = shopCache.get(shopId);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;
  const promise = buildShopData(shopId);
  shopCache.set(shopId, { at: Date.now(), promise });
  promise.catch(() => shopCache.delete(shopId)); // hatalı sonucu önbellekte tutma
  return promise;
}

const EXCLUDED_FROM_STATS = new Set(['canceled', 'fully refunded']);

// Listing başına satış adedi ve net kazanç (kupon ve iadeler düşülmüş)
function buildStats(receipts) {
  const byListing = new Map();
  let currency = null;
  for (const r of receipts) {
    if (EXCLUDED_FROM_STATS.has(String(r.status).toLowerCase())) continue;
    // subtotal = ürün toplamı − kupon (vergi/kargo hariç); kalemlere fiyat payına göre dağıt.
    // İade vergi/kargoyu da kapsayabildiği için net eksiye düşmesin.
    const subtotal = money(r.subtotal)?.value || 0;
    const refunded = (r.refunds || []).reduce((s, f) => s + (money(f.amount)?.value || 0), 0);
    for (const t of r.transactions || []) {
      const net = Math.max(0, subtotal - refunded) * lineShare(t, r);
      const s = byListing.get(t.listing_id) || { units: 0, revenue: 0, first: Infinity, last: 0 };
      s.units += t.quantity;
      s.revenue += net;
      s.first = Math.min(s.first, r.create_timestamp);
      s.last = Math.max(s.last, r.create_timestamp);
      byListing.set(t.listing_id, s);
      currency ||= money(t.price)?.currency;
    }
  }
  const all = [...byListing.values()];
  [...all].sort((a, b) => b.units - a.units || b.revenue - a.revenue).forEach((s, i) => { s.rankUnits = i + 1; });
  [...all].sort((a, b) => b.revenue - a.revenue).forEach((s, i) => { s.rankRevenue = i + 1; });
  return { byListing, rankedCount: all.length, currency };
}

// Mağazanın varyasyon profillerindeki tek parça oranlar (2:3, 12:7...). Sipariş
// detayında görselin oranı bunlardan en yakınına yuvarlanır. Çoklu panel setleri
// ("2:3x2") hariç; mağazanın profili yoksa tüm mağazalarınki kullanılır.
function variationRatios(shopId) {
  const pick = (rows) => [...new Set(rows.map(r => r.ratio).filter(r => /^\d+:\d+$/.test(r || '')))];
  const own = pick(db.prepare('SELECT DISTINCT ratio FROM variation_profiles WHERE shop_id = ?').all(shopId));
  return own.length ? own : pick(db.prepare('SELECT DISTINCT ratio FROM variation_profiles').all());
}

function tagsFor(s) {
  const tags = [];
  if (!s) return tags;
  if (s.rankUnits === 1 && s.units >= 2) tags.push({ label: 'En çok satan', tone: 'gold' });
  else if (s.rankUnits <= 5 && s.units >= 2) tags.push({ label: `Satışta #${s.rankUnits}`, tone: 'amber' });
  if (s.rankRevenue === 1) tags.push({ label: 'En çok kazandıran', tone: 'gold' });
  if (s.units === 1) tags.push({ label: 'İlk satışı', tone: 'sky' });
  else if (s.units >= 2) tags.push({ label: 'Tekrar satan', tone: 'emerald' });
  return tags;
}

const STATES = ['paid', 'shipped', 'completed', 'refunded', 'canceled'];

const SORTS = {
  date_desc: (a, b) => b.create_timestamp - a.create_timestamp,
  date_asc: (a, b) => a.create_timestamp - b.create_timestamp,
  total_desc: (a, b) => (money(b.grandtotal)?.value || 0) - (money(a.grandtotal)?.value || 0),
  total_asc: (a, b) => (money(a.grandtotal)?.value || 0) - (money(b.grandtotal)?.value || 0)
};

// Aktif mağazanın siparişleri: ?state=paid|shipped|completed|refunded|canceled &sort=... &refresh=1
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), PAGE_MAX);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const state = STATES.includes(req.query.state) ? req.query.state : null;
    const sort = req.query.sort || 'date_desc';
    // Mağazayı istek başında sabitle; detay çağrıları da bu mağazayla yapılır.
    const shopId = getActiveShop().shop_id;
    const { receipts, deliveredIds, stats } = await loadShop(shopId, req.query.refresh === '1');

    const counts = { all: receipts.length };
    for (const s of STATES) counts[s] = 0;
    for (const r of receipts) counts[stateOf(r, deliveredIds)]++;

    let list = state ? receipts.filter(r => stateOf(r, deliveredIds) === state) : [...receipts];
    if (sort === 'product_revenue_desc') {
      // Siparişteki ürünün mağazada toplam kazandırdığı paraya göre
      const key = (r) => Math.max(0, ...(r.transactions || []).map(t => stats.byListing.get(t.listing_id)?.revenue || 0));
      list.sort((a, b) => key(b) - key(a) || b.create_timestamp - a.create_timestamp);
    } else {
      list.sort(SORTS[sort] || SORTS.date_desc);
    }
    const page = list.slice(offset, offset + limit);

    const listingIds = [...new Set(page.flatMap(r => (r.transactions || []).map(t => t.listing_id)))];
    const imagesByListing = new Map();
    try {
      for (const l of await EtsyService.getListingsWithImages(listingIds)) {
        imagesByListing.set(l.listing_id, l.images || []);
      }
    } catch (err) {
      // Görseller olmadan da liste işe yarar; yerel kaynak görsel varsa o gösterilir.
      console.warn('[Orders] Listing görselleri alınamadı:', err.response?.data || err.message);
    }

    res.json({
      shop_id: shopId,
      count: list.length,
      counts,
      limit,
      offset,
      orders: page.map(r => ({ ...toOrder(r, imagesByListing, deliveredIds), shop_id: shopId }))
    });
  } catch (err) {
    etsyError(err, res, next);
  }
});

// Sipariş detayındaki "ürün performansı" kartı: satış adedi, kazanç, sıralama, stok
router.get('/listing/:listingId/insights', async (req, res, next) => {
  try {
    const listingId = Number(req.params.listingId);
    const productId = req.query.product_id ? Number(req.query.product_id) : null;
    // Siparişin mağazası; verilmezse aktif mağaza (eski istemciler için)
    const shopId = req.query.shop_id ? String(req.query.shop_id) : getActiveShop().shop_id;
    const { stats } = await loadShop(shopId);
    const s = stats.byListing.get(listingId);

    // Stok: satın alınan varyantın adedi. Envanter okunamazsa (silinmiş listing vb.)
    // istatistikler yine döner.
    let stock = null;
    try {
      const inv = await EtsyService.getListingInventory(listingId, shopId);
      const live = (inv.products || []).filter(p => !p.is_deleted);
      const qty = (p) => (p.offerings || []).filter(o => o.is_enabled && !o.is_deleted).reduce((a, o) => a + (o.quantity || 0), 0);
      const variant = productId ? live.find(p => p.product_id === productId) : null;
      stock = { variant: variant ? qty(variant) : null };
    } catch (err) {
      console.warn(`[Orders] Envanter okunamadı (${listingId}):`, err.response?.data?.error || err.message);
    }

    res.json({
      units_sold: s?.units || 0,
      revenue: s ? { value: round2(s.revenue), currency: stats.currency } : null,
      first_sale_at: s?.first ?? null,
      last_sale_at: s?.last || null,
      rank_units: s?.rankUnits || null,
      rank_revenue: s?.rankRevenue || null,
      ranked_listings: stats.rankedCount,
      tags: tagsFor(s),
      stock,
      variation_ratios: variationRatios(shopId)
    });
  } catch (err) {
    etsyError(err, res, next);
  }
});

// Orijinal (kaynak) görseli indir
router.get('/listing/:listingId/source', (req, res) => {
  const src = findSourceByListing(req.params.listingId);
  if (!src.absPath) return res.status(404).json({ error: 'Bu ürünün kaynak görseli diskte yok.' });
  res.download(src.absPath, basename(src.absPath), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Kaynak görsel bulunamadı (silinmiş olabilir).' });
  });
});

// ---------------------------------------------------------------------------
// Kaynak görseli olmayan (diskte bulunamayan ya da hiç eşleşmemiş) siparişe
// kullanıcının kaynak görsel tanıtması. Dosya ürün yüklemesiyle aynı yere ve aynı
// adlandırmayla kopyalanır: storage/etsy/<Mağaza>/uploads/product-<zaman>-<rastgele>.<uzantı>
// ---------------------------------------------------------------------------
const SOURCE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const shopIdOf = (req) => String(req.query.shop_id || '') || getActiveShop().shop_id;

const sourceUpload = multer({
  storage: multer.diskStorage({
    // shop_id sorgu parametresinden: multipart alanları dosyadan önce çözülmeyebilir
    destination: (req, file, cb) => {
      const dir = join(PROJECT_ROOT, 'storage', 'etsy', getShopStorageName(shopIdOf(req)), 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `product-${Date.now()}-${Math.round(Math.random() * 1E9)}${extname(file.originalname).toLowerCase()}`);
    }
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (SOURCE_EXT.has(extname(file.originalname).toLowerCase())) return cb(null, true);
    cb(new Error('Yalnızca PNG, JPG veya WEBP yüklenebilir.'));
  }
});

router.post('/listing/:listingId/source', (req, res, next) => {
  const listingId = String(Number(req.params.listingId));
  if (listingId === 'NaN') return res.status(400).json({ error: 'Geçersiz listing.' });
  // Mevcut kaynak dosyanın üzerine yazma: bu yol yalnızca kaynağı olmayan ürünler için
  if (findSourceByListing(listingId).source === 'local') {
    return res.status(409).json({ error: 'Bu ürünün kaynak görseli zaten diskte.' });
  }

  sourceUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Görsel seçilmedi.' });
    try {
      const shopId = shopIdOf(req);
      const relPath = `storage/etsy/${getShopStorageName(shopId)}/uploads/${req.file.filename}`;
      const existing = findSourceByListing(listingId).product;
      let productId;
      if (existing) {
        // Ürün kayıtlı ama dosyası kayıp: yeni dosyaya bağla
        db.prepare('UPDATE products SET image_path = ? WHERE id = ?').run(relPath, existing.id);
        productId = existing.id;
      } else {
        // Uygulama dışından açılmış listing: products.js'teki "bağlı kayıt" ile aynı biçimde live kayıt
        productId = uuidv4();
        db.prepare(`
          INSERT INTO products (id, shop_id, image_path, title, tags, description, ai_attributes, template_ids, etsy_listing_id, status)
          VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, 'live')
        `).run(
          productId, shopId, relPath,
          String(req.body?.title || '').slice(0, 140),
          JSON.stringify([]),
          JSON.stringify({ visual_style: [], occasion: [], holiday: [], room: [] }),
          JSON.stringify([]),
          listingId
        );
      }
      console.log(`[Orders] Kaynak görsel tanıtıldı: listing ${listingId} -> ${relPath} (${existing ? 'güncellendi' : 'yeni kayıt'})`);
      res.json({ source: 'local', source_image_path: relPath, product_id: productId, created: !existing });
    } catch (e) {
      fs.rmSync(req.file.path, { force: true }); // DB yazılamadıysa yetim dosya bırakma
      next(e);
    }
  });
});

export default router;
