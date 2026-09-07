/**
 * Hızlı perspektif warp — ters eşleme (inverse mapping) ile.
 *
 * NEDEN GEREKTİ:
 * Eski yöntem (homography.js/warpImage) hedef dörtgeni 24x24 ızgaraya bölüp
 * 1152 üçgenin her birini ayrı ayrı çiziyordu. Her üçgen için ctx.save() +
 * clip() + transform() + drawImage(TÜM GÖRSEL) yapılıyor; yani kaynak görsel
 * 1152 kez baştan çiziliyor ve her seferinde Skia bir clip maskesi ayırıyor.
 * Tarayıcıda bu GPU'da ucuzdu, sunucuda CPU'da 3000x3000 bir şablonda
 * 15 saniye sürüyor.
 *
 * YENİ YÖNTEM:
 * Hedef dörtgenin sınırlayıcı kutusundaki her piksel için, ters homografi ile
 * kaynak görseldeki karşılığı bulunup bilinear örnekleniyor. Maliyet artık
 * üçgen sayısından bağımsız — sadece hedef alanın piksel sayısı kadar.
 * Ayrıca parçalı afin yaklaşıklama yerine gerçek projektif dönüşüm
 * hesaplandığı için sonuç eskisinden daha doğru.
 *
 * Kenar yumuşatma: her piksel için 2x2 alt-örnekle kapsama oranı hesaplanıp
 * alfa olarak yazılır, böylece dörtgen kenarları tırtıklı olmaz.
 */

import { createCanvas } from '@napi-rs/canvas';
import { solveHomography } from './homography.js';

/**
 * Kaynak piksel verisi önbelleği.
 * Aynı ön-ölçeklenmiş görsel birden çok perspektif şablonunda kullanılıyor;
 * her seferinde getImageData ile 10-50 MB'lık tampon üretmek hem yavaş hem de
 * çöp toplayıcıyı boğuyordu. Görsel nesnesi yaşadığı sürece veri saklanır.
 */
const srcDataCache = new WeakMap();

function getSourcePixels(img) {
  const hit = srcDataCache.get(img);
  if (hit) return hit;

  const c = createCanvas(img.width, img.height);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, img.width, img.height).data;
  srcDataCache.set(img, data);
  return data;
}

/**
 * @param {CanvasRenderingContext2D} ctx hedef context
 * @param {Image|Canvas} img kaynak görsel
 * @param {Array<{x,y}>} destQuad [tl, tr, br, bl] hedef köşeler
 */
