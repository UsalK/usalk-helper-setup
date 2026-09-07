import express from 'express';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db, { getRawActiveShopify } from '../db/db.js';
import { testConnection, getCollections, createProduct, createCollection } from '../services/ShopifyService.js';
import { orderMockupFiles } from '../services/MockupOrder.js';

const router = express.Router();
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * GET /status
 * Retrieve active Shopify connection and theme settings
 */
router.get('/status', (req, res, next) => {
  try {
    const active = getRawActiveShopify();
    if (active) {
      res.json({
        connected: true,
        shopUrl: active.shop_url,
        shopName: active.shop_name,
        themePath: active.theme_path
      });
    } else {
      res.json({ connected: false });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /connect
 * Save credentials and connect Shopify store
 */
router.post('/connect', async (req, res, next) => {
  try {
    const { shopUrl, accessToken, themePath } = req.body;
    if (!shopUrl || !accessToken) {
      return res.status(400).json({ error: 'shopUrl and accessToken are required.' });
    }

    const cleanUrl = shopUrl.replace(/https?:\/\//, '').replace(/\/$/, '');
    console.log(`Connecting to Shopify store: ${cleanUrl}...`);

    // Test connection
    const test = await testConnection(cleanUrl, accessToken);
    if (!test.success) {
      return res.status(400).json({ error: `Bağlantı başarısız: ${test.error || test.statusText}` });
    }

    // Save to database
    db.exec('BEGIN');
    try {
      // Set all other shops to inactive
      db.prepare('UPDATE shopify_auth SET is_active = 0').run();

      // Insert or replace shop details
      const stmt = db.prepare(`
        INSERT INTO shopify_auth (shop_url, shop_name, access_token, theme_path, is_active)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(shop_url) DO UPDATE SET
          shop_name = excluded.shop_name,
          access_token = excluded.access_token,
          theme_path = excluded.theme_path,
          is_active = 1
      `);
      stmt.run(cleanUrl, test.shopName, accessToken, themePath || '');
      db.exec('COMMIT');
    } catch (dbErr) {
      db.exec('ROLLBACK');
      throw dbErr;
    }

    res.json({ success: true, shopName: test.shopName });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /collections
 * Fetch collections list
 */
router.get('/collections', async (req, res, next) => {
  try {
    const active = getRawActiveShopify();
    if (!active) {
      return res.status(401).json({ error: 'Shopify bağlantısı aktif değil.' });
    }

    const list = await getCollections(active.shop_url, active.access_token);
    res.json(list);
  } catch (err) {
    next(err);
  }
});
/**
 * POST /collections/create
 * Create a new custom collection in Shopify
 */
router.post('/collections/create', async (req, res, next) => {
  try {
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Collection title is required.' });
    }

    const active = getRawActiveShopify();
    if (!active) {
      return res.status(400).json({ error: 'Active Shopify credentials not found.' });
    }

    const result = await createCollection(active.shop_url, active.access_token, title);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.collection);
  } catch (err) {
    next(err);
  }
});
/**
 * GET /theme/read
 * Read local theme parameters for visual editing
 */
router.get('/theme/read', (req, res, next) => {
  try {
    const active = getRawActiveShopify();
    if (!active || !active.theme_path) {
      return res.status(400).json({ error: 'Tema klasör yolu ayarlanmamış.' });
    }

    const path = active.theme_path;
    const settingsPath = join(path, 'config', 'settings_data.json');
    const indexPath = join(path, 'templates', 'index.json');
    const headerGroupPath = join(path, 'sections', 'header-group.json');

    if (!fs.existsSync(settingsPath) || !fs.existsSync(indexPath)) {
      return res.status(404).json({ error: 'Pitch tema dosyaları klasörde bulunamadı. Lütfen yolu kontrol edin.' });
    }

    const settingsData = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    
    let headerGroupData = null;
    if (fs.existsSync(headerGroupPath)) {
      headerGroupData = JSON.parse(fs.readFileSync(headerGroupPath, 'utf8'));
    }

    // Extract relevant visual parameters for ThemeStudio
    // Colors
    const currentScheme = settingsData.current?.schemes?.['scheme-1']?.settings || {};
    
    // Header Announcements
    let announcements = [];
    if (headerGroupData && headerGroupData.sections) {
      const headerSection = Object.values(headerGroupData.sections).find(s => s.type === 'announcement-bar');
      if (headerSection && headerSection.blocks) {
        announcements = Object.values(headerSection.blocks).map(b => b.settings?.text || '');
      }
    }

    // Hero philosophy title
    let heroTitle = '';
    let heroText = '';
    if (indexData.sections) {
      // Find image-banner or rich-text sections representing the hero area
      const richText = Object.values(indexData.sections).find(s => s.type === 'rich-text');
      if (richText && richText.blocks) {
        const headingBlock = Object.values(richText.blocks).find(b => b.type === 'heading');
        const textBlock = Object.values(richText.blocks).find(b => b.type === 'text');
        heroTitle = headingBlock?.settings?.heading || '';
        heroText = textBlock?.settings?.text || '';
      }
    }

    res.json({
      themePath: path,
      colors: {
        background: currentScheme.background || '',
        text: currentScheme.text || '',
        accent: currentScheme.accent || '',
        border: currentScheme.border || '',
        background_gradient: currentScheme.background_gradient || ''
      },
      announcements,
      hero: {
        title: heroTitle,
        text: heroText
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /theme/write
 * Save visual updates to local theme files
 */
router.post('/theme/write', (req, res, next) => {
  try {
    const active = getRawActiveShopify();
    if (!active || !active.theme_path) {
      return res.status(400).json({ error: 'Tema klasör yolu ayarlanmamış.' });
    }

    const { colors, announcements, hero } = req.body;
    const path = active.theme_path;
    const settingsPath = join(path, 'config', 'settings_data.json');
    const indexPath = join(path, 'templates', 'index.json');
    const headerGroupPath = join(path, 'sections', 'header-group.json');

    if (!fs.existsSync(settingsPath) || !fs.existsSync(indexPath)) {
      return res.status(404).json({ error: 'Tema dosyaları bulunamadı.' });
    }

    // 1. Update Colors in settings_data.json
    const settingsData = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (settingsData.current?.schemes?.['scheme-1']?.settings) {
      const scheme = settingsData.current.schemes['scheme-1'].settings;
      if (colors.background) scheme.background = colors.background;
      if (colors.text) scheme.text = colors.text;
      if (colors.accent) scheme.accent = colors.accent;
      if (colors.border) scheme.border = colors.border;
      if (colors.background_gradient !== undefined) {
        scheme.background_gradient = colors.background_gradient;
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settingsData, null, 2), 'utf8');
    }

    // 2. Update Hero banner details in index.json
    const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (indexData.sections && hero) {
      const richTextKey = Object.keys(indexData.sections).find(k => indexData.sections[k].type === 'rich-text');
      if (richTextKey && indexData.sections[richTextKey].blocks) {
        const blocks = indexData.sections[richTextKey].blocks;
        const headingKey = Object.keys(blocks).find(k => blocks[k].type === 'heading');
        const textKey = Object.keys(blocks).find(k => blocks[k].type === 'text');
        
        if (headingKey && hero.title) {
          blocks[headingKey].settings.heading = hero.title;
        }
        if (textKey && hero.text) {
          blocks[textKey].settings.text = hero.text;
        }
        fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf8');
      }
    }

    // 3. Update Announcements in header-group.json
    if (fs.existsSync(headerGroupPath) && announcements && Array.isArray(announcements)) {
      const headerGroupData = JSON.parse(fs.readFileSync(headerGroupPath, 'utf8'));
      if (headerGroupData.sections) {
        const headerKey = Object.keys(headerGroupData.sections).find(k => headerGroupData.sections[k].type === 'announcement-bar');
        if (headerKey && headerGroupData.sections[headerKey].blocks) {
          const blocks = headerGroupData.sections[headerKey].blocks;
          const blockKeys = Object.keys(blocks);

          // Update texts for existing blocks, ignore extra ones
          announcements.forEach((text, idx) => {
            if (blockKeys[idx]) {
              blocks[blockKeys[idx]].settings.text = text;
            }
          });
          fs.writeFileSync(headerGroupPath, JSON.stringify(headerGroupData, null, 2), 'utf8');
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /publish
 * Publish product to Shopify store
 */
router.post('/publish', async (req, res, next) => {
  try {
    const { productId, collectionId, discountRate = 50 } = req.body;
    if (!productId) {
      return res.status(400).json({ error: 'productId is required.' });
    }

    const active = getRawActiveShopify();
    if (!active) {
      return res.status(401).json({ error: 'Shopify bağlantısı bulunamadı.' });
    }

    // 1. Get product details from DB
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    // Update status to uploading
    db.prepare("UPDATE products SET status = 'uploading' WHERE id = ?").run(productId);

    // 2. Fetch Variation Profile for pricing
    if (!product.variation_profile_id) {
      db.prepare("UPDATE products SET status = 'error' WHERE id = ?").run(productId);
      return res.status(400).json({ error: 'Varyasyon profili seçilmemiş.' });
    }

    const profile = db.prepare('SELECT * FROM variation_profiles WHERE id = ?').get(product.variation_profile_id);
    if (!profile) {
      db.prepare("UPDATE products SET status = 'error' WHERE id = ?").run(productId);
      return res.status(400).json({ error: 'Geçersiz varyasyon profili.' });
    }

    const combinations = JSON.parse(profile.combinations || '[]');
    if (combinations.length === 0) {
      db.prepare("UPDATE products SET status = 'error' WHERE id = ?").run(productId);
      return res.status(400).json({ error: 'Seçili varyasyon profilinde fiyat kombinasyonları tanımlanmamış.' });
    }

    // Calculate discounted prices and compare_at prices
    const rate = parseFloat(discountRate) / 100;
    const finalCombinations = combinations.map(c => {
      const basePrice = parseFloat(c.price || 0);
      return {
        size: c.size,
        frame: c.frame,
        compareAtPrice: basePrice, // Crossed out price
        price: Math.round(basePrice * (1 - rate) * 100) / 100 // Final selling price
      };
    });

    // 3. Collect local images to upload (original image + mockups)
    const imagePaths = [];
    if (product.image_path) {
      const originalPath = join(__dirname, '../..', product.image_path);
      if (fs.existsSync(originalPath)) {
        imagePaths.push(originalPath);
      }
    }

    // Find generated mockups
    const shopStorage = active.shop_name.replace(/[^a-zA-Z0-9_-]/g, '_');
    let mockupsDir = join(__dirname, '../..', 'storage', shopStorage, 'mockups', productId);
    if (!fs.existsSync(mockupsDir)) {
      mockupsDir = join(__dirname, '../..', 'storage/mockups', productId);
    }

    if (fs.existsSync(mockupsDir)) {
      const files = fs.readdirSync(mockupsDir).filter(f => {
        const lower = f.toLowerCase();
        return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png');
      });
      // Şablon Stüdyosu'ndaki oran bazlı dizilim (kapak görseli + galeri sırası)
      orderMockupFiles(files).forEach(f => {
        imagePaths.push(join(mockupsDir, f));
      });
    }

    // 4. Trigger creation
    console.log(`Publishing product ${product.title} to Shopify...`);
    const createdProduct = await createProduct(active.shop_url, active.access_token, {
      title: product.title,
      description: product.description,
      tags: JSON.parse(product.tags || '[]'),
      combinations: finalCombinations,
      imagePaths,
      collectionId
    });

    // 5. Update DB status to live
    db.prepare(`
      UPDATE products 
      SET status = 'live', 
          shopify_product_id = ?, 
          shopify_collection_id = ? 
      WHERE id = ?
    `).run(createdProduct.id.toString(), collectionId || null, productId);

    res.json({ success: true, shopifyId: createdProduct.id });
  } catch (err) {
    db.prepare("UPDATE products SET status = 'error' WHERE id = ?").run(req.body.productId);
    next(err);
  }
});

export default router;
