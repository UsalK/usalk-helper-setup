// Homography matrix solver and texture mapper for Canvas 2D
// Based on solving the linear system H * src = dest using Gaussian elimination

export function solveHomography(src, dest) {
  // src and dest are arrays of 4 points: [{x, y}, {x, y}, {x, y}, {x, y}]
  // We want to find H (3x3 matrix, H22 = 1)
  // Solve A * h = B
  const A = [];
  const B = [];
  
  for (let i = 0; i < 4; i++) {
    const s = src[i];
    const d = dest[i];
    
    // Equation 1 for x
    A.push([s.x, s.y, 1, 0, 0, 0, -s.x * d.x, -s.y * d.x]);
    B.push(d.x);
    
    // Equation 2 for y
    A.push([0, 0, 0, s.x, s.y, 1, -s.x * d.y, -s.y * d.y]);
    B.push(d.y);
  }
  
  // Solve A * h = B using Gaussian elimination
  const h = gaussianElimination(A, B);
  if (!h) return null;
  
  // Return H matrix: [[h0, h1, h2], [h3, h4, h5], [h6, h7, 1]]
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1]
  ];
}

function gaussianElimination(A, B) {
  const n = A.length;
  for (let i = 0; i < n; i++) {
    A[i].push(B[i]); // augmented matrix
  }
  
  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
        maxRow = k;
      }
    }
    
    // Swap rows
    const temp = A[i];
    A[i] = A[maxRow];
    A[maxRow] = temp;
    
    if (Math.abs(A[i][i]) < 1e-10) {
      return null; // Singular matrix
    }
    
    // Eliminate columns below
    for (let k = i + 1; k < n; k++) {
      const c = -A[k][i] / A[i][i];
      for (let j = i; j <= n; j++) {
        if (i === j) {
          A[k][j] = 0;
        } else {
          A[k][j] += c * A[i][j];
        }
      }
    }
  }
  
  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = A[i][n] / A[i][i];
    for (let k = i - 1; k >= 0; k--) {
      A[k][n] -= A[k][i] * x[i];
    }
  }
  
  return x;
}

// Map a coordinate using homography matrix H
export function mapPoint(H, p) {
  const w = H[2][0] * p.x + H[2][1] * p.y + H[2][2];
  return {
    x: (H[0][0] * p.x + H[0][1] * p.y + H[0][2]) / w,
    y: (H[1][0] * p.x + H[1][1] * p.y + H[1][2]) / w
  };
}

// Warp an image onto a destination quad using a grid of triangles
export function warpImage(ctx, img, destQuad, gridSegments = 16) {
  const W = img.width;
  const H = img.height;
  
  // Source quad is simply the corners of the image
  const srcQuad = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H }
  ];
  
  const matrix = solveHomography(srcQuad, destQuad);
  if (!matrix) return;
  
  // Draw grid of triangles
  for (let y = 0; y < gridSegments; y++) {
    const sy1 = (y / gridSegments) * H;
    const sy2 = ((y + 1) / gridSegments) * H;
    
    for (let x = 0; x < gridSegments; x++) {
      const sx1 = (x / gridSegments) * W;
      const sx2 = ((x + 1) / gridSegments) * W;
      
      // 4 corners of current grid cell (source)
      const s00 = { x: sx1, y: sy1 };
      const s10 = { x: sx2, y: sy1 };
      const s11 = { x: sx2, y: sy2 };
      const s01 = { x: sx1, y: sy2 };
      
      // Map corners to destination
      const d00 = mapPoint(matrix, s00);
      const d10 = mapPoint(matrix, s10);
      const d11 = mapPoint(matrix, s11);
      const d01 = mapPoint(matrix, s01);
      
      // Triangle 1: Top-Left, Top-Right, Bottom-Left
      drawTriangle(ctx, img, 
        d00.x, d00.y, d10.x, d10.y, d01.x, d01.y,
        s00.x, s00.y, s10.x, s10.y, s01.x, s01.y
      );
      
      // Triangle 2: Top-Right, Bottom-Right, Bottom-Left
      drawTriangle(ctx, img,
        d10.x, d10.y, d11.x, d11.y, d01.x, d01.y,
        s10.x, s10.y, s11.x, s11.y, s01.x, s01.y
      );
    }
  }
}

function drawTriangle(ctx, img, x0, y0, x1, y1, x2, y2, sx0, sy0, sx1, sy1, sx2, sy2) {
  const denom = sx0 * (sy2 - sy1) - sx1 * sy2 + sx2 * sy1 + (sx1 - sx2) * sy0;
  if (Math.abs(denom) < 1e-6) {
    return;
  }
  
  const a = -(sy0 * (x2 - x1) - sy1 * x2 + sy2 * x1 + (sy1 - sy2) * x0) / denom;
  const b = -(sy0 * (y2 - y1) - sy1 * y2 + sy2 * y1 + (sy1 - sy2) * y0) / denom;
  const c = (sx0 * (x2 - x1) - sx1 * x2 + sx2 * x1 + (sx1 - sx2) * x0) / denom;
  const d = (sx0 * (y2 - y1) - sx1 * y2 + sx2 * y1 + (sx1 - sx2) * y0) / denom;
  const e = (sx0 * (sy2 * x1 - sy1 * x2) + sy0 * (sx1 * x2 - sx2 * x1) + (sx2 * sy1 - sx1 * sy2) * x0) / denom;
  const f = (sx0 * (sy2 * y1 - sy1 * y2) + sy0 * (sx1 * y2 - sx2 * y1) + (sx2 * sy1 - sx1 * sy2) * y0) / denom;

  // Dilate clip path slightly (1.0px) to prevent sub-pixel seams
  const xc = (x0 + x1 + x2) / 3;
  const yc = (y0 + y1 + y2) / 3;
  const padding = 1.0;
  
  let dx0 = x0 - xc;
  let dy0 = y0 - yc;
  const len0 = Math.hypot(dx0, dy0);
  let px0 = x0;
  let py0 = y0;
  if (len0 > 1e-6) {
    px0 += (dx0 / len0) * padding;
    py0 += (dy0 / len0) * padding;
  }
  
  let dx1 = x1 - xc;
  let dy1 = y1 - yc;
  const len1 = Math.hypot(dx1, dy1);
  let px1 = x1;
  let py1 = y1;
  if (len1 > 1e-6) {
    px1 += (dx1 / len1) * padding;
    py1 += (dy1 / len1) * padding;
  }
  
  let dx2 = x2 - xc;
  let dy2 = y2 - yc;
  const len2 = Math.hypot(dx2, dy2);
  let px2 = x2;
  let py2 = y2;
  if (len2 > 1e-6) {
    px2 += (dx2 / len2) * padding;
    py2 += (dy2 / len2) * padding;
  }

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(px0, py0);
  ctx.lineTo(px1, py1);
  ctx.lineTo(px2, py2);
  ctx.closePath();
  ctx.clip();
  
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}
