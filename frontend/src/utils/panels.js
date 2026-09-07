// Çok panelli (Set of 2 gibi) şablon ve varyasyon profillerinin ortak yardımcıları.
// backend/services/MockupRenderer.js içindeki aynı isimli fonksiyonlarla
// birebir aynı davranışı üretir; tarayıcı ve sunucu render'ı ayrışmasın diye
// ikisi birlikte güncellenmelidir.

export const DEFAULT_PLACEMENT = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

export const DEFAULT_CORNERS = {
  tl: { x: 0.25, y: 0.25 },
  tr: { x: 0.75, y: 0.25 },
  br: { x: 0.75, y: 0.75 },
  bl: { x: 0.25, y: 0.75 }
};

/**
 * Oran anahtarını panel oranı + panel sayısına ayırır.
 * '2:3'   → { ratio: 0.667, panelCount: 1 }
 * '1:2x2' → { ratio: 0.5,   panelCount: 2 }  (her paneli 1:2 olan ikili set)
 */
export const parseRatioKey = (ratioStr) => {
  if (!ratioStr) return { ratio: 1, panelCount: 1 };
  const [base, countPart] = String(ratioStr).split('x');
  const panelCount = countPart ? Math.max(1, parseInt(countPart, 10) || 1) : 1;
  const parts = base.split(':');
  if (parts.length === 2) {
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (Number.isFinite(w) && Number.isFinite(h) && h !== 0) {
      return { ratio: w / h, panelCount };
    }
  }
  return { ratio: 1, panelCount };
};

/** Bir oran anahtarının tek panel en/boy oranı. */
export const parseRatio = (ratioStr) => parseRatioKey(ratioStr).ratio;

/** Oran anahtarı çok panelli bir seti mi tanımlıyor? */
export const isSetRatioKey = (ratioStr) => parseRatioKey(ratioStr).panelCount > 1;

/** Oran anahtarının okunabilir etiketi: '1:2x2' → '1:2 × 2 panel'. */
export const ratioKeyLabel = (ratioStr) => {
  const { panelCount } = parseRatioKey(ratioStr);
  if (panelCount <= 1) return ratioStr;
  const base = String(ratioStr).split('x')[0];
  return `${base} × ${panelCount} panel`;
};

/**
 * Şablonun panel yerleşimlerini döner.
 * Çok panelli şablonlar config.slots dizisini kullanır; tek panelli klasik
 * şablonlarda config.placement / config.corners okunur, böylece eski
 * şablonlar hiç değişmeden çalışır.
 */
export const getTemplateSlots = (config = {}) => {
  if (Array.isArray(config.slots) && config.slots.length > 0) return config.slots;
  return [{ placement: config.placement, corners: config.corners }];
};

/**
 * Set şablonlarında her panele hangi görselin gireceğini belirler.
 *   'split'     → tek görsel panel sayısı kadar dikey dilime bölünür
 *                 (soldaki dilim sol panele, sağdaki sağ panele)
 *   'duplicate' → aynı görsel her panelde tekrarlanır
 */
export const buildPanelSources = (img, count, mode) => {
  if (count <= 1) return [img];
  if (mode === 'duplicate') return new Array(count).fill(img);

  const sliceW = Math.floor(img.width / count);
  if (sliceW < 1) return new Array(count).fill(img);

  const sources = [];
  for (let i = 0; i < count; i++) {
    const w = (i === count - 1) ? (img.width - sliceW * i) : sliceW;
    const slice = document.createElement('canvas');
    slice.width = w;
    slice.height = img.height;
    const sctx = slice.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, sliceW * i, 0, w, img.height, 0, 0, w, img.height);
    sources.push(slice);
  }
  return sources;
};

/**
 * Bir arka plan üzerinde N paneli simetrik olarak yerleştirir.
 * Paneller ortalanır, aralarında `gap` (arka plan genişliğinin oranı) boşluk kalır.
 *
 * @param {number} panelRatio panel en/boy oranı (ör. 1:2 için 0.5)
 * @param {number} count      panel sayısı
 * @param {number} gap        paneller arası boşluk (0-1, arka plan genişliğine göre)
 * @param {number} height     panel yüksekliği (0-1, arka plan yüksekliğine göre)
 * @param {number} centerY    panel grubunun dikey merkezi (0-1)
 * @param {number} bgRatio    arka plan görselinin en/boy oranı (w/h)
 */
