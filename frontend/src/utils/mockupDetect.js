// Mockup şablonu otomatik köşe tanıma motoru.
//
// Stüdyoya yüklenen bir sahne fotoğrafındaki tablo/çerçeve alanını bulup
// perspektif köşelerini çıkarır. İki bağımsız aday kaynağı birleştirilir:
//
//   1) Kenar (Hough) dedektörü — görseldeki baskın düz çizgiler bulunur, iki
//      dikey + iki yatay çizginin kesişiminden dörtgenler kurulur. Üzerinde
//      eser bulunan (dolu) mockup'larda çerçeve kenarı ince bir çizgi olduğu
//      için asıl güvenilen yöntem budur.
//   2) Bölge dedektörü — düz renkli alanlar büyütülerek (region growing)
//      çıkarılır; alanın kendisi (boş beyaz tuval) veya içindeki boşluk
//      (kalın çerçevenin ortası) aday olur.
//
// Tüm adaylar ortak bir ölçütle puanlanır: kenar desteği (dörtgenin kenarları
// gerçekten görseldeki kenarlara oturuyor mu), iç/dış kontrast, alan, boşluk
// doluluğu ve perspektif tutarlılığı.
//
// Dönen köşeler 0-1 aralığında normalize edilir; TemplateStudio'daki
// `corners` yapısıyla birebir aynıdır.

/** Tanımanın yapıldığı küçültülmüş görselin en uzun kenarı (px). */
const MAX_DIM = 620;

/** Bölge büyütmede komşunun bölge ortalamasına uzaklık sınırı. */
const TOL_MEAN = 22;
/** Bölge çekirdeğinden izin verilen toplam renk kayması. */
const TOL_SEED = 54;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v) => clamp(v, 0, 1);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Aşamalar arasında ana iş parçacığını bırakır; tarama animasyonu ve durum
 * yazısı akmaya devam eder.
 *
 * requestAnimationFrame tek başına yeterli değildir: sekme arka plana
 * alındığında (ya da pencere başka bir pencerenin arkasında kaldığında)
 * tarayıcı rAF'i tamamen durdurur ve tarama asla bitmez. Bu yüzden zamanlayıcı
 * ile yarıştırılır; hangisi önce gelirse o devam ettirir.
 */
const tick = () => new Promise(resolve => {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    resolve();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
  setTimeout(finish, 32);
});

/* ------------------------------------------------------------------ */
/* 1. Görsel hazırlığı                                                 */
/* ------------------------------------------------------------------ */

function toImageData(img, maxDim = MAX_DIM) {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const w = Math.max(16, Math.round(srcW * scale));
  const h = Math.max(16, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Gri tonlama + 3x3 kutu bulanıklaştırma (gürültü kenar sanılmasın). */
function toGray(imageData) {
  const { data, width: w, height: h } = imageData;
  const n = w * h;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i << 2;
    raw[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }

  const gray = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += raw[yy * w + xx];
          cnt++;
        }
      }
      gray[y * w + x] = sum / cnt;
    }
  }
  return gray;
}

/** Sobel gradyanı. */
function sobel(gray, w, h) {
  const n = w * h;
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  const mag = new Float32Array(n);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = gray[i - w - 1], tc = gray[i - w], tr = gray[i - w + 1];
      const ml = gray[i - 1], mr = gray[i + 1];
      const bl = gray[i + w - 1], bc = gray[i + w], br = gray[i + w + 1];

      const sx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      const sy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
      gx[i] = sx;
      gy[i] = sy;
      mag[i] = Math.hypot(sx, sy);
    }
  }
  return { gx, gy, mag };
}

/** Kenar sayılacak gradyan eşiği (yüzdelik dilim tabanlı). */
function edgeThreshold(mag, percentile = 0.86, floor = 15) {
  const hist = new Int32Array(257);
  let max = 0;
  for (let i = 0; i < mag.length; i++) if (mag[i] > max) max = mag[i];
  if (max <= 0) return Infinity;

  for (let i = 0; i < mag.length; i++) {
    hist[Math.min(256, (mag[i] / max * 256) | 0)]++;
  }
  const target = mag.length * percentile;
  let acc = 0;
  for (let b = 0; b <= 256; b++) {
    acc += hist[b];
    if (acc >= target) return Math.max(floor, (b / 256) * max);
  }
  return Math.max(floor, max * 0.5);
}

/* ------------------------------------------------------------------ */
/* 2. Kenar dedektörü: yönlü Hough + çizgi çifti sayımı                */
/* ------------------------------------------------------------------ */

const THETA_BINS = 360;               // 0.5° çözünürlük
const THETA_STEP = Math.PI / THETA_BINS;

/**
 * Yönlü Hough dönüşümü: her kenar pikseli yalnızca kendi gradyan yönüne
 * yakın açılara oy verir. Klasik Hough'a göre çok daha temiz tepe verir.
 */
