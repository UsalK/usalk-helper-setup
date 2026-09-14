/**
 * İlk kurulum sihirbazı.
 *
 * Sıfırdan klonlanan bir kurulumda `.env` ve `database.db` git'e dahil edilmediği
 * için uygulama hiçbir şeyi bilmeden açılır. Bu router, kullanıcıyı zorunlu
 * sırayla ilerletir:
 *
 *   1. Etsy app bilgileri                  (bu olmadan OAuth başlatılamaz)
 *   2. mağaza bağlama                       (bu olmadan Etsy API çağrılamaz)
 *   3. kargo/iade/işleme profilleri         (bu olmadan listing yüklenemez)
 *   4. OpenRouter anahtarı                  (bu olmadan SEO üretimi çalışmaz)
 *
 * Sıra kritik: her adım bir öncekinin ürettiği bilgiye dayanıyor.
 */

import express from 'express';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db, { getActiveShop } from '../db/db.js';
import * as EtsyService from '../services/EtsyService.js';

const router = express.Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '../.env');

/** Ayar tablosundaki global (mağazadan bağımsız) bayraklar. */
function getGlobalFlag(key) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE shop_id = ? AND key = ?').get('global', key);
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

function setGlobalFlag(key, value) {
  const val = JSON.stringify(value);
  db.prepare(
    "INSERT INTO settings (shop_id, key, value) VALUES ('global', ?, ?) ON CONFLICT(shop_id, key) DO UPDATE SET value = ?"
  ).run(key, val, val);
}

/**
 * .env dosyasını satır bazında günceller.
 *
 * Dosyayı yeniden üretmek yerine mevcut satırları koruyup sadece verilen
 * anahtarları değiştiriyoruz: kullanıcının elle eklediği (Shopify, NVIDIA gibi)
 * değerler ve yorum satırları kaybolmasın.
 */
