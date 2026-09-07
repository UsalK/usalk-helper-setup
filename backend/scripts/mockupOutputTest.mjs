// node --experimental-test-module-mocks backend/scripts/mockupOutputTest.mjs
// Exercises the real renderer with a fake DB; writes only benchmark fixtures/results.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import fs from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getMockupOutputSize as browserSize } from '../../frontend/src/utils/mockupOutput.js';
import { getMockupOutputSize as serverSize } from '../services/mockupOutput.js';
import { warpImageFast } from '../services/warpFast.js';
import * as panels from '../../frontend/src/utils/panels.js';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const folder = 'logs/mockup-output-test';
fs.mkdirSync(join(root, folder), { recursive: true });
let template;
let minimum;
let warpInputSize;
mock.module('../db/db.js', {
  defaultExport: { prepare: sql => ({
    all: () => [template],
    get: (shopId, key) => sql.includes('variation_profiles')
      ? { ratio: '1:1', template_ids: '[]' }
      : { value: JSON.stringify({ mockup_min_short_edge_px: minimum, mockup_max_output_px: 800, mockup_max_upscale: 1, mockup_jpeg_quality: 92 }[key]) }
  }) },
  namedExports: { getProductStorageFolder: () => '../' + folder, DISABLED_PROFILE_IDS: [], isSetProfileId: () => false }
});
mock.module('../services/warpFast.js', { namedExports: {
  warpImageFast: (ctx, img, quad) => { warpInputSize = [img.width, img.height]; return warpImageFast(ctx, img, quad); }
} });
const { generateMockupsForProduct, clearMockupCache } = await import('../services/MockupRenderer.js');
const productCanvas = createCanvas(4000, 4000);
productCanvas.getContext('2d').fillStyle = '#ff0000';
productCanvas.getContext('2d').fillRect(0, 0, 4000, 4000);
const image_path = `${folder}/product.png`;
fs.writeFileSync(join(root, image_path), productCanvas.toBuffer('image/png'));
const cases = [
  [1024, 1024, 'flat', undefined, 2000, 2000],
  [1024, 3072, 'flat', undefined, 2000, 6000],
  [3072, 1024, 'static', undefined, 6000, 2000],
  [600, 600, 'flat', undefined, 2000, 2000],
  [3000, 3000, 'flat', undefined, 3000, 3000],
  [2000, 3000, 'static', undefined, 2000, 3000],
  [1024, 1024, 'perspective', undefined, 2000, 2000],
  [1024, 1024, 'static', 2400, 2400, 2400]
];
for (const [width, height, type, setting, expectedW, expectedH] of cases) {
  minimum = setting;
  const expected = { width: expectedW, height: expectedH };
  assert.deepEqual(browserSize(width, height, minimum), expected);
  assert.deepEqual(serverSize(width, height, minimum), expected);
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').fillStyle = '#ffffff';
  canvas.getContext('2d').fillRect(0, 0, width, height);
  const background_path = `${folder}/background.png`;
  const original = canvas.toBuffer('image/png');
  fs.writeFileSync(join(root, background_path), original);
  template = { id: 'template', type, background_path, config: JSON.stringify({
    compatible_ratios: ['1:1'], editorWidth: 800,
    placement: { x: .2, y: .2, width: .6, height: .6 },
    corners: { tl: { x: .2, y: .2 }, tr: { x: .8, y: .2 }, br: { x: .8, y: .8 }, bl: { x: .2, y: .8 } },
    frame: { style: 'stretched' }, shadow: { enabled: false }
  }) };
  clearMockupCache();
  const paths = await generateMockupsForProduct({ id: `${type}-${width}-${height}-${setting ?? 2000}`, shop_id: 'test', variation_profile_id: 'test', image_path });
  assert.equal(paths.length, 1);
  const result = await loadImage(join(root, paths[0]));
  assert.deepEqual([result.width, result.height], [expectedW, expectedH]);
  assert.deepEqual(fs.readFileSync(join(root, background_path)), original, 'Original template must not change');
  const probe = createCanvas(1, 1).getContext('2d');
  probe.drawImage(result, Math.floor(expectedW / 2), Math.floor(expectedH / 2), 1, 1, 0, 0, 1, 1);
  const pixel = probe.getImageData(0, 0, 1, 1).data;
  assert.ok(pixel[0] > 240 && (type === 'static' ? pixel[1] > 240 : pixel[1] < 15), 'Artwork stays centered');
  if (type === 'perspective') assert.ok(warpInputSize[0] >= 1200, 'Artwork pre-scale must cover the enlarged destination');
  console.log(`PASS ${type}: ${width}x${height} -> ${expectedW}x${expectedH}`);
}
for (const invalid of [0, -1, 1000, NaN, Infinity, 'invalid']) {
  assert.deepEqual(browserSize(600, 600, invalid), { width: 2000, height: 2000 });
  assert.deepEqual(serverSize(600, 600, invalid), { width: 2000, height: 2000 });
}
console.log('PASS invalid settings; legacy cap ignored; original files unchanged; centered artwork; perspective source resolution');

// Execute the panel's actual Canvas code with local image/API adapters.
const panelSource = fs.readFileSync(join(root, 'frontend/src/pages/BulkUpload.jsx'), 'utf8');
const drawingHelpers = panelSource.slice(panelSource.indexOf('const getLockedPlacement ='), panelSource.indexOf('export default function BulkUpload'));
const generation = panelSource.slice(panelSource.indexOf('  const getStepScaledCanvas ='), panelSource.indexOf('  // Queue Worker useEffect'));
for (const [width, height, type, , expectedW, expectedH] of [cases[1], cases[2]]) {
  const background = createCanvas(width, height);
  background.getContext('2d').fillStyle = '#ffffff';
  background.getContext('2d').fillRect(0, 0, width, height);
  const tpl = { ...template, type, config: JSON.parse(template.config) };
  const uploads = [];
  const dependencies = {
    ...panels, getMockupOutputSize: browserSize,
    API_BASE: 'test', templates: [tpl], variationProfiles: [{ id: 'test', ratio: '1:1' }],
    document: { createElement: () => createCanvas(1, 1) },
    renderCanvasRef: { current: createCanvas(1, 1) },
    loadImage: async url => url.endsWith(image_path) ? productCanvas : background,
    axios: { get: async () => ({ data: { mockup_max_output_px: 800, mockup_max_upscale: 1 } }), post: async (url, body) => uploads.push(body) }
  };
  const generate = new Function(...Object.keys(dependencies), drawingHelpers + generation + '\nreturn generateMockupsForProduct;')(...Object.values(dependencies));
  await generate({ id: 'test', variation_profile_id: 'test', image_path });
  assert.equal(uploads.length, 1);
  const result = await loadImage(Buffer.from(uploads[0].image.split(',')[1], 'base64'));
  assert.deepEqual([result.width, result.height], [expectedW, expectedH]);
  console.log(`PASS product panel ${type}: ${width}x${height} -> ${expectedW}x${expectedH}`);
}
mock.restoreAll();
