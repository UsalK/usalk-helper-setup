import { createCanvas, loadImage } from '@napi-rs/canvas';

// Pikselleri renk ailesine LCh (açıklık, doygunluk, ton açısı) kurallarıyla
// ayırıyoruz. Eski yöntem her pikseli birkaç sabit örnek renge en yakın olana
// atıyordu; soluk pembe/mor tonlar "Kahverengi"ye, pastel resimlerin çoğu
// "Bej/Gri"ye düşüyordu. Ton açısı, insanın rengi adlandırma biçimine daha yakın.
//
// Ayarlar 21 yağlıboya görsellik elle etiketlenmiş bir sette seçildi (hata
// %69 -> %2) ve ayrıca bilinen renk adlarıyla (magenta, somon, zeytin, antrasit
// ...) sağlandı: backend/scripts/artworkColors.test.mjs.
const NEUTRAL_CHROMA = 8;     // bunun altı renksiz sayılır
const NEUTRAL_WEIGHT = 0.25;  // renksiz pikselin oyu (renkli piksel en fazla 1)
const CHROMA_CAP = 15;        // bu doygunluktan sonrası tam oy
const TEAL_CUT = 170;         // yeşil/mavi sınırı (turkuaz mavi sayılır)
const NEUTRALS = new Set(['Black', 'White', 'Gray', 'Beige', 'Brown']);

function toLch(r, g, b) {
  const [R, G, B] = [r, g, b].map(v => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const x = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const y = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const z = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  const a = 500 * (x - y);
  const bb = 200 * (y - z);
  const h = Math.atan2(bb, a) * 180 / Math.PI;
  return [116 * y - 16, Math.hypot(a, bb), h < 0 ? h + 360 : h];
}

/** L (0-100), C (doygunluk) ve h (ton açısı, derece) değerini Etsy renk ailesine çevirir. */
export function colorFamily(L, C, h) {
  if (C < NEUTRAL_CHROMA || (L < 35 && C < 12)) {
    if (L < 20) return 'Black';
    if (L > 90) return 'White';
    if (C >= 3 && h >= 40 && h < 110 && L >= 60) return 'Beige';
    return 'Gray';
  }
  if (L < 18 && C < 20) return 'Black';
  if (h >= 345 || h < 22) {                       // pembe / kırmızı / mürdüm
    if (C >= 35) return L >= 65 ? 'Pink' : 'Red';
    if (L >= 55) return 'Pink';
    return h >= 345 || h < 10 ? 'Purple' : 'Red';
  }
  if (h < 50) {                                   // somon / kiremit
    if (C >= 40) return L >= 65 ? (h < 40 ? 'Pink' : 'Orange') : 'Red';
    if (L >= 55) return 'Pink';
    return C >= 25 ? 'Red' : 'Brown';
  }
  if (h < 75) {                                   // turuncu / şeftali / kahve
    if (L < 45) return 'Brown';
    if (L >= 72 && C < 18) return 'Beige';
    if (L < 55 && C < 45) return 'Brown';
    return 'Orange';
  }
  if (h < 105) {                                  // sarı / krem / zeytin
    if (L < 50) return h > 95 ? 'Green' : 'Brown';
    if (C < 25) return L >= 60 ? 'Beige' : C < 15 ? 'Gray' : 'Brown';
    if (h >= 95 && L < 65) return 'Green';
    return 'Yellow';
  }
  if (h < TEAL_CUT) return 'Green';
  if (h < 295) return 'Blue';
  if (h < 320) return 'Purple';
  return C >= 45 ? 'Pink' : 'Purple';              // magenta pembe, soluk mor mor
}

/**
 * Renk ailelerini sıralar. Renkli pikseller doygunluklarıyla, renksizler sabit
 * düşük oyla sayılır: pastel bir resimde geniş krem gökyüzü, resmi tanımlayan
 * pembe/yeşil tonların önüne geçmesin. `share` görseldeki alan payıdır.
 */
export function rankArtworkColors(pixels) {
  const votes = new Map();
  const areas = new Map();
  const classified = new Map();
  let visible = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    if (!alpha) continue;
    const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    let entry = classified.get(key);
    if (!entry) {
      const [L, C, h] = toLch(pixels[i], pixels[i + 1], pixels[i + 2]);
      const name = colorFamily(L, C, h);
      entry = { name, weight: NEUTRALS.has(name) ? NEUTRAL_WEIGHT : Math.min(C, CHROMA_CAP) / CHROMA_CAP };
      classified.set(key, entry);
    }
    votes.set(entry.name, (votes.get(entry.name) || 0) + alpha * entry.weight);
    areas.set(entry.name, (areas.get(entry.name) || 0) + alpha);
    visible += alpha;
  }
  return [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => ({ name, share: areas.get(name) / visible }));
}

export async function detectArtworkColors(imagePath) {
  const image = await loadImage(imagePath);
  const ratio = Math.min(1, 256 / Math.max(image.width, image.height));
  const canvas = createCanvas(Math.max(1, Math.round(image.width * ratio)), Math.max(1, Math.round(image.height * ratio)));
  const ctx = canvas.getContext('2d');
  // Sample actual pixels without creating blended colours along edges.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const colors = rankArtworkColors(ctx.getImageData(0, 0, canvas.width, canvas.height).data).slice(0, 2);
  if (!colors.length) throw new Error('Görselde renk analizi yapılabilecek görünür piksel yok.');
  return colors;
}

const normalize = value => String(value || '').toLowerCase().replace(/colour/g, 'color').replace(/grey/g, 'gray').replace(/[^a-z]/g, '');

export function mapArtworkColorProperties(colors, taxonomyProperties) {
  const properties = ['primary', 'secondary'].map(role => taxonomyProperties.find(property =>
    property.supports_attributes && [property.name, property.display_name].some(name =>
      normalize(name) === `${role}color` || (role === 'primary' && normalize(name) === 'color')
    )
  ));
  const updates = colors.map((color, index) => {
    const property = properties[index];
    const value = property?.possible_values?.find(v => normalize(v.name) === normalize(color.name));
    if (!property || !value || !Number.isSafeInteger(value.value_id) || value.value_id <= 0) {
      throw new Error(`Etsy kategorisinde ${index === 0 ? 'ana' : 'ikincil'} renk için "${color.name}" seçeneği bulunamadı.`);
    }
    return {
      property_id: property.property_id,
      value_ids: [value.value_id],
      values: [value.name],
      ...(value.scale_id ? { scale_id: value.scale_id } : {})
    };
  });
  return { colors, updates, secondaryPropertyId: properties[1]?.property_id };
}

export async function prepareArtworkColors(imagePath, taxonomyId, etsy) {
  const colors = await detectArtworkColors(imagePath);
  return mapArtworkColorProperties(colors, await etsy.getTaxonomyProperties(taxonomyId));
}

export async function sendArtworkColors(listingId, prepared, etsy, { clearSecondary = false } = {}) {
  for (const { property_id, ...body } of prepared.updates) {
    await etsy.updateListingProperty(listingId, property_id, body);
  }
  if (clearSecondary && prepared.colors.length === 1 && prepared.secondaryPropertyId) {
    await etsy.deleteListingProperty(listingId, prepared.secondaryPropertyId);
  }
}
