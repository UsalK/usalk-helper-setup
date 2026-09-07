// Keep in sync with frontend/src/utils/mockupOutput.js.
export function getMockupOutputSize(width, height, minShortEdge = 2000) {
  const requested = Number(minShortEdge);
  const minimum = Number.isFinite(requested) ? Math.max(2000, Math.round(requested)) : 2000;
  const scale = Math.max(1, minimum / Math.min(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
