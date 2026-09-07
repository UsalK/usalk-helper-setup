/**
 * Yeni listing açma ve mevcut listing güncelleme akışlarının paylaştığı yardımcılar.
 * Tek yerde durmaları, iki akışın zamanla birbirinden ayrışmasını engeller.
 */

/**
 * Varyasyon profilinden Etsy envanter payload'ı üretir.
 * ListingUploadService'teki mantığın birebir aynısıdır: aynı property ID'leri
 * (513 Dimensions / 514 Frame), aynı SKU şeması, aynı fiyat kuralları.
 */
/**
 * Yeni açılan listing'lerde ve varyasyon offering'lerinde kullanılan stok adedi.
 * Daha önce 100'dü; yeni yüklemelerde 8 adet yazıyoruz. Zaten yayında olan
 * listing'lerin stoğuna dokunulmaz (bkz. routes/etsy.js fiyat güncelleme akışı,
 * orada mevcut offering.quantity korunur).
 */
export const DEFAULT_LISTING_QUANTITY = 8;

export function buildInventoryPayload(variationProfile, productId, readinessStateId, isPhysical = true) {
  if (!variationProfile?.combinations?.length) return null;

  const hasFrames = variationProfile.frames && variationProfile.frames.length > 0;
  const validCombs = variationProfile.combinations.filter(c =>
    c.size && !isNaN(Number(c.price)) && (hasFrames ? c.frame : true)
  );

  if (validCombs.length === 0) return null;

  const productsList = validCombs.map((comb) => {
    const property_values = [
      {
        property_id: 513, // Custom1 (Dimensions)
        property_name: 'Dimensions',
        value_ids: [],
        values: [comb.size]
      }
    ];

    if (hasFrames && comb.frame) {
      property_values.push({
        property_id: 514, // Custom2 (Frame)
        property_name: 'Frame',
        value_ids: [],
        values: [comb.frame]
      });
    }

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
          readiness_state_id: isPhysical && readinessStateId ? Number(readinessStateId) : null
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

  return {
    products: productsList,
    price_on_property,
    quantity_on_property: [],
    sku_on_property
  };
}

/**
 * Varyasyon profilinin boyut listesinden listing'e yazılacak temsili ölçüyü
 * inç cinsinden çıkarır.
 *
 * Boyutlar "20x30cm - 8”x12”" veya "40x17cm 16\"x7\"" gibi karışık biçimlerde
 * saklanıyor; inç kısmı düz tırnak da eğik tırnak da olabiliyor.
 *
 * Profildeki tüm boyutlar aynı orana sahip olduğu için hangisinin seçildiği
 * oranı değiştirmez; ortanca seçilir çünkü en büyük ölçü (bazı profillerde
 * 106 inç) listing bilgisi olarak gerçekçi durmuyor. Önemli olan, dikey bir
 * üründen yatay bir ürüne geçildiğinde eski ölçülerin kalmaması.
 *
 * @returns {{width:number, height:number}|null}
 */
export function representativeInchSize(sizes) {
  if (!Array.isArray(sizes) || sizes.length === 0) return null;

  const parsed = [];

  for (const raw of sizes) {
    if (typeof raw !== 'string') continue;

    // Tırnak çeşitlerini tekilleştir: ” ″ “ -> "
    const norm = raw.replace(/[”″“]/g, '"').replace(/[’‘]/g, "'");

    // 8"x12" / 16"x7" / 24" x 36" biçimlerini yakala
    const m = norm.match(/(\d+(?:\.\d+)?)\s*"\s*[xX×]\s*(\d+(?:\.\d+)?)\s*"/);
    if (!m) continue;

    const width = parseFloat(m[1]);
    const height = parseFloat(m[2]);
    if (!isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) continue;

    parsed.push({ width, height });
  }

  if (parsed.length === 0) return null;

  parsed.sort((a, b) => (a.width * a.height) - (b.width * b.height));
  return parsed[Math.floor(parsed.length / 2)];
}
