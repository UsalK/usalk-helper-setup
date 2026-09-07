import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initializeLocalSnapshots } from '../services/TemplateSync.js';
import { initializeLocalData } from '../services/LocalData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, 'database.db');
initializeLocalData();
const db = new DatabaseSync(dbPath);

// Default export burada tanımlanır; yerel çıktı servisi bu bağlantıyı kullanır. services/TemplateSync.js
// bu modulu default import'la geri cagiriyor (dairesel bagimlilik) ve seed importu
// bu dosyanin en altina gelmeden, satir ~529'da calisiyor. Export en sonda kalirsa
// o an binding hala TDZ'de olur ve seed yuklemesi her aciliista
// "Cannot access 'db' before initialization" ile sessizce dusser: mockup sablonlari
// ve varsayilan varyasyon profilleri hic yuklenmez.
export default db;

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// Initialize schema
const schemaPath = join(__dirname, 'schema.sql');
const schema = readFileSync(schemaPath, 'utf8');

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// Database Migration: Check if shop_id exists in products table. If not, perform migration.
let needsMigration = false;
try {
  const tableInfo = db.prepare("PRAGMA table_info(products)").all();
  if (tableInfo.length > 0) {
    const hasShopId = tableInfo.some(col => col.name === 'shop_id');
    if (!hasShopId) {
      needsMigration = true;
    }
  } else {
    // Table doesn't exist, schema will initialize it
    needsMigration = false;
  }
} catch (err) {
  needsMigration = false;
}

