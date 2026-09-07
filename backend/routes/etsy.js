import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import db, { getActiveShop, getShopStorageName, getProductStorageFolder } from '../db/db.js';
import * as EtsyService from '../services/EtsyService.js';
import { uploadProductToEtsy } from '../services/ListingUploadService.js';
import { DEFAULT_LISTING_QUANTITY } from '../services/listingShared.js';
import { assignUsalkScores } from '../services/UsalkScore.js';
import {
  STYLE_MAPPING,
  OCCASION_MAPPING,
  HOLIDAY_MAPPING,
  ROOM_MAPPING,
  MATERIALS_MAPPING
} from '../config/etsyTaxonomy.js';


const router = express.Router();
const __dirname = dirname(fileURLToPath(import.meta.url));

// Etsy taksonomi eşlemeleri artık config/etsyTaxonomy.js içinde ve
// ListingUploadService ile paylaşılıyor.

// Utility to generate PKCE
function generateVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// 1. Get auth URL
router.get('/auth-url', (req, res, next) => {
  try {
    const { client_id } = EtsyService.getEtsyCredentials();
    const verifier = generateVerifier();
    const challenge = generateChallenge(verifier);
    
    // Save verifier in settings table to use on callback
    const stmt = db.prepare(
      "INSERT INTO settings (shop_id, key, value) VALUES ('global', ?, ?) ON CONFLICT(shop_id, key) DO UPDATE SET value = ?"
    );
    const verifierStr = JSON.stringify(verifier);
    stmt.run('etsy_code_verifier', verifierStr, verifierStr);
    
    const redirectUri = process.env.ETSY_REDIRECT_URI || 'http://localhost:3001/api/etsy/callback';
    const scope = 'listings_r listings_w listings_d shops_r shops_w';
    const state = 'usalk_auth';
    
    const authUrl = `https://www.etsy.com/oauth/connect?` + new URLSearchParams({
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scope,
      client_id: client_id,
      state: state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    }).toString();
    
    res.json({ url: authUrl });
  } catch (err) {
    next(err);
  }
});

