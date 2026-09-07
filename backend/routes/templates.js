import express from 'express';
import multer from 'multer';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db, { getActiveShop, getShopStorageName } from '../db/db.js';
import { exportTemplatesToSeed } from '../services/TemplateSync.js';
import {
  getMockupOrderConfig,
  saveRatioOrder,
  saveMockupOrderConfig,
  previewRatioOrder,
  invalidateTemplateCache,
  DEFAULT_RATIO_ORDER
} from '../services/MockupOrder.js';

const router = express.Router();
const __dirname = dirname(fileURLToPath(import.meta.url));

// Configure multer for template backgrounds
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const activeShop = getActiveShop();
    const shopName = getShopStorageName(activeShop.shop_id);
    const destDir = join(__dirname, '../..', 'storage', shopName, 'templates');
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    cb(null, destDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = file.originalname.split('.').pop();
    cb(null, `template-${uniqueSuffix}.${ext}`);
  }
});
const upload = multer({ storage });

// Get all templates
router.get('/', (req, res, next) => {
  try {
    const activeShop = getActiveShop();
    const stmt = db.prepare('SELECT * FROM templates WHERE shop_id = ? ORDER BY created_at DESC');
    const templates = stmt.all(activeShop.shop_id);
    
    // Parse config JSON strings
    const parsed = templates.map(t => ({
      ...t,
      config: JSON.parse(t.config)
    }));
    res.json(parsed);
  } catch (err) {
    next(err);
  }
});

