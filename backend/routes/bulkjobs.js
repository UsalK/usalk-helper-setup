import express from 'express';
import fs from 'fs';
import { join, extname, basename } from 'path';
import db from '../db/db.js';
import { createJob, getJob, listActiveJobs, cancelJob } from '../services/BulkJobService.js';
import { pickImages, pickFolder, getLastDir } from '../services/FilePicker.js';

const router = express.Router();

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * GET /api/bulk-jobs/browse?path=C:\...
 * Klasör seçimi için basit dizin tarayıcı. Tarayıcı güvenlik nedeniyle
 * gerçek klasör yolunu vermediğinden, kullanıcı yolu buradan gezerek seçer.
 * Sadece okuma yapar.
 */
router.get('/browse', (req, res, next) => {
  try {
    const target = req.query.path;

    // Yol verilmediyse sürücü listesini döndür
    if (!target) {
      const drives = [];
      for (const letter of 'CDEFGHIJKL') {
        const root = `${letter}:\\`;
        try {
          if (fs.existsSync(root)) drives.push({ name: root, path: root, type: 'drive' });
        } catch { /* erişilemeyen sürücüyü atla */ }
      }
      return res.json({ path: null, parent: null, entries: drives, imageCount: 0 });
    }

    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      return res.status(404).json({ error: 'Klasör bulunamadı.' });
    }

    let raw;
    try {
      raw = fs.readdirSync(target, { withFileTypes: true });
    } catch (err) {
      return res.status(403).json({ error: 'Klasör okunamadı: ' + err.message });
    }

    const entries = raw
      .filter(d => d.isDirectory() && !d.name.startsWith('$') && !d.name.startsWith('.'))
      .map(d => ({ name: d.name, path: join(target, d.name), type: 'dir' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

    const images = raw
      .filter(d => d.isFile() && IMAGE_EXT.includes(extname(d.name).toLowerCase()))
      .map(d => d.name)
      .sort();

    const parentPath = join(target, '..');
    const parent = parentPath !== target ? parentPath : null;

    res.json({
      path: target,
      parent,
      entries,
      imageCount: images.length,
      images: images.slice(0, 200)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/bulk-jobs/pick — yerel Windows dosya/klasör seçicisini açar.
 * Body: { mode: 'files' | 'folder' }
 */
router.post('/pick', async (req, res, next) => {
  try {
    const mode = req.body?.mode === 'folder' ? 'folder' : 'files';
    const result = mode === 'folder' ? await pickFolder() : await pickImages();
    res.json(result);
  } catch (err) {
    console.error('[FilePicker] Seçici açılamadı:', err.message);
    res.status(500).json({ error: 'Dosya seçici açılamadı: ' + err.message });
  }
});

/** GET /api/bulk-jobs/last-dir — en son kullanılan klasör */
router.get('/last-dir', (req, res) => {
  res.json({ folder: getLastDir() });
});

/** POST /api/bulk-jobs — yeni toplu iş başlatır (oluşturma veya güncelleme) */
router.post('/', (req, res, next) => {
  try {
    const { sourceFolder, filePaths, config, mode, targetListingIds } = req.body;
    const job = createJob({
      sourceFolder,
      filePaths,
      config: config || {},
      mode: mode === 'update' ? 'update' : 'create',
      targetListingIds
    });
    res.json(job);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** GET /api/bulk-jobs — aktif ve yakın zamanda biten işler (widget bunu yoklar) */
router.get('/', (req, res, next) => {
  try {
    res.json(listActiveJobs());
  } catch (err) {
    next(err);
  }
});

/** GET /api/bulk-jobs/:id */
router.get('/:id', (req, res, next) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'İş bulunamadı.' });
    res.json(job);
  } catch (err) {
    next(err);
  }
});

/** POST /api/bulk-jobs/:id/cancel */
router.post('/:id/cancel', (req, res, next) => {
  try {
    res.json(cancelJob(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** DELETE /api/bulk-jobs/:id — biten işi listeden kaldırır (kayıtları siler) */
router.delete('/:id', (req, res, next) => {
  try {
    const job = db.prepare('SELECT status FROM bulk_jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'İş bulunamadı.' });
    if (job.status === 'running') {
      return res.status(400).json({ error: 'Çalışan iş silinemez, önce iptal edin.' });
    }
    db.prepare('DELETE FROM bulk_job_items WHERE job_id = ?').run(req.params.id);
    db.prepare('DELETE FROM bulk_jobs WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
