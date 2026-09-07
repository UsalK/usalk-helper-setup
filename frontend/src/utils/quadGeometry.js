// Perspektif dörtgen ölçümleri.
//
// Otomatik tanınan köşelerden; kenar uzunlukları, perspektif sapması ve
// dikdörtgenin GERÇEK en/boy oranı hesaplanır. Perspektifte üst kenar alt
// kenardan kısa görünür, bu yüzden ekrandaki ham genişlik/yükseklik oranı
// gerçek oranı vermez. Zhang & He'nin (Whiteboard Scanning, MSR-TR-2002-39)
// yöntemiyle odak uzaklığı ve gerçek oran birlikte çözülür.

import { parseRatioKey, isSetRatioKey } from './panels.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Tek kaçış noktası sonluyken (yalnızca yana açılı çerçeveler) odak uzaklığı
 * görüntüden çözülemez; tipik bir iç mekân fotoğrafı/render'ı varsayılır.
 * İç mekân görsellerinde odak kabaca 0.65-1.4 × en uzun kenar arasındadır,
 * ortası alınır.
 */
const ASSUMED_FOCAL_FACTOR = 1.05;

/**
 * Varsayılan odakla yapılan düzeltmenin üst sınırı. Gerçek odak varsayımdan
 * çok farklıysa (çok geniş açı) düzeltme aşırıya kaçıp ham orandan daha kötü
 * bir sonuç verebilir; bu sınır o riski keser.
 */
const MAX_ASSUMED_CORRECTION = 1.35;

/**
 * Perspektif projeksiyondan dikdörtgenin gerçek en/boy oranını çözer.
 *
 * @param {{tl,tr,br,bl}} corners piksel koordinatlarında köşeler
 * @param {number} imgW görselin piksel genişliği
 * @param {number} imgH görselin piksel yüksekliği
 * @returns {{ aspect: number, method: 'perspective'|'assumed'|'affine', focal: number|null }}
 */
export function trueAspectRatio(corners, imgW, imgH) {
  const u0 = imgW / 2;
  const v0 = imgH / 2;

  // Zhang'in gösterimi: m1 sol üst, m2 sağ üst, m3 sol alt, m4 sağ alt
  const m1 = [corners.tl.x, corners.tl.y, 1];
  const m2 = [corners.tr.x, corners.tr.y, 1];
  const m3 = [corners.bl.x, corners.bl.y, 1];
  const m4 = [corners.br.x, corners.br.y, 1];

  // Afin (perspektifsiz) yedek çözüm: kenar uzunluklarının ortalaması
  const affine = () => {
    const top = dist(corners.tl, corners.tr);
    const bottom = dist(corners.bl, corners.br);
    const left = dist(corners.tl, corners.bl);
    const right = dist(corners.tr, corners.br);
    const wAvg = (top + bottom) / 2;
    const hAvg = (left + right) / 2;
    return { aspect: hAvg > 0 ? wAvg / hAvg : 1, method: 'affine', focal: null };
  };

  const d2 = dot3(cross3(m2, m4), m3);
  const d3 = dot3(cross3(m3, m4), m2);
  if (Math.abs(d2) < 1e-9 || Math.abs(d3) < 1e-9) return affine();

  const k2 = dot3(cross3(m1, m4), m3) / d2;
  const k3 = dot3(cross3(m1, m4), m2) / d3;

  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];

  // n[2], ilgili kenar çiftinin kaçış noktasının ne kadar "sonlu" olduğudur:
  // 0 ise o iki kenar görüntüde paraleldir (kaçış noktası sonsuzda).
  const Z_EPS = 1e-3;
  const finite2 = Math.abs(n2[2]) > Z_EPS;
  const finite3 = Math.abs(n3[2]) > Z_EPS;

  // Hiçbir yönde perspektif yoksa oran doğrudan kenar uzunluklarından gelir.
  if (!finite2 && !finite3) return affine();

  const D = Math.max(imgW, imgH);
  let f2 = null;
  let method = null;

  // İki kaçış noktası da sonluysa odak uzaklığı görüntüden çözülebilir.
  if (finite2 && finite3) {
    const solved = -(
      (n2[0] - u0 * n2[2]) * (n3[0] - u0 * n3[2]) +
      (n2[1] - v0 * n2[2]) * (n3[1] - v0 * n3[2])
    ) / (n2[2] * n3[2]);

    // Makul olmayan odak uzaklıkları (gürültülü köşelerde çıkar) reddedilir.
    if (Number.isFinite(solved) && solved > (0.35 * D) ** 2 && solved < (8 * D) ** 2) {
      f2 = solved;
      method = 'perspective';
    }
  }

  // Tek kaçış noktası sonluysa odak çözülemez ama varsayılan odakla yapılan
  // düzeltme, ham kenar oranına göre belirgin biçimde daha doğrudur.
  if (f2 === null) {
    f2 = (ASSUMED_FOCAL_FACTOR * D) ** 2;
    method = 'assumed';
  }

  const norm = (n) => (
    ((n[0] - u0 * n[2]) ** 2 + (n[1] - v0 * n[2]) ** 2) / f2 + n[2] ** 2
  );

  const denom = norm(n3);
  if (denom <= 0) return affine();

  let aspect = Math.sqrt(norm(n2) / denom);
  if (!Number.isFinite(aspect) || aspect <= 0.05 || aspect >= 20) return affine();

  if (method === 'assumed') {
    const raw = affine().aspect;
    const lo = raw / MAX_ASSUMED_CORRECTION;
    const hi = raw * MAX_ASSUMED_CORRECTION;
    aspect = Math.min(hi, Math.max(lo, aspect));
  }

  return { aspect, method, focal: Math.sqrt(f2) };
}

