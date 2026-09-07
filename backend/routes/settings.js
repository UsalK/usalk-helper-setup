import express from 'express';
import db, { getActiveShop } from '../db/db.js';

const router = express.Router();

// Get all settings
router.get('/', (req, res, next) => {
  try {
    const activeShop = getActiveShop();
    const stmt = db.prepare('SELECT * FROM settings WHERE shop_id = ?');
    const settings = stmt.all(activeShop.shop_id);
    const result = {};
    settings.forEach(s => {
      result[s.key] = JSON.parse(s.value);
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Update or set setting
router.post('/', (req, res, next) => {
  try {
    const settings = req.body; // Key-value pairs
    const activeShop = getActiveShop();
    const stmt = db.prepare(
      'INSERT INTO settings (shop_id, key, value) VALUES (?, ?, ?) ON CONFLICT(shop_id, key) DO UPDATE SET value = ?'
    );
    
    db.exec('BEGIN');
    try {
      for (const [key, val] of Object.entries(settings)) {
        const valStr = JSON.stringify(val);
        stmt.run(activeShop.shop_id, key, valStr, valStr);
      }
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }
    
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
