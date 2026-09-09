// Fiyat matrisinde çerçevelerin tek sütunda toplanması.
//
// Gruplama YALNIZCA çerçeveli seçeneklere (Gold, Black, Silver, White,
// Natural Wood, Walnut ...) uygulanır; bunların fiyatı pratikte hep aynıdır.
// Roll ve Stretched Wood kendi fiyatlarına sahiptir ve gruplama açıkken de
// ayrı, kendi adlarıyla duran sütunlar olarak kalır.
//
// Gruplama yalnızca DÜZENLEME görünümünü etkiler. Kaydederken fiyatlar yine
// her çerçeve için ayrı ayrı yazılır (combinations: {size, frame, price}),
// böylece render, Etsy yükleme ve fiyat güncelleme tarafında hiçbir şey
// değişmez.

/** Seçenek gerçek bir çerçeve mi, yoksa rulo/kanvas gibi ayrı bir ürün mü? */
export function isFrameOption(frame) {
  const name = String(frame || '').toLowerCase();
  if (name.includes('roll') || name.includes('rulo')) return false;
  if (name.includes('stretched') || name.includes('canvas') || name.includes('kanvas')) return false;
  return true;
}

/** Gruplanmış çerçeve sütununun başlığı. */
export const FRAME_COLUMN_LABEL = 'Çerçeveli';

/**
 * Fiyat matrisinin sütunlarını kurar.
 *
 * Gruplama kapalıyken her seçenek kendi sütunudur. Açıkken çerçeveli
 * seçenekler tek sütunda toplanır; rulo/kanvas seçenekleri olduğu gibi kalır.
 * Sütun sırası çerçeve listesindeki sırayı korur: gruplanmış sütun, ilk
 * çerçevenin bulunduğu yere yerleşir.
 *
 * @param {string[]} frames
 * @param {boolean} grouped
 * @returns {{key: string, label: string, frames: string[], grouped: boolean}[]}
 */
export function buildPriceColumns(frames = [], grouped = false) {
  if (!grouped) {
    return frames.map(f => ({ key: f, label: f, frames: [f], grouped: false }));
  }

  const columns = [];
  let framePlaceholder = null;

  for (const frame of frames) {
    if (!isFrameOption(frame)) {
      columns.push({ key: frame, label: frame, frames: [frame], grouped: false });
      continue;
    }
    if (!framePlaceholder) {
      framePlaceholder = { key: '__frames__', label: FRAME_COLUMN_LABEL, frames: [], grouped: true };
      columns.push(framePlaceholder);
    }
    framePlaceholder.frames.push(frame);
  }

  return columns;
}

/**
 * Bir sütunun ortak fiyatı. Sütundaki çerçevelerin fiyatları birbirinden
 * farklıysa null döner; arayüz bunu "farklı" olarak gösterir.
 */
export function columnPriceOf(priceMap, size, column) {
  const values = column.frames.map(f => priceMap[`${size}_${f}`]);
  const first = values[0];
  return values.every(v => v === first) ? (first ?? '') : null;
}

/** Sütundaki tüm çerçevelere aynı fiyatı yazar. */
export function setColumnPrice(priceMap, size, column, value) {
  const price = Number(value) || 0;
  const next = { ...priceMap };
  for (const frame of column.frames) {
    next[`${size}_${frame}`] = price;
  }
  return next;
}
