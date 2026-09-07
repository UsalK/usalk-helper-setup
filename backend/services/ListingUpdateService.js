/**
 * Mevcut bir Etsy listing'ini YERİNDE günceller.
 *
 * ListingUploadService yeni listing açar; bu servis ise var olanı korur.
 * Listing ID, URL, yaşı, favorileri ve satış geçmişi aynı kalır — sadece
 * içeriği yenilenir:
 *   - yeni görselden mockup'lar üretilir (aynı MockupRenderer, aynı şablonlar)
 *   - AI SEO ile başlık / etiket / açıklama yazılır (aynı system prompt)
 *   - istenirse mağaza bölümü AI tarafından seçilir
 *   - listing'in eski görselleri silinip yenileri yüklenir (kapak dahil)
 *   - başlık, açıklama, etiket ve bölüm PATCH edilir
 *   - varyasyon boyutları ve fiyatları yeni orana göre yeniden yazılır
 *   - item_width / item_height temizlenir (varyasyonlu üründe tek ölçü yanıltıcı)
 */

import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db, { getActiveShop, getShopStorageName, getProductStorageFolder, getSetProfileInfo } from '../db/db.js';
import * as EtsyService from './EtsyService.js';
import { generateSEO } from './KimiService.js';
import { getMockupPool } from './MockupPool.js';
import { orderMockupFiles } from './MockupOrder.js';
import { buildInventoryPayload } from './listingShared.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../..');

// Etsy bir listing'de en fazla 20 görsel kabul ediyor
const MAX_LISTING_IMAGES = 20;

/** Ürünün mockup klasörünü bulur (eski düzenlere de bakar). */
function findMockupsDir(productId, shopId) {
  const subPath = getProductStorageFolder(productId);
  let dir = join(PROJECT_ROOT, 'storage', subPath, 'mockups', productId);
  if (fs.existsSync(dir)) return dir;

  const shopName = getShopStorageName(shopId);
  dir = join(PROJECT_ROOT, 'storage', shopName, 'mockups', productId);
  if (fs.existsSync(dir)) return dir;

  dir = join(PROJECT_ROOT, 'storage/mockups', productId);
  return fs.existsSync(dir) ? dir : null;
}

/**
 * Bir listing'i yeni bir görselle günceller.
 *
 * @param {object} input
 *   listingId        — güncellenecek Etsy listing ID'si (zorunlu)
 *   productId        — mockup ve SEO'nun üretileceği yerel ürün kaydı (zorunlu)
 *   autoSection      — true ise bölümü AI seçer
 *   shopSectionId    — sabit bölüm (autoSection false ise)
 *   targetMarket, shopStyle — SEO prompt parametreleri
 *   onStep           — ilerleme bildirimi
 * @returns {Promise<{success, listing_id, url, title, section}>}
 */
