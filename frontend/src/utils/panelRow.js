// Çok panelli (Set of 2 / Set of 3) şablonlarda panel eşleştirme.
//
// Otomatik tanıma sahnedeki tüm çerçeve adaylarını döndürür. Bir set
// şablonunda bunlardan hangilerinin "yan yana asılmış aynı seri" olduğunu
// seçip soldan sağa panellere dağıtmak gerekir: aynı hizada duran, benzer
// boyutta ve yatayda birbirini kesmeyen N dörtgen.
//
// Köşeler 0-1 normalize olduğu için oranlar (genişlik/genişlik gibi) aynı
// görselde piksel uzayıyla birebir aynıdır; ayrıca ölçeklemeye gerek yoktur.

/** Aday dörtgenin sınırlayıcı kutusu ve merkezi. */
function boxOf(candidate) {
  const c = candidate.corners;
  const xs = [c.tl.x, c.tr.x, c.br.x, c.bl.x];
  const ys = [c.tl.y, c.tr.y, c.br.y, c.bl.y];
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  return {
    candidate,
    x0, x1, y0, y1,
    w: x1 - x0,
    h: y1 - y0,
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2
  };
}

/** k elemanlı tüm alt kümeler (aday sayısı küçük olduğu için kaba kuvvet yeterli). */
function combinations(items, k) {
  const out = [];
  const walk = (start, picked) => {
    if (picked.length === k) { out.push(picked.slice()); return; }
    for (let i = start; i < items.length; i++) {
      picked.push(items[i]);
      walk(i + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);
  return out;
}

/** Panelleri bir seri sayabilmek için sınırlar. */
const LIMITS = {
  sizeRatio: 1.35,      // en büyük / en küçük panel (genişlik ve yükseklik)
  centerDrift: 0.06,    // dikey hizadan sapma (görsel yüksekliğine oran)
  overlap: 0.18         // yatayda birbirine girme payı (dar panelin genişliğine oran)
};

/**
 * Adaylar arasından yan yana duran `count` panelli bir seri seçer.
 *
 * @param {Array} candidates detectMockupQuads çıktısı
 * @param {number} count panel sayısı (2, 3, ...)
 * @returns {{ panels: Array, score: number }|null} soldan sağa sıralı paneller
 */
export function pickPanelRow(candidates = [], count = 2) {
  if (count < 2 || candidates.length < count) return null;

  const boxes = candidates.map(boxOf).filter(b => b.w > 0.01 && b.h > 0.01);
  if (boxes.length < count) return null;

  let best = null;

  for (const combo of combinations(boxes, count)) {
    const row = [...combo].sort((a, b) => a.cx - b.cx);

    // Benzer boyut
    const widths = row.map(b => b.w);
    const heights = row.map(b => b.h);
    const wRatio = Math.max(...widths) / Math.min(...widths);
    const hRatio = Math.max(...heights) / Math.min(...heights);
    if (wRatio > LIMITS.sizeRatio || hRatio > LIMITS.sizeRatio) continue;

    // Aynı dikey hiza
    const meanCy = row.reduce((s, b) => s + b.cy, 0) / row.length;
    const drift = Math.max(...row.map(b => Math.abs(b.cy - meanCy)));
    if (drift > LIMITS.centerDrift) continue;

    // Yatayda ayrık: komşu paneller birbirine girmemeli
    let overlapping = false;
    const gaps = [];
    for (let i = 1; i < row.length; i++) {
      const prev = row[i - 1];
      const cur = row[i];
      const gap = cur.x0 - prev.x1;
      const narrow = Math.min(prev.w, cur.w);
      if (gap < -LIMITS.overlap * narrow) { overlapping = true; break; }
      gaps.push(gap);
    }
    if (overlapping) continue;

    // Eşit aralık (üç ve daha fazla panelde anlamlı)
    let gapPenalty = 0;
    if (gaps.length > 1) {
      const meanGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      const spread = Math.max(...gaps) - Math.min(...gaps);
      gapPenalty = meanGap > 0 ? Math.min(1, spread / Math.max(meanGap, 0.02)) : 0;
    }

    // Puan: tanıma güveni + hizanın ve boyutların tutarlılığı
    const detection = row.reduce((s, b) => s + (b.candidate.score || 0), 0) / row.length;
    const score =
      detection
      + 1.5 * (1 - drift / LIMITS.centerDrift)
      + 1.0 * (1 - (wRatio - 1) / (LIMITS.sizeRatio - 1))
      + 0.8 * (1 - (hRatio - 1) / (LIMITS.sizeRatio - 1))
      - 0.6 * gapPenalty;

    if (!best || score > best.score) {
      best = { panels: row.map(b => b.candidate), score };
    }
  }

  return best;
}