function houghLines(mag, gx, gy, w, h, thresh) {
  const rhoMax = Math.ceil(Math.hypot(w, h));
  const rhoBins = 2 * rhoMax + 1;
  const acc = new Int32Array(THETA_BINS * rhoBins);
  const spread = 6; // ±3°

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mag[i] < thresh) continue;

      let phi = Math.atan2(gy[i], gx[i]);
      if (phi < 0) phi += Math.PI;
      if (phi >= Math.PI) phi -= Math.PI;
      const centre = Math.round(phi / THETA_STEP);

      for (let d = -spread; d <= spread; d++) {
        let t = centre + d;
        if (t < 0) t += THETA_BINS;
        else if (t >= THETA_BINS) t -= THETA_BINS;
        const theta = t * THETA_STEP;
        const rho = Math.round(x * Math.cos(theta) + y * Math.sin(theta)) + rhoMax;
        if (rho < 0 || rho >= rhoBins) continue;
        acc[t * rhoBins + rho]++;
      }
    }
  }

  // Tepe noktaları: yerel maksimum + asgari oy
  const minVotes = Math.max(20, Math.round(Math.min(w, h) * 0.11));
  const peaks = [];
  for (let t = 0; t < THETA_BINS; t++) {
    const base = t * rhoBins;
    for (let r = 3; r < rhoBins - 3; r++) {
      const v = acc[base + r];
      if (v < minVotes) continue;

      let isMax = true;
      for (let dt = -3; dt <= 3 && isMax; dt++) {
        let tt = t + dt;
        if (tt < 0) tt += THETA_BINS;
        else if (tt >= THETA_BINS) tt -= THETA_BINS;
        const bb = tt * rhoBins;
        for (let dr = -6; dr <= 6; dr++) {
          if (dt === 0 && dr === 0) continue;
          const o = acc[bb + r + dr];
          if (o > v || (o === v && (dt < 0 || (dt === 0 && dr < 0)))) { isMax = false; break; }
        }
      }
      if (isMax) peaks.push({ theta: t * THETA_STEP, rho: r - rhoMax, votes: v });
    }
  }

  peaks.sort((a, b) => b.votes - a.votes);
  return peaks;
}

/** Normal açısı θ olan doğrunun yönü θ+90°'dir: dikey mi yatay mı? */
function classifyLines(peaks, maxPerGroup = 22) {
  const vertical = [];   // normali yatay → çizgi dikey
  const horizontal = []; // normali dikey  → çizgi yatay
  const deg = (t) => t * 180 / Math.PI;

  for (const p of peaks) {
    const d = deg(p.theta);
    if (d <= 34 || d >= 146) {
      if (vertical.length < maxPerGroup) vertical.push(p);
    } else if (d >= 56 && d <= 124) {
      if (horizontal.length < maxPerGroup) horizontal.push(p);
    }
    if (vertical.length >= maxPerGroup && horizontal.length >= maxPerGroup) break;
  }
  return { vertical, horizontal };
}

function intersectPolar(l1, l2) {
  const c1 = Math.cos(l1.theta), s1 = Math.sin(l1.theta);
  const c2 = Math.cos(l2.theta), s2 = Math.sin(l2.theta);
  const det = c1 * s2 - s1 * c2;
  if (Math.abs(det) < 1e-6) return null;
  return {
    x: (l1.rho * s2 - l2.rho * s1) / det,
    y: (l2.rho * c1 - l1.rho * c2) / det
  };
}

/**
 * Bir kenarın görseldeki gerçek kenarlarla ne kadar örtüştüğü (0-1).
 * Her örnek noktada, kenarın normaline paralel güçlü bir gradyan aranır.
 */
function edgeSupport(a, b, mag, gx, gy, w, h, thresh) {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len = Math.hypot(ex, ey);
  if (len < 4) return 0;

  const nx = -ey / len;
  const ny = ex / len;
  const samples = 40;
  let hits = 0;

  for (let i = 0; i < samples; i++) {
    const t = 0.04 + 0.92 * (i / (samples - 1));
    const px = a.x + ex * t;
    const py = a.y + ey * t;
    let ok = false;

    for (let s = -2; s <= 2 && !ok; s++) {
      const qx = Math.round(px + nx * s);
      const qy = Math.round(py + ny * s);
      if (qx < 1 || qy < 1 || qx >= w - 1 || qy >= h - 1) continue;
      const j = qy * w + qx;
      const m = mag[j];
      if (m < thresh) continue;
      if (Math.abs(gx[j] * nx + gy[j] * ny) / m > 0.87) ok = true;
    }
    if (ok) hits++;
  }
  return hits / samples;
}

