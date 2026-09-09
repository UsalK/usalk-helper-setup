// Read-only production data; scratch inputs/results go to logs/mockup-scale-bench.
// Runs the actual renderer with an in-memory DB adapter and output writes disabled.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const out = join(root, 'logs/mockup-scale-bench');
fs.mkdirSync(out, { recursive: true });
const db = new DatabaseSync(join(root, 'backend/db/database.db'), { readOnly: true });
const tpl = db.prepare("SELECT * FROM templates WHERE name = 't8' LIMIT 1").get();
const product = db.prepare('SELECT * FROM products WHERE image_path IS NOT NULL').all()
  .find(p => fs.existsSync(join(root, p.image_path)));
if (!tpl || !product) throw new Error('Missing benchmark inputs');
const original = await loadImage(join(root, tpl.background_path));
console.log(JSON.stringify({ template: tpl.name, size: [original.width, original.height], productId: product.id }));
let templates = [];
globalThis.mockupBenchDb = {
  prepare(sql) {
    return {
      all: () => templates,
      get: (...args) => sql.includes('variation_profiles')
        ? { ratio: '1:2', template_ids: '[]' }
        : sql.includes('settings') ? { value: JSON.stringify(args[1] === 'mockup_jpeg_quality' ? 92 : 2000) } : undefined
    };
  }
};
let source = fs.readFileSync(join(root, 'backend/services/MockupRenderer.js'), 'utf8');
source = source.replace(/import db,.*?from '\.\.\/db\/db\.js';/, 'const db = globalThis.mockupBenchDb;');
source = source.replace("from '@napi-rs/canvas'", `from '${import.meta.resolve('@napi-rs/canvas')}'`);
source = source.replace("from './warpFast.js'", `from '${pathToFileURL(join(root, 'backend/services/warpFast.js')).href}'`);
source = source.replace("import { getMockupOutputSize } from './mockupOutput.js';", `import { getMockupOutputSize as productionSize } from '${pathToFileURL(join(root, 'backend/services/mockupOutput.js')).href}';
const getMockupOutputSize = (w, h) => globalThis.mockupBenchNative ? { width: w, height: h } : productionSize(w, h);`);
source = source.replace('const __dirname = dirname(fileURLToPath(import.meta.url));', `const __dirname = ${JSON.stringify(join(root, 'backend/services'))};`);
source = source.replace(/function saveMockupToDisk\([\s\S]*?\n}\r?\n/, 'function saveMockupToDisk(a,b,c,buffer) { globalThis.mockupBenchBytes += buffer.length; return "benchmark"; }\n');
source = source.replaceAll('Date.now()', 'performance.now()');
process.env.MOCKUP_PROFILE = '1';
const renderer = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const results = [];
for (const shape of ['square', 'tall']) {
  let basePath = tpl.background_path;
  if (shape === 'tall') {
    // Synthetic 1:3 background with photographic content, NOT a real tall template.
    const tall = createCanvas(original.width, original.height * 3);
    for (let i = 0; i < 3; i++) tall.getContext('2d').drawImage(original, 0, i * original.height);
    basePath = 'logs/mockup-scale-bench/tall.png';
    fs.writeFileSync(join(root, basePath), tall.toBuffer('image/png'));
  }
  const base = await loadImage(join(root, basePath));
  const scale = Math.max(1, 2000 / Math.min(base.width, base.height));
  const enlarged = createCanvas(Math.round(base.width * scale), Math.round(base.height * scale));
  const cx = enlarged.getContext('2d');
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(base, 0, 0, enlarged.width, enlarged.height);
  const enlargedPath = `logs/mockup-scale-bench/${shape}-prescaled.png`;
  fs.writeFileSync(join(root, enlargedPath), enlarged.toBuffer('image/png'));
  for (const mode of ['native', 'runtime-upscale', 'prescaled']) {
    globalThis.mockupBenchNative = mode !== 'runtime-upscale';
    templates = Array.from({ length: 10 }, (_, i) => ({ ...tpl, id: `bench-${i}`, background_path: mode === 'prescaled' ? enlargedPath : basePath }));
    renderer.clearMockupCache();
    const testProduct = { ...product, variation_profile_id: 'benchmark' };
    await renderer.generateMockupsForProduct(testProduct); // 10 warm-up outputs
    renderer.resetProfile();
    globalThis.mockupBenchBytes = 0;
    const start = performance.now();
    for (let i = 0; i < 3; i++) await renderer.generateMockupsForProduct(testProduct);
    const elapsed = performance.now() - start;
    const phases = Object.fromEntries(Object.entries(renderer.readProfile()).map(([key, value]) => [key, +(value.ms / 30).toFixed(2)]));
    const result = { shape, mode, samples: 30, output: mode === 'native' ? [base.width, base.height] : [enlarged.width, enlarged.height], msPerMockup: +(elapsed / 30).toFixed(2), phases, jpegKB: +(globalThis.mockupBenchBytes / 30 / 1024).toFixed(1) };
    results.push(result);
    console.log(JSON.stringify(result));
  }
}
fs.writeFileSync(join(out, 'results.json'), JSON.stringify({ date: new Date().toISOString(), template: tpl.name, note: 'Sequential backend benchmark, 30 measured outputs per case; warm template cache, JPEG 92, output disk write and upload excluded. Tall input is synthetic. Ten template entries share one background.', results }, null, 2));
db.close();