if (needsMigration) {
  console.log("Running SQLite database migration for multi-shop support...");
  
  // Try to find the existing shop_id
  let migratedShopId = 'default_shop';
  try {
    const oldAuth = db.prepare("SELECT shop_id FROM etsy_auth WHERE id = 1").get();
    if (oldAuth && oldAuth.shop_id && oldAuth.shop_id.trim() !== '') {
      migratedShopId = oldAuth.shop_id.toString();
    }
  } catch (err) {
    console.warn("Could not query old active shop_id from etsy_auth:", err.message);
  }
  
  console.log(`Existing data will be associated with shop: '${migratedShopId}'`);
  
  try {
    db.exec('BEGIN');
    
    // Rename old tables
    db.exec('ALTER TABLE etsy_auth RENAME TO etsy_auth_old');
    db.exec('ALTER TABLE settings RENAME TO settings_old');
    db.exec('ALTER TABLE templates RENAME TO templates_old');
    db.exec('ALTER TABLE variation_profiles RENAME TO variation_profiles_old');
    db.exec('ALTER TABLE products RENAME TO products_old');
    
    // Create new tables
    db.exec(`
      CREATE TABLE etsy_auth (
        shop_id TEXT PRIMARY KEY,
        shop_name TEXT,
        access_token TEXT,
        refresh_token TEXT,
        expires_at TEXT,
        is_active INTEGER DEFAULT 0
      );
      
      CREATE TABLE settings (
        shop_id TEXT,
        key TEXT,
        value TEXT,
        PRIMARY KEY (shop_id, key)
      );
      
      CREATE TABLE templates (
        id TEXT PRIMARY KEY,
        shop_id TEXT DEFAULT 'default_shop',
        name TEXT,
        type TEXT CHECK(type IN ('flat', 'perspective', 'static')),
        config TEXT,
        background_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE variation_profiles (
        id TEXT,
        shop_id TEXT DEFAULT 'default_shop',
        name TEXT,
        ratio TEXT,
        sizes TEXT,
        frames TEXT,
        combinations TEXT,
        template_ids TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (shop_id, id)
      );
      
      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        shop_id TEXT DEFAULT 'default_shop',
        image_path TEXT,
        title TEXT,
        tags TEXT,
        description TEXT,
        ai_attributes TEXT,
        variation_profile_id TEXT,
        template_ids TEXT,
        etsy_listing_id TEXT,
        shop_section_id TEXT,
        status TEXT CHECK(status IN ('draft','uploading','live','error')) DEFAULT 'draft',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Populate new tables with old data using the active shop ID
    db.exec(`
      INSERT INTO etsy_auth (shop_id, shop_name, access_token, refresh_token, expires_at, is_active)
      SELECT shop_id, 'Ana Magaza', access_token, refresh_token, expires_at, 1
      FROM etsy_auth_old WHERE shop_id IS NOT NULL AND shop_id != '';
    `);
    
    const insertSettings = db.prepare('INSERT INTO settings (shop_id, key, value) SELECT ?, key, value FROM settings_old');
    insertSettings.run(migratedShopId);
    
    const insertTemplates = db.prepare(`
      INSERT INTO templates (id, shop_id, name, type, config, background_path, created_at)
      SELECT id, ?, name, type, config, background_path, created_at FROM templates_old
    `);
    insertTemplates.run(migratedShopId);
    
    const insertProfiles = db.prepare(`
      INSERT INTO variation_profiles (id, shop_id, name, ratio, sizes, frames, combinations, template_ids, created_at)
      SELECT id, ?, name, ratio, sizes, frames, combinations, template_ids, created_at FROM variation_profiles_old
    `);
    insertProfiles.run(migratedShopId);
    
    const insertProducts = db.prepare(`
      INSERT INTO products (id, shop_id, image_path, title, tags, description, ai_attributes, variation_profile_id, template_ids, etsy_listing_id, shop_section_id, status, created_at)
      SELECT id, ?, image_path, title, tags, description, ai_attributes, variation_profile_id, template_ids, etsy_listing_id, shop_section_id, status, created_at FROM products_old
    `);
    insertProducts.run(migratedShopId);
    
    // Drop old tables
    db.exec('DROP TABLE etsy_auth_old');
    db.exec('DROP TABLE settings_old');
    db.exec('DROP TABLE templates_old');
    db.exec('DROP TABLE variation_profiles_old');
    db.exec('DROP TABLE products_old');
    
    db.exec('COMMIT');
    console.log("Database migrations completed successfully!");
  } catch (migErr) {
    db.exec('ROLLBACK');
    console.error("Critical database migration failed:", migErr);
  }
} else {
  // Initialize schema if not exist
  db.exec(schema);
}

// Ensure digital_file_path column exists in products table for digital downloads support
try {
  db.exec("ALTER TABLE products ADD COLUMN digital_file_path TEXT");
  console.log("[Schema Upgrade] Added digital_file_path column to products table.");
} catch (err) {
  // Column already exists, ignore
}

// Ensure shopify columns exist in products table
try {
  db.exec("ALTER TABLE products ADD COLUMN shopify_product_id TEXT");
  console.log("[Schema Upgrade] Added shopify_product_id column to products table.");
} catch (err) {
  // Column already exists, ignore
}

try {
  db.exec("ALTER TABLE products ADD COLUMN shopify_collection_id TEXT");
  console.log("[Schema Upgrade] Added shopify_collection_id column to products table.");
} catch (err) {
  // Column already exists, ignore
}

// Ensure ai_usage logging table exists
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      id TEXT PRIMARY KEY,
      shop_id TEXT,
      model TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      cost REAL DEFAULT 0.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch (err) {
  console.error("Failed to ensure ai_usage table:", err);
}

// Ensure cost column exists in ai_usage
try {
  db.exec("ALTER TABLE ai_usage ADD COLUMN cost REAL DEFAULT 0.0");
} catch (err) {
  // Column already exists, ignore
}

// Ensure reasoning_tokens column exists in ai_usage.
// Sağlayıcılar "düşünme" tokenlarını completion_tokens içinde faturalar ama
// ayrıca completion_tokens_details.reasoning_tokens olarak da raporlar.
// Bunu ayrı saklamak, bir modelin düşünmeyi kapatma isteğini gerçekten
// uygulayıp uygulamadığını tahmin etmek yerine ölçmemizi sağlar.
try {
  db.exec("ALTER TABLE ai_usage ADD COLUMN reasoning_tokens INTEGER DEFAULT 0");
  console.log("[Schema Upgrade] Added reasoning_tokens column to ai_usage table.");
} catch (err) {
  // Column already exists, ignore
}

// Ensure etsy_analytics_cache table exists
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS etsy_analytics_cache (
      listing_id TEXT PRIMARY KEY,
      shop_id TEXT DEFAULT 'default_shop',
      title TEXT,
      state TEXT,
      views INTEGER DEFAULT 0,
      num_favorers INTEGER DEFAULT 0,
      sales_count INTEGER DEFAULT 0,
      total_revenue REAL DEFAULT 0.0,
      price_amount REAL DEFAULT 0.0,
      currency_code TEXT DEFAULT 'USD',
      quantity INTEGER DEFAULT 0,
      creation_timestamp INTEGER DEFAULT 0,
      original_creation_timestamp INTEGER DEFAULT 0,
      url TEXT,
      image_url TEXT,
      image_width INTEGER DEFAULT 0,
      image_height INTEGER DEFAULT 0,
      tags TEXT,
      shop_section_id TEXT,
      section_title TEXT,
      last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch (err) {
  console.error("Failed to ensure etsy_analytics_cache table:", err);
}

// Ensure should_auto_renew and ending_timestamp exist in etsy_analytics_cache
try {
  db.exec("ALTER TABLE etsy_analytics_cache ADD COLUMN should_auto_renew INTEGER DEFAULT 1");
  console.log("[Schema Upgrade] Added should_auto_renew column to etsy_analytics_cache table.");
} catch (err) {
  // Column already exists, ignore
}

try {
  db.exec("ALTER TABLE etsy_analytics_cache ADD COLUMN ending_timestamp INTEGER DEFAULT 0");
  console.log("[Schema Upgrade] Added ending_timestamp column to etsy_analytics_cache table.");
} catch (err) {
  // Column already exists, ignore
}

// Çok panelli (set) varyasyon profilleri için ek kolonlar.
// kind: 'single' (tek panel, klasik oran profili) | 'set' (birden fazla panel)
// panel_count: sette kaç panel var (tek panelde 1)
// panel_ratio: her bir panelin kendi oranı, ör. '1:2'
for (const [col, ddl] of [
  ['kind', "ALTER TABLE variation_profiles ADD COLUMN kind TEXT DEFAULT 'single'"],
  ['panel_count', 'ALTER TABLE variation_profiles ADD COLUMN panel_count INTEGER DEFAULT 1'],
  ['panel_ratio', 'ALTER TABLE variation_profiles ADD COLUMN panel_ratio TEXT']
]) {
  try {
    db.exec(ddl);
    console.log(`[Schema Upgrade] Added ${col} column to variation_profiles table.`);
  } catch (err) {
    // Kolon zaten var, yoksay
  }
}

// Global helper: Get current active shop
export function getActiveShop() {
  const row = db.prepare('SELECT * FROM etsy_auth WHERE is_active = 1').get();
  if (row) {
    return row;
  }
  return {
    shop_id: 'default_shop',
    shop_name: 'Bagli Magaza Yok',
    access_token: '',
    refresh_token: '',
    expires_at: ''
  };
}

// Global helper: Get current active Shopify configuration
export function getRawActiveShopify() {
  try {
    const row = db.prepare('SELECT * FROM shopify_auth WHERE is_active = 1').get();
    return row || null;
  } catch (err) {
    console.error("Failed to query active Shopify auth:", err);
    return null;
  }
}

// Global helper: Get storage-safe folder name for a shop ID
export function getShopStorageName(shopId) {
  const row = db.prepare('SELECT shop_name FROM etsy_auth WHERE shop_id = ?').get(shopId);
  const rawName = row ? row.shop_name : (shopId === 'default_shop' ? 'Bagli Magaza Yok' : 'Bagli Magaza Yok');
  return rawName.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Global helper: Get platform-specific upload subpath
export function getPlatformUploadPath(platform) {
  if (platform === 'shopify') {
    const active = getRawActiveShopify();
    const shopName = active ? active.shop_url.replace('.myshopify.com', '') : 'default_shopify';
    return join('shopify', shopName);
  } else {
    const active = getActiveShop();
    const shopName = getShopStorageName(active.shop_id);
    return join('etsy', shopName);
  }
}

// Global helper: Get platform-specific storage subpath for a product
export function getProductStorageFolder(productId) {
  try {
    const row = db.prepare('SELECT shop_id FROM products WHERE id = ?').get(productId);
    if (row && row.shop_id) {
      const shopId = row.shop_id;
      if (shopId.includes('.myshopify.com')) {
        const shopName = shopId.replace('.myshopify.com', '');
        return join('shopify', shopName);
      } else {
        const shopName = getShopStorageName(shopId);
        return join('etsy', shopName);
      }
    }
  } catch (err) {
    console.error("Failed to query product storage folder:", err.message);
  }
  // Fallback
  return 'default';
}


// Pasife alınan varyasyon profilleri.
// Bu listedeki profiller seed edilmez, API listesinde dönmez ve otomatik
// oran eşleştirmesine girmez. Tekrar aktif etmek için listeden çıkarmak yeterli.
//
// 'double_1_2' eski ikili set yapılandırmasıdır: tek panelli 1:2 profiliyle aynı
// oran anahtarını ('1:2') kullandığı için şablonları ve mockup dizilim ayarını
// onunla paylaşıyordu. Yerine ayrı oran anahtarlı 'set_of_2_1_2' geldi.
export const DISABLED_PROFILE_IDS = ['double_1_2'];

// Çok panelli set profilleri. Bunlar otomatik oran eşleştirmesine girmez;
// kullanıcı ürün için bilerek seçer.
export const SET_PROFILE_IDS = ['set_of_2_1_2', 'set_of_2_2_3'];

export const isSetProfileId = (id) => SET_PROFILE_IDS.includes(id);

/**
 * Bir ürünün varyasyon profili çok panelli bir set mi?
 * Set ise SEO/metin üretiminde kullanılacak panel bilgisini döner, değilse null.
 *
 * @returns {{panelCount:number, panelRatio:string, profileName:string}|null}
 */
export function getSetProfileInfo(variationProfileId, shopId) {
  if (!variationProfileId) return null;
  try {
    const row = db.prepare('SELECT name, ratio, kind, panel_count, panel_ratio FROM variation_profiles WHERE id = ? AND shop_id = ?')
      .get(variationProfileId, shopId);
    if (!row) return null;

    const isSet = row.kind === 'set' || isSetProfileId(variationProfileId);
    const panelCount = Number(row.panel_count) || 1;
    if (!isSet || panelCount < 2) return null;

    return {
      panelCount,
      panelRatio: row.panel_ratio || row.ratio || '',
      profileName: row.name || variationProfileId
    };
  } catch (err) {
    console.error('Set profil bilgisi okunamadı:', err.message);
    return null;
  }
}

// Varsayılan varyasyon profilleri.
// ratio alanı hem şablon eşleştirmesinde hem mockup dosya adında anahtar olarak
// kullanılır; set profillerinde '<panel oranı>x<panel sayısı>' biçimindedir
// ('1:2x2'), böylece tek panelli 1:2 profiliyle karışmaz.
const DEFAULT_PROFILE_DEFS = [
  { id: 'ratio_2_3', name: '2:3 Oranı (Dikey)', ratio: '2:3' },
  { id: 'ratio_3_2', name: '3:2 Oranı (Yatay)', ratio: '3:2' },
  { id: 'ratio_1_1', name: '1:1 Oranı (Kare)', ratio: '1:1' },
  { id: 'ratio_12_7', name: '12:7 Oranı (Geniş)', ratio: '12:7' },
  { id: 'ratio_7_12', name: '7:12 Oranı (Uzun)', ratio: '7:12' },
  { id: 'ratio_12_5', name: '12:5 Oranı (Panoramik)', ratio: '12:5' },
  { id: 'ratio_1_2', name: '1:2 Oranı (Uzun Panoramik)', ratio: '1:2' },
  {
    id: 'set_of_2_1_2',
    name: 'Set of 2 (1:2) — İkili Panel',
    ratio: '1:2x2',
    kind: 'set',
    panel_count: 2,
    panel_ratio: '1:2'
  },
  {
    id: 'set_of_2_2_3',
    name: 'Set of 2 (2:3) — İkili Panel',
    ratio: '2:3x2',
    kind: 'set',
    panel_count: 2,
    panel_ratio: '2:3'
  }
];

export const DEFAULT_PROFILES = DEFAULT_PROFILE_DEFS.filter(
  d => !DISABLED_PROFILE_IDS.includes(d.id)
);

// Global helper: Seed variation profiles for a specific shop
export function seedDefaultProfilesForShop(shopId) {
  const seedStmt = db.prepare(`
    INSERT INTO variation_profiles
      (id, shop_id, name, ratio, sizes, frames, combinations, template_ids, kind, panel_count, panel_ratio)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(shop_id, id) DO NOTHING
  `);

  // Yeni baglanan bir magaza bos fiyat tablosuyla acilmasin: 'default_shop'
  // satirlari kullanicinin yerel veritabanindaki referans olcu/cerceve/fiyat
  // setini tasiyor ve yeni magazaya baslangic degeri olarak kopyalaniyor.
  // template_ids KOPYALANMAZ - mockup sablonlari magazaya ozel, baska bir
  // magazanin sablon ID'lerini tasimak kirik referans olur.
  const referenceStmt = db.prepare(
    'SELECT sizes, frames, combinations FROM variation_profiles WHERE shop_id = ? AND id = ?'
  );

  DEFAULT_PROFILES.forEach(d => {
    const kind = d.kind || 'single';
    const panelCount = d.panel_count || 1;
    const panelRatio = d.panel_ratio || d.ratio;

    let reference = null;
    if (shopId !== 'default_shop') {
      try {
        reference = referenceStmt.get('default_shop', d.id) || null;
      } catch (err) {
        reference = null;
      }
    }

    seedStmt.run(
      d.id,
      shopId,
      d.name,
      d.ratio,
      reference?.sizes || JSON.stringify([]),
      reference?.frames || JSON.stringify([]),
      reference?.combinations || JSON.stringify([]),
      JSON.stringify([]),
      kind,
      panelCount,
      panelRatio
    );
  });
}

// Legacy profiles remain stored; UI filtering does not delete user data.

// Global helper: Copy general settings template to a new shop
export function copySettingsTemplateToShop(fromShopId, toShopId) {
  try {
    const checkStmt = db.prepare('SELECT COUNT(*) as count FROM settings WHERE shop_id = ?');
    const checkRow = checkStmt.get(toShopId);
    if (checkRow && checkRow.count === 0) {
      const getSettings = db.prepare('SELECT key, value FROM settings WHERE shop_id = ?');
      const rows = getSettings.all(fromShopId);
      
      const insertStmt = db.prepare('INSERT INTO settings (shop_id, key, value) VALUES (?, ?, ?)');
      
      // Keys containing Etsy-specific unique identifiers that must NOT be copied
      const skipKeys = [
        'default_shipping_profile_id',
        'default_return_policy_id',
        'default_shop_section_id',
        'readiness_state_id'
      ];
      
      db.exec('BEGIN');
      try {
        rows.forEach(r => {
          if (!skipKeys.includes(r.key)) {
            insertStmt.run(toShopId, r.key, r.value);
          }
        });
        db.exec('COMMIT');
        console.log(`General settings templates copied from ${fromShopId} to ${toShopId}`);
      } catch (txErr) {
        db.exec('ROLLBACK');
        throw txErr;
      }
    }
  } catch (err) {
    console.error("Failed to copy settings template:", err);
  }
}

// Seed default shop profiles for all shops on launch
try {
  const allShops = db.prepare('SELECT shop_id FROM etsy_auth').all();
  allShops.forEach(s => seedDefaultProfilesForShop(s.shop_id));
  seedDefaultProfilesForShop('default_shop');
} catch (err) {
  const activeShop = getActiveShop();
  seedDefaultProfilesForShop(activeShop.shop_id);
}

// Create missing local exports only. Never overwrite DB rows from seed files.
try {
  initializeLocalSnapshots();
} catch (err) {
  console.error('Failed to initialize local exports:', err);
}

// Dynamic Shopify credentials auto-seed on startup
async function seedDefaultShopifyAuth() {
  const shop = process.env.SHOPIFY_SHOP || '';
  const clientId = process.env.SHOPIFY_CLIENT_ID || '';
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || '';
  if (!shop || !clientId || !clientSecret) return;
  if (db.prepare('SELECT 1 FROM shopify_auth LIMIT 1').get()) return;
  const themePath = process.env.SHOPIFY_THEME_PATH || '';

  try {
    console.log('[Shopify Seed] Checking active Shopify connection...');
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
      })
    });

    if (response.ok) {
      const data = await response.json();
      const accessToken = data.access_token;
      
      // Update database
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE shopify_auth SET is_active = 0').run();
        const stmt = db.prepare(`
          INSERT INTO shopify_auth (shop_url, shop_name, access_token, theme_path, is_active)
          VALUES (?, ?, ?, ?, 1)
          ON CONFLICT(shop_url) DO UPDATE SET
            access_token = excluded.access_token,
            theme_path = excluded.theme_path,
            is_active = 1
        `);
        stmt.run(shop, process.env.SHOPIFY_SHOP_NAME || shop, accessToken, themePath);
        db.exec('COMMIT');
        console.log('[Shopify Seed] Successfully auto-seeded Shopify connection & access token!');
      } catch (dbErr) {
        db.exec('ROLLBACK');
        console.error('[Shopify Seed] Failed to save seeded connection to database:', dbErr.message);
      }
    } else {
      console.warn('[Shopify Seed] OAuth credentials exchange failed with status:', response.status);
    }
  } catch (err) {
    console.warn('[Shopify Seed] Could not auto-seed Shopify credentials:', err.message);
  }
}

// Trigger Shopify seeding asynchronously so it doesn't block server start
seedDefaultShopifyAuth();