export function warpImageFast(ctx, img, destQuad) {
  const sw = img.width;
  const sh = img.height;

  const srcQuad = [
    { x: 0, y: 0 },
    { x: sw, y: 0 },
    { x: sw, y: sh },
    { x: 0, y: sh }
  ];

  // Ters yön: hedef -> kaynak
  const Hinv = solveHomography(destQuad, srcQuad);
  if (!Hinv) return false;

  const xs = destQuad.map(p => p.x);
  const ys = destQuad.map(p => p.y);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys)));

  const bw = maxX - minX;
  const bh = maxY - minY;
  if (bw <= 0 || bh <= 0) return false;

  // Kaynak pikseller (aynı görsel için tekrar çıkarılmaz)
  const srcData = getSourcePixels(img);

  const out = createCanvas(bw, bh);
  const outCtx = out.getContext('2d');
  const outImg = outCtx.createImageData(bw, bh);
  const dst = outImg.data;

  // Dörtgen kenarlarının yarı-düzlem katsayıları (içeride mi testi için)
  const edges = [];
  for (let i = 0; i < 4; i++) {
    const a = destQuad[i];
    const b = destQuad[(i + 1) % 4];
    edges.push({ ax: a.x, ay: a.y, dx: b.x - a.x, dy: b.y - a.y });
  }
  // Dörtgenin yönü (saat yönü / tersi) — işaret referansı olarak merkez kullanılır
  const cx = (destQuad[0].x + destQuad[1].x + destQuad[2].x + destQuad[3].x) / 4;
  const cy = (destQuad[0].y + destQuad[1].y + destQuad[2].y + destQuad[3].y) / 4;
  const signRef = edges.map(e => Math.sign((cx - e.ax) * e.dy - (cy - e.ay) * e.dx));

  const inside = (px, py) => {
    for (let i = 0; i < 4; i++) {
      const e = edges[i];
      const s = (px - e.ax) * e.dy - (py - e.ay) * e.dx;
      if (s !== 0 && Math.sign(s) !== signRef[i]) return false;
    }
    return true;
  };

  const h00 = Hinv[0][0], h01 = Hinv[0][1], h02 = Hinv[0][2];
  const h10 = Hinv[1][0], h11 = Hinv[1][1], h12 = Hinv[1][2];
  const h20 = Hinv[2][0], h21 = Hinv[2][1], h22 = Hinv[2][2];

  // 2x2 alt-örnek konumları (kenar yumuşatma için)
  const SUB = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];

  /**
   * Tarama satırının dörtgeni kestiği x aralığını bulur.
   *
   * Önceki sürüm her piksel için 4 alt-örnek × 4 kenar = 16 işaret hesabı
   * yapıyordu; alanın büyük kısmı dörtgenin tam içindeyken bu tamamen boşa
   * gidiyordu. Artık satır başına bir kez aralık hesaplanıyor, iç pikseller
   * testsiz işleniyor, yalnızca kenardaki birkaç piksel alt-örnekleniyor.
   */
  const scanSpan = (py) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 4; i++) {
      const a = destQuad[i];
      const b = destQuad[(i + 1) % 4];
      const y0 = a.y, y1 = b.y;
      if ((py < y0 && py < y1) || (py > y0 && py > y1)) continue;
      if (y0 === y1) {
        lo = Math.min(lo, a.x, b.x);
        hi = Math.max(hi, a.x, b.x);
        continue;
      }
      const t = (py - y0) / (y1 - y0);
      const x = a.x + t * (b.x - a.x);
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    return { lo, hi };
  };

  for (let y = 0; y < bh; y++) {
    const py = minY + y + 0.5;

    const { lo, hi } = scanSpan(py);
    if (!isFinite(lo) || !isFinite(hi) || hi < lo) continue;

    // Satırın işlenecek piksel aralığı (kenar yumuşatma payıyla birlikte)
    const xStart = Math.max(0, Math.floor(lo - minX) - 1);
    const xEnd = Math.min(bw - 1, Math.ceil(hi - minX) + 1);
    if (xEnd < xStart) continue;

    // Bu sınırların içindeki pikseller kesinlikle dörtgenin içinde:
    // alt-örneklemeye gerek yok.
    const innerStart = Math.max(0, Math.ceil(lo - minX) + 1);
    const innerEnd = Math.min(bw - 1, Math.floor(hi - minX) - 1);

    let rowOff = (y * bw + xStart) * 4;

    for (let x = xStart; x <= xEnd; x++) {
      const px = minX + x + 0.5;

      // kapsama oranı: iç bölgede sabit 4, yalnızca kenarda hesaplanır
      let cover;
      if (x >= innerStart && x <= innerEnd) {
        cover = 4;
      } else {
        cover = 0;
        for (let s = 0; s < 4; s++) {
          if (inside(minX + x + SUB[s][0], minY + y + SUB[s][1])) cover++;
        }
        if (cover === 0) { rowOff += 4; continue; }
      }

      // ters homografi ile kaynak koordinatı
      const w = h20 * px + h21 * py + h22;
      if (w === 0) { rowOff += 4; continue; }
      const u = (h00 * px + h01 * py + h02) / w;
      const v = (h10 * px + h11 * py + h12) / w;

      if (u < -0.5 || v < -0.5 || u > sw - 0.5 || v > sh - 0.5) { rowOff += 4; continue; }

      // bilinear örnekleme
      const u0 = Math.floor(u), v0 = Math.floor(v);
      const fu = u - u0, fv = v - v0;
      const u1 = u0 + 1 < sw ? u0 + 1 : sw - 1;
      const v1 = v0 + 1 < sh ? v0 + 1 : sh - 1;
      const cu0 = u0 < 0 ? 0 : u0;
      const cv0 = v0 < 0 ? 0 : v0;

      const i00 = (cv0 * sw + cu0) * 4;
      const i10 = (cv0 * sw + u1) * 4;
      const i01 = (v1 * sw + cu0) * 4;
      const i11 = (v1 * sw + u1) * 4;

      const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv);
      const w01 = (1 - fu) * fv, w11 = fu * fv;

      dst[rowOff]     = srcData[i00]     * w00 + srcData[i10]     * w10 + srcData[i01]     * w01 + srcData[i11]     * w11;
      dst[rowOff + 1] = srcData[i00 + 1] * w00 + srcData[i10 + 1] * w10 + srcData[i01 + 1] * w01 + srcData[i11 + 1] * w11;
      dst[rowOff + 2] = srcData[i00 + 2] * w00 + srcData[i10 + 2] * w10 + srcData[i01 + 2] * w01 + srcData[i11 + 2] * w11;
      dst[rowOff + 3] = (cover / 4) * 255;

      rowOff += 4;
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  ctx.drawImage(out, minX, minY);
  return true;
}
