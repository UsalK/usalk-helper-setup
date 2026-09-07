import express from 'express';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db, { getActiveShop, getSetProfileInfo } from '../db/db.js';
import { generateSEO } from '../services/KimiService.js';

const router = express.Router();
const __dirname = dirname(fileURLToPath(import.meta.url));

router.get('/agent-guide', (req, res) => {
  const guidePath = join(__dirname, '../../agent-help.md');
  if (!fs.existsSync(guidePath)) {
    return res.status(404).json({ error: `Agent rehberi bulunamadı: ${guidePath}` });
  }
  res.json({
    guidePath,
    prompt: `Önce şu dosyayı tamamen oku: "${guidePath}". usalk-helper üzerinden görsel yükleme, varyasyon eşleme, mockup oluşturma, SEO, section seçimi ve Etsy yayınlama akışını bu rehbere göre yürüt. Yalnızca bu görevde belirttiğim görselleri ve mağazaları işle; kapsam verilmemişse önce bunları sor. Kritik: geçerli kargo profili, eksiksiz fiyatlar ve ürünün gerçek mockupları yoksa yükleme yapma. Statik description ve görselleri sınıflandırmaya yeterli section bulunduğunu doğrula. Aktif AI Modeli ayarının kaydedilmiş değerini oku: AI Agent (desktop-agent) seçiliyse görseli kendin inceleyip SEO'yu bizzat oluştur ve agentSeo köprüsüyle teslim et; bir model seçiliyse uygulamanın OpenRouter çağrısını kullan, SEO'yu kendin yazma ve modeli değiştirme. Önce yerel hazırlık ve kontrolleri tamamla; ardından aynı ürünleri listing_state: active ile yükle ve Etsy'de gerçekten active olduklarını doğrula. Hazırlıkta oluşturduğun ürünleri yeniden create işine gönderme. Tüm akışı tamamla; ilgisiz ayarları değiştirme.`
  });
});

router.post('/generate', async (req, res, next) => {
  const controller = new AbortController();
  const onClose = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', onClose);
  try {
    const { productId, targetMarket, shopStyle } = req.body;
    
    if (!productId) {
      return res.status(400).json({ error: 'productId is required' });
    }
    
    // Get product from DB
    const getStmt = db.prepare('SELECT * FROM products WHERE id = ?');
    const product = getStmt.get(productId);
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    if (!product.image_path) {
      return res.status(400).json({ error: 'Ürünün görsel yolu veritabanında tanımlı değil.' });
    }
    
    const imagePath = join(__dirname, '../..', product.image_path);
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: `Ürün görsel dosyası disk üzerinde bulunamadı (${product.image_path}).` });
    }
    
    const platform = product.shop_id.includes('.myshopify.com') ? 'shopify' : 'etsy';
    
    // Çok panelli profillerde SEO metni set diliyle yazılır
    const setInfo = getSetProfileInfo(product.variation_profile_id, product.shop_id);

    // Call Kimi service for physical wall art SEO
    const seoData = await generateSEO(imagePath, targetMarket, shopStyle, product.shop_id, platform, null, setInfo, {
      signal: controller.signal,
      context: { type: 'manual_seo', productId, uploadAfterCompletion: false }
    });
    if (controller.signal.aborted) return;
    
    // Extract info
    const title = seoData.title || '';
    const tags = JSON.stringify(seoData.tags || []);
    const description = seoData.description || seoData.description_hook || '';
    const ai_attributes = JSON.stringify({
      visual_style: seoData.visual_style || [],
      occasion: seoData.occasion || [],
      holiday: seoData.holiday || [],
      room: seoData.room || []
    });
    
    // Update product in DB
    const updateStmt = db.prepare(
      'UPDATE products SET title = ?, tags = ?, description = ?, ai_attributes = ? WHERE id = ?'
    );
    updateStmt.run(title, tags, description, ai_attributes, productId);
    
    res.json({
      id: productId,
      title,
      tags: seoData.tags || [],
      description,
      ai_attributes: {
        visual_style: seoData.visual_style || [],
        occasion: seoData.occasion || [],
        holiday: seoData.holiday || [],
        room: seoData.room || []
      },
      _meta: seoData._meta || null
    });
  } catch (err) {
    if (controller.signal.aborted) return;
    console.error("SEO Generation Error:", err);
    next(err);
  } finally {
    res.off('close', onClose);
  }
});

export default router;
