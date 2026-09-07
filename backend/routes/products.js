import express from 'express';
import multer from 'multer';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import db, { getActiveShop, getShopStorageName, getPlatformUploadPath, getRawActiveShopify, getProductStorageFolder } from '../db/db.js';

const router = express.Router();
const __dirname = dirname(fileURLToPath(import.meta.url));

// Configure multer for product uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const platform = req.query.platform || 'etsy';
    const subPath = getPlatformUploadPath(platform);
    const destDir = join(__dirname, '../..', 'storage', subPath, 'uploads');
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    cb(null, destDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = file.originalname.split('.').pop();
    cb(null, `product-${uniqueSuffix}.${ext}`);
  }
});
const upload = multer({ storage });

// Get all products
router.get('/', (req, res, next) => {
  try {
    const { shop_section_id, platform } = req.query;
    
    // Determine active shop dynamically by platform
    let shopId = 'default_shop';
    if (platform === 'shopify') {
      const activeShopify = getRawActiveShopify();
      shopId = activeShopify ? activeShopify.shop_url : 'default_shopify';
    } else {
      const activeEtsy = getActiveShop();
      shopId = activeEtsy.shop_id;
    }
    
    let sql = 'SELECT * FROM products WHERE shop_id = ?';
    const params = [shopId];
    if (shop_section_id) {
      sql += ' AND shop_section_id = ?';
      params.push(shop_section_id);
    }
    sql += ' ORDER BY created_at DESC';
    
    const stmt = db.prepare(sql);
    const products = stmt.all(...params);
    
    const parsed = products.map(p => {
      const subPath = getProductStorageFolder(p.id);
      let mockupsDir = join(__dirname, '../..', 'storage', subPath, 'mockups', p.id);
      if (!fs.existsSync(mockupsDir)) {
        // Fallback checks
        const shopName = getShopStorageName(p.shop_id);
        mockupsDir = join(__dirname, '../..', 'storage', shopName, 'mockups', p.id);
        if (!fs.existsSync(mockupsDir)) {
          mockupsDir = join(__dirname, '../..', 'storage/mockups', p.id);
        }
      }
      
      let mockupCount = 0;
      if (fs.existsSync(mockupsDir)) {
        mockupCount = fs.readdirSync(mockupsDir).filter(f => {
          const lower = f.toLowerCase();
          return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png');
        }).length;
      }
      
      return {
        ...p,
        tags: p.tags ? JSON.parse(p.tags) : [],
        ai_attributes: p.ai_attributes ? JSON.parse(p.ai_attributes) : null,
        template_ids: p.template_ids ? JSON.parse(p.template_ids) : [],
        mockup_count: mockupCount
      };
    });
    
    res.json(parsed);
  } catch (err) {
    next(err);
  }
});

// Upload multiple products
router.post('/upload', upload.array('images'), (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    
    const platform = req.query.platform || 'etsy';
    let shopId = 'default_shop';
    if (platform === 'shopify') {
      const activeShopify = getRawActiveShopify();
      shopId = activeShopify ? activeShopify.shop_url : 'default_shopify';
    } else {
      const activeEtsy = getActiveShop();
      shopId = activeEtsy.shop_id;
    }

    const subPath = getPlatformUploadPath(platform);
    const stmt = db.prepare(
      'INSERT INTO products (id, shop_id, image_path, title, tags, description, ai_attributes, template_ids, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    
    const newProducts = [];
    
    db.exec('BEGIN');
    try {
      for (const file of req.files) {
        const id = uuidv4();
        const imagePath = `storage/${subPath.replace(/\\/g, '/')}/uploads/${file.filename}`;
        
        // Base title is filename without extension
        const title = file.originalname.replace(/\.[^/.]+$/, "").substring(0, 140);
        
        stmt.run(
          id,
          shopId,
          imagePath,
          title,
          JSON.stringify([]),
          '',
          JSON.stringify({
            visual_style: [],
            occasion: [],
            holiday: [],
            room: []
          }),
          JSON.stringify([]),
          'draft'
        );
        
        newProducts.push({
          id,
          shop_id: shopId,
          image_path: imagePath,
          title,
          tags: [],
          description: '',
          ai_attributes: {
            visual_style: [],
            occasion: [],
            holiday: [],
            room: []
          },
          template_ids: [],
          status: 'draft'
        });
      }
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }
    
    res.json(newProducts);
  } catch (err) {
    next(err);
  }
});