// 2. OAuth Callback
router.get('/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;
    
    if (!code) {
      return res.status(400).send('Authorization code is missing.');
    }
    
    const verifierStmt = db.prepare("SELECT value FROM settings WHERE shop_id = 'global' AND key = 'etsy_code_verifier'");
    const verifierRow = verifierStmt.get();
    
    if (!verifierRow) {
      return res.status(400).send('Code verifier not found. Please try logging in again.');
    }
    
    const verifier = JSON.parse(verifierRow.value);
    const { client_id, client_secret } = EtsyService.getEtsyCredentials();
    
    const redirectUri = process.env.ETSY_REDIRECT_URI || 'http://localhost:3001/api/etsy/callback';
    
    // Exchange authorization code for access tokens
    const response = await axios.post('https://api.etsy.com/v3/public/oauth/token', 
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client_id,
        client_secret: client_secret,
        redirect_uri: redirectUri,
        code: code.toString(),
        code_verifier: verifier
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    
    const { access_token, refresh_token, expires_in } = response.data;
    
    let shopId = '';
    let shopName = 'Etsy Shop';
    
    try {
      const meRes = await axios.get('https://openapi.etsy.com/v3/application/users/me', {
        headers: {
          'x-api-key': `${client_id}:${client_secret}`,
          'Authorization': `Bearer ${access_token}`
        }
      });
      const userId = meRes.data.user_id;
      if (meRes.data.shop_id) {
        shopId = meRes.data.shop_id.toString();
      }
      
      // Get shops for user to fetch shop name
      try {
        const shopRes = await axios.get(`https://openapi.etsy.com/v3/application/users/${userId}/shops`, {
          headers: {
            'x-api-key': `${client_id}:${client_secret}`,
            'Authorization': `Bearer ${access_token}`
          }
        });
        
        if (shopRes.data.shop_id) {
          shopId = shopRes.data.shop_id.toString();
          shopName = shopRes.data.shop_name || 'Etsy Shop';
        } else if (shopRes.data.results && shopRes.data.results.length > 0) {
          shopId = shopRes.data.results[0].shop_id.toString();
          shopName = shopRes.data.results[0].shop_name || 'Etsy Shop';
        } else if (shopRes.data.count === 0 || (shopRes.data.results && shopRes.data.results.length === 0)) {
          console.warn(`[OAuth Callback] User ${userId} has no shops associated with their account.`);
        }
      } catch (shopErr) {
        console.error("Failed to fetch shops for user during callback:", shopErr.response?.data || shopErr.message);
        // If /users/{userId}/shops 404s, it means there is no shop for this user
      }
    } catch (meErr) {
      console.error("Failed to fetch user me details during callback:", meErr.response?.data || meErr.message);
    }
    
    if (!shopId) {
      return res.status(400).send(`
        <html>
          <head>
            <meta charset="utf-8">
            <title>Etsy Bağlantı Hatası</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; padding: 40px; text-align: center; background: #f8fafc; color: #334155; }
              .card { max-width: 550px; margin: 0 auto; background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1); border-top: 5px solid #ef4444; }
              h2 { color: #dc2626; margin-top: 0; font-size: 24px; font-weight: 700; }
              p { font-size: 16px; line-height: 1.6; color: #475569; }
              .info-box { background: #fdf2f2; padding: 20px; border-radius: 12px; text-align: left; font-size: 14px; margin: 25px 0; border: 1px solid #fee2e2; }
              .info-title { font-weight: 600; color: #991b1b; margin-bottom: 8px; }
              .info-text { color: #7f1d1d; line-height: 1.5; }
              .button { background: #4f46e5; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 15px; transition: background 0.2s; text-decoration: none; display: inline-block; }
              .button:hover { background: #4338ca; }
            </style>
          </head>
          <body>
            <div class="card">
              <h2>Etsy Mağaza Kimliği Bulunamadı</h2>
              <p>Bağlanmaya çalıştığınız Etsy hesabı için aktif bir satıcı mağazası (shop_id) bulunamadı.</p>
              
              <div class="info-box">
                <div class="info-title">Olası Nedenler & Çözümler:</div>
                <div class="info-text">
                  1. <strong>Satıcı Mağazası Yok:</strong> Giriş yaptığınız Etsy hesabı sadece alıcı (buyer) hesabı olabilir. Bu uygulamayı kullanabilmek için Etsy satıcı mağazanızın açık ve aktif olması gerekir.<br><br>
                  2. <strong>Mağaza Kurulumu Tamamlanmamış:</strong> Eğer yeni bir mağaza açtıysanız, Etsy üzerinde en az bir adet listeleme (taslak olarak da olabilir) yayınlayarak ilk mağaza açılış işlemlerini tamamladığınızdan emin olun.<br><br>
                  3. <strong>Yanlış Hesapla Giriş:</strong> Tarayıcınızda halihazırda açık olan başka bir bireysel/alıcı Etsy hesabı ile oturum açılmış olabilir. Etsy.com'a gidip satıcı hesabınızla giriş yaptıktan sonra tekrar deneyin.
                </div>
              </div>
              
              <button onclick="window.close()" class="button">Pencereyi Kapat</button>
            </div>
          </body>
        </html>
      `);
    }
    
    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();
    
    db.exec('BEGIN');
    try {
      // Deactivate other shops
      db.prepare('UPDATE etsy_auth SET is_active = 0').run();
      
      // Save/update this shop
      const authStmt = db.prepare(
        `INSERT INTO etsy_auth (shop_id, shop_name, access_token, refresh_token, expires_at, is_active) 
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(shop_id) DO UPDATE SET 
           shop_name = EXCLUDED.shop_name,
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           expires_at = EXCLUDED.expires_at,
           is_active = 1`
      );
      authStmt.run(shopId, shopName, access_token, refresh_token, expiresAt);
      
      // Self-heal: eski 'default_shop' kayitlarini ilk baglanan magazaya tasi.
      //
      // Bu tasima SADECE hic veri uretmemis sifir kurulum icindir. Magaza
      // etsy_auth'tan silinip (ornegin Etsy app/API degistigi icin) ayni magaza
      // yeniden baglandiginda o shop_id'ye ait satirlar veritabaninda duruyor
      // olur. O durumda 'default_shop' referans satirlarini ustune tasimak
      // PRIMARY KEY(shop_id, id) catismasi uretiyor, catisma tum transaction'i
      // ROLLBACK ediyor ve magaza hic eklenemiyordu.
      //
      // Bu yuzden her tablo ayri kontrol ediliyor: hedef magazanin o tabloda
      // kendi verisi varsa tasima atlanir. UPDATE OR IGNORE de son emniyet
      // kemeri - beklenmedik bir catisma artik OAuth'u kiramaz.
      const connectedShopsCount = db.prepare('SELECT COUNT(*) as count FROM etsy_auth WHERE shop_id != ?').get(shopId).count;
      if (connectedShopsCount === 0) {
        for (const table of ['settings', 'templates', 'variation_profiles', 'products']) {
          const own = db.prepare(`SELECT COUNT(*) as count FROM ${table} WHERE shop_id = ?`).get(shopId).count;
          if (own > 0) {
            console.log(`[OAuth] ${table}: ${shopId} icin ${own} kayit zaten var, default_shop tasimasi atlandi.`);
            continue;
          }
          const info = db.prepare(`UPDATE OR IGNORE ${table} SET shop_id = ? WHERE shop_id = 'default_shop'`).run(shopId);
          if (info.changes > 0) {
            console.log(`[OAuth] ${table}: ${info.changes} default_shop kaydi ${shopId} magazasina tasindi.`);
          }
        }
      }
      
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    // Varsayilan varyasyon profilleri commit'ten SONRA yukleniyor. Onceden
    // transaction'in icinde fire-and-forget bir dynamic import olarak duruyordu:
    // seed'in commit'ten once mi sonra mi isledigi belirsizdi ve olasi bir hata
    // yakalanmadan kaliyordu. Burada hata magaza kaydini goturmez.
    try {
      const dbMod = await import('../db/db.js');
      dbMod.seedDefaultProfilesForShop(shopId);
    } catch (seedErr) {
      console.error('[OAuth] Varsayilan varyasyon profilleri yuklenemedi:', seedErr.message);
    }
    
    // Clear the cache
    EtsyService.clearEtsyCache();
    
    // Redirect back to frontend
    res.send(`
      <html>
        <body>
          <h2>Etsy Connected Successfully: ${shopName}!</h2>
          <p>You can close this window now.</p>
          <script>
            setTimeout(() => {
              window.close();
            }, 1500);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Callback Error:", err.response?.data || err.message);
    next(err);
  }
});

// 3. Connection Status
router.get('/status', async (req, res) => {
  try {
    const activeShop = getActiveShop();
    const allShops = db.prepare('SELECT shop_id, shop_name, is_active FROM etsy_auth').all();
    
    if (activeShop.shop_id === 'default_shop' || !activeShop.access_token) {
      return res.json({ 
        connected: false,
        activeShop: null,
        shops: allShops
      });
    }
    
    const expiresAt = new Date(activeShop.expires_at);
    const now = new Date();
    const isExpired = expiresAt.getTime() - now.getTime() < 5 * 60 * 1000; // expired or within 5 min
    
    if (isExpired) {
      if (!activeShop.refresh_token) {
        return res.json({ connected: false, reason: 'no_refresh_token', shops: allShops });
      }
      try {
        console.log('[Status] Active shop token expired, attempting auto-refresh...');
        await EtsyService.getValidToken();
        
        // Re-read updated details
        const updatedActive = getActiveShop();
        const updatedShops = db.prepare('SELECT shop_id, shop_name, is_active FROM etsy_auth').all();
        
        return res.json({
          connected: true,
          activeShop: {
            shop_id: updatedActive.shop_id,
            shop_name: updatedActive.shop_name
          },
          shops: updatedShops,
          expires_at: updatedActive.expires_at
        });
      } catch (refreshErr) {
        console.error('[Status] getValidToken failed:', refreshErr.message);
        return res.json({ connected: false, reason: 'refresh_failed', error: refreshErr.message, shops: allShops });
      }
    }
    
    res.json({
      connected: true,
      activeShop: {
        shop_id: activeShop.shop_id,
        shop_name: activeShop.shop_name
      },
      shops: allShops,
      expires_at: activeShop.expires_at
    });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

// 4. Switch Active Shop
router.post('/switch', (req, res, next) => {
  try {
    const { shopId } = req.body;
    if (!shopId) {
      return res.status(400).json({ error: 'shopId is required' });
    }
    
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE etsy_auth SET is_active = 0').run();
      const stmt = db.prepare('UPDATE etsy_auth SET is_active = 1 WHERE shop_id = ?');
      const info = stmt.run(shopId);
      
      if (info.changes === 0) {
        db.exec('ROLLBACK');
        return res.status(404).json({ error: 'Shop not found' });
      }
      
      db.exec('COMMIT');
      console.log(`Active shop switched to: ${shopId}`);
      EtsyService.clearEtsyCache();
      res.json({ success: true, activeShopId: shopId });
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    next(err);
  }
});

// Disconnect Etsy Account (disconnect specific or current active shop)
router.post('/disconnect', (req, res, next) => {
  try {
    const { shopId } = req.body;
    const activeShop = getActiveShop();
    const targetShopId = shopId || activeShop.shop_id;
    
    if (targetShopId !== 'default_shop') {
      db.prepare('DELETE FROM etsy_auth WHERE shop_id = ?').run(targetShopId);
      
      // If we deleted the active shop, make another one active if any remains
      const currentActive = getActiveShop();
      if (currentActive.shop_id === 'default_shop') {
        const remaining = db.prepare('SELECT shop_id FROM etsy_auth LIMIT 1').get();
        if (remaining) {
          db.prepare('UPDATE etsy_auth SET is_active = 1 WHERE shop_id = ?').run(remaining.shop_id);
        }
      }
    }
    
    EtsyService.clearEtsyCache();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Clear Cache
router.post('/clear-cache', (req, res, next) => {
  try {
    EtsyService.clearEtsyCache();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 4. Shop Sections
router.get('/shop-sections', async (req, res, next) => {
  try {
    const sections = await EtsyService.getShopSections();
    res.json(sections);
  } catch (err) {
    next(err);
  }
});

// Create Shop Section
router.post('/shop-sections', async (req, res, next) => {
  try {
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Bölüm başlığı gereklidir.' });
    }
    const section = await EtsyService.createShopSection(title);
    res.json(section);
  } catch (err) {
    next(err);
  }
});

// 5. Shipping Profiles
router.get('/shipping-profiles', async (req, res, next) => {
  try {
    const profiles = await EtsyService.getShippingProfiles();
    res.json(profiles);
  } catch (err) {
    next(err);
  }
});

// 6. Return Policies
router.get('/return-policies', async (req, res, next) => {
  try {
    const policies = await EtsyService.getReturnPolicies();
    res.json(policies);
  } catch (err) {
    next(err);
  }
});

// 8. Readiness States (Ready to ship / Processing profiles)
router.get('/readiness-states', async (req, res, next) => {
  try {
    const states = await EtsyService.getReadinessStates();
    res.json(states);
  } catch (err) {
    next(err);
  }
});

// 7. Upload Product to Etsy
router.post('/upload-listing', async (req, res, next) => {
  // Asıl mantık services/ListingUploadService.js içinde; toplu değiştirme
  // iş kuyruğu da aynı fonksiyonu çağırır.
  try {
    const result = await uploadProductToEtsy(req.body);
    res.json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

const listingsCache = {
  data: {}
};

async function getFullListingsForShopState(shop_id, state, access_token, client_id, client_secret) {
  const cacheKey = `${shop_id}_${state || 'active'}`;
  const now = Date.now();
  if (listingsCache.data[cacheKey] && (now - listingsCache.data[cacheKey].timestamp < 3 * 60 * 1000)) {
    return listingsCache.data[cacheKey].listings;
  }

  const url = `https://openapi.etsy.com/v3/application/shops/${shop_id}/listings`;
  const headers = {
    'x-api-key': `${client_id}:${client_secret}`,
    'Authorization': `Bearer ${access_token}`
  };

  const firstRes = await axios.get(url, {
    params: { state: state || 'active', limit: 100, offset: 0, includes: 'images' },
    headers
  });

  const totalCount = firstRes.data.count || 0;
  const allListings = [...(firstRes.data.results || [])];

  if (totalCount > 100) {
    for (let offset = 100; offset < totalCount; offset += 100) {
      // Sleep to prevent rate limit (429)
      await new Promise(resolve => setTimeout(resolve, 250));
      try {
        const r = await axios.get(url, {
          params: { state: state || 'active', limit: 100, offset, includes: 'images' },
          headers
        });
        if (r.data?.results) {
          allListings.push(...r.data.results);
        }
      } catch (err) {
        console.error(`Failed to fetch page offset ${offset}:`, err.message);
        // Break or continue on individual page error? Continue since we want as many as possible
      }
    }
  }

  listingsCache.data[cacheKey] = {
    timestamp: now,
    listings: allListings
  };

  return allListings;
}

// Get listings from Etsy for the active shop
router.get('/listings', async (req, res, next) => {
  try {
    const { state, limit, offset, shop_section_ids } = req.query;
    const { access_token, client_id, client_secret, shop_id } = await EtsyService.getValidToken();
    const limitNum = Number(limit) || 50;
    const offsetNum = Number(offset) || 0;

    if (shop_section_ids) {
      const allListings = await getFullListingsForShopState(shop_id, state, access_token, client_id, client_secret);
      const filtered = allListings.filter(l => l.shop_section_id && l.shop_section_id.toString() === shop_section_ids.toString());
      return res.json({
        count: filtered.length,
        results: filtered.slice(offsetNum, offsetNum + limitNum)
      });
    }

    const url = `https://openapi.etsy.com/v3/application/shops/${shop_id}/listings`;
    const response = await axios.get(url, {
      params: {
        state: state || 'active',
        limit: limitNum,
        offset: offsetNum,
        includes: 'images'
      },
      headers: {
        'x-api-key': `${client_id}:${client_secret}`,
        'Authorization': `Bearer ${access_token}`
      }
    });
    
    res.json(response.data);
  } catch (err) {
    console.error("Failed to fetch listings from Etsy:", err.response?.data || err.message);
    next(err);
  }
});

// Get listing details and local mockups
router.get('/listings/:listingId/details', async (req, res, next) => {
  try {
    const { listingId } = req.params;
    const activeShop = getActiveShop();
    
    // Find local product by etsy_listing_id
    const stmt = db.prepare('SELECT * FROM products WHERE etsy_listing_id = ? OR etsy_listing_id = ? OR etsy_listing_id = ?');
    const product = stmt.get(listingId, listingId + '.0', Number(listingId).toString());
    
    let mockups = [];
    if (product) {
      const shopId = product.shop_id || activeShop.shop_id;
      const shopName = getShopStorageName(shopId);
      const subPath = getProductStorageFolder(product.id);
      let mockupsDir = join(__dirname, '../..', 'storage', subPath, 'mockups', product.id);
      if (!fs.existsSync(mockupsDir)) {
        // Fallback check
        const shopName = getShopStorageName(shopId);
        mockupsDir = join(__dirname, '../..', 'storage', shopName, 'mockups', product.id);
        if (!fs.existsSync(mockupsDir)) {
          mockupsDir = join(__dirname, '../..', 'storage/mockups', product.id);
        }
      }
      
      if (fs.existsSync(mockupsDir)) {
        const files = fs.readdirSync(mockupsDir).filter(f => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.jpeg') || f.toLowerCase().endsWith('.png'));
        const subPathUrl = getProductStorageFolder(product.id).replace(/\\/g, '/');
        mockups = files.map(file => ({
          filename: file,
          url: `http://localhost:3001/storage/${subPathUrl}/mockups/${product.id}/${file}`
        }));
      }
    }
    
    res.json({
      productId: product ? product.id : null,
      localProduct: product || null,
      mockups: mockups
    });
  } catch (err) {
    next(err);
  }
});

// Batch update materials for multiple listings on Etsy
router.post('/listings/batch-materials', async (req, res, next) => {
  try {
    const { listingIds, materials } = req.body;
    if (!listingIds || !Array.isArray(listingIds) || listingIds.length === 0) {
      return res.status(400).json({ error: 'listingIds dizisi gereklidir.' });
    }
    if (!materials || !Array.isArray(materials)) {
      return res.status(400).json({ error: 'materials dizisi gereklidir.' });
    }

    const activeShop = getActiveShop();

    const cleanMaterials = materials
      .map(m => m.replace(/[^\p{L}\p{N}\p{Zs}]/gu, '').trim())
      .filter(m => m.length > 0)
      .slice(0, 13);

    console.log(`Batch updating materials to [${cleanMaterials.join(', ')}] for ${listingIds.length} listings...`);

    const results = [];
    for (const listingId of listingIds) {
      try {
        await EtsyService.updateListing(listingId, { materials: cleanMaterials });
        results.push({ listingId, success: true });
      } catch (err) {
        console.error(`Failed to update materials for listing ${listingId}:`, err.response?.data || err.message);
        results.push({ listingId, success: false, error: err.response?.data?.error || err.message });
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    next(err);
  }
});

// Update a single listing on Etsy
router.post('/listings/:listingId/update', async (req, res, next) => {
  try {
    const { listingId } = req.params;
    const { title, description, tags, materials, shop_section_id, should_auto_renew } = req.body;
    
    const activeShop = getActiveShop();
    const checkProduct = db.prepare('SELECT id, title, tags, description, shop_section_id FROM products WHERE etsy_listing_id = ? OR etsy_listing_id = ? OR etsy_listing_id = ?');
    const product = checkProduct.get(listingId, listingId + '.0', Number(listingId).toString());

    const updateData = {};
    if (title !== undefined) updateData.title = title.substring(0, 140);
    if (description !== undefined) updateData.description = description;
    if (tags !== undefined && Array.isArray(tags)) {
      updateData.tags = tags.map(t => t.trim().substring(0, 20)).filter(t => t.length > 0).slice(0, 13);
    }
    if (materials !== undefined && Array.isArray(materials)) {
      updateData.materials = materials.map(m => m.replace(/[^\p{L}\p{N}\p{Zs}]/gu, '').trim()).filter(m => m.length > 0).slice(0, 13);
    }
    if (shop_section_id !== undefined) {
      updateData.shop_section_id = shop_section_id || null;
    }
    if (should_auto_renew !== undefined) {
      updateData.should_auto_renew = Boolean(should_auto_renew);
    }

    console.log(`Updating listing ${listingId} on Etsy...`, updateData);
    const updated = await EtsyService.updateListing(listingId, updateData);
    
    // If should_auto_renew changed, update cache and memory
    if (should_auto_renew !== undefined) {
      try {
        db.prepare('UPDATE etsy_analytics_cache SET should_auto_renew = ? WHERE listing_id = ?')
          .run(should_auto_renew ? 1 : 0, String(listingId));
      } catch (dbErr) {}

      const cacheKey = `${activeShop.shop_id}_active`;
      if (listingsCache.data[cacheKey]) {
        const item = listingsCache.data[cacheKey].listings.find(l => String(l.listing_id) === String(listingId));
        if (item) item.should_auto_renew = Boolean(should_auto_renew);
      }
    }

    // If there is a local product, also update it in SQLite!
    if (product) {
      const updateStmt = db.prepare(
        'UPDATE products SET title = ?, tags = ?, description = ?, shop_section_id = ? WHERE id = ? AND shop_id = ?'
      );
      updateStmt.run(
        title !== undefined ? title : product.title, 
        tags !== undefined ? JSON.stringify(tags) : product.tags, 
        description !== undefined ? description : product.description, 
        shop_section_id !== undefined ? (shop_section_id || null) : product.shop_section_id,
        product.id,
        activeShop.shop_id
      );
    }
    
    res.json({ success: true, updated });
  } catch (err) {
    console.error("Etsy Update Error:", err.response?.data || err.message);
    next(err);
  }
});

// Batch update should_auto_renew for multiple listings on Etsy
router.post('/listings/batch-auto-renew', async (req, res, next) => {
  try {
    const { listingIds, should_auto_renew } = req.body;
    if (!listingIds || !Array.isArray(listingIds) || listingIds.length === 0) {
      return res.status(400).json({ error: 'listingIds dizisi gereklidir.' });
    }
    if (typeof should_auto_renew !== 'boolean') {
      return res.status(400).json({ error: 'should_auto_renew boolean olmalıdır.' });
    }

    const activeShop = getActiveShop();
    const cacheKey = `${activeShop.shop_id}_active`;
    const results = [];

    const updateCacheStmt = db.prepare('UPDATE etsy_analytics_cache SET should_auto_renew = ? WHERE listing_id = ?');

    for (const listingId of listingIds) {
      const listingIdStr = String(listingId);
      try {
        await EtsyService.updateListing(listingIdStr, { should_auto_renew });
        
        // Update in SQLite
        try {
          updateCacheStmt.run(should_auto_renew ? 1 : 0, listingIdStr);
        } catch (dbErr) {}

        // Update in memory cache
        if (listingsCache.data[cacheKey]) {
          const item = listingsCache.data[cacheKey].listings.find(l => String(l.listing_id) === listingIdStr);
          if (item) item.should_auto_renew = should_auto_renew;
        }

        results.push({ listingId: listingIdStr, success: true });
      } catch (err) {
        console.error(`Auto-renew update failed for listing ${listingIdStr}:`, err.response?.data || err.message);
        results.push({
          listingId: listingIdStr,
          success: false,
          error: err.response?.data?.error || err.message
        });
      }

      // Small delay between calls to prevent rate limits
      if (listingIds.length > 1) {
        await sleep(150);
      }
    }

    const successes = results.filter(r => r.success);
    const failures = results.filter(r => !r.success);

    return res.json({
      success: true,
      updatedCount: successes.length,
      failedCount: failures.length,
      results
    });
  } catch (err) {
    console.error("Batch auto-renew error:", err);
    next(err);
  }
});

// Dedicated endpoint for Renew Manager: returns paginated, filtered, sorted listings with stats & expiration progress
router.get('/renew-manager/listings', async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      renewFilter = 'all', // 'all' | 'auto' | 'manual'
      daysFilter = 'all',  // 'all' | 'urgent' (<15) | 'warning' (<30) | 'safe' (>30)
      shop_section_id = '',
      sortBy = 'days_remaining', // 'days_remaining' | 'num_favorers' | 'views' | 'sales_count' | 'total_revenue' | 'price'
      sortOrder = 'asc' // 'asc' | 'desc'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const { access_token, client_id, client_secret, shop_id } = await EtsyService.getValidToken();

    // Fetch active listings for this shop (cached in memory)
    const allListings = await getFullListingsForShopState(shop_id, 'active', access_token, client_id, client_secret);

    // Fetch local analytics map
    let localAnalytics = [];
    try {
      localAnalytics = db.prepare('SELECT listing_id, sales_count, total_revenue FROM etsy_analytics_cache WHERE shop_id = ?').all(shop_id);
    } catch (e) {}

    const analyticsMap = new Map();
    localAnalytics.forEach(a => analyticsMap.set(String(a.listing_id), a));

    const nowSec = Math.floor(Date.now() / 1000);

    // Transform raw listings
    let mapped = allListings.map(l => {
      const listingIdStr = String(l.listing_id);
      const cached = analyticsMap.get(listingIdStr);
      const salesCount = cached ? cached.sales_count : (l.transaction_sell_count || 0);
      const totalRevenue = cached ? cached.total_revenue : 0;
      const priceVal = l.price ? (l.price.amount / (l.price.divisor || 100)) : 0;
      const endingTimestamp = l.ending_timestamp || 0;
      const remainingSec = endingTimestamp > 0 ? (endingTimestamp - nowSec) : 0;
      const daysRemaining = endingTimestamp > 0 ? Math.max(0, Math.ceil(remainingSec / 86400)) : 0;
      // Etsy standard listing duration is 120 days (~4 months)
      const lifePercent = Math.min(100, Math.max(0, Math.round((daysRemaining / 120) * 100)));

      const imagesArr = l.images || l.Images || [];
      const firstImg = imagesArr[0];
      const thumbnail = firstImg ? (firstImg.url_170x135 || firstImg.url_75x75 || firstImg.url_570xN || firstImg.url_fullxfull || '') : '';

      return {
        listing_id: l.listing_id,
        listing_id_str: listingIdStr,
        title: l.title || 'Untitled',
        url: l.url || `https://www.etsy.com/listing/${listingIdStr}`,
        price: priceVal,
        currency: l.price?.currency_code || 'USD',
        quantity: l.quantity || 0,
        state: l.state,
        should_auto_renew: Boolean(l.should_auto_renew),
        ending_timestamp: endingTimestamp,
        creation_timestamp: l.creation_timestamp || 0,
        original_creation_timestamp: l.original_creation_timestamp || 0,
        views: l.views || 0,
        num_favorers: l.num_favorers || 0,
        sales_count: salesCount,
        total_revenue: totalRevenue,
        image_url: thumbnail,
        shop_section_id: l.shop_section_id ? String(l.shop_section_id) : null,
        days_remaining: daysRemaining,
        life_percent: lifePercent
      };
    });

    // Summary calculation (over ALL active listings of the shop)
    const autoRenewListings = mapped.filter(m => m.should_auto_renew);
    const manualListings = mapped.filter(m => !m.should_auto_renew);
    const urgentCount = mapped.filter(m => m.days_remaining <= 30 && m.should_auto_renew).length;
    const criticalCount = mapped.filter(m => m.days_remaining <= 15 && m.should_auto_renew).length;

    const summary = {
      total_listings: mapped.length,
      auto_renew_count: autoRenewListings.length,
      manual_count: manualListings.length,
      urgent_count: urgentCount, // < 30 days & auto-renew
      critical_count: criticalCount, // < 15 days & auto-renew
      potential_cost: (autoRenewListings.length * 0.20).toFixed(2)
    };

    // Filter by search
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      mapped = mapped.filter(m => 
        m.title.toLowerCase().includes(q) || 
        m.listing_id_str.includes(q)
      );
    }

    // Filter by auto renew
    if (renewFilter === 'auto') {
      mapped = mapped.filter(m => m.should_auto_renew);
    } else if (renewFilter === 'manual') {
      mapped = mapped.filter(m => !m.should_auto_renew);
    }

    // Filter by days remaining
    if (daysFilter === 'urgent') {
      mapped = mapped.filter(m => m.days_remaining <= 15);
    } else if (daysFilter === 'warning') {
      mapped = mapped.filter(m => m.days_remaining <= 30);
    } else if (daysFilter === 'safe') {
      mapped = mapped.filter(m => m.days_remaining > 30);
    }

    // Filter by shop section
    if (shop_section_id) {
      mapped = mapped.filter(m => m.shop_section_id === String(shop_section_id));
    }

    // Sorting
    mapped.sort((a, b) => {
      let valA = a[sortBy] ?? 0;
      let valB = b[sortBy] ?? 0;

      if (sortBy === 'days_remaining') {
        return sortOrder === 'desc' ? (valB - valA) : (valA - valB);
      }
      return sortOrder === 'asc' ? (valA - valB) : (valB - valA);
    });

    const totalFiltered = mapped.length;
    const totalPages = Math.ceil(totalFiltered / limitNum) || 1;
    const offset = (pageNum - 1) * limitNum;
    const pageItems = mapped.slice(offset, offset + limitNum);

    res.json({
      success: true,
      summary,
      total: totalFiltered,
      page: pageNum,
      limit: limitNum,
      total_pages: totalPages,
      listings: pageItems
    });
  } catch (err) {
    console.error("Renew manager listings error:", err.response?.data || err.message);
    next(err);
  }
});

// Batch update variation profile for multiple listings on Etsy and update SQLite
router.post('/listings/batch-variation-profile', async (req, res, next) => {
  try {
    const { listingIds, variation_profile_id } = req.body;
    if (!listingIds || !Array.isArray(listingIds) || listingIds.length === 0) {
      return res.status(400).json({ error: 'listingIds dizisi gereklidir.' });
    }
    if (!variation_profile_id) {
      return res.status(400).json({ error: 'variation_profile_id gereklidir.' });
    }

    const activeShop = getActiveShop();
    
    // Fetch variation profile from DB
    const profileStmt = db.prepare('SELECT * FROM variation_profiles WHERE id = ? AND shop_id = ?');
    let profileRow = profileStmt.get(variation_profile_id, activeShop.shop_id);
    if (!profileRow) {
      // Fallback check default shop
      profileRow = profileStmt.get(variation_profile_id, 'default_shop');
    }
    if (!profileRow) {
      return res.status(404).json({ error: 'Seçilen varyasyon profili bulunamadı.' });
    }

    const variationProfile = {
      ...profileRow,
      sizes: profileRow.sizes ? JSON.parse(profileRow.sizes) : [],
      frames: profileRow.frames ? JSON.parse(profileRow.frames) : [],
      combinations: profileRow.combinations ? JSON.parse(profileRow.combinations) : []
    };

    const hasFrames = variationProfile.frames && variationProfile.frames.length > 0;
    const validCombs = variationProfile.combinations.filter(c => 
      c.size && !isNaN(Number(c.price)) && (hasFrames ? c.frame : true)
    );

    if (validCombs.length === 0) {
      return res.status(400).json({ error: 'Seçilen profil geçerli varyasyon kombinasyonları içermiyor.' });
    }

    // Retrieve readiness state ID
    let readiness_state_id = null;
    const settingsStmt = db.prepare('SELECT * FROM settings WHERE shop_id = ?');
    const settingsRows = settingsStmt.all(activeShop.shop_id);
    const settings = {};
    settingsRows.forEach(s => {
      try { settings[s.key] = JSON.parse(s.value); } catch (e) { settings[s.key] = s.value; }
    });

    if (settings.default_readiness_state_id) {
      readiness_state_id = Number(settings.default_readiness_state_id);
    } else {
      try {
        const states = await EtsyService.getReadinessStates();
        if (states && states.length > 0) {
          readiness_state_id = Number(states[0].readiness_state_id);
        }
      } catch (rErr) {
        console.error("Failed to fetch default readiness states:", rErr.message);
      }
    }

    // 1. Update local DB for all items
    const updateStmt = db.prepare('UPDATE products SET variation_profile_id = ? WHERE (id = ? OR etsy_listing_id = ?) AND shop_id = ?');
    const insertStmt = db.prepare(`
      INSERT INTO products (id, shop_id, etsy_listing_id, variation_profile_id, status)
      VALUES (?, ?, ?, ?, 'live')
    `);
    const checkStmt = db.prepare('SELECT id FROM products WHERE (id = ? OR etsy_listing_id = ?) AND shop_id = ?');

    const { v4: uuidv4 } = await import('uuid');

    for (const id of listingIds) {
      const idStr = id.toString();
      const existing = checkStmt.get(idStr, idStr, activeShop.shop_id);
      if (existing) {
        updateStmt.run(variation_profile_id, idStr, idStr, activeShop.shop_id);
      } else {
        insertStmt.run(uuidv4(), activeShop.shop_id, idStr, variation_profile_id);
      }
    }

    // 2. Push variation inventory to Etsy for each listing
    console.log(`Pushing variation profile ${variation_profile_id} to ${listingIds.length} Etsy listings (readiness_state_id: ${readiness_state_id})...`);
    const results = [];

    for (const listingId of listingIds) {
      const listingIdStr = listingId.toString();
      const productsList = validCombs.map((comb) => {
        const property_values = [
          {
            property_id: 513, // Custom1 (Dimensions)
            property_name: "Dimensions",
            value_ids: [],
            values: [comb.size]
          }
        ];
        
        if (hasFrames && comb.frame) {
          property_values.push({
            property_id: 514, // Custom2 (Frame)
            property_name: "Frame",
            value_ids: [],
            values: [comb.frame]
          });
        }
        
        const cleanSize = comb.size.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
        const cleanFrame = comb.frame ? comb.frame.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8) : 'NONE';
        const prodPrefix = listingIdStr.substring(0, 6).toUpperCase();
        const sku = `ART-${prodPrefix}-${cleanSize}-${cleanFrame}`.toUpperCase();
        
        const offeringObj = {
          price: Number(comb.price),
          quantity: DEFAULT_LISTING_QUANTITY,
          is_enabled: true
        };
        if (readiness_state_id) {
          offeringObj.readiness_state_id = readiness_state_id;
        }

        return {
          sku,
          property_values,
          offerings: [offeringObj]
        };
      });
      
      const price_on_property = [513];
      const sku_on_property = [513];
      if (hasFrames) {
        price_on_property.push(514);
        sku_on_property.push(514);
      }
      
      const inventoryData = {
        products: productsList,
        price_on_property,
        quantity_on_property: [],
        sku_on_property
      };

      try {
        await EtsyService.updateListingInventory(listingIdStr, inventoryData);
        console.log(`Successfully updated variations on Etsy for listing ${listingIdStr}!`);
        results.push({ listingId: listingIdStr, success: true });
      } catch (invErr) {
        const errMsg = invErr.response?.data?.error || invErr.response?.data || invErr.message;
        console.error(`Failed to update variations on Etsy for listing ${listingIdStr}:`, errMsg);
        results.push({ listingId: listingIdStr, success: false, error: errMsg });
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error("Batch variation profile error:", err);
    next(err);
  }
});

// Configure multer for custom draft mockups
const customDraftStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const destDir = join(__dirname, '..', 'uploads');
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    cb(null, destDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'custom-draft-' + uniqueSuffix + '.' + file.originalname.split('.').pop());
  }
});
const uploadCustomDraft = multer({ storage: customDraftStorage });

// POST route to upload custom mockups and create a draft listing on Etsy
router.post('/upload-custom-draft', uploadCustomDraft.array('mockups'), async (req, res, next) => {
  const files = req.files || [];
  const { profileId } = req.body;
  
  if (files.length === 0) {
    return res.status(400).json({ error: 'At least one mockup file is required.' });
  }
  
  try {
    const activeShop = getActiveShop();
    
    // 1. Fetch settings to get shipping, taxonomy, who_made, when_made defaults
    const settingsStmt = db.prepare('SELECT * FROM settings WHERE shop_id = ?');
    const settingsRows = settingsStmt.all(activeShop.shop_id);
    const settings = {};
    settingsRows.forEach(s => {
      settings[s.key] = JSON.parse(s.value);
    });
    
    const shipping_profile_id = settings.default_shipping_profile_id;
    const return_policy_id = settings.default_return_policy_id;
    const taxonomy_id = settings.default_taxonomy_id || 1027; // wall decor default
    const who_made = settings.default_who_made || 'i_did';
    const when_made = settings.default_when_made || 'made_to_order';
    const readiness_state_id = settings.default_readiness_state_id;
    
    if (!shipping_profile_id) {
      return res.status(400).json({ error: 'Lütfen genel ayarlardan varsayılan bir kargo şablonu belirtin.' });
    }
    
    // 2. Fetch the variation profile combinations to get prices
    const profileStmt = db.prepare('SELECT * FROM variation_profiles WHERE id = ? AND shop_id = ?');
    const profileRow = profileStmt.get(profileId, activeShop.shop_id);
    if (!profileRow) {
      return res.status(404).json({ error: 'Varyasyon profili bulunamadı.' });
    }
    
    const variationProfile = {
      ...profileRow,
      sizes: JSON.parse(profileRow.sizes),
      frames: JSON.parse(profileRow.frames),
      combinations: JSON.parse(profileRow.combinations)
    };
    
    let fallbackPrice = settings.default_price || 35.00;
    if (variationProfile.combinations.length > 0) {
      const prices = variationProfile.combinations.map(c => Number(c.price)).filter(p => !isNaN(p));
      if (prices.length > 0) {
        fallbackPrice = Math.min(...prices);
      }
    }
    
    // Gather tags and attributes
    const tags = ['wall art', 'canvas art', 'double set', 'home decor', 'poster set', 'gift for home', 'canvas print', 'handmade art', '12 ratio set'];
    
    // 3. Create draft listing on Etsy
    const listingData = {
      title: 'Handmade Canvas Wall Art Set (1:2) - Draft',
      description: settings.description_boilerplate || 'Stunning printed wall art set.',
      price: fallbackPrice,
      quantity: DEFAULT_LISTING_QUANTITY,
      who_made,
      when_made,
      taxonomy_id: Number(taxonomy_id),
      state: 'draft',
      type: 'physical',
      should_auto_renew: settings.auto_renew !== undefined ? settings.auto_renew : true
    };
    
    if (shipping_profile_id) listingData.shipping_profile_id = Number(shipping_profile_id);
    if (return_policy_id) listingData.return_policy_id = Number(return_policy_id);
    if (readiness_state_id) listingData.readiness_state_id = Number(readiness_state_id);
    
    // Add Materials if enabled
    const materialsEnabled = settings.attribute_materials_enabled !== undefined ? settings.attribute_materials_enabled : true;
    const materialsList = settings.attribute_materials !== undefined ? settings.attribute_materials : ['Canvas', 'Paper', 'Cotton', 'Wood', 'Fabric'];
    if (materialsEnabled && materialsList && materialsList.length > 0) {
      listingData.materials = materialsList
        .map(m => m.replace(/[^\p{L}\p{N}\p{Zs}]/gu, '').trim())
        .filter(m => m.length > 0)
        .slice(0, 13);
    }

    // Add Width & Height if enabled
    if (settings.attribute_width_enabled && settings.attribute_width) {
      listingData.item_width = Number(settings.attribute_width);
      listingData.item_dimensions_unit = settings.attribute_width_unit === 'Inches' ? 'in' : 'cm';
    }
    if (settings.attribute_height_enabled && settings.attribute_height) {
      listingData.item_height = Number(settings.attribute_height);
      listingData.item_dimensions_unit = settings.attribute_height_unit === 'Inches' ? 'in' : 'cm';
    }
    
    // Add Tags
    listingData.tags = tags;
    
    const createdListing = await EtsyService.createListing(listingData);
    const listing_id = createdListing.listing_id.toString();
    
    // Update taxonomy properties
    try {
      // 1. Home Style
      if (settings.attribute_home_style_enabled && settings.attribute_home_style) {
        const valId = STYLE_MAPPING[settings.attribute_home_style];
        if (valId) {
          await EtsyService.updateListingProperty(listing_id, 145330288652, {
            value_ids: [valId],
            values: [settings.attribute_home_style]
          });
        }
      }

      // 2. Occasion
      if (settings.attribute_occasion_enabled && settings.attribute_occasion) {
        const valId = OCCASION_MAPPING[settings.attribute_occasion];
        if (valId) {
          await EtsyService.updateListingProperty(listing_id, 46803063641, {
            value_ids: [valId],
            values: [settings.attribute_occasion]
          });
        }
      }

      // 3. Holiday
      if (settings.attribute_holiday_enabled && settings.attribute_holiday) {
        const valId = HOLIDAY_MAPPING[settings.attribute_holiday];
        if (valId) {
          await EtsyService.updateListingProperty(listing_id, 46803063659, {
            value_ids: [valId],
            values: [settings.attribute_holiday]
          });
        }
      }

      // 4. Room
      if (settings.attribute_room_enabled && settings.attribute_rooms && settings.attribute_rooms.length > 0) {
        const valIds = settings.attribute_rooms
          .map(r => ROOM_MAPPING[r])
          .filter(id => id !== undefined);
        const values = settings.attribute_rooms
          .filter(r => ROOM_MAPPING[r] !== undefined);
          
        if (valIds.length > 0) {
          await EtsyService.updateListingProperty(listing_id, 145330288592, {
            value_ids: valIds,
            values: values
          });
        }
      }

      // 5. Materials (ID: 148789511893)
      if (settings.attribute_materials_enabled && settings.attribute_materials && settings.attribute_materials.length > 0) {
        const valIds = settings.attribute_materials
          .map(m => MATERIALS_MAPPING[m])
          .filter(id => id !== undefined);
        const values = settings.attribute_materials
          .filter(m => MATERIALS_MAPPING[m] !== undefined);
          
        if (valIds.length > 0) {
          await EtsyService.updateListingProperty(listing_id, 148789511893, {
            value_ids: valIds,
            values: values
          });
        }
      }
    } catch (attrErr) {
      console.warn("Failed to set taxonomy properties for custom draft listing:", attrErr.response?.data || attrErr.message);
    }
    
    // 4. Upload mockup images to Etsy listing
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        await EtsyService.uploadListingImage(listing_id, file.path, i + 1, 'İkili Set Mockup');
      } catch (imgErr) {
        console.error(`Failed to upload image ${file.filename} to Etsy:`, imgErr.message);
      } finally {
        // Clean up file from disk
        try {
          fs.unlinkSync(file.path);
        } catch (unErr) {
          console.error(`Failed to delete local file ${file.path}:`, unErr.message);
        }
      }
    }
    
    // 5. Update SQLite database products table
    const { v4: uuidv4 } = await import('uuid');
    const insertStmt = db.prepare(`
      INSERT INTO products (id, shop_id, etsy_listing_id, variation_profile_id, status, title, tags, description)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)
    `);
    insertStmt.run(uuidv4(), activeShop.shop_id, listing_id, profileId, 'Handmade Canvas Wall Art Set (1:2) - Draft', JSON.stringify(tags), listingData.description);
    
    // 6. Push variation inventory if combinations exist
    if (variationProfile.combinations.length > 0) {
      console.log(`Pushing variations for custom draft listing ${listing_id}...`);
      
      let actualReadinessStateId = readiness_state_id;
      if (!actualReadinessStateId) {
        try {
          const states = await EtsyService.getReadinessStates();
          if (states && states.length > 0) {
            actualReadinessStateId = Number(states[0].readiness_state_id);
          }
        } catch (rErr) {
          console.error("Failed to fetch default readiness states:", rErr.message);
        }
      }
      
      const hasFrames = variationProfile.frames && variationProfile.frames.length > 0;
      
      const productsList = variationProfile.combinations.map((comb) => {
        const property_values = [
          {
            property_id: 513, // Dimensions (Custom1)
            property_name: "Dimensions",
            value_ids: [],
            values: [comb.size]
          }
        ];
        
        if (hasFrames && comb.frame) {
          property_values.push({
            property_id: 514, // Frame (Custom2)
            property_name: "Frame",
            value_ids: [],
            values: [comb.frame]
          });
        }
        
        // Generate SKU (max 32 characters for Etsy)
        const cleanSize = comb.size.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
        const cleanFrame = comb.frame ? comb.frame.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8) : 'NONE';
        const sku = `ART-CUSTOM-${cleanSize}-${cleanFrame}`.toUpperCase();
        
        return {
          sku,
          property_values,
          offerings: [
            {
              price: Number(comb.price),
              quantity: DEFAULT_LISTING_QUANTITY,
              is_enabled: true,
              readiness_state_id: Number(actualReadinessStateId)
            }
          ]
        };
      });
      
      const price_on_property = [513];
      const sku_on_property = [513];
      if (hasFrames) {
        price_on_property.push(514);
        sku_on_property.push(514);
      }
      
      const inventoryData = {
        products: productsList,
        price_on_property,
        quantity_on_property: [],
        sku_on_property
      };
      
      try {
        await EtsyService.updateListingInventory(listing_id, inventoryData);
        console.log(`Successfully pushed variations inventory to custom draft listing ${listing_id}`);
      } catch (invErr) {
        console.error(`Failed to push variations inventory for custom draft listing ${listing_id}:`, invErr.response?.data || invErr.message);
      }
    }
    
    return res.json({ success: true, listing_id });
  } catch (err) {
    // Clean up any remaining uploaded files
    files.forEach(file => {
      try {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (unErr) {
        console.error(`Cleanup failed for file ${file.path}:`, unErr.message);
      }
    });
    console.error("Custom draft upload failed:", err.response?.data || err.message);
    return res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Fetch all active listings from Etsy and map their variation profile IDs from the local database
router.get('/listings-with-variations', async (req, res, next) => {
  try {
    const { access_token, client_id, client_secret, shop_id } = await EtsyService.getValidToken();
    
    // Fetch all active listings from Etsy (paginated)
    const allListings = await getFullListingsForShopState(shop_id, 'active', access_token, client_id, client_secret);
    
    // Fetch local products to map their variation profiles
    const localProducts = db.prepare('SELECT etsy_listing_id, variation_profile_id FROM products WHERE shop_id = ?').all(shop_id);
    const localMap = new Map();
    localProducts.forEach(p => {
      if (p.etsy_listing_id) {
        // Strip float suffix if any
        const cleanId = p.etsy_listing_id.toString().split('.')[0];
        localMap.set(cleanId, p.variation_profile_id);
      }
    });

    const listingsWithProfile = allListings.map(l => {
      const listingIdStr = l.listing_id.toString();
      const variation_profile_id = localMap.get(listingIdStr) || null;
      return {
        listing_id: l.listing_id,
        title: l.title,
        price: l.price,
        state: l.state,
        shop_section_id: l.shop_section_id,
        images: l.images || [],
        variation_profile_id
      };
    });

    res.json(listingsWithProfile);
  } catch (err) {
    console.error("Failed to get listings with variation profiles:", err.response?.data || err.message);
    next(err);
  }
});

// Update prices of listings (+20% or custom percentage) in batches
router.post('/listings/bulk-price-update', async (req, res, next) => {
  try {
    const { listingIds, percentage, execute } = req.body;
    if (!listingIds || !Array.isArray(listingIds) || listingIds.length === 0) {
      return res.status(400).json({ error: 'listingIds array is required.' });
    }

    const pct = percentage !== undefined ? parseFloat(percentage) : 20;
    const multiplier = 1 + (pct / 100);

    const credentials = await EtsyService.getValidToken();
    const { access_token, client_id, client_secret, shop_id } = credentials;

    const results = [];
    
    for (const listingId of listingIds) {
      const listingIdStr = listingId.toString();
      try {
        // Fetch current inventory
        const getUrl = `https://openapi.etsy.com/v3/application/listings/${listingIdStr}/inventory`;
        const getRes = await axios.get(getUrl, {
          headers: {
            'x-api-key': `${client_id}:${client_secret}`,
            'Authorization': `Bearer ${access_token}`
          }
        });

        const inventory = getRes.data;
        if (!inventory || !inventory.products || inventory.products.length === 0) {
          results.push({
            listingId: listingIdStr,
            status: 'skipped',
            reason: 'No products in inventory'
          });
          continue;
        }

        const hasVariations = inventory.price_on_property && inventory.price_on_property.length > 0;
        const originalPrices = [];
        const newPrices = [];

        // Map existing products into updated list
        const updatedProducts = inventory.products.map(product => {
          const property_values = (product.property_values || []).map(pv => ({
            property_id: pv.property_id,
            property_name: pv.property_name,
            value_ids: pv.value_ids || [],
            values: pv.values || []
          }));

          const offerings = (product.offerings || []).map(offering => {
            const originalPrice = offering.price.amount / offering.price.divisor;
            const newPriceVal = Number((originalPrice * multiplier).toFixed(2));

            originalPrices.push(originalPrice);
            newPrices.push(newPriceVal);

            const newOffering = {
              price: newPriceVal,
              quantity: offering.quantity !== undefined ? offering.quantity : 100,
              is_enabled: offering.is_enabled !== undefined ? offering.is_enabled : true
            };

            if (offering.readiness_state_id) {
              newOffering.readiness_state_id = offering.readiness_state_id;
            } else {
              newOffering.readiness_state_id = null;
            }

            return newOffering;
          });

          return {
            sku: product.sku || '',
            property_values,
            offerings
          };
        });

        const minOrig = Math.min(...originalPrices);
        const maxOrig = Math.max(...originalPrices);
        const minNew = Math.min(...newPrices);
        const maxNew = Math.max(...newPrices);

        if (!hasVariations) {
          // Simple listing PATCH
          if (execute) {
            const patchUrl = `https://openapi.etsy.com/v3/application/shops/${shop_id}/listings/${listingIdStr}`;
            const params = new URLSearchParams();
            params.append('price', newPrices[0].toString());

            await axios.patch(patchUrl, params, {
              headers: {
                'x-api-key': `${client_id}:${client_secret}`,
                'Authorization': `Bearer ${access_token}`,
                'Content-Type': 'application/x-www-form-urlencoded'
              }
            });
          }
          results.push({
            listingId: listingIdStr,
            status: execute ? 'updated' : 'dry-run-success',
            hasVariations: false,
            originalPrices,
            newPrices
          });
        } else {
          // Variation listing PUT
          if (execute) {
            const putData = {
              products: updatedProducts,
              price_on_property: inventory.price_on_property || [],
              quantity_on_property: inventory.quantity_on_property || [],
              sku_on_property: inventory.sku_on_property || []
            };

            await axios.put(
              `https://openapi.etsy.com/v3/application/listings/${listingIdStr}/inventory`,
              putData,
              {
                headers: {
                  'x-api-key': `${client_id}:${client_secret}`,
                  'Authorization': `Bearer ${access_token}`,
                  'Content-Type': 'application/json'
                }
              }
            );
          }
          results.push({
            listingId: listingIdStr,
            status: execute ? 'updated' : 'dry-run-success',
            hasVariations: true,
            originalPrices,
            newPrices
          });
        }
      } catch (err) {
        const errMsg = err.response?.data?.error || err.response?.data || err.message;
        results.push({
          listingId: listingIdStr,
          status: 'error',
          error: errMsg
        });
      }

      // Small delay between items to prevent rate limits inside the batch
      await sleep(150);
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error("Bulk price update endpoint error:", err);
    next(err);
  }
});

// Helper: Parse PNG / JPEG buffer to inspect width & height without heavy dependencies
async function getImageDimensionsFromUrl(imageUrl) {
  if (!imageUrl) return { width: 0, height: 0 };
  try {
    const res = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 8000 });
    const buffer = Buffer.from(res.data);
    
    // PNG Check
    if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }
    
    // JPEG Check
    if (buffer.length > 4 && buffer[0] === 0xFF && buffer[1] === 0xD8) {
      let offset = 2;
      while (offset < buffer.length - 8) {
        if (buffer[offset] !== 0xFF) break;
        const marker = buffer[offset + 1];
        if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2 || marker === 0xC3) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height };
        }
        const length = buffer.readUInt16BE(offset + 2);
        offset += 2 + length;
      }
    }
  } catch (err) {
    console.warn("[getImageDimensionsFromUrl] Dimension parse warning:", err.message);
  }
  return { width: 0, height: 0 };
}