/**
 * İki dikey + iki yatay çizginin kesişiminden dörtgen adayları üretir.
 *
 * Kenar destekleri paylaşıldığı için önceden hesaplanır: üst kenar yalnızca
 * (yatay çizgi, dikey çift) üçlüsüne bağlıdır, alt kenarın hangi yatay çizgi
 * olduğuna bağlı değildir. Böylece V²H² dörtgen için 2·V·H²/2 destek hesabı
 * yeterli olur ve tarama tarayıcıda saniyenin altında kalır.
 */
function edgeQuadCandidates(ctx, peaks) {
  const { w, h, mag, gx, gy, thresh } = ctx;
  const N = w * h;
  const { vertical, horizontal } = classifyLines(peaks);

  const midY = h / 2;
  const midX = w / 2;
  const xAt = (l, y) => (Math.abs(Math.cos(l.theta)) < 1e-6 ? NaN : (l.rho - y * Math.sin(l.theta)) / Math.cos(l.theta));
  const yAt = (l, x) => (Math.abs(Math.sin(l.theta)) < 1e-6 ? NaN : (l.rho - x * Math.cos(l.theta)) / Math.sin(l.theta));

  const vs = vertical.map(l => ({ l, at: xAt(l, midY) })).filter(o => Number.isFinite(o.at)).sort((a, b) => a.at - b.at);
  const hs = horizontal.map(l => ({ l, at: yAt(l, midX) })).filter(o => Number.isFinite(o.at)).sort((a, b) => a.at - b.at);

  const V = vs.length;
  const H = hs.length;
  if (V < 2 || H < 2) return { candidates: [], lineCount: { vertical: V, horizontal: H } };

  // Kesişim tablosu: X[k * V + i] = yatay k ile dikey i'nin kesişimi
  const pad = Math.max(w, h) * 0.10;
  const X = new Array(H * V).fill(null);
  for (let k = 0; k < H; k++) {
    for (let i = 0; i < V; i++) {
      const p = intersectPolar(hs[k].l, vs[i].l);
      if (!p || p.x < -pad || p.y < -pad || p.x > w + pad || p.y > h + pad) continue;
      X[k * V + i] = p;
    }
  }

  const sup = (a, b) => (a && b ? edgeSupport(a, b, mag, gx, gy, w, h, thresh) : 0);

  // hSup[k][i * V + j] — yatay çizgi k üzerinde, dikey i ile j arasındaki parça
  const minGapX = w * 0.10;
  const minGapY = h * 0.10;
  const hSup = [];
  for (let k = 0; k < H; k++) {
    const row = new Float32Array(V * V);
    for (let i = 0; i < V; i++) {
      for (let j = i + 1; j < V; j++) {
        if (vs[j].at - vs[i].at < minGapX) continue;
        row[i * V + j] = sup(X[k * V + i], X[k * V + j]);
      }
    }
    hSup.push(row);
  }

  // vSup[i][k * H + m] — dikey çizgi i üzerinde, yatay k ile m arasındaki parça
  const vSup = [];
  for (let i = 0; i < V; i++) {
    const row = new Float32Array(H * H);
    for (let k = 0; k < H; k++) {
      for (let m = k + 1; m < H; m++) {
        if (hs[m].at - hs[k].at < minGapY) continue;
        row[k * H + m] = sup(X[k * V + i], X[m * V + i]);
      }
    }
    vSup.push(row);
  }

  const MIN_SIDE = 0.40;
  const candidates = [];

  for (let i = 0; i < V; i++) {
    for (let j = i + 1; j < V; j++) {
      if (vs[j].at - vs[i].at < minGapX) continue;
      const vIdx = i * V + j;

      for (let k = 0; k < H; k++) {
        const sTop = hSup[k][vIdx];
        if (sTop < MIN_SIDE) continue;

        for (let m = k + 1; m < H; m++) {
          if (hs[m].at - hs[k].at < minGapY) continue;
          const sBottom = hSup[m][vIdx];
          if (sBottom < MIN_SIDE) continue;

          const hIdx = k * H + m;
          const sLeft = vSup[i][hIdx];
          if (sLeft < MIN_SIDE) continue;
          const sRight = vSup[j][hIdx];
          if (sRight < MIN_SIDE) continue;

          const tl = X[k * V + i], tr = X[k * V + j];
          const br = X[m * V + j], bl = X[m * V + i];
          if (!tl || !tr || !br || !bl) continue;

          const quad = [tl, tr, br, bl];
          const quadArea = polygonArea(quad);
          if (quadArea < N * 0.015 || quadArea > N * 0.85) continue;

          candidates.push({
            quad, quadArea, fillRatio: null, source: 'edge', isHole: false,
            sides: [sTop, sRight, sBottom, sLeft]
          });
        }
      }
    }
  }

  return { candidates, lineCount: { vertical: V, horizontal: H } };
}