// Update product
router.put('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, tags, description, ai_attributes, variation_profile_id, template_ids, status, etsy_listing_id, shop_section_id } = req.body;
    
    const checkStmt = db.prepare('SELECT id FROM products WHERE id = ?');
    const productExists = checkStmt.get(id);
    if (!productExists) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    const updateStmt = db.prepare(
      `UPDATE products 
       SET title = ?, 
           tags = ?, 
           description = ?, 
           ai_attributes = ?, 
           variation_profile_id = ?, 
           template_ids = ?, 
           status = ?, 
           etsy_listing_id = ?,
           shop_section_id = ?
       WHERE id = ?`
     );
    
    updateStmt.run(
      title !== undefined ? title : '',
      tags ? JSON.stringify(tags) : JSON.stringify([]),
      description !== undefined ? description : '',
      ai_attributes ? JSON.stringify(ai_attributes) : JSON.stringify({}),
      variation_profile_id || null,
      template_ids ? JSON.stringify(template_ids) : JSON.stringify([]),
      status || 'draft',
      etsy_listing_id || null,
      shop_section_id || null,
      id
    );
    
    res.json({ id, success: true });
  } catch (err) {
    next(err);
  }
});

// Delete product
router.delete('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    
    const getStmt = db.prepare('SELECT * FROM products WHERE id = ?');
    const product = getStmt.get(id);
    
    if (product) {
      if (product.image_path) {
        const fullPath = join(__dirname, '../..', product.image_path);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }
      
      // Delete generated mockups directory if it exists
      const subPath = getProductStorageFolder(id);
      const shopMockupsDir = join(__dirname, '../..', 'storage', subPath, 'mockups', id);
      if (fs.existsSync(shopMockupsDir)) {
        fs.rmSync(shopMockupsDir, { recursive: true, force: true });
      }
      const oldMockupsDir = join(__dirname, '../..', 'storage/mockups', id);
      if (fs.existsSync(oldMockupsDir)) {
        fs.rmSync(oldMockupsDir, { recursive: true, force: true });
      }
      
      // Delete digital files directory if it exists (using subPath as well)
      const digitalDir = join(__dirname, '../..', 'storage', subPath, 'digital_files', id);
      if (fs.existsSync(digitalDir)) {
        fs.rmSync(digitalDir, { recursive: true, force: true });
      }
      const oldDigitalDir = join(__dirname, '../..', 'storage/digital_files', product.shop_id, id);
      if (fs.existsSync(oldDigitalDir)) {
        fs.rmSync(oldDigitalDir, { recursive: true, force: true });
      }
      
      const deleteStmt = db.prepare('DELETE FROM products WHERE id = ?');
      deleteStmt.run(id);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Product not found' });
    }
  } catch (err) {
    next(err);
  }
});

// Upload digital file for a product (max 20MB)
router.post('/:id/digital-file', (req, res, next) => {
  return res.status(403).json({ error: 'Dijital ürün desteği geçici olarak devre dışı bırakılmıştır.' });
});

// Batch update variation profile for multiple products
router.post('/batch-variation-profile', (req, res, next) => {
  try {
    const { productIds, variation_profile_id } = req.body;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: 'productIds (array) is required' });
    }
    
    const activeShop = getActiveShop();
    const profileId = variation_profile_id || null;
    
    db.exec('BEGIN');
    try {
      const updateStmt = db.prepare('UPDATE products SET variation_profile_id = ? WHERE (id = ? OR etsy_listing_id = ?) AND shop_id = ?');
      const insertStmt = db.prepare(`
        INSERT INTO products (id, shop_id, etsy_listing_id, variation_profile_id, status)
        VALUES (?, ?, ?, ?, 'live')
      `);
      const checkStmt = db.prepare('SELECT id FROM products WHERE (id = ? OR etsy_listing_id = ?) AND shop_id = ?');
      
      let updatedCount = 0;
      for (const id of productIds) {
        const idStr = id.toString();
        const existing = checkStmt.get(idStr, idStr, activeShop.shop_id);
        if (existing) {
          const info = updateStmt.run(profileId, idStr, idStr, activeShop.shop_id);
          updatedCount += info.changes;
        } else {
          // Create linked record for Etsy listing if not existing in products table
          const newId = uuidv4();
          insertStmt.run(newId, activeShop.shop_id, idStr, profileId);
          updatedCount += 1;
        }
      }
      db.exec('COMMIT');
      res.json({ success: true, updatedCount });
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    next(err);
  }
});

// Open mockups folder in file explorer
router.post('/:id/open-folder', (req, res, next) => {
  try {
    const { id } = req.params;
    const activeShop = getActiveShop();
    const shopName = getShopStorageName(activeShop.shop_id);
    
    let mockupsDir = join(__dirname, '../..', 'storage', shopName, 'mockups', id);
    if (!fs.existsSync(mockupsDir)) {
      mockupsDir = join(__dirname, '../..', 'storage/mockups', id);
    }

    if (!fs.existsSync(mockupsDir)) {
      return res.status(404).json({ error: 'Mockup klasörü henüz oluşturulmamış.' });
    }

    exec(`explorer "${mockupsDir}"`);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