// ----------------------------------------------------
// ANALYTICS & LISTING OPTIMIZATION ENDPOINTS
// ----------------------------------------------------

// 1. Sync Etsy listings to SQLite Cache DB
router.get('/analytics/sync', async (req, res, next) => {
  try {
    const auth = await EtsyService.getValidToken();
    const shopId = auth.shop_id;

    console.log(`[Analytics Sync] Fetching listings from Etsy API for shop ${shopId}...`);

    let sectionsMap = {};
    try {
      const sections = await EtsyService.getShopSections();
      if (Array.isArray(sections)) {
        sections.forEach(s => {
          sectionsMap[s.shop_section_id] = s.title;
        });
      }
    } catch (secErr) {
      console.warn("[Analytics Sync] Could not fetch shop sections:", secErr.message);
    }

    let allListings = [];
    let offset = 0;
    const limit = 100;

    // Fetch active listings
    while (true) {
      const url = `https://openapi.etsy.com/v3/application/shops/${shopId}/listings/active?limit=${limit}&offset=${offset}`;
      const response = await axios.get(url, {
        headers: {
          'x-api-key': `${auth.client_id}:${auth.client_secret}`,
          'Authorization': `Bearer ${auth.access_token}`
        }
      });
      const results = response.data.results || [];
      allListings.push(...results);
      if (allListings.length >= response.data.count || results.length === 0) break;
      offset += limit;
    }

    console.log(`[Analytics Sync] Retrieved ${allListings.length} listings from Etsy API. Fetching images in batch...`);

    // Map for image data
    const imageMap = {};
    const batchSize = 50;
    for (let i = 0; i < allListings.length; i += batchSize) {
      const batchListings = allListings.slice(i, i + batchSize);
      const batchIds = batchListings.map(l => l.listing_id).join(',');
      try {
        const batchUrl = `https://openapi.etsy.com/v3/application/listings/batch?listing_ids=${batchIds}&includes=images`;
        const batchRes = await axios.get(batchUrl, {
          headers: {
            'x-api-key': `${auth.client_id}:${auth.client_secret}`,
            'Authorization': `Bearer ${auth.access_token}`
          }
        });
        const batchResults = batchRes.data.results || [];
        batchResults.forEach(item => {
          if (item.images && item.images.length > 0) {
            const firstImg = item.images[0];
            imageMap[item.listing_id] = {
              url: firstImg.url_570xN || firstImg.url_170x135 || firstImg.url_75x75 || '',
              width: firstImg.full_width || 0,
              height: firstImg.full_height || 0
            };
          }
        });
      } catch (batchErr) {
        console.warn(`[Analytics Sync] Batch image fetch warning (chunk ${i}):`, batchErr.message);
      }
    }

    console.log(`[Analytics Sync] Saving ${allListings.length} listings with images to database...`);

    const upsertStmt = db.prepare(`
      INSERT INTO etsy_analytics_cache (
        listing_id, shop_id, title, state, views, num_favorers, sales_count, total_revenue,
        price_amount, currency_code, quantity, creation_timestamp, original_creation_timestamp,
        url, image_url, image_width, image_height, tags, shop_section_id, section_title,
        should_auto_renew, ending_timestamp, last_synced_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
      ) ON CONFLICT(listing_id) DO UPDATE SET
        title = excluded.title,
        state = excluded.state,
        views = excluded.views,
        num_favorers = excluded.num_favorers,
        sales_count = excluded.sales_count,
        total_revenue = excluded.total_revenue,
        price_amount = excluded.price_amount,
        currency_code = excluded.currency_code,
        quantity = excluded.quantity,
        creation_timestamp = excluded.creation_timestamp,
        original_creation_timestamp = excluded.original_creation_timestamp,
        url = excluded.url,
        image_url = CASE WHEN excluded.image_url != '' THEN excluded.image_url ELSE etsy_analytics_cache.image_url END,
        image_width = CASE WHEN excluded.image_width > 0 THEN excluded.image_width ELSE etsy_analytics_cache.image_width END,
        image_height = CASE WHEN excluded.image_height > 0 THEN excluded.image_height ELSE etsy_analytics_cache.image_height END,
        tags = excluded.tags,
        shop_section_id = excluded.shop_section_id,
        section_title = excluded.section_title,
        should_auto_renew = excluded.should_auto_renew,
        ending_timestamp = excluded.ending_timestamp,
        last_synced_at = CURRENT_TIMESTAMP
    `);

    db.exec('BEGIN');
    try {
      allListings.forEach(l => {
        const priceVal = l.price ? (l.price.amount / l.price.divisor) : 0;
        const currency = l.price ? l.price.currency_code : 'USD';
        const sectionTitle = l.shop_section_id ? (sectionsMap[l.shop_section_id] || 'Seksiyon Yok') : 'Seksiyon Yok';
        const tagsJson = JSON.stringify(l.tags || []);
        
        // Image data
        const imgData = imageMap[l.listing_id] || { url: '', width: 0, height: 0 };

        // Sales / revenue
        const salesCount = l.transaction_sell_count || 0;
        const totalRevenue = salesCount * priceVal;


        upsertStmt.run(
          String(l.listing_id),
          shopId,
          l.title || '',
          l.state || 'active',
          l.views || 0,
          l.num_favorers || 0,
          salesCount,
          totalRevenue,
          priceVal,
          currency,
          l.quantity || 0,
          l.creation_timestamp || 0,
          l.original_creation_timestamp || l.creation_timestamp || 0,
          l.url || '',
          imgData.url,
          imgData.width,
          imgData.height,
          tagsJson,
          l.shop_section_id ? String(l.shop_section_id) : '',
          sectionTitle,
          l.should_auto_renew ? 1 : 0,
          l.ending_timestamp || 0
        );
      });
      db.exec('COMMIT');
      console.log(`[Analytics Sync] Successfully cached ${allListings.length} listings in SQLite with thumbnails.`);
    } catch (dbErr) {
      db.exec('ROLLBACK');
      throw dbErr;
    }

    res.json({
      success: true,
      count: allListings.length,
      last_synced_at: new Date().toISOString()
    });
  } catch (err) {
    console.error("Analytics sync error:", err.response?.data || err.message);
    next(err);
  }
});


