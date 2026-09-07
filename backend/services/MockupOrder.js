/**
 * Mockup görsellerinin yükleme sırası (kapak + galeri dizilimi).
 *
 * Şablon Stüdyosu'nda oran bazında ("2:3", "1:1" ...) bir dizilim tanımlanır;
 * burada o dizilim gerçek dosya listesine uygulanır. Etsy/Shopify'a yüklenen
 * görsellerin sırası bu modülden geçer, böylece stüdyodaki önizleme ile
 * yüklemedeki gerçek sıra birebir aynıdır.
 *
 * Kural sırası:
 *   1. thumbnailFirst açıksa 1. sıra (kapak) mutlaka thumbnail işaretli bir
 *      şablondur — kullanıcı sabit sıraya bir thumbnail koyduysa o, koymadıysa
 *      thumbnail'lardan rastgele biri.
 *   2. Kullanıcının sabitlediği şablonlar (pinned) verilen sırayla dizilir.
 *   3. Kalanlar restMode'a göre rastgele karıştırılır ya da olduğu gibi eklenir.
 *
 * Hiç ayar yoksa eski davranış (legacy) aynen korunur: rastgele bir thumbnail
 * kapak olur, diğerleri klasör sırasıyla, artan thumbnail'lar en sona gider.
 */

import db, { getActiveShop } from '../db/db.js';

const SETTINGS_KEY = 'mockup_order';

/** Bir oran için varsayılan dizilim ayarı. */
export const DEFAULT_RATIO_ORDER = {
  enabled: false,        // false → legacy davranış
  thumbnailFirst: true,  // kapak görseli thumbnail şablonlarından seçilir
  mode: 'custom',        // 'custom' (sabit sıra + kalanlar) | 'random' (tamamı rastgele)
  pinned: [],            // sabit sıradaki şablon anahtarları (statikler: static_<id>)
  restMode: 'random',    // 'random' | 'sequential' — sabit sıradan sonrası
  staticLast: true       // sabitlenmemiş statik görseller (ölçü tablosu vb.) en sona
};

/* ------------------------------------------------------------------ */
/* Dosya adı çözümleme                                                 */
/* ------------------------------------------------------------------ */

/**
 * `<templateId>_<oran>.jpg` / `static_<templateId>_<oran>.jpg` adını çözer.
 * @returns {{ key: string, ratio: string|null }} key statik önekini korur.
 */
export function parseMockupFilename(filename) {
  const dotIdx = filename.lastIndexOf('.');
  const base = dotIdx === -1 ? filename : filename.substring(0, dotIdx);
  const underscoreIdx = base.lastIndexOf('_');
  if (underscoreIdx === -1) return { key: base, ratio: null };

  // Oran anahtarı '2-3' ya da çok panelli setlerde '1-2x2' biçimindedir.
  const rawRatio = base.substring(underscoreIdx + 1);
  const ratio = /^\d+-\d+(x\d+)?$/.test(rawRatio) ? rawRatio.replace('-', ':') : null;
  if (!ratio) return { key: base, ratio: null };

  return { key: base.substring(0, underscoreIdx), ratio };
}

/** Anahtardan gerçek şablon ID'si (statik öneki atılır). */
export function templateIdFromKey(key) {
  return key.startsWith('static_') ? key.substring(7) : key;
}

const templateCache = new Map();

function getTemplateInfo(key) {
  if (templateCache.has(key)) return templateCache.get(key);

  let info = null;
  try {
    const row = db.prepare('SELECT name, type, config FROM templates WHERE id = ?').get(templateIdFromKey(key));
    if (row) {
      let config = {};
      try { config = JSON.parse(row.config) || {}; } catch { config = {}; }
      info = { name: row.name, type: row.type, config };
    }
  } catch (err) {
    console.error('[MockupOrder] Şablon okunamadı:', err.message);
  }

  templateCache.set(key, info);
  return info;
}

/** Şablon önbelleğini boşaltır (şablon eklenince/silinince çağrılır). */
export function invalidateTemplateCache() {
  templateCache.clear();
}

/** Şablon adı "thumb" ile başlıyorsa ya da config'inde işaretliyse kapak adayıdır. */
export function isThumbnailKey(key) {
  const info = getTemplateInfo(key);
  if (!info) return false;
  const configIsThumb = info.config && (info.config.is_thumbnail === true || info.config.is_thumbnail === 'true');
  const nameIsThumb = info.name && info.name.toLowerCase().startsWith('thumb');
  return Boolean(configIsThumb || nameIsThumb);
}