/* ------------------------------------------------------------------ */
/* 3. Bölge dedektörü                                                  */
/* ------------------------------------------------------------------ */

function segment(imageData) {
  const { data, width: w, height: h } = imageData;
  const n = w * h;
  const labels = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const regions = [];
  const tm2 = TOL_MEAN * TOL_MEAN;
  const ts2 = TOL_SEED * TOL_SEED;

  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1) continue;

    const id = regions.length;
    const so = start << 2;
    const sr = data[so], sg = data[so + 1], sb = data[so + 2];

    let sumR = sr, sumG = sg, sumB = sb, count = 1;
    let minX = start % w, maxX = minX;
    let minY = (start / w) | 0, maxY = minY;

    let head = 0, tail = 0;
    labels[start] = id;
    queue[tail++] = start;

    while (head < tail) {
      const p = queue[head++];
      const px = p % w;
      const py = (p / w) | 0;
      const mr = sumR / count, mg = sumG / count, mb = sumB / count;

      for (let k = 0; k < 4; k++) {
        const qx = px + (k === 0 ? -1 : k === 1 ? 1 : 0);
        const qy = py + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;

        const q = qy * w + qx;
        if (labels[q] !== -1) continue;

        const qo = q << 2;
        const r = data[qo], g = data[qo + 1], b = data[qo + 2];

        let dr = r - mr, dg = g - mg, db = b - mb;
        if (dr * dr + dg * dg + db * db > tm2) continue;
        dr = r - sr; dg = g - sg; db = b - sb;
        if (dr * dr + dg * dg + db * db > ts2) continue;

        labels[q] = id;
        queue[tail++] = q;
        sumR += r; sumG += g; sumB += b; count++;
        if (qx < minX) minX = qx; else if (qx > maxX) maxX = qx;
        if (qy < minY) minY = qy; else if (qy > maxY) maxY = qy;
      }
    }

    regions.push({ id, area: count, minX, maxX, minY, maxY });
  }

  return { labels, regions };
}

/** Bölgenin içinde kalan, dışarıya bağlanamayan piksel kümeleri. */
function holesOfRegion(labels, w, h, region, minArea) {
  const x0 = Math.max(0, region.minX - 1);
  const x1 = Math.min(w - 1, region.maxX + 1);
  const y0 = Math.max(0, region.minY - 1);
  const y1 = Math.min(h - 1, region.maxY + 1);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  if (bw < 6 || bh < 6) return [];

  // 0 = boşluk adayı, 1 = bölgenin kendisi, 2 = dışarıya bağlı
  const state = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    const rowSrc = (y0 + y) * w + x0;
    const rowDst = y * bw;
    for (let x = 0; x < bw; x++) {
      if (labels[rowSrc + x] === region.id) state[rowDst + x] = 1;
    }
  }

  const stack = new Int32Array(bw * bh);
  let sp = 0;
  const pushOutside = (x, y) => {
    const i = y * bw + x;
    if (state[i] === 0) { state[i] = 2; stack[sp++] = i; }
  };
  for (let x = 0; x < bw; x++) { pushOutside(x, 0); pushOutside(x, bh - 1); }
  for (let y = 0; y < bh; y++) { pushOutside(0, y); pushOutside(bw - 1, y); }

  while (sp > 0) {
    const i = stack[--sp];
    const x = i % bw;
    const y = (i / bw) | 0;
    if (x > 0) pushOutside(x - 1, y);
    if (x < bw - 1) pushOutside(x + 1, y);
    if (y > 0) pushOutside(x, y - 1);
    if (y < bh - 1) pushOutside(x, y + 1);
  }

  const holes = [];
  const comp = new Int32Array(bw * bh).fill(-1);
  for (let seed = 0; seed < state.length; seed++) {
    if (state[seed] !== 0 || comp[seed] !== -1) continue;

    const label = holes.length;
    const mask = new Uint8Array(bw * bh);
    let area = 0;
    let hMinX = bw, hMaxX = 0, hMinY = bh, hMaxY = 0;
    let head = 0, tail = 0;
    comp[seed] = label;
    stack[tail++] = seed;

    while (head < tail) {
      const i = stack[head++];
      const x = i % bw;
      const y = (i / bw) | 0;
      mask[i] = 1;
      area++;
      if (x < hMinX) hMinX = x;
      if (x > hMaxX) hMaxX = x;
      if (y < hMinY) hMinY = y;
      if (y > hMaxY) hMaxY = y;

      const nb = [
        x > 0 ? i - 1 : -1,
        x < bw - 1 ? i + 1 : -1,
        y > 0 ? i - bw : -1,
        y < bh - 1 ? i + bw : -1
      ];
      for (const j of nb) {
        if (j < 0 || state[j] !== 0 || comp[j] !== -1) continue;
        comp[j] = label;
        stack[tail++] = j;
      }
    }

    if (area >= minArea) {
      holes.push({ mask, area, x0, y0, bw, bh, minX: hMinX, maxX: hMaxX, minY: hMinY, maxY: hMaxY });
    }
  }

  return holes;
}

