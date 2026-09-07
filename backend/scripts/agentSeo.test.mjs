import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { requestAgentSEO, submitAgentSEO, listAgentRequests, getAgentRequest, validateAgentSEO } from '../services/AgentSEOService.js';

const seo = () => ({
  title: 'Botanical Wall Art, Green Leaf Artwork, Serene Nature Decor',
  description: 'Botanical wall art with flowing green leaves creates a serene mood for a quiet reading nook.',
  tags: ['green leaf decor', 'botanical room art', 'quiet reading nook', 'garden lover gift', 'nature inspired art', 'earthy bedroom art', 'sage green decor', 'organic leaf print', 'serene office decor', 'fern study artwork', 'fresh foliage art', 'woodland home decor', 'calm entryway art'],
  visual_style: ['Botanical'], occasion: [], holiday: [], room: ['Office']
});
function fixture(t) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'agent-seo-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const imagePath = join(dir, 'art.png');
  fs.writeFileSync(imagePath, 'test artwork bytes');
  return { root: join(dir, 'queue'), input: { imagePath, shopId: 'shop-one', platform: 'etsy', systemPrompt: 'rules', promptText: 'schema' } };
}

test('waits for a desktop answer, preserves context, then resumes with the answer', async t => {
  const { root, input } = fixture(t);
  let id, finished = false;
  const pending = requestAgentSEO(input, { root, pollMs: 5, timeoutMs: 2000, context: { productId: 'one', dryRun: true }, onWaiting: job => { id = job.id; } });
  pending.then(() => { finished = true; });
  await delay(15);
  assert.equal(finished, false);
  assert.equal(listAgentRequests({ root, shopId: 'shop-two' }).length, 0);
  assert.equal(getAgentRequest(id, { root }).context.productId, 'one');
  assert.equal(getAgentRequest(id, { root }).imagePath, input.imagePath);
  assert.throws(() => submitAgentSEO(id, { ...seo(), title: '' }, { root }), /Başlık/);
  assert.equal(getAgentRequest(id, { root }).status, 'pending');
  submitAgentSEO(id, seo(), { root });
  assert.deepEqual(await pending, seo());
  assert.equal(getAgentRequest(id, { root }).status, 'completed');
  assert.equal(listAgentRequests({ root }).length, 0);
  assert.equal(submitAgentSEO(id, seo(), { root }).alreadySubmitted, true);
  assert.throws(() => submitAgentSEO(id, { ...seo(), title: 'Different title' }, { root }), /zaten/);
});

test('restart reuses a bulk answer, but another product or modified image gets a new job', async t => {
  const { root, input } = fixture(t);
  const ids = [];
  const options = { root, pollMs: 5, timeoutMs: 2000, requestKey: 'bulk:job:item', onWaiting: ({ id }) => {
    ids.push(id); submitAgentSEO(id, seo(), { root });
  } };
  await requestAgentSEO(input, options);
  await requestAgentSEO(input, options);
  assert.equal(ids[0], ids[1]);
  await requestAgentSEO(input, { ...options, requestKey: 'bulk:job:other-item' });
  assert.notEqual(ids[0], ids[2]);
  fs.writeFileSync(input.imagePath, 'changed artwork');
  await requestAgentSEO(input, options);
  assert.notEqual(ids[0], ids[3]);
});

test('cancelled bulk item stops waiting and rejects late delivery', async t => {
  const { root, input } = fixture(t);
  let id, cancelled = false;
  const pending = requestAgentSEO(input, { root, pollMs: 5, timeoutMs: 2000, isCancelled: () => cancelled, onWaiting: job => { id = job.id; } });
  cancelled = true;
  await assert.rejects(pending, { code: 'AGENT_CANCELLED' });
  assert.equal(getAgentRequest(id, { root }).status, 'cancelled');
  assert.throws(() => submitAgentSEO(id, seo(), { root }), /artık/);
});

test('disconnected manual client aborts and a missing agent times out', async t => {
  const { root, input } = fixture(t);
  const controller = new AbortController();
  const pending = requestAgentSEO(input, { root, pollMs: 5, timeoutMs: 2000, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'AGENT_CANCELLED' });
  await assert.rejects(requestAgentSEO(input, { root, pollMs: 5, timeoutMs: 15 }), { code: 'AGENT_EXPIRED' });
});

test('rejects a result envelope for a different job', async t => {
  const { root, input } = fixture(t);
  const pending = requestAgentSEO(input, { root, pollMs: 5, timeoutMs: 2000, onWaiting: ({ id }) => {
    fs.writeFileSync(join(root, id, 'result.json'), JSON.stringify({ id: 'wrong-id', fingerprint: 'wrong', result: seo() }));
  } });
  await assert.rejects(pending, /başka bir işe/);
});

test('requires valid unique tag lists and metadata types; rejects path traversal', () => {
  assert.throws(() => validateAgentSEO({ ...seo(), tags: ['only one'] }), /Etiketler/);
  assert.throws(() => validateAgentSEO({ ...seo(), tags: [...seo().tags, seo().tags[0]] }), /tekrarlanmamalı/);
  assert.throws(() => validateAgentSEO({ ...seo(), visual_style: [42] }), /visual_style/);
  assert.throws(() => getAgentRequest('../secrets'), /kimliği/);
});