/* ------------------------------------------------------------------ */
/* Ayar okuma / yazma                                                  */
/* ------------------------------------------------------------------ */

/** Tüm oranların dizilim ayarını döner: `{ '2:3': {...}, '1:1': {...} }` */
export function getMockupOrderConfig(shopId = null) {
  const targetShop = shopId || getActiveShop().shop_id;
  try {
    const row = db.prepare('SELECT value FROM settings WHERE shop_id = ? AND key = ?').get(targetShop, SETTINGS_KEY);
    if (!row || !row.value) return {};
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.error('[MockupOrder] Dizilim ayarı okunamadı:', err.message);
    return {};
  }
}

/** Verilen oranın ayarını (varsayılanlarla tamamlanmış olarak) döner. */
export function getRatioOrder(ratio, shopId = null) {
  const all = getMockupOrderConfig(shopId);
  return normalizeRatioOrder(all[ratio]);
}

/** Tüm dizilim ayarını kaydeder. */
export function saveMockupOrderConfig(config, shopId = null) {
  const targetShop = shopId || getActiveShop().shop_id;
  const clean = {};
  for (const [ratio, value] of Object.entries(config || {})) {
    clean[ratio] = normalizeRatioOrder(value);
  }
  const stmt = db.prepare(
    'INSERT INTO settings (shop_id, key, value) VALUES (?, ?, ?) ON CONFLICT(shop_id, key) DO UPDATE SET value = ?'
  );
  const valStr = JSON.stringify(clean);
  stmt.run(targetShop, SETTINGS_KEY, valStr, valStr);
  return clean;
}

/** Tek bir oranın ayarını günceller, diğerlerine dokunmaz. */
export function saveRatioOrder(ratio, ratioConfig, shopId = null) {
  const all = getMockupOrderConfig(shopId);
  all[ratio] = normalizeRatioOrder(ratioConfig);
  saveMockupOrderConfig(all, shopId);
  return all[ratio];
}

function normalizeRatioOrder(value) {
  const cfg = { ...DEFAULT_RATIO_ORDER, ...(value || {}) };
  cfg.enabled = Boolean(cfg.enabled);
  cfg.thumbnailFirst = Boolean(cfg.thumbnailFirst);
  cfg.mode = cfg.mode === 'random' ? 'random' : 'custom';
  cfg.restMode = cfg.restMode === 'sequential' ? 'sequential' : 'random';
  cfg.staticLast = cfg.staticLast !== false;
  cfg.pinned = Array.isArray(cfg.pinned) ? cfg.pinned.filter(k => typeof k === 'string' && k.length > 0) : [];
  // Aynı şablon iki kez sabitlenemez
  cfg.pinned = Array.from(new Set(cfg.pinned));
  return cfg;
}

/* ------------------------------------------------------------------ */
/* Sıralama                                                            */
/* ------------------------------------------------------------------ */

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Ayar tanımlı değilken kullanılan eski davranış. */
function legacyOrder(entries) {
  const thumbs = entries.filter(e => isThumbnailKey(e.key));
  const others = entries.filter(e => !isThumbnailKey(e.key));

  if (thumbs.length === 0) return entries.map(e => e.file);

  const randomIndex = Math.floor(Math.random() * thumbs.length);
  const primary = thumbs[randomIndex];
  const remainingThumbs = thumbs.filter((_, idx) => idx !== randomIndex);

  return [primary, ...others, ...remainingThumbs].map(e => e.file);
}