/* ------------------------------------------------------------------ */
/* 4. Geometri yardımcıları                                            */
/* ------------------------------------------------------------------ */

/** Andrew monotone chain — dışbükey zarf. */
function convexHull(points) {
  if (points.length < 4) return points.slice();
  const pts = points.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Nokta bulutundan kaba köşeler: dik duran dörtgenler için güvenilir. */
function extremeCorners(hull) {
  let tl = hull[0], tr = hull[0], br = hull[0], bl = hull[0];
  let sMin = Infinity, sMax = -Infinity, dMin = Infinity, dMax = -Infinity;
  for (const p of hull) {
    const s = p.x + p.y;
    const d = p.x - p.y;
    if (s < sMin) { sMin = s; tl = p; }
    if (s > sMax) { sMax = s; br = p; }
    if (d > dMax) { dMax = d; tr = p; }
    if (d < dMin) { dMin = d; bl = p; }
  }
  return [tl, tr, br, bl];
}

function fitLine(points) {
  let mx = 0, my = 0;
  for (const p of points) { mx += p.x; my += p.y; }
  mx /= points.length;
  my /= points.length;

  let sxx = 0, syy = 0, sxy = 0;
  for (const p of points) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: { x: mx, y: my }, d: { x: Math.cos(theta), y: Math.sin(theta) } };
}

function lineThrough(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { p: a, d: { x: dx / len, y: dy / len } };
}

function intersectLines(l1, l2) {
  const det = l1.d.x * (-l2.d.y) - l1.d.y * (-l2.d.x);
  if (Math.abs(det) < 1e-9) return null;
  const rx = l2.p.x - l1.p.x;
  const ry = l2.p.y - l1.p.y;
  const t = (rx * (-l2.d.y) - ry * (-l2.d.x)) / det;
  return { x: l1.p.x + t * l1.d.x, y: l1.p.y + t * l1.d.y };
}

/** Kaba köşeleri sınır piksellerine doğru uydurarak keskinleştirir. */
function refineCorners(boundary, quad, tolPx) {
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const groups = [[], [], [], []];

  for (const p of boundary) {
    let best = -1, bestD = Infinity, bestT = 0;
    for (let e = 0; e < 4; e++) {
      const a = quad[edges[e][0]];
      const b = quad[edges[e][1]];
      const vx = b.x - a.x, vy = b.y - a.y;
      const L2 = vx * vx + vy * vy;
      if (L2 < 1e-9) continue;
      const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2;
      const tc = clamp01(t);
      const d = Math.hypot(p.x - (a.x + tc * vx), p.y - (a.y + tc * vy));
      if (d < bestD) { bestD = d; best = e; bestT = t; }
    }
    if (best >= 0 && bestD <= tolPx && bestT > 0.14 && bestT < 0.86) groups[best].push(p);
  }

  const lines = groups.map((g, e) => (
    g.length >= 10 ? fitLine(g) : lineThrough(quad[edges[e][0]], quad[edges[e][1]])
  ));

  const diag = dist(quad[0], quad[2]);
  const maxShift = Math.max(4, diag * 0.09);
  const pairs = [[3, 0], [0, 1], [1, 2], [2, 3]];

  return quad.map((orig, i) => {
    const hit = intersectLines(lines[pairs[i][0]], lines[pairs[i][1]]);
    if (!hit || !Number.isFinite(hit.x) || !Number.isFinite(hit.y)) return orig;
    return dist(hit, orig) > maxShift ? orig : hit;
  });
}

function polygonArea(q) {
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const p1 = q[i];
    const p2 = q[(i + 1) % q.length];
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(a) / 2;
}

function isConvex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < 1e-9) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

function interiorAngles(q) {
  return q.map((p, i) => {
    const prev = q[(i + 3) % 4];
    const next = q[(i + 1) % 4];
    const a1 = Math.atan2(prev.y - p.y, prev.x - p.x);
    const a2 = Math.atan2(next.y - p.y, next.x - p.x);
    let d = Math.abs(a1 - a2) * 180 / Math.PI;
    if (d > 180) d = 360 - d;
    return d;
  });
}

