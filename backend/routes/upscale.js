import express from 'express';
import { findSourceByListing } from '../services/OrderSources.js';
import * as Upscale from '../services/UpscaleService.js';

const router = express.Router();

// shop_id: siparişin mağazası; çıktı storage/etsy/<Mağaza>/upscaled'a yazılır.
// Verilmezse aktif mağaza kullanılır.
const shopOf = (req) => String(req.query.shop_id || req.body?.shop_id || '') || null;

router.get('/config', (req, res) => {
  res.json(Upscale.engineInfo());
});

// Siparişteki listingin upscale durumu (idle | queued | running | done | error | unavailable)
router.get('/status', (req, res) => {
  const src = findSourceByListing(req.query.listing_id);
  if (!src.absPath) return res.json({ status: 'unavailable', source: src.source });
  res.json(Upscale.getJob(src.absPath, shopOf(req)));
});

// force: true -> upscale edilmiş hali olsa da yeniden üret
router.post('/', (req, res) => {
  if (!Upscale.isConfigured()) {
    return res.status(400).json({ error: 'Upscale motoru yapılandırılmamış (backend .env: UPSCALE_ENGINE / UPSCALE_SCRIPT / UPSCALE_COMMAND).' });
  }
  const src = findSourceByListing(req.body?.listing_id);
  if (!src.absPath) return res.status(404).json({ error: 'Bu ürünün kaynak görseli diskte yok.' });
  res.json(Upscale.startJob(src.absPath, shopOf(req), { force: Boolean(req.body?.force) }));
});

router.get('/download', (req, res) => {
  const src = findSourceByListing(req.query.listing_id);
  if (!src.absPath) return res.status(404).json({ error: 'Kaynak görsel yok.' });
  const job = Upscale.getJob(src.absPath, shopOf(req));
  if (job.status !== 'done') return res.status(404).json({ error: 'Upscale edilmiş dosya bulunamadı (silinmiş olabilir).' });
  // Dosya kontrol ile gönderim arasında silinirse de düzgün yanıt ver
  res.download(Upscale.outputPathFor(src.absPath, shopOf(req)), job.output_name, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Upscale edilmiş dosya bulunamadı (silinmiş olabilir).' });
  });
});

export default router;
