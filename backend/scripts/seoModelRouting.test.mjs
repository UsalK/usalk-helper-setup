// Offline provider routing checks; no live database or API calls.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

const selectedModel = 'google/gemini-3.8-flash';
const calls = [];
let providerFailure = false;
const seo = {
  title: 'Botanical Wall Art, Green Leaf Artwork, Serene Nature Decor, Quiet Reading Nook, Organic Garden Design',
  description: 'Flowing green leaves create a serene botanical composition for a quiet reading nook.',
  tags: ['green leaf decor', 'botanical room art', 'quiet reading nook', 'garden lover gift', 'nature inspired art', 'earthy bedroom art', 'sage green decor', 'organic leaf print', 'serene office decor', 'fern study artwork', 'fresh foliage art', 'woodland home decor', 'calm entryway art'],
  visual_style: ['Botanical'], room: ['Office'], occasion: [], holiday: []
};
mock.module('axios', { defaultExport: { post: async (url, payload) => {
  calls.push({ url, model: payload.model });
  if (providerFailure) throw Object.assign(new Error('Test authorization failure'), { response: { status: 401 } });
  return { data: { choices: [{ message: { content: JSON.stringify(seo) } }] } };
} } });
mock.module('jimp', { namedExports: { Jimp: { read: async () => ({
  width: 100, getBase64: async () => 'data:image/png;base64,dGVzdA=='
}) } } });
mock.module(new URL('../db/db.js', import.meta.url), {
  defaultExport: { prepare: () => ({ get: () => ({ value: JSON.stringify(selectedModel) }), run: () => {} }) },
  namedExports: { getActiveShop: () => ({ shop_id: 'test-shop' }) }
});
const { generateSEO } = await import('../services/KimiService.js');

function setup(t) {
  calls.length = 0;
  providerFailure = false;
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'seo-model-routing-'));
  const imagePath = join(dir, 'art.png');
  fs.writeFileSync(imagePath, 'test artwork');
  const previous = { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, NVIDIA_API_KEY: process.env.NVIDIA_API_KEY };
  process.env.OPENROUTER_API_KEY = 'sk-or-offline-test';
  process.env.NVIDIA_API_KEY = 'nvapi-offline-test';
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  return imagePath;
}

test('named model calls exactly the saved OpenRouter model even when a NVIDIA key exists', async t => {
  const result = await generateSEO(setup(t), 'US/UK', 'botanical', 'test-shop');
  assert.deepEqual(calls, [{ url: 'https://openrouter.ai/api/v1/chat/completions', model: selectedModel }]);
  assert.equal(result._meta.model, selectedModel);
  assert.equal(result._meta.fallbackUsed, false);
  assert.equal(result.tags.length, 13);
});

test('OpenRouter failure never switches to NVIDIA or a desktop agent', async t => {
  const imagePath = setup(t);
  providerFailure = true;
  await assert.rejects(generateSEO(imagePath, 'US/UK', 'botanical', 'test-shop'), /Test authorization failure/);
  assert.deepEqual(calls, [{ url: 'https://openrouter.ai/api/v1/chat/completions', model: selectedModel }]);
});

test('missing OpenRouter key cannot use a NVIDIA key as fallback', async t => {
  const imagePath = setup(t);
  delete process.env.OPENROUTER_API_KEY;
  await assert.rejects(generateSEO(imagePath, 'US/UK', 'botanical', 'test-shop'), /OPENROUTER_API_KEY/);
  assert.equal(calls.length, 0);
});

test('NVIDIA key accidentally entered as OpenRouter key is rejected before any API request', async t => {
  const imagePath = setup(t);
  process.env.OPENROUTER_API_KEY = 'nvapi-offline-test';
  await assert.rejects(generateSEO(imagePath, 'US/UK', 'botanical', 'test-shop'), /OPENROUTER_API_KEY/);
  assert.equal(calls.length, 0);
});