/** Bir maskeyi (yerel koordinatlarda) dörtgene oturtur. */
function quadFromMask(inMask, x0, y0, bw, bh, area) {
  const boundary = [];
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (!inMask(x, y)) continue;
      if (x === 0 || y === 0 || x === bw - 1 || y === bh - 1 ||
          !inMask(x - 1, y) || !inMask(x + 1, y) || !inMask(x, y - 1) || !inMask(x, y + 1)) {
        boundary.push({ x: x + x0, y: y + y0 });
      }
    }
  }
  if (boundary.length < 24) return null;

  const hull = convexHull(boundary);
  if (hull.length < 4) return null;

  let quad = extremeCorners(hull);
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (dist(quad[i], quad[j]) < 3) return null;
    }
  }

  quad = refineCorners(boundary, quad, 2.6);
  const quadArea = polygonArea(quad);
  if (quadArea < 1) return null;

  return { quad, maskArea: area, quadArea, fillRatio: clamp01(area / quadArea) };
}

/* ------------------------------------------------------------------ */
/* 5. Ortak puanlama                                                   */
/* ------------------------------------------------------------------ */

/** Dörtgen içinde çift doğrusal örnekleme noktası. */
const quadPoint = (q, u, v) => {
  const topX = q[0].x + (q[1].x - q[0].x) * u;
  const topY = q[0].y + (q[1].y - q[0].y) * u;
  const botX = q[3].x + (q[2].x - q[3].x) * u;
  const botY = q[3].y + (q[2].y - q[3].y) * u;
  return { x: topX + (botX - topX) * v, y: topY + (botY - topY) * v };
};

/** İç bölgenin parlaklık/doygunluk istatistikleri ve dışıyla kontrastı. */
function interiorStats(q, data, w, h) {
  let sum = 0, sum2 = 0, satSum = 0, count = 0;
  const grid = 13;
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const u = 0.10 + 0.80 * (i / (grid - 1));
      const v = 0.10 + 0.80 * (j / (grid - 1));
      const p = quadPoint(q, u, v);
      const x = Math.round(p.x), y = Math.round(p.y);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const o = (y * w + x) << 2;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sum += L; sum2 += L * L; satSum += mx > 0 ? (mx - mn) / mx : 0;
      count++;
    }
  }
  if (!count) return null;

  const mean = sum / count;
  const std = Math.sqrt(Math.max(0, sum2 / count - mean * mean));
  const sat = satSum / count;

  // Dört kenarın hemen iç ve dış tarafını ayrı ayrı örnekle. Gerçek bir
  // tablo/çerçevede dört kenarda da iç taraf dışa göre tutarlı biçimde daha
  // koyu ya da daha açıktır (polarite tutarlılığı). Boş bir duvarda birbiriyle
  // ilgisiz çizgilerden kurulan sahte dörtgende bu tutarlılık bulunmaz.
  const sideDelta = [];
  const sides = [
    { fixed: 'v', at: 0 },  // üst
    { fixed: 'u', at: 1 },  // sağ
    { fixed: 'v', at: 1 },  // alt
    { fixed: 'u', at: 0 }   // sol
  ];

  for (const side of sides) {
    let inSum = 0, inN = 0, outSum = 0, outN = 0;
    for (let i = 0; i < 20; i++) {
      const t = 0.10 + 0.80 * (i / 19);
      const inAt = side.at === 0 ? 0.045 : 0.955;
      const outAt = side.at === 0 ? -0.045 : 1.045;
      const pIn = side.fixed === 'v' ? quadPoint(q, t, inAt) : quadPoint(q, inAt, t);
      const pOut = side.fixed === 'v' ? quadPoint(q, t, outAt) : quadPoint(q, outAt, t);

      for (const [p, isIn] of [[pIn, true], [pOut, false]]) {
        const x = Math.round(p.x), y = Math.round(p.y);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const o = (y * w + x) << 2;
        const L = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
        if (isIn) { inSum += L; inN++; } else { outSum += L; outN++; }
      }
    }
    sideDelta.push(inN && outN ? (inSum / inN) - (outSum / outN) : 0);
  }

  const contrast = sideDelta.reduce((s, d) => s + Math.abs(d), 0) / 4;
  const positives = sideDelta.filter(d => d > 0).length;
  // 4/4 aynı yönde → 1.0, 2/4 → 0 (tutarsız)
  const polarity = Math.abs(positives - 2) / 2;

  return {
    mean, std, sat,
    sideDelta, contrast, polarity,
    blankness: clamp01((mean - 186) / 64) * clamp01((0.17 - sat) / 0.17) * clamp01((34 - std) / 34)
  };
}