function writeEnvKeys(updates) {
  let lines = [];
  if (fs.existsSync(ENV_PATH)) {
    lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  }

  for (const [key, rawValue] of Object.entries(updates)) {
    if (rawValue === undefined || rawValue === null) continue;
    const value = String(rawValue).trim();
    if (!value) continue;

    const line = `${key}=${value}`;
    const idx = lines.findIndex(l => l.trim().startsWith(`${key}=`));
    if (idx >= 0) {
      lines[idx] = line;
    } else {
      lines.push(line);
    }

    // Süreç içi değeri de tazeliyoruz ki kullanıcı backend'i yeniden başlatmadan
    // bir sonraki adıma geçebilsin — getEtsyCredentials() gibi çağrılar
    // process.env'i her seferinde yeniden okuyor.
    process.env[key] = value;
  }

  fs.writeFileSync(ENV_PATH, lines.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf8');
}

const hasEnv = (key) => Boolean(process.env[key] && process.env[key].trim());

/**
 * Kurulumun neresinde olduğumuzu döner. Frontend bu yanıta bakarak hangi adımı
 * açacağına ve hangilerini tamamlanmış göstereceğine karar verir.
 */
router.get('/status', async (req, res, next) => {
  try {
    const status = {
      // Etsy app'inde kayıtlı olması gereken callback; sihirbaz kopyalatır.
      redirectUri: EtsyService.getRedirectUri(),
      etsyCredentials: hasEnv('ETSY_CLIENT_ID') && hasEnv('ETSY_CLIENT_SECRET'),
      openRouterKey: hasEnv('OPENROUTER_API_KEY'),
      shopConnected: false,
      shopName: null,
      shippingProfiles: [],
      returnPolicies: [],
      readinessStates: [],
      defaults: {},
      completed: getGlobalFlag('setup_completed') === true
    };

    let activeShop = null;
    try {
      activeShop = getActiveShop();
    } catch {
      activeShop = null;
    }

    if (activeShop && activeShop.shop_id && activeShop.shop_id !== 'default_shop') {
      status.shopConnected = true;
      status.shopName = activeShop.shop_name;

      const settingsRows = db.prepare('SELECT key, value FROM settings WHERE shop_id = ?').all(activeShop.shop_id);
      settingsRows.forEach(r => {
        try {
          status.defaults[r.key] = JSON.parse(r.value);
        } catch {
          /* bozuk satır kurulumu bloke etmesin */
        }
      });

      // Etsy'ye ulaşamamak kurulum durumunu okumayı engellememeli: token süresi
      // dolmuş ya da ağ yoksa profil listeleri boş döner, adım "eksik" görünür.
      try {
        const [shipping, returns, readiness] = await Promise.all([
          EtsyService.getShippingProfiles(),
          EtsyService.getReturnPolicies(),
          EtsyService.getReadinessStates().catch(() => [])
        ]);
        status.shippingProfiles = shipping || [];
        status.returnPolicies = returns || [];
        status.readinessStates = readiness || [];
      } catch (err) {
        status.etsyFetchError = err.response?.data?.error || err.message;
      }
    }

    // Adım kilidi: her adım kendinden öncekiler bitmeden açılmaz.
    status.steps = {
      etsy: status.etsyCredentials,
      shop: status.shopConnected,
      profiles: Boolean(status.defaults.default_shipping_profile_id && status.defaults.default_return_policy_id),
      ai: status.openRouterKey
    };
    status.allDone = Object.values(status.steps).every(Boolean);

    res.json(status);
  } catch (err) {
    next(err);
  }
});

/**
 * Adım 1: Etsy app bilgileri. Callback adresi sabit (localhost); eski sürümden
 * kalma bir `*.local` adresi .env'de duruyorsa burada localhost'a çevrilir.
 */
router.post('/env/etsy', (req, res, next) => {
  try {
    const { client_id, client_secret } = req.body;

    if (!client_id?.trim() || !client_secret?.trim()) {
      return res.status(400).json({ error: 'Etsy API Key (client_id) ve Shared Secret (client_secret) zorunludur.' });
    }

    const redirectUri = EtsyService.getRedirectUri();
    writeEnvKeys({
      ETSY_CLIENT_ID: client_id.trim(),
      ETSY_CLIENT_SECRET: client_secret.trim(),
      ETSY_REDIRECT_URI: redirectUri
    });

    res.json({ success: true, redirectUri });
  } catch (err) {
    next(err);
  }
});

/** Adım 4: OpenRouter anahtarı. */
router.post('/env/openrouter', (req, res, next) => {
  try {
    const { api_key } = req.body;
    if (!api_key?.trim()) {
      return res.status(400).json({ error: 'OpenRouter API anahtarı boş olamaz.' });
    }
    writeEnvKeys({ OPENROUTER_API_KEY: api_key.trim() });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/** Adım 3a: kargo şablonu oluştur. */
router.post('/shipping-profile', async (req, res, next) => {
  try {
    const { title, origin_country_iso, primary_cost, secondary_cost } = req.body;
    if (!title?.trim() || !origin_country_iso?.trim()) {
      return res.status(400).json({ error: 'Şablon adı ve gönderim ülkesi zorunludur.' });
    }
    if (primary_cost === undefined || secondary_cost === undefined) {
      return res.status(400).json({ error: 'Kargo ücretleri zorunludur (ücretsiz kargo için 0 girin).' });
    }

    const created = await EtsyService.createShippingProfile(req.body);
    res.json({ success: true, profile: created });
  } catch (err) {
    next(err);
  }
});

/** Adım 3b: iade politikası oluştur. */
router.post('/return-policy', async (req, res, next) => {
  try {
    const created = await EtsyService.createReturnPolicy(req.body);
    res.json({ success: true, policy: created });
  } catch (err) {
    next(err);
  }
});

/** Adım 3c: işleme süresi tanımı oluştur. */
router.post('/readiness-state', async (req, res, next) => {
  try {
    const { min_processing_time, max_processing_time } = req.body;
    if (!min_processing_time || !max_processing_time) {
      return res.status(400).json({ error: 'Minimum ve maksimum işleme süresi zorunludur.' });
    }
    const created = await EtsyService.createReadinessStateDefinition(req.body);
    res.json({ success: true, readinessState: created });
  } catch (err) {
    next(err);
  }
});

/** Kurulumu tamamlandı olarak işaretler; sihirbaz bir daha otomatik açılmaz. */
router.post('/complete', (req, res, next) => {
  try {
    setGlobalFlag('setup_completed', true);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/** Sihirbazı yeniden çalıştırmak için (ayarlardan erişilebilir). */
router.post('/reset', (req, res, next) => {
  try {
    setGlobalFlag('setup_completed', false);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
