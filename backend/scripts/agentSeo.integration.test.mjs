// node --experimental-test-module-mocks --test backend/scripts/agentSeo.integration.test.mjs
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { submitAgentSEO, getAgentRequest } from '../services/AgentSEOService.js';

let providerCalls = 0, imageDecodeCalls = 0, dbWrites = 0;
mock.module('axios', { defaultExport: { post: async () => { providerCalls++; throw new Error('Provider must never be called in agent mode'); } } });
mock.module('jimp', { namedExports: { Jimp: { read: async () => { imageDecodeCalls++; throw new Error('Agent must receive original local image'); } } } });
mock.module(new URL('../db/db.js', import.meta.url), {
  defaultExport: { prepare: () => ({ get: () => ({ value: JSON.stringify('desktop-agent') }), run: () => { dbWrites++; } }) },
  namedExports: { getActiveShop: () => ({ shop_id: 'test-shop' }) }
});
const { generateSEO } = await import('../services/KimiService.js');

test('selected AI Agent uses original prompts and common SEO processing, with no provider calls or live database writes', async t => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'agent-seo-integration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const imagePath = join(dir, 'original.png');
  fs.writeFileSync(imagePath, 'original artwork bytes');
  const root = join(dir, 'queue');
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-or-test-not-a-real-key';
  t.after(() => { if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previousKey; });
  let request;
  const result = await generateSEO(imagePath, 'US/UK', 'botanical', 'test-shop', 'etsy', [
    { shop_section_id: '123', title: 'Nature Art' }
  ], { panelCount: 2, panelRatio: '2:3' }, {
    root, pollMs: 5, timeoutMs: 2000,
    onWaiting: ({ id }) => {
      request = getAgentRequest(id, { root });
      submitAgentSEO(id, {
        title: 'Botanical Wall Art, Green Leaf Artwork, Serene Nature Decor, Quiet Reading Nook, Organic Garden Design',
        description: 'Botanical wall art with flowing leaves creates a serene mood for a quiet reading nook.',
        tags: ['green leaf decor', 'botanical room art', 'quiet reading nook', 'garden lover gift', 'nature inspired art', 'earthy bedroom art', 'sage green decor', 'organic leaf print', 'serene office decor', 'fern study artwork', 'fresh foliage art', 'woodland home decor', 'calm entryway art'],
        visual_style: ['Botanical'], room: ['Office'], occasion: [], holiday: [],
        shop_section: 'Nature Art'
      }, { root });
    }
  });
  assert.equal(providerCalls, 0);
  assert.equal(imageDecodeCalls, 0);
  assert.equal(dbWrites, 0);
  assert.equal(request.imagePath, imagePath);
  assert.equal(request.shopId, 'test-shop');
  assert.match(request.systemPrompt, /Etsy SEO expert/);
  assert.match(request.promptText, /Nature Art/);
  assert.match(request.promptText, /set/i);
  assert.equal(result._meta.model, 'desktop-agent');
  assert.equal(result._meta.fallbackUsed, false);
  assert.equal(result.tags.length, 13);
  assert.ok(result.tags.every(tag => tag.length <= 20));
  assert.ok(result.title.length <= 140);
  assert.match(result.title, /Set Of 2|Set of 2/i);
  assert.equal(result.shop_section_id, '123');
});