// Create new template
router.post('/', upload.single('background'), (req, res, next) => {
  try {
    const { name, type, config } = req.body;
    const id = uuidv4();
    const activeShop = getActiveShop();
    const shopName = getShopStorageName(activeShop.shop_id);
    const background_path = req.file ? `storage/${shopName}/templates/${req.file.filename}` : '';
    
    const stmt = db.prepare(
      'INSERT INTO templates (id, shop_id, name, type, config, background_path) VALUES (?, ?, ?, ?, ?, ?)'
    );
    stmt.run(id, activeShop.shop_id, name, type, config, background_path);
    exportTemplatesToSeed();
    invalidateTemplateCache();
    
    res.json({ id, shop_id: activeShop.shop_id, name, type, config: JSON.parse(config), background_path });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------- */
/* Mockup dizilim ayarları (Şablon Stüdyosu → Mockup Sıralaması)      */
/* ---------------------------------------------------------------- */

// Tüm oranların dizilim ayarı
router.get('/mockup-order', (req, res, next) => {
  try {
    res.json({
      config: getMockupOrderConfig(),
      defaults: DEFAULT_RATIO_ORDER
    });
  } catch (err) {
    next(err);
  }
});

// Dizilim ayarını kaydet: tek oran ({ ratio, order }) veya tümü ({ config })
router.put('/mockup-order', (req, res, next) => {
  try {
    const { ratio, order, config } = req.body || {};

    if (ratio && order) {
      const saved = saveRatioOrder(ratio, order);
      return res.json({ success: true, ratio, order: saved });
    }

    if (config && typeof config === 'object') {
      const saved = saveMockupOrderConfig(config);
      return res.json({ success: true, config: saved });
    }

    res.status(400).json({ error: 'ratio + order veya config gövdesi gereklidir.' });
  } catch (err) {
    next(err);
  }
});

// Bir oranın dizilimini gerçek algoritmayla önizler (ürün yüklemeye gerek yok)
router.post('/mockup-order/preview', (req, res, next) => {
  try {
    const { ratio, order } = req.body || {};
    if (!ratio) return res.status(400).json({ error: 'ratio gereklidir.' });

    const items = previewRatioOrder(ratio, order || null);
    res.json({ ratio, count: items.length, items });
  } catch (err) {
    next(err);
  }
});

// Delete template
router.delete('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const activeShop = getActiveShop();
    
    // Get background path to delete the file
    const getStmt = db.prepare('SELECT background_path FROM templates WHERE id = ? AND shop_id = ?');
    const template = getStmt.get(id, activeShop.shop_id);
    
    if (template && template.background_path) {
      const fullPath = join(__dirname, '../..', template.background_path);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }
    
    const stmt = db.prepare('DELETE FROM templates WHERE id = ? AND shop_id = ?');
    stmt.run(id, activeShop.shop_id);
    exportTemplatesToSeed();
    invalidateTemplateCache();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Get all templates from other shops
router.get('/other-shops', (req, res, next) => {
  try {
    const activeShop = getActiveShop();
    const stmt = db.prepare('SELECT templates.*, etsy_auth.shop_name FROM templates LEFT JOIN etsy_auth ON templates.shop_id = etsy_auth.shop_id WHERE templates.shop_id != ? OR templates.shop_id IS NULL ORDER BY templates.created_at DESC');
    const templates = stmt.all(activeShop.shop_id);
    const parsed = templates.map(t => ({
      ...t,
      config: JSON.parse(t.config),
      shop_name: t.shop_name || 'Global / Varsayılan'
    }));
    res.json(parsed);
  } catch (err) {
    next(err);
  }
});

// Copy template(s) from another shop to the active shop
router.post('/copy', (req, res, next) => {
  try {
    const { templateId, templateIds } = req.body;
    const idsToCopy = [];
    if (templateId) idsToCopy.push(templateId);
    if (templateIds && Array.isArray(templateIds)) {
      idsToCopy.push(...templateIds);
    }
    
    if (idsToCopy.length === 0) {
      return res.status(400).json({ error: 'templateId or templateIds array is required' });
    }
    
    const activeShop = getActiveShop();
    const getStmt = db.prepare('SELECT * FROM templates WHERE id = ?');
    const insertStmt = db.prepare(
      'INSERT INTO templates (id, shop_id, name, type, config, background_path) VALUES (?, ?, ?, ?, ?, ?)'
    );
    
    const copied = [];
    
    db.exec('BEGIN');
    try {
      for (const idToCopy of idsToCopy) {
        const sourceTemplate = getStmt.get(idToCopy);
        if (!sourceTemplate) continue;
        
        let newBackgroundPath = '';
        if (sourceTemplate.background_path) {
          const srcFullPath = join(__dirname, '../..', sourceTemplate.background_path);
          if (fs.existsSync(srcFullPath)) {
            const activeShopName = getShopStorageName(activeShop.shop_id);
            const ext = sourceTemplate.background_path.split('.').pop();
            const newFilename = `template-copy-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
            newBackgroundPath = `storage/${activeShopName}/templates/${newFilename}`;
            const destFullPath = join(__dirname, '../..', newBackgroundPath);
            
            // Ensure destination directory exists
            const destDir = join(__dirname, '../..', 'storage', activeShopName, 'templates');
            if (!fs.existsSync(destDir)) {
              fs.mkdirSync(destDir, { recursive: true });
            }
            
            fs.copyFileSync(srcFullPath, destFullPath);
          }
        }
        
        const newId = uuidv4();
        insertStmt.run(newId, activeShop.shop_id, `${sourceTemplate.name} (Kopya)`, sourceTemplate.type, sourceTemplate.config, newBackgroundPath);
        copied.push({
          id: newId,
          name: `${sourceTemplate.name} (Kopya)`
        });
      }
      db.exec('COMMIT');
      exportTemplatesToSeed();
    invalidateTemplateCache();
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }
    
    res.json({ success: true, copied });
  } catch (err) {
    next(err);
  }
});

// Update template config
router.patch('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const { config } = req.body;
    const activeShop = getActiveShop();
    
    const stmt = db.prepare('UPDATE templates SET config = ? WHERE id = ? AND shop_id = ?');
    stmt.run(JSON.stringify(config), id, activeShop.shop_id);
    exportTemplatesToSeed();
    invalidateTemplateCache();
    
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
