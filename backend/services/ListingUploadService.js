/**
 * Etsy listing yükleme pipeline'ı.
 *
 * Bu kod daha önce routes/etsy.js içindeki POST /upload-listing handler'ının
 * gövdesiydi; olduğu gibi buraya taşındı. Hem o route hem de toplu değiştirme
 * iş kuyruğu (services/BulkJobService.js) artık AYNI fonksiyonu çağırır, böylece
 * tek bir yükleme davranışı vardır: aynı varsayılan ayarlar, aynı taksonomi
 * attribute'ları, aynı thumbnail seçimi, aynı varyasyon envanteri.
 */

import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db, { getActiveShop, getShopStorageName, getProductStorageFolder } from '../db/db.js';
import * as EtsyService from './EtsyService.js';
import { orderMockupFiles } from './MockupOrder.js';
import { DEFAULT_LISTING_QUANTITY } from './listingShared.js';
import {
  STYLE_MAPPING,
  OCCASION_MAPPING,
  HOLIDAY_MAPPING,
  ROOM_MAPPING,
  MATERIALS_MAPPING
} from '../config/etsyTaxonomy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Route katmanının HTTP durum koduna çevirebilmesi için işaretli hata. */
function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Bir taslak ürünü Etsy'ye yükler: listing oluşturur, taksonomi attribute'larını
 * yazar, mockup'ları sıralayıp gönderir, varyasyon envanterini kurar ve
 * gerekiyorsa listing'i aktifleştirir.
 *
 * @param {object} input productId + opsiyonel override'lar
 *   (shipping_profile_id, return_policy_id, shop_section_id, listing_state,
 *    readiness_state_id)
 * @returns {Promise<{success: boolean, listing_id: number, url: string}>}
 */