function evaluate(cand, ctx) {
  const { w, h, data, mag, gx, gy, thresh } = ctx;
  const q = cand.quad;
  const N = w * h;
  const areaFrac = cand.quadArea / N;
  const reject = (reason) => ({ ...cand, areaFrac, reject: reason });

  if (areaFrac < 0.015 || areaFrac > 0.85) return reject('alan');
  if (!isConvex(q)) return reject('dışbükey değil');
  if (interiorAngles(q).some(a => a < 52 || a > 128)) return reject('açı');

  const top = dist(q[0], q[1]);
  const bottom = dist(q[3], q[2]);
  const left = dist(q[0], q[3]);
  const right = dist(q[1], q[2]);
  if (Math.min(top, bottom, left, right) < 14) return reject('kenar kısa');

  const hSkew = Math.abs(top - bottom) / Math.max(top, bottom);
  const vSkew = Math.abs(left - right) / Math.max(left, right);
  if (hSkew > 0.36 || vSkew > 0.36) return reject('sapma');

  const aspect = ((top + bottom) / 2) / ((left + right) / 2);
  if (aspect < 0.18 || aspect > 5.5) return reject('oran');

  // Kenar desteği: dörtgenin kenarları görseldeki gerçek kenarlara oturuyor mu
  const sup = cand.sides || [
    edgeSupport(q[0], q[1], mag, gx, gy, w, h, thresh),
    edgeSupport(q[1], q[2], mag, gx, gy, w, h, thresh),
    edgeSupport(q[2], q[3], mag, gx, gy, w, h, thresh),
    edgeSupport(q[3], q[0], mag, gx, gy, w, h, thresh)
  ];
  const meanSup = (sup[0] + sup[1] + sup[2] + sup[3]) / 4;
  const minSup = Math.min(...sup);

  const solid = cand.fillRatio != null && cand.fillRatio >= 0.88;
  if (minSup < 0.42 && !(solid && minSup >= 0.18)) return reject('kenar desteği');
  if (meanSup < 0.58 && !solid) return reject('kenar desteği');

  const stats = interiorStats(q, data, w, h);
  if (!stats) return reject('örnek yok');

  // Görselin kenarına yapışan alanlar (duvar, zemin, gökyüzü) elenir
  const eps = 3;
  const xs = q.map(p => p.x), ys = q.map(p => p.y);
  let borderTouch = 0;
  if (Math.min(...xs) <= eps) borderTouch++;
  if (Math.max(...xs) >= w - 1 - eps) borderTouch++;
  if (Math.min(...ys) <= eps) borderTouch++;
  if (Math.max(...ys) >= h - 1 - eps) borderTouch++;
  borderTouch /= 4;
  if (borderTouch >= 0.5) return reject('kenara yapışık');

  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const centerDist = clamp01(Math.hypot(cx / w - 0.5, cy / h - 0.5) / 0.707);

  // Boş duvarda birbiriyle ilgisiz çizgilerden kurulan sahte dörtgenler:
  // ya iç/dış kontrastı yoktur ya da dört kenarın polaritesi tutarsızdır.
  if (stats.contrast < 7 && stats.blankness < 0.35) return reject('kontrast yok');
  if (stats.polarity < 0.5 && stats.contrast < 22) return reject('polarite tutarsız');

  let score = 0;
  score += 2.20 * meanSup;
  score += 1.30 * minSup;
  score += 0.90 * areaScore(areaFrac);
  score += 0.85 * clamp01(stats.contrast / 55);
  score += 0.60 * stats.polarity;
  score += 0.55 * stats.blankness;
  score += 0.45 * (cand.fillRatio != null ? cand.fillRatio : 0.85);
  score += 0.30 * (1 - centerDist);
  score -= 1.20 * borderTouch;
  score -= 0.70 * clamp01((hSkew + vSkew - 0.05) / 0.35);

  return {
    ...cand,
    reject: null,
    score, aspect, areaFrac, borderTouch,
    support: { mean: meanSup, min: minSup, sides: sup },
    stats,
    edges: { top, bottom, left, right },
    hSkew, vSkew
  };
}

function areaScore(frac) {
  const t = Math.log(frac / 0.22);
  return Math.exp(-(t * t) / (2 * 1.0 * 1.0));
}