export async function updateListingFromProduct(input) {
  const {
    listingId,
    productId,
    autoSection = false,
    shopSectionId = null,
    targetMarket = 'US/UK',
    shopStyle = 'vintage poster, art deco',
    dryRun = false,
    onStep = () => {},
    agentOptions = {}
  } = input;

  if (!listingId) throw new Error('listingId zorunludur.');
  if (!productId) throw new Error('productId zorunludur.');

  const activeShop = getActiveShop();
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND shop_id = ?')
    .get(productId, activeShop.shop_id);
  if (!product) throw new Error('Ürün kaydı bulunamadı.');

  // Yeni görselin oranına atanmış varyasyon profili: hem mockup şablonlarını
  // hem de yazılacak fiyat/boyut kombinasyonlarını belirler.
  let variationProfile = null;
  if (product.variation_profile_id) {
    const row = db.prepare('SELECT * FROM variation_profiles WHERE id = ? AND shop_id = ?')
      .get(product.variation_profile_id, activeShop.shop_id);
    if (row) {
      variationProfile = {
        ...row,
        sizes: JSON.parse(row.sizes || '[]'),
        frames: JSON.parse(row.frames || '[]'),
        combinations: JSON.parse(row.combinations || '[]')
      };
    }
  }

  // 1) Mockup üret — yeni ürün akışıyla birebir aynı motor ve şablonlar
  onStep('Mockup üretiliyor');
  await getMockupPool().render(product, {
    onProgress: ({ done, total }) => onStep(`Mockup ${done}/${total}`)
  });

  // 2) AI SEO — yeni ürün akışıyla birebir aynı system prompt
  onStep('SEO içeriği yazılıyor');
  let sections = null;
  if (autoSection) {
    try {
      sections = await EtsyService.getShopSections();
    } catch (err) {
      console.warn('[Update] Mağaza bölümleri alınamadı, otomatik seçim atlanıyor:', err.message);
    }
  }

  const imageAbs = join(PROJECT_ROOT, product.image_path);
  // Çok panelli profillerde SEO metni set diliyle yazılır
  const setInfo = getSetProfileInfo(product.variation_profile_id, activeShop.shop_id);
  const seo = await generateSEO(imageAbs, targetMarket, shopStyle, activeShop.shop_id, 'etsy', sections, setInfo, {
    ...agentOptions,
    context: agentOptions.context || { type: 'listing_update', productId, listingId, dryRun, uploadAfterCompletion: !dryRun },
    onWaiting: agentOptions.onWaiting || (({ message }) => onStep(message))
  });
  if (agentOptions.isCancelled?.()) {
    const err = new Error('İş iptal edildi.');
    err.code = 'AGENT_CANCELLED';
    throw err;
  }

  // Yerel kaydı da güncelle ki panelde doğru görünsün.
  // ID metin olarak saklanır: node:sqlite JS sayılarını REAL olarak bağlıyor
  // ve "58441250.0" gibi bir değer sonraki metin karşılaştırmalarını bozuyor.
  const rawSectionId = autoSection
    ? (seo.shop_section_id || shopSectionId || null)
    : (shopSectionId || null);
  const finalSectionId = rawSectionId ? String(rawSectionId) : null;

  db.prepare(
    'UPDATE products SET title = ?, tags = ?, description = ?, ai_attributes = ?, shop_section_id = ?, etsy_listing_id = ? WHERE id = ?'
  ).run(
    seo.title || product.title,
    JSON.stringify(seo.tags || []),
    seo.description || '',
    JSON.stringify({
      visual_style: seo.visual_style || [],
      occasion: seo.occasion || [],
      holiday: seo.holiday || [],
      room: seo.room || []
    }),
    finalSectionId,
    String(listingId),
    productId
  );

  // Deneme modu: mockup ve SEO hazırlandı, Etsy'ye hiçbir şey gönderilmiyor.
  // Sonucu Toplu Yükleme Sihirbazı'ndan inceleyip gerçek çalıştırmaya karar verebilirsin.
  if (dryRun) {
    console.log(
      `[Update] DENEME — listing ${listingId} hazır ama gönderilmedi.\n` +
      `  başlık   : ${seo.title}\n` +
      `  bölüm    : ${seo.shop_section_title || '(değişmiyor)'}\n` +
      `  varyasyon: ${variationProfile?.combinations?.length || 0} kombinasyon\n` +
      `  ölçü     : temizlenecek (width/height boşaltılır)`
    );
    return {
      success: true,
      dryRun: true,
      listing_id: listingId,
      title: seo.title,
      section_id: finalSectionId,
      section_title: seo.shop_section_title || null,
      variation_count: variationProfile?.combinations?.length || 0,
      images_uploaded: 0
    };
  }

  // 3) Metin ve ölçü alanlarını güncelle
  onStep('Listing metni güncelleniyor');
  const settings = {};
  db.prepare('SELECT * FROM settings WHERE shop_id = ?').all(activeShop.shop_id)
    .forEach(s => { settings[s.key] = JSON.parse(s.value); });

  const boilerplate = settings.description_boilerplate || '';
  const rawDescription = seo.description || 'Stunning printed wall art.';
  const finalDescription = boilerplate ? `${rawDescription}\n\n${boilerplate}` : rawDescription;

  const patch = {
    title: (seo.title || product.title || 'Untitled Art').substring(0, 140),
    description: finalDescription
  };

  const tags = (seo.tags || [])
    .map(t => t.trim().substring(0, 20))
    .filter(Boolean)
    .slice(0, 13);
  if (tags.length > 0) patch.tags = tags;

  if (finalSectionId) patch.shop_section_id = Number(finalSectionId);

  // Ölçü alanları TEMİZLENİR.
  //
  // Bu varyasyonlu bir listing: aynı görsel 6-14 farklı boyutta satılıyor,
  // dolayısıyla tek bir "ürün genişliği/yüksekliği" değeri zaten yanıltıcı.
  // Üstelik dikey bir üründen yatay bir ürüne geçildiğinde eski ölçü
  // (40x60 inç gibi) olduğu gibi kalıyordu. Boyut bilgisi zaten varyasyon
  // seçeneklerinde yazıyor.
  //
  // null göndermek EtsyService.updateListing tarafından "alanı boşalt" olarak
  // yorumlanır; alanı hiç değiştirmemek isteseydik göndermezdik.
  patch.item_width = null;
  patch.item_height = null;
  patch.item_dimensions_unit = null;

  await EtsyService.updateListing(listingId, patch);

  // 4) Varyasyonları ve fiyatları yenile.
  // Yeni görselin oranı farklıysa (örn. 2:3 -> 12:5) eski boyut/fiyat listesi
  // tamamen geçersiz kalıyordu; profilin kombinasyonları yeniden yazılır.
  if (variationProfile?.combinations?.length > 0) {
    onStep('Varyasyon ve fiyatlar güncelleniyor');
    const inventory = buildInventoryPayload(
      variationProfile,
      productId,
      settings.default_readiness_state_id,
      true
    );

    if (inventory) {
      try {
        await EtsyService.updateListingInventory(listingId, inventory);
        console.log(`[Update] Listing ${listingId}: ${inventory.products.length} varyasyon kombinasyonu yazıldı.`);
      } catch (invErr) {
        console.error(`[Update] Varyasyonlar güncellenemedi (${listingId}):`, invErr.response?.data || invErr.message);
      }
    }
  }

  // 5) Görselleri değiştir.
  //
  // Sıra önemli: önce YENİ kapak görseli 1. sıraya yüklenir, sonra tüm eski
  // görseller silinir, en son kalan yeni görseller eklenir. Böylece listing
  // hiçbir an görselsiz kalmaz (Etsy bunu reddeder) ve kapak görseli
  // kesinlikle yeni üründen olur — eskiden eski kapak sağ kalıyordu.
  onStep('Görseller yükleniyor');
  const mockupsDir = findMockupsDir(productId, activeShop.shop_id);
  let uploadedCount = 0;

  if (mockupsDir) {
    const files = fs.readdirSync(mockupsDir).filter(f => {
      const l = f.toLowerCase();
      return l.endsWith('.jpg') || l.endsWith('.jpeg') || l.endsWith('.png');
    });

    if (files.length > 0) {
      const oldImages = await EtsyService.getListingImages(listingId);
      const ordered = orderMockupFiles(files, { shopId: activeShop.shop_id });
      const willUpload = ordered.slice(0, MAX_LISTING_IMAGES);

      // Kapak için yer aç: listing zaten doluysa bir eski görsel silinir
      let oldIndex = 0;
      if (oldImages.length >= MAX_LISTING_IMAGES) {
        try {
          await EtsyService.deleteListingImage(listingId, oldImages[oldIndex].listing_image_id);
          oldIndex++;
        } catch (err) {
          console.warn('[Update] Kapak için yer açılamadı:', err.response?.data || err.message);
        }
      }

      // Yeni kapak görseli
      await EtsyService.uploadListingImage(listingId, join(mockupsDir, willUpload[0]), 1, patch.title);
      uploadedCount++;

      // Tüm eski görselleri sil
      let deletedCount = 0;
      for (let i = oldIndex; i < oldImages.length; i++) {
        try {
          await EtsyService.deleteListingImage(listingId, oldImages[i].listing_image_id);
          deletedCount++;
        } catch (err) {
          console.warn(`[Update] Eski görsel silinemedi (${oldImages[i].listing_image_id}):`, err.response?.data || err.message);
        }
      }

      // Kalan yeni görseller
      for (let i = 1; i < willUpload.length; i++) {
        try {
          await EtsyService.uploadListingImage(listingId, join(mockupsDir, willUpload[i]), i + 1, patch.title);
          uploadedCount++;
        } catch (err) {
          console.warn(`[Update] Görsel yüklenemedi (${willUpload[i]}):`, err.response?.data || err.message);
        }
      }

      const skipped = ordered.length - willUpload.length;
      console.log(
        `[Update] Listing ${listingId}: ${uploadedCount}/${ordered.length} yeni görsel yüklendi, ` +
        `${deletedCount + oldIndex} eski görsel silindi.` +
        (skipped > 0 ? ` ${skipped} mockup Etsy'nin ${MAX_LISTING_IMAGES} görsel sınırı nedeniyle atlandı.` : '')
      );
    }
  }

  if (uploadedCount === 0) {
    console.warn(`[Update] Listing ${listingId} için mockup bulunamadı, görseller değiştirilmedi.`);
  }

  db.prepare('UPDATE products SET status = ? WHERE id = ?').run('live', productId);

  // Analiz önbelleğini de tazele ki panelde yeni başlık görünsün
  try {
    db.prepare('UPDATE etsy_analytics_cache SET title = ?, shop_section_id = ? WHERE listing_id = ?')
      .run(patch.title, finalSectionId ? String(finalSectionId) : null, String(listingId));
  } catch { /* önbellek kaydı yoksa sorun değil */ }

  return {
    success: true,
    listing_id: listingId,
    url: `https://www.etsy.com/listing/${listingId}`,
    title: patch.title,
    section_id: finalSectionId,
    section_title: seo.shop_section_title || null,
    images_uploaded: uploadedCount
  };
}