export async function uploadProductToEtsy(input) {
  // Etsy'de listing oluştuktan sonraki adımlar patlarsa bile ID'yi kaydedebilmek
  // için try bloğunun dışında tutulur.
  let createdListingId = null;

  try {
    const { productId, shipping_profile_id: overrideShipping, return_policy_id: overrideReturn, shop_section_id: overrideSection, listing_state: overrideState } = input;
    if (!productId) {
      throw httpError(400, 'productId is required');
    }
    
    const activeShop = getActiveShop();
    
    // 1. Fetch product details
    const productStmt = db.prepare('SELECT * FROM products WHERE id = ? AND shop_id = ?');
    const product = productStmt.get(productId, activeShop.shop_id);
    if (!product) {
      throw httpError(404, 'Product not found');
    }
    
    // 2. Fetch global defaults from settings
    const settingsStmt = db.prepare('SELECT * FROM settings WHERE shop_id = ?');
    const settingsRows = settingsStmt.all(activeShop.shop_id);
    const settings = {};
    settingsRows.forEach(s => {
      settings[s.key] = JSON.parse(s.value);
    });
    
    const taxonomy_id = settings.default_taxonomy_id || 1027; // wall decor default
    const who_made = settings.default_who_made || 'i_did';
    const when_made = settings.default_when_made || 'made_to_order';
    
    // Prioritize request overrides, then fallback to global settings
    const shipping_profile_id = overrideShipping || settings.default_shipping_profile_id;
    const return_policy_id = overrideReturn || settings.default_return_policy_id;
    const state = overrideState || settings.default_listing_state || 'draft';
    const readiness_state_id = input.readiness_state_id || settings.default_readiness_state_id;
    
    // Prioritize product-specific section, then request override, then global settings
    const shop_section_id = product.shop_section_id || overrideSection || settings.default_shop_section_id;
    
    if (!shipping_profile_id) {
      throw httpError(400, 'Kargo şablonu (shipping profile) seçilmedi. Lütfen genel ayarlardan veya toplu yükleme sihirbazından bir kargo şablonu belirtin.');
    }
    
    // 3. Mark product as uploading in DB
    const updateStatus = db.prepare('UPDATE products SET status = ? WHERE id = ? AND shop_id = ?');
    updateStatus.run('uploading', productId, activeShop.shop_id);
    
    // 4. Create listing on Etsy
    // Gather tags and attributes
    const tags = product.tags ? JSON.parse(product.tags) : [];
    
    // Clean listing price (use average from variation profile or default price)
    let fallbackPrice = settings.default_price || 35.00;
    let variationProfile = null;
    
    if (product.variation_profile_id) {
      const profileStmt = db.prepare('SELECT * FROM variation_profiles WHERE id = ? AND shop_id = ?');
      const profileRow = profileStmt.get(product.variation_profile_id, activeShop.shop_id);
      if (profileRow) {
        variationProfile = {
          ...profileRow,
          combinations: JSON.parse(profileRow.combinations)
        };
        // Find minimum price from combinations
        if (variationProfile.combinations.length > 0) {
          const prices = variationProfile.combinations.map(c => Number(c.price)).filter(p => !isNaN(p));
          if (prices.length > 0) {
            fallbackPrice = Math.min(...prices);
          }
        }
      }
    }
    
    const boilerplate = settings.description_boilerplate || '';
    const rawDescription = product.description || 'Stunning printed wall art.';
    const finalDescription = boilerplate 
      ? `${rawDescription}\n\n${boilerplate}`
      : rawDescription;

    const listingData = {
      title: product.title ? product.title.substring(0, 140) : 'Untitled Art',
      description: finalDescription,
      price: fallbackPrice,
      quantity: DEFAULT_LISTING_QUANTITY,
      who_made,
      when_made,
      taxonomy_id: Number(taxonomy_id),
      state,
      type: 'physical',
      should_auto_renew: settings.auto_renew !== undefined ? settings.auto_renew : true
    };

    if (shipping_profile_id) listingData.shipping_profile_id = Number(shipping_profile_id);
    if (return_policy_id) listingData.return_policy_id = Number(return_policy_id);

    // Add Materials if enabled (default to true and ['Canvas', 'Paper', 'Cotton', 'Wood', 'Fabric'] if not saved in settings)
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

    if (!readiness_state_id) {
      throw httpError(400, 'Fiziksel ürünler için hazırlık profili (readiness state) seçilmelidir. Lütfen genel ayarlardan veya kargo tabından varsayılan bir hazırlık profili belirtin.');
    }
    listingData.readiness_state_id = Number(readiness_state_id);
    
    if (shop_section_id) {
      listingData.shop_section_id = shop_section_id;
    }
    if (tags.length > 0) {
      listingData.tags = tags
        .map(t => t.trim().substring(0, 20))
        .filter(t => t.length > 0)
        .slice(0, 13);
    }
    
    // Yarım kalan bir yüklemeyi DEVAM ETTİR, yeniden oluşturma.
    //
    // createListing basarili olup sonraki adimlardan biri patladiginda (tipik
    // olarak Etsy hiz limiti) urune bir etsy_listing_id yaziliyor. Bu ID
    // okunmazsa "tekrar dene" Etsy'de ikinci bir taslak acardi; kullanici da
    // duplicate'i elle silmek zorunda kalirdi.
    let listing_id;
    const existingListingId = product.etsy_listing_id
      ? String(product.etsy_listing_id).split('.')[0]
      : null;

    const isResume = Boolean(existingListingId && product.status === 'error');

    if (isResume) {
      listing_id = Number(existingListingId);
      console.log(`[Upload] Product ${productId} icin yarim kalan listing ${listing_id} bulundu, yeniden olusturulmuyor.`);

      // Metin alanlari ilk denemeden bu yana degismis olabilir, tazeliyoruz.
      // Ama PATCH'e create'e ozgu alanlar GONDERILMEZ: price/quantity/
      // readiness_state_id updateListing semasinda yok (400 doner) ve 'state'
      // burada gonderilirse listing gorseller yuklenmeden aktiflesir —
      // aktiflestirme akisin sonunda, envanter kurulduktan sonra yapiliyor.
      const { price, quantity, readiness_state_id: _rs, state: _st, ...resumeData } = listingData;
      try {
        await EtsyService.updateListing(listing_id, resumeData);
      } catch (err) {
        // Guncelleme basarisiz olsa bile listing duruyor; devam etmek
        // duplicate acmaktan iyidir.
        console.warn(`[Upload] Devam eden listing ${listing_id} guncellenemedi (${err.response?.data?.error || err.message}); mevcut icerikle devam ediliyor.`);
      }
    } else {
      console.log(`Creating draft listing on Etsy for product ${productId}...`);
      const createdListing = await EtsyService.createListing(listingData);
      listing_id = createdListing.listing_id;
    }
    createdListingId = listing_id;

    // Listing ID'yi hemen kaydet: sonraki adımlardan biri patlarsa bile
    // ürün Etsy'deki taslakla eşleşmiş kalır.
    db.prepare('UPDATE products SET etsy_listing_id = ? WHERE id = ? AND shop_id = ?')
      .run(listing_id.toString(), productId, activeShop.shop_id);

    // Update taxonomy properties
    try {
      // 1. Home Style
      if (settings.attribute_home_style_enabled && settings.attribute_home_style) {
        const valId = STYLE_MAPPING[settings.attribute_home_style];
        if (valId) {
          console.log(`Setting Home Style attribute to ${settings.attribute_home_style} (ID: ${valId})...`);
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
          console.log(`Setting Occasion attribute to ${settings.attribute_occasion} (ID: ${valId})...`);
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
          console.log(`Setting Holiday attribute to ${settings.attribute_holiday} (ID: ${valId})...`);
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
          console.log(`Setting Room attributes to ${values.join(', ')}...`);
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
          console.log(`Setting Materials attributes to ${values.join(', ')}...`);
          await EtsyService.updateListingProperty(listing_id, 148789511893, {
            value_ids: valIds,
            values: values
          });
        }
      }
    } catch (attrErr) {
      console.warn("Failed to set taxonomy properties for listing:", attrErr.response?.data || attrErr.message);
    }
    
    // 5. Upload generated mockups
    const subPath = getProductStorageFolder(productId);
    let mockupsDir = join(__dirname, '../..', 'storage', subPath, 'mockups', productId);
    if (!fs.existsSync(mockupsDir)) {
      // Fallback check using old directory name
      const shopId = product ? product.shop_id : activeShop.shop_id;
      const shopName = getShopStorageName(shopId);
      mockupsDir = join(__dirname, '../..', 'storage', shopName, 'mockups', productId);
      if (!fs.existsSync(mockupsDir)) {
        mockupsDir = join(__dirname, '../..', 'storage/mockups', productId);
      }
    }
    
    // Devam eden bir yuklemede listing'de onceki denemeden kalan gorseller
    // olabilir; temizlenmezse ayni mockup'lar ikinci kez eklenir ve siralama
    // bozulur. Silme basarisiz olursa yukleme durmuyor, sadece uyariliyor.
    if (isResume) {
      try {
        const existingImages = await EtsyService.getListingImages(listing_id);
        if (existingImages?.length) {
          console.log(`[Upload] Devam: listing ${listing_id} uzerindeki ${existingImages.length} eski gorsel siliniyor.`);
          for (const img of existingImages) {
            await EtsyService.deleteListingImage(listing_id, img.listing_image_id);
          }
        }
      } catch (err) {
        console.warn(`[Upload] Eski gorseller silinemedi (${err.message}); gorseller tekrarlanabilir.`);
      }
    }

    let uploadedMockups = false;
    if (fs.existsSync(mockupsDir)) {
      const files = fs.readdirSync(mockupsDir).filter(f => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.jpeg') || f.toLowerCase().endsWith('.png'));
      if (files.length > 0) {
        // Şablon Stüdyosu'ndaki oran bazlı dizilim ayarı (yoksa eski davranış)
        const orderedFiles = orderMockupFiles(files, { shopId: product ? product.shop_id : activeShop.shop_id });
        console.log(`[Mockup Order] Yükleme sırası: ${orderedFiles.join(' → ')}`);

        console.log(`Uploading ${orderedFiles.length} mockup images to Etsy for listing ${listing_id}...`);
        for (let i = 0; i < orderedFiles.length; i++) {
          const file = orderedFiles[i];
          const filePath = join(mockupsDir, file);
          await EtsyService.uploadListingImage(listing_id, filePath, i + 1, product.title);
        }
        uploadedMockups = true;
      }
    }
    
    if (!uploadedMockups) {
      console.log(`No mockup folder or images found. Uploading original image for listing ${listing_id}...`);
      const originalPath = join(__dirname, '../..', product.image_path);
      await EtsyService.uploadListingImage(listing_id, originalPath, 1, product.title);
    }
    
    // 6. Setup variations inventory (if variation profile is set)
    if (variationProfile && variationProfile.combinations && variationProfile.combinations.length > 0) {
      console.log(`Configuring variations for listing ${listing_id}...`);
      
      const hasFrames = variationProfile.frames && variationProfile.frames.length > 0;
      const validCombs = variationProfile.combinations.filter(c => 
        c.size && !isNaN(Number(c.price)) && (hasFrames ? c.frame : true)
      );
      
      if (validCombs.length > 0) {
        const productsList = validCombs.map((comb, index) => {
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
          
          // Generate SKU (max 32 characters for Etsy)
          const cleanSize = comb.size.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
          const cleanFrame = comb.frame ? comb.frame.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8) : 'NONE';
          const prodPrefix = productId.substring(0, 6).toUpperCase();
          const sku = `ART-${prodPrefix}-${cleanSize}-${cleanFrame}`.toUpperCase();
          
          return {
            sku,
            property_values,
            offerings: [
              {
                price: Number(comb.price),
                quantity: DEFAULT_LISTING_QUANTITY,
                is_enabled: true,
                readiness_state_id: listingData.type === 'physical' ? Number(readiness_state_id) : null
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
          console.log(`Successfully uploaded ${productsList.length} variation combinations to Etsy for listing ${listing_id}!`);
        } catch (invErr) {
          console.error(`Failed to upload variations to Etsy for listing ${listing_id}:`, invErr.response?.data || invErr.message);
        }
      }
    }
    // 6.5. Activate listing if state is active (since createDraftListing only creates drafts)
    if (state === 'active') {
      console.log(`Activating listing ${listing_id} on Etsy...`);
      try {
        await EtsyService.updateListing(listing_id, { state: 'active' });
        console.log(`Listing ${listing_id} activated successfully!`);
      } catch (actErr) {
        console.error(`Failed to activate listing ${listing_id} on Etsy:`, actErr.response?.data || actErr.message);
        throw new Error(`Ürün başarıyla yüklendi ancak aktif duruma getirilemedi. Hata: ${JSON.stringify(actErr.response?.data || actErr.message)}`);
      }
    }

    // 7. Update status to live in DB
    const updateSuccess = db.prepare(
      'UPDATE products SET status = ?, etsy_listing_id = ? WHERE id = ? AND shop_id = ?'
    );
    updateSuccess.run('live', listing_id.toString(), productId, activeShop.shop_id);
    
    return {
      success: true,
      listing_id,
      url: `https://www.etsy.com/listing/${listing_id}`
    };
  } catch (err) {
    console.error("Etsy Upload Error:", err.response?.data || err.message);

    // Revert status to error in DB. Listing Etsy'de oluşturulduysa ID'yi de yaz ki
    // tekrar denendiğinde duplicate listing açılmasın.
    if (input.productId) {
      const activeShop = getActiveShop();
      if (createdListingId) {
        db.prepare('UPDATE products SET status = ?, etsy_listing_id = ? WHERE id = ? AND shop_id = ?')
          .run('error', createdListingId.toString(), input.productId, activeShop.shop_id);
        console.warn(`[Upload] Listing ${createdListingId} Etsy'de oluşturuldu ancak sonraki adım başarısız oldu. Ürüne bağlandı, tekrar denemede duplicate açılmayacak.`);
      } else {
        db.prepare('UPDATE products SET status = ? WHERE id = ? AND shop_id = ?')
          .run('error', input.productId, activeShop.shop_id);
      }
    }

    throw err;
  }
}

export { httpError };
