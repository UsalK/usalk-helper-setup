import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import db, { getActiveShop, getShopStorageName, getProductStorageFolder } from '../db/db.js';

const router = express.Router();
const __dirname = dirname(fileURLToPath(import.meta.url));

router.post('/save', (req, res, next) => {
  try {
    const { productId, templateId, ratio, image } = req.body;
    
    if (!productId || !templateId || !ratio || !image) {
      return res.status(400).json({ error: 'Missing parameters. productId, templateId, ratio, and image are required.' });
    }
    
    // Create product mockups folder if it doesn't exist
    const subPath = getProductStorageFolder(productId);
    const productMockupDir = join(__dirname, '../..', 'storage', subPath, 'mockups', productId);
    if (!fs.existsSync(productMockupDir)) {
      fs.mkdirSync(productMockupDir, { recursive: true });
    }
    
    // Clean base64 string
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');
    
    const cleanRatio = ratio.replace(':', '-');
    const filePath = join(productMockupDir, `${templateId}_${cleanRatio}.jpg`);
    fs.writeFileSync(filePath, buffer);
    
    res.json({ success: true, path: `storage/${subPath.replace(/\\/g, '/')}/mockups/${productId}/${templateId}_${cleanRatio}.jpg` });
  } catch (err) {
    next(err);
  }
});

// List all mockups generated for a product
router.get('/list/:productId', (req, res, next) => {
  try {
    const { productId } = req.params;
    const activeShop = getActiveShop();
    const subPath = getProductStorageFolder(productId);
    const productMockupDir = join(__dirname, '../..', 'storage', subPath, 'mockups', productId);
    
    if (!fs.existsSync(productMockupDir)) {
      return res.json([]);
    }
    
    const files = fs.readdirSync(productMockupDir).filter(f => {
      const lower = f.toLowerCase();
      return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png');
    });
    
    const mockups = files.map(file => {
      return {
        filename: file,
        url: `http://localhost:3001/storage/${subPath.replace(/\\/g, '/')}/mockups/${productId}/${file}`
      };
    });
    
    res.json(mockups);
  } catch (err) {
    next(err);
  }
});

// Delete a mockup file
router.delete('/delete/:productId/:filename', (req, res, next) => {
  try {
    const { productId, filename } = req.params;
    const activeShop = getActiveShop();
    const subPath = getProductStorageFolder(productId);
    const filePath = join(__dirname, '../..', 'storage', subPath, 'mockups', productId, filename);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Mockup file not found' });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