/** İki dörtgenin sınırlayıcı kutu tabanlı örtüşmesi. */
function boxIoU(a, b) {
  const box = (c) => {
    const xs = c.quad.map(p => p.x);
    const ys = c.quad.map(p => p.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const [ax0, ay0, ax1, ay1] = box(a);
  const [bx0, by0, bx1, by1] = box(b);

  const ix = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
  const iy = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
  const inter = ix * iy;
  const union = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter;
  return union > 0 ? inter / union : 0;
}

/* ------------------------------------------------------------------ */
/* 6. Ana giriş noktaları                                              */
/* ------------------------------------------------------------------ */

/**
 * Sahne görselindeki çerçeve alanlarını bulur.
 *
 * @param {HTMLImageElement} img
 * @param {{ onPhase?: (phase: string) => void, maxCandidates?: number }} opts
 * @returns {Promise<Array>} puana göre sıralı adaylar
 */
export async function detectMockupQuads(img, opts = {}) {
  return (await analyzeMockup(img, opts)).candidates;
}

/**
 * detectMockupQuads ile aynı işi yapar, ayrıca elenmiş adayları da döner.
 * Eşik ayarı / hata ayıklama için kullanılır.
 */
export async function analyzeMockup(img, opts = {}) {
  const { onPhase, maxCandidates = 4 } = opts;

  onPhase?.('Görsel analiz ediliyor');
  const imageData = toImageData(img);
  const { data, width: w, height: h } = imageData;
  const N = w * h;
  const gray = toGray(imageData);
  const { gx, gy, mag } = sobel(gray, w, h);
  const thresh = edgeThreshold(mag);
  const ctx = { w, h, data, mag, gx, gy, thresh };
  await tick();

  onPhase?.('Kenarlar çıkarılıyor');
  const peaks = houghLines(mag, gx, gy, w, h, thresh);
  const { candidates: edgeCands, lineCount } = edgeQuadCandidates(ctx, peaks);
  const raw = edgeCands.slice();
  await tick();

  onPhase?.('Yüzeyler ayrıştırılıyor');
  const { labels, regions } = segment(imageData);

  // (b) Dolu, dörtgene yakın bölgeler → boş (beyaz) tuvaller
  const solids = regions
    .filter(r => r.area >= N * 0.02 && r.area <= N * 0.72)
    .sort((a, b) => b.area - a.area)
    .slice(0, 30);

  for (const r of solids) {
    const cand = quadFromMask(
      (x, y) => labels[(r.minY + y) * w + (r.minX + x)] === r.id,
      r.minX, r.minY, r.maxX - r.minX + 1, r.maxY - r.minY + 1, r.area
    );
    if (cand) raw.push({ ...cand, source: 'region', isHole: false });
  }
  await tick();

  // (c) Bölgelerin içindeki boşluklar → kalın çerçevenin ortası
  const rings = regions
    .filter(r => r.area >= N * 0.004)
    .map(r => ({ r, boxArea: (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1) }))
    .filter(x => x.boxArea >= N * 0.03)
    .sort((a, b) => b.boxArea - a.boxArea)
    .slice(0, 20);

  for (const { r } of rings) {
    for (const hole of holesOfRegion(labels, w, h, r, Math.round(N * 0.015))) {
      const cand = quadFromMask(
        (x, y) => hole.mask[y * hole.bw + x] === 1,
        hole.x0, hole.y0, hole.bw, hole.bh, hole.area
      );
      if (cand) raw.push({ ...cand, source: 'hole', isHole: true });
    }
  }
  await tick();

  onPhase?.('Köşeler yerleştiriliyor');
  // Aynı dörtgenin defalarca puanlanmasını önle (çizgi çiftleri çok üretir)
  const seen = new Set();
  const unique = [];
  for (const c of raw) {
    const key = c.quad.map(p => `${Math.round(p.x / 3)},${Math.round(p.y / 3)}`).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  const evaluated = unique.map(c => evaluate(c, ctx));
  const scored = evaluated.filter(c => !c.reject).sort((a, b) => b.score - a.score);
  await tick();

  // Örtüşen adayları tekille: iç içe iki dörtgende içteki gerçek eser alanı,
  // dıştaki çerçevenin dış kenarıdır.
  const kept = [];
  for (const cand of scored) {
    let merged = false;
    for (let i = 0; i < kept.length; i++) {
      if (boxIoU(kept[i], cand) <= 0.55) continue;
      merged = true;
      if (cand.quadArea < kept[i].quadArea && cand.score >= kept[i].score * 0.92) {
        kept[i] = { ...cand, score: Math.max(cand.score, kept[i].score) };
      }
      break;
    }
    if (!merged) kept.push(cand);
    if (kept.length >= maxCandidates * 4) break;
  }

  const toResult = (c) => ({
    corners: {
      tl: { x: clamp01(c.quad[0].x / w), y: clamp01(c.quad[0].y / h) },
      tr: { x: clamp01(c.quad[1].x / w), y: clamp01(c.quad[1].y / h) },
      br: { x: clamp01(c.quad[2].x / w), y: clamp01(c.quad[2].y / h) },
      bl: { x: clamp01(c.quad[3].x / w), y: clamp01(c.quad[3].y / h) }
    },
    score: c.score,
    support: c.support,
    contrast: c.stats?.contrast,
    polarity: c.stats?.polarity,
    blankness: c.stats?.blankness,
    fillRatio: c.fillRatio,
    areaFrac: c.areaFrac,
    source: c.source,
    isHole: c.isHole,
    reject: c.reject,
    kind: c.stats && c.stats.blankness > 0.45 ? 'blank' : (c.isHole ? 'framed' : 'scene')
  });

  return {
    width: w,
    height: h,
    lineCount,
    candidates: kept.sort((a, b) => b.score - a.score).slice(0, maxCandidates).map(toResult),
    all: evaluated.map(toResult)
  };
}