export const layoutPanels = (panelRatio, count, gap, height, centerY, bgRatio) => {
  // Panel genişliği normalize koordinatta: (h * bgH * panelRatio) / bgW
  const width = (height * panelRatio) / bgRatio;
  const totalW = count * width + (count - 1) * gap;
  const startX = 0.5 - totalW / 2;
  const y = centerY - height / 2;

  return Array.from({ length: count }, (_, i) => ({
    placement: {
      x: startX + i * (width + gap),
      y,
      width,
      height
    }
  }));
};

/**
 * Otomatik set yüklemesinde beklenen kaynak görsel oranının etiketi:
 * paneller yan yana dizildiğinde ortaya çıkan oran.
 *   '1:2' × 2 → '1:1'   ·   '2:3' × 2 → '4:3'
 */
export const sourceRatioLabel = (panelRatioStr, panelCount = 1) => {
  const parts = String(panelRatioStr || '').split(':');
  if (parts.length !== 2) return null;
  let w = Number(parts[0]) * panelCount;
  let h = Number(parts[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return null;

  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(Math.round(w), Math.round(h)) || 1;
  return `${Math.round(w) / g}:${Math.round(h) / g}`;
};

/** Bir dosyayı Image nesnesi olarak yükler. */
export const loadImageFile = (file) => new Promise((resolve, reject) => {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    resolve(img);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Görsel okunamadı: ' + file.name));
  };
  img.src = url;
});

/** Görselin en/boy oranını döner. */
export const aspectOfFile = async (file) => {
  const img = await loadImageFile(file);
  return img.width / img.height;
};

/**
 * Manuel set yüklemesi: seçilen görselleri soldan sağa yan yana dizip TEK bir
 * kaynak görsel üretir. Render motoru bu görseli `set_source: 'split'` ile
 * tekrar eşit dilimlere böldüğü için her dilim kendi paneline geri döner.
 *
 * Her dilim panelin kendi oranında (`panelRatio`) üretilir; böylece mockup
 * yerleşiminde ikinci bir kırpma yaşanmaz. Kaynak görselin oranı panelden
 * farklıysa merkezden kırpılır (cover).
 *
 * @param {File[]} files      panel sırasına göre görseller (0 = sol)
 * @param {number} panelRatio panel en/boy oranı (1:2 için 0.5)
 * @param {number} maxHeight  çıktı panel yüksekliği üst sınırı
 * @returns {Promise<File>} birleştirilmiş JPEG
 */
export const composePanelsImage = async (files, panelRatio, maxHeight = 4000) => {
  const images = await Promise.all(files.map(loadImageFile));

  const height = Math.min(maxHeight, Math.max(...images.map(i => i.height)));
  const width = Math.max(1, Math.round(height * panelRatio));

  const canvas = document.createElement('canvas');
  canvas.width = width * images.length;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  images.forEach((img, idx) => {
    // Cover: hedef orana göre merkezden kırp
    const imgRatio = img.width / img.height;
    let sx, sy, sw, sh;
    if (imgRatio > panelRatio) {
      sh = img.height;
      sw = sh * panelRatio;
      sx = (img.width - sw) / 2;
      sy = 0;
    } else {
      sw = img.width;
      sh = sw / panelRatio;
      sx = 0;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, idx * width, 0, width, height);
  });

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  const name = `set-${files.length}-${Date.now()}.jpg`;
  return new File([blob], name, { type: 'image/jpeg' });
};

/** Bir yerleşim dikdörtgeninin köşe noktalarına çevrilmiş hali (perspektif modu için). */
export const placementToCorners = (placement) => ({
  tl: { x: placement.x, y: placement.y },
  tr: { x: placement.x + placement.width, y: placement.y },
  br: { x: placement.x + placement.width, y: placement.y + placement.height },
  bl: { x: placement.x, y: placement.y + placement.height }
});