/** Dosya listesindeki baskın oranı bulur (ürünler tek oranla üretilir). */
function dominantRatio(entries) {
  const counts = new Map();
  for (const e of entries) {
    if (!e.ratio) continue;
    counts.set(e.ratio, (counts.get(e.ratio) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [ratio, count] of counts) {
    if (count > bestCount) {
      best = ratio;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Mockup dosyalarını yükleme sırasına dizer.
 *
 * @param {string[]} files   klasördeki dosya adları
 * @param {object}   options { shopId, config, ratio }
 * @returns {string[]} sıralanmış dosya adları
 */
export function orderMockupFiles(files, options = {}) {
  const list = Array.isArray(files) ? files : [];
  if (list.length <= 1) return [...list];

  const entries = list.map(file => ({ file, ...parseMockupFilename(file) }));
  const ratio = options.ratio || dominantRatio(entries);

  const cfg = options.config
    ? normalizeRatioOrder(options.config)
    : (ratio ? getRatioOrder(ratio, options.shopId) : null);

  if (!cfg || !cfg.enabled) return legacyOrder(entries);

  return applyRatioOrder(entries, cfg).map(e => e.file);
}

/**
 * Dizilim ayarını çözümlenmiş girdilere uygular.
 * Önizleme (Şablon Stüdyosu) ve gerçek yükleme aynı fonksiyonu kullanır.
 *
 * @param {{file:string,key:string,ratio:string|null}[]} entries
 * @param {object} cfg normalize edilmiş oran ayarı
 * @returns {object[]} sıralanmış girdiler
 */
export function applyRatioOrder(entries, cfg) {
  const remaining = [...entries];
  const result = [];

  const take = (predicate) => {
    const idx = remaining.findIndex(predicate);
    if (idx === -1) return null;
    return remaining.splice(idx, 1)[0];
  };

  // 1) Kapak görseli: thumbnail kuralı her şeyin önünde
  if (cfg.thumbnailFirst) {
    const pinnedThumbKey = cfg.pinned.find(key => isThumbnailKey(key) && remaining.some(e => e.key === key));
    let cover = null;

    if (pinnedThumbKey) {
      cover = take(e => e.key === pinnedThumbKey);
    } else {
      const thumbs = remaining.filter(e => isThumbnailKey(e.key));
      if (thumbs.length > 0) {
        const pick = thumbs[Math.floor(Math.random() * thumbs.length)];
        cover = take(e => e.file === pick.file);
      }
    }

    if (cover) result.push(cover);
  }

  // 2) Kullanıcının sabitlediği sıra (mode === 'random' ise atlanır)
  if (cfg.mode !== 'random') {
    for (const key of cfg.pinned) {
      const entry = take(e => e.key === key);
      if (entry) result.push(entry);
    }
  }

  // 3) Kalanlar
  let rest = (cfg.mode === 'random' || cfg.restMode === 'random')
    ? shuffle(remaining)
    : remaining;

  // 4) Statik bilgilendirme görselleri (ölçü tablosu vb.) galerinin sonunda
  if (cfg.staticLast) {
    const statics = rest.filter(e => e.key.startsWith('static_'));
    rest = [...rest.filter(e => !e.key.startsWith('static_')), ...statics];
  }

  return [...result, ...rest];
}

/**
 * Bir oran için üretilecek mockup'ların sanal dosya listesini kurar.
 * Ürün yüklemeden stüdyoda önizleme yapabilmek için kullanılır.
 *
 * @returns {{key:string, file:string, id:string, name:string, type:string,
 *            background_path:string, is_thumbnail:boolean}[]}
 */
export function buildRatioCandidates(ratio, shopId = null) {
  const targetShop = shopId || getActiveShop().shop_id;
  const cleanRatio = ratio.replace(':', '-');

  let rows = [];
  try {
    rows = db.prepare('SELECT id, name, type, config, background_path FROM templates WHERE shop_id = ? ORDER BY created_at DESC').all(targetShop);
  } catch (err) {
    console.error('[MockupOrder] Şablonlar okunamadı:', err.message);
    return [];
  }

  const candidates = [];
  for (const row of rows) {
    let config = {};
    try { config = JSON.parse(row.config) || {}; } catch { config = {}; }

    const ratios = (config.compatible_ratios && config.compatible_ratios.length > 0)
      ? config.compatible_ratios
      : ['2:3'];
    if (!ratios.includes(ratio)) continue;

    const key = row.type === 'static' ? `static_${row.id}` : row.id;
    candidates.push({
      key,
      file: `${key}_${cleanRatio}.jpg`,
      ratio,
      id: row.id,
      name: row.name,
      type: row.type,
      background_path: row.background_path,
      is_thumbnail: isThumbnailKey(key)
    });
  }

  return candidates;
}

/**
 * Stüdyo önizlemesi: bir oranın şablonlarını gerçek algoritmayla dizer.
 * `config` verilmezse kayıtlı ayar kullanılır (henüz kaydedilmemiş ayarlar da
 * önizlenebilsin diye dışarıdan geçilebilir).
 */
export function previewRatioOrder(ratio, config = null, shopId = null) {
  invalidateTemplateCache();
  const candidates = buildRatioCandidates(ratio, shopId);
  if (candidates.length === 0) return [];

  const cfg = normalizeRatioOrder(config || getRatioOrder(ratio, shopId));

  if (!cfg.enabled) {
    const orderedFiles = legacyOrder(candidates);
    const byFile = new Map(candidates.map(c => [c.file, c]));
    return orderedFiles.map(f => byFile.get(f)).filter(Boolean);
  }

  return applyRatioOrder(candidates, cfg);
}