// 2. Query cached listings with date range, filters, thresholds & sorting
router.get('/analytics/listings', (req, res, next) => {
  try {
    const activeShop = getActiveShop();
    const shopId = activeShop.shop_id;

    const {
      range = 'all',
      startDate,
      endDate,
      search = '',
      minAgeDays = 0,
      zeroVisitsOnly = 'false',
      zeroFavsOnly = 'false',
      sortBy = 'views',
      sortOrder = 'desc'
    } = req.query;

    let rows = db.prepare(`SELECT * FROM etsy_analytics_cache WHERE shop_id = ?`).all(shopId);

    const nowSec = Math.floor(Date.now() / 1000);

    // Usalk puanı mağazanın TAMAMINA göre hesaplanır; filtreden sonra
    // hesaplansaydı puan seçilen filtreye göre kayardı.
    rows = assignUsalkScores(rows, nowSec);

    // Mağaza genelinde geçerli indirim oranı (Etsy API'si kampanya bilgisi
    // vermediği için Genel Ayarlar'dan okunur)
    let discountPercent = 0;
    try {
      const dRow = db.prepare('SELECT value FROM settings WHERE shop_id = ? AND key = ?')
        .get(shopId, 'shop_discount_percent');
      if (dRow) discountPercent = Number(JSON.parse(dRow.value)) || 0;
    } catch (e) {
      discountPercent = 0;
    }
    if (discountPercent < 0 || discountPercent >= 100) discountPercent = 0;

    let processed = rows.map(r => {
      let tagsArr = [];
      try {
        tagsArr = JSON.parse(r.tags || '[]');
      } catch (e) {
        tagsArr = [];
      }

      const ageDays = r.creation_timestamp > 0 ? Math.floor((nowSec - r.creation_timestamp) / 86400) : 0;
      const convRate = r.views > 0 ? ((r.sales_count / r.views) * 100).toFixed(2) : '0.00';
      const clickRate = r.views > 0 ? ((r.num_favorers / r.views) * 100).toFixed(2) : '0.00';

      return {
        listing_id: r.listing_id,
        title: r.title,
        state: r.state,
        views: r.views,
        num_favorers: r.num_favorers,
        sales_count: r.sales_count,
        total_revenue: r.total_revenue,
        price_amount: r.price_amount,
        // İndirim uygulanmış satış fiyatı; kartlarda üstü çizili orijinalle gösterilir
        discounted_price: discountPercent > 0
          ? Math.round(r.price_amount * (1 - discountPercent / 100) * 100) / 100
          : null,
        discount_percent: discountPercent,
        currency_code: r.currency_code,
        quantity: r.quantity,
        creation_timestamp: r.creation_timestamp,
        age_days: ageDays,
        conv_rate: parseFloat(convRate),
        click_rate: parseFloat(clickRate),
        // favori / görüntülenme oranı — "fav oranı" sıralaması için
        fav_rate: r.views > 0 ? Math.round((r.num_favorers / r.views) * 10000) / 100 : 0,
        usalk_score: r.usalk_score,
        url: r.url,
        image_url: r.image_url,
        image_width: r.image_width,
        image_height: r.image_height,
        is_high_res: r.image_width >= 2000 && r.image_height >= 2000,
        tags: tagsArr,
        shop_section_id: r.shop_section_id,
        section_title: r.section_title,
        last_synced_at: r.last_synced_at
      };
    });

    // Date range filter
    if (range !== 'all') {
      let cutoffSec = 0;
      if (range === '7d') cutoffSec = nowSec - 7 * 86400;
      else if (range === '30d') cutoffSec = nowSec - 30 * 86400;
      else if (range === '90d') cutoffSec = nowSec - 90 * 86400;
      else if (range === 'custom' && startDate) {
        cutoffSec = Math.floor(new Date(startDate).getTime() / 1000);
      }

      if (cutoffSec > 0) {
        processed = processed.filter(p => p.creation_timestamp >= cutoffSec);
      }
      if (range === 'custom' && endDate) {
        const endCutoffSec = Math.floor(new Date(endDate).getTime() / 1000) + 86400;
        processed = processed.filter(p => p.creation_timestamp <= endCutoffSec);
      }
    }

    // Search filter
    if (search && search.trim() !== '') {
      const q = search.toLowerCase().trim();
      processed = processed.filter(p => p.title.toLowerCase().includes(q) || p.tags.some(t => t.toLowerCase().includes(q)));
    }

    // Threshold filters
    if (parseInt(minAgeDays) > 0) {
      const minDays = parseInt(minAgeDays);
      processed = processed.filter(p => p.age_days >= minDays);
    }
    if (zeroVisitsOnly === 'true') {
      processed = processed.filter(p => p.views === 0);
    }
    if (zeroFavsOnly === 'true') {
      processed = processed.filter(p => p.num_favorers === 0);
    }

    // Sort
    const isAsc = sortOrder === 'asc';
    processed.sort((a, b) => {
      let valA = a[sortBy] !== undefined ? a[sortBy] : 0;
      let valB = b[sortBy] !== undefined ? b[sortBy] : 0;
      if (typeof valA === 'string') {
        return isAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return isAsc ? valA - valB : valB - valA;
    });

    // Compute Summary Stats

    const totalViews = processed.reduce((sum, item) => sum + item.views, 0);
    const totalFavs = processed.reduce((sum, item) => sum + item.num_favorers, 0);
    let totalSales = processed.reduce((sum, item) => sum + item.sales_count, 0);
    let totalRevenue = processed.reduce((sum, item) => sum + item.total_revenue, 0);
    const avgClickRate = processed.length > 0 ? (processed.reduce((sum, item) => sum + item.click_rate, 0) / processed.length).toFixed(2) : '0.00';

    // Override summary totals if imported CSV totals exist in settings
    try {
      const impSalesRow = db.prepare('SELECT value FROM settings WHERE shop_id = ? AND key = ?').get(shopId, 'imported_sales_count');
      const impRevRow = db.prepare('SELECT value FROM settings WHERE shop_id = ? AND key = ?').get(shopId, 'imported_total_revenue');
      if (impSalesRow && impSalesRow.value) {
        const impSales = JSON.parse(impSalesRow.value);
        if (impSales > totalSales) totalSales = impSales;
      }
      if (impRevRow && impRevRow.value) {
        const impRev = JSON.parse(impRevRow.value);
        if (impRev > totalRevenue) totalRevenue = impRev;
      }
    } catch (sErr) {
      console.warn("Could not query imported sales settings:", sErr.message);
    }

    res.json({
      success: true,
      total_count: processed.length,
      summary: {
        total_views: totalViews,
        total_favorites: totalFavs,
        total_sales: totalSales,
        total_revenue: totalRevenue,
        avg_click_rate: parseFloat(avgClickRate)
      },
      listings: processed
    });
  } catch (err) {
    console.error("Analytics listing query error:", err);
    next(err);
  }
});

// 3. Inspect listing image dimensions (Algorithm, no AI)
router.post('/analytics/inspect-image', async (req, res, next) => {
  try {
    const { listing_id } = req.body;
    if (!listing_id) {
      return res.status(400).json({ error: 'listing_id required' });
    }

    const auth = await EtsyService.getValidToken();
    const imagesUrl = `https://openapi.etsy.com/v3/application/shops/${auth.shop_id}/listings/${listing_id}/images`;
    
    let mainImageUrl = '';
    let width = 0;
    let height = 0;

    try {
      const imgRes = await axios.get(imagesUrl, {
        headers: {
          'x-api-key': `${auth.client_id}:${auth.client_secret}`,
          'Authorization': `Bearer ${auth.access_token}`
        }
      });
      const results = imgRes.data.results || [];
      if (results.length > 0) {
        const first = results[0];
        mainImageUrl = first.url_fullxfull || first.url_570xN || '';
        width = first.full_width || 0;
        height = first.full_height || 0;
      }
    } catch (e) {
      console.warn(`[Inspect Image] Could not fetch images from Etsy for listing ${listing_id}:`, e.message);
    }

    if ((width === 0 || height === 0) && mainImageUrl) {
      const dims = await getImageDimensionsFromUrl(mainImageUrl);
      width = dims.width;
      height = dims.height;
    }

    const isHighRes = width >= 2000 && height >= 2000;

    // Update database cache
    try {
      db.prepare(`UPDATE etsy_analytics_cache SET image_url = ?, image_width = ?, image_height = ? WHERE listing_id = ?`)
        .run(mainImageUrl, width, height, String(listing_id));
    } catch (dbErr) {
      console.warn("Failed to update cache image dimensions:", dbErr.message);
    }

    res.json({
      success: true,
      listing_id,
      image_url: mainImageUrl,
      width,
      height,
      is_high_res: isHighRes
    });
  } catch (err) {
    console.error("Inspect image error:", err);
    next(err);
  }
});


// Analiz önbelleğini CSV olarak dışa aktar.
// Veriler zaten SQLite'ta kalıcı — bu, dışarıda saklamak/incelemek isteyenler için.
router.get('/analytics/export-csv', (req, res, next) => {
  try {
    const shopId = getActiveShop().shop_id;
    const rows = assignUsalkScores(
      db.prepare('SELECT * FROM etsy_analytics_cache WHERE shop_id = ?').all(shopId)
    );

    const nowSec = Math.floor(Date.now() / 1000);
    const headers = [
      'listing_id', 'title', 'state', 'usalk_score', 'views', 'num_favorers',
      'fav_rate_pct', 'sales_count', 'total_revenue', 'price_amount', 'currency_code',
      'quantity', 'age_days', 'section_title', 'image_width', 'image_height', 'tags', 'url'
    ];

    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [headers.join(',')];
    for (const r of rows) {
      const ageDays = r.creation_timestamp > 0 ? Math.floor((nowSec - r.creation_timestamp) / 86400) : 0;
      const favRate = r.views > 0 ? ((r.num_favorers / r.views) * 100).toFixed(2) : '0.00';
      let tags = '';
      try { tags = JSON.parse(r.tags || '[]').join(' | '); } catch { tags = ''; }

      lines.push([
        r.listing_id, r.title, r.state, r.usalk_score, r.views, r.num_favorers,
        favRate, r.sales_count, r.total_revenue, r.price_amount, r.currency_code,
        r.quantity, ageDays, r.section_title, r.image_width, r.image_height, tags, r.url
      ].map(esc).join(','));
    }

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="etsy-analiz-${shopId}-${stamp}.csv"`);
    res.send('﻿' + lines.join('\n')); // BOM: Excel'de Türkçe karakterler bozulmasın
  } catch (err) {
    next(err);
  }
});

// 5. Replace single listing
router.post('/analytics/replace-single', multer({ dest: 'uploads/' }).single('file'), async (req, res, next) => {
  try {
    const { listing_id, title, tags, description, shop_section_id } = req.body;
    if (!listing_id) {
      return res.status(400).json({ error: 'listing_id required' });
    }

    const updateData = {};
    if (title) updateData.title = title.trim();
    if (description) updateData.description = description.trim();
    if (shop_section_id) updateData.shop_section_id = Number(shop_section_id);
    if (tags) {
      let parsedTags = typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(Boolean) : tags;
      updateData.tags = parsedTags.slice(0, 13);
    }

    console.log(`[Replace Single] Updating listing #${listing_id} metadata...`);
    if (Object.keys(updateData).length > 0) {
      await EtsyService.updateListing(listing_id, updateData);
    }

    if (req.file) {
      console.log(`[Replace Single] Uploading new image for listing #${listing_id}...`);
      await EtsyService.uploadListingImage(listing_id, req.file.path, 1, title || 'Artwork Print');
      try { fs.unlinkSync(req.file.path); } catch(e){}
    }

    res.json({ success: true, listing_id, message: 'Listing successfully updated.' });
  } catch (err) {
    console.error("Replace single listing error:", err);
    next(err);
  }
});

// 6. Import Sold Orders CSV (EtsySoldOrders.csv or EtsySoldOrderItems.csv) to map real sales & revenue
router.post('/analytics/import-sales-csv', multer({ dest: 'uploads/' }).single('file'), async (req, res, next) => {
  try {
    let csvContent = '';
    if (req.file) {
      csvContent = fs.readFileSync(req.file.path, 'utf8');
      try { fs.unlinkSync(req.file.path); } catch(e){}
    } else if (req.body.csv_path && fs.existsSync(req.body.csv_path)) {
      csvContent = fs.readFileSync(req.body.csv_path, 'utf8');
    } else {
      return res.status(400).json({ error: 'Lütfen içe aktarılacak satış CSV dosyasını seçin.' });
    }

    const lines = csvContent.split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV file is empty or invalid.' });
    }

    const activeShop = getActiveShop();
    const shopId = activeShop.shop_id;

    const dbProducts = db.prepare("SELECT id, etsy_listing_id FROM products WHERE etsy_listing_id IS NOT NULL AND etsy_listing_id != ''").all();
    const prefixToListingMap = {};
    dbProducts.forEach(p => {
      if (p.id) {
        const prefix = p.id.substring(0, 6).toUpperCase();
        const cleanListingId = String(p.etsy_listing_id).replace(/\.0$/, '').trim();
        prefixToListingMap[prefix] = cleanListingId;
      }
    });

    const listingSales = {};
    let matchedOrders = 0;
    let totalCsvItemsSold = 0;
    let totalCsvRevenue = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const fields = [];
      let insideQuote = false;
      let currentField = '';
      for (let c = 0; c < line.length; c++) {
        const char = line[c];
        if (char === '"') {
          insideQuote = !insideQuote;
        } else if (char === ',' && !insideQuote) {
          fields.push(currentField.trim());
          currentField = '';
        } else {
          currentField += char;
        }
      }
      fields.push(currentField.trim());

      if (fields.length < 15) continue;

      const numItems = parseInt(fields[6]?.replace(/"/g, '')) || 1;
      let orderValueStr = fields[16]?.replace(/"/g, '').replace(/,/g, '') || '0';
      let discountStr = fields[19]?.replace(/"/g, '').replace(/,/g, '') || '0';
      let orderValue = parseFloat(orderValueStr) || 0;
      let discount = parseFloat(discountStr) || 0;
      let netRev = Math.max(0, orderValue - discount);

      totalCsvItemsSold += numItems;
      totalCsvRevenue += netRev;

      const sku = fields[fields.length - 1]?.replace(/"/g, '').trim().toUpperCase() || '';

      let matchedListingId = null;
      if (sku.startsWith('ART-')) {
        const skuParts = sku.split('-');
        if (skuParts.length >= 2) {
          const prefix = skuParts[1];
          if (prefixToListingMap[prefix]) {
            matchedListingId = prefixToListingMap[prefix];
          }
        }
      }

      if (matchedListingId) {
        matchedOrders++;
        if (!listingSales[matchedListingId]) {
          listingSales[matchedListingId] = { sales_count: 0, total_revenue: 0 };
        }
        listingSales[matchedListingId].sales_count += numItems;
        listingSales[matchedListingId].total_revenue += netRev;
      }
    }

    // Save CSV Totals to Settings DB
    const setStmt = db.prepare('INSERT INTO settings (shop_id, key, value) VALUES (?, ?, ?) ON CONFLICT(shop_id, key) DO UPDATE SET value = excluded.value');
    setStmt.run(shopId, 'imported_sales_count', JSON.stringify(totalCsvItemsSold));
    setStmt.run(shopId, 'imported_total_revenue', JSON.stringify(totalCsvRevenue));

    const updateStmt = db.prepare(`
      UPDATE etsy_analytics_cache
      SET sales_count = ?, total_revenue = ?
      WHERE listing_id = ?
    `);

    db.exec('BEGIN');
    let updatedCount = 0;
    for (const [listingId, stats] of Object.entries(listingSales)) {
      updateStmt.run(stats.sales_count, stats.total_revenue, String(listingId));
      updatedCount++;
    }
    db.exec('COMMIT');

    res.json({
      success: true,
      total_orders_parsed: lines.length - 1,
      total_items_sold: totalCsvItemsSold,
      matched_orders: matchedOrders,
      updated_listings: updatedCount,
      total_revenue_imported: totalCsvRevenue
    });
  } catch (err) {
    console.error("Import sales CSV error:", err);
    next(err);
  }
});

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

export default router;