/**
 * Bir dörtgenin tüm ölçümleri. Köşeler 0-1 normalize gelir; uzunluklar
 * gerçek piksel oranlarını korumak için görsel boyutlarıyla ölçeklenir.
 *
 * @param {{tl,tr,br,bl}} corners 0-1 normalize köşeler
 * @param {number} imgW
 * @param {number} imgH
 */
export function measureQuad(corners, imgW, imgH) {
  const px = {
    tl: { x: corners.tl.x * imgW, y: corners.tl.y * imgH },
    tr: { x: corners.tr.x * imgW, y: corners.tr.y * imgH },
    br: { x: corners.br.x * imgW, y: corners.br.y * imgH },
    bl: { x: corners.bl.x * imgW, y: corners.bl.y * imgH }
  };

  const top = dist(px.tl, px.tr);
  const bottom = dist(px.bl, px.br);
  const left = dist(px.tl, px.bl);
  const right = dist(px.tr, px.br);

  // Perspektif sapması: karşılıklı kenarların uzunluk farkı
  const hSkew = Math.max(top, bottom) > 0 ? Math.abs(top - bottom) / Math.max(top, bottom) : 0;
  const vSkew = Math.max(left, right) > 0 ? Math.abs(left - right) / Math.max(left, right) : 0;

  // Eğim: üst ve alt kenarların yataydan sapması (derece)
  const angleOf = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const topTilt = angleOf(px.tl, px.tr);
  const bottomTilt = angleOf(px.bl, px.br);
  const leftTilt = angleOf(px.tl, px.bl) - 90;
  const rightTilt = angleOf(px.tr, px.br) - 90;

  const rawAspect = ((left + right) / 2) > 0 ? ((top + bottom) / 2) / ((left + right) / 2) : 1;
  const { aspect, method, focal } = trueAspectRatio(px, imgW, imgH);

  return {
    px,
    top, bottom, left, right,
    hSkew, vSkew,
    deviation: Math.max(hSkew, vSkew),
    tilt: { top: topTilt, bottom: bottomTilt, left: leftTilt, right: rightTilt },
    maxTilt: Math.max(Math.abs(topTilt), Math.abs(bottomTilt), Math.abs(leftTilt), Math.abs(rightTilt)),
    rawAspect,
    aspect,
    aspectMethod: method,
    focal,
    /** Sapma yok denecek kadar küçükse şablon düz (flat) modda da çalışır. */
    isNearRectangle: Math.max(hSkew, vSkew) < 0.012 &&
      Math.max(Math.abs(topTilt), Math.abs(bottomTilt), Math.abs(leftTilt), Math.abs(rightTilt)) < 0.8
  };
}

/**
 * Ölçülen orana en yakın varyasyon oranını seçer.
 * Karşılaştırma logaritmik yapılır; 2:3 ile 3:2 arasındaki mesafe simetrik olur.
 *
 * @param {number} aspect ölçülen en/boy oranı
 * @param {string[]} ratioKeys mevcut oran anahtarları ('2:3', '1:2x2' ...)
 * @param {{ allowSets?: boolean }} opts
 * @returns {{ key: string, error: number, ratio: number }|null}
 */
export function nearestRatioKey(aspect, ratioKeys, opts = {}) {
  const { allowSets = false } = opts;
  if (!aspect || !Number.isFinite(aspect)) return null;

  let best = null;
  for (const key of ratioKeys || []) {
    if (!allowSets && isSetRatioKey(key)) continue;
    const { ratio } = parseRatioKey(key);
    if (!ratio || !Number.isFinite(ratio)) continue;
    const error = Math.abs(Math.log(aspect / ratio));
    if (!best || error < best.error) best = { key, error, ratio };
  }
  return best;
}

/** Oranın yönü. */
export function orientationLabel(aspect) {
  if (aspect > 1.04) return 'Yatay';
  if (aspect < 0.96) return 'Dikey';
  return 'Kare';
}

/**
 * Şablona otomatik ad üretir: "3:2 Yatay 1", "2:3 Dikey 4" ...
 * Aynı önekle başlayan mevcut şablonların en büyük sayacını bulur ve bir
 * artırır; böylece silme/yeniden adlandırma sonrası çakışma olmaz.
 *
 * @param {string} ratioKey  '2:3' ya da '1:2x2'
 * @param {number} aspect    ölçülen oran (yön etiketi için)
 * @param {string[]} existingNames mevcut şablon adları
 */
export function suggestTemplateName(ratioKey, aspect, existingNames = []) {
  const { ratio, panelCount } = parseRatioKey(ratioKey);
  const base = String(ratioKey).split('x')[0];
  const orientation = orientationLabel(Number.isFinite(aspect) ? aspect : ratio);
  const prefix = panelCount > 1
    ? `${base} ${orientation} ${panelCount}'li`
    : `${base} ${orientation}`;

  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}\\s+(\\d+)\\s*$`, 'i');

  let max = 0;
  for (const name of existingNames) {
    const m = re.exec(String(name || '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  }

  return `${prefix} ${max + 1}`;
}

/** Köşelerin sınırlayıcı kutusu → flat mod yerleşimi. */
export function cornersToPlacement(corners) {
  const xs = [corners.tl.x, corners.tr.x, corners.br.x, corners.bl.x];
  const ys = [corners.tl.y, corners.tr.y, corners.br.y, corners.bl.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y
  };
}
