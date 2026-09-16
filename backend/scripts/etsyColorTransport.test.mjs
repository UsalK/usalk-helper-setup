// node --experimental-test-module-mocks --test backend/scripts/etsyColorTransport.test.mjs
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
let deleteStatus = 0;
mock.module('axios', { defaultExport: { create: () => ({
  interceptors: { request: { use() {} }, response: { use() {} } },
  get: async (...args) => { calls.push(['get', ...args]); return { data: { results: [{ property_id: 200 }] } }; },
  put: async (...args) => { calls.push(['put', ...args]); return { data: {} }; },
  delete: async (...args) => { calls.push(['delete', ...args]); if (deleteStatus) throw { response: { status: deleteStatus } }; }
}) } });
mock.module(new URL('../db/db.js', import.meta.url), {
  defaultExport: {},
  namedExports: { getActiveShop: () => ({ shop_id: 'test-shop', access_token: 'test-token', expires_at: '2099-01-01' }) }
});
// This test process never loads .env or contacts Etsy.
process.env.ETSY_CLIENT_ID = 'test-key';
process.env.ETSY_CLIENT_SECRET = 'test-secret';
const etsy = await import('../services/EtsyService.js');

test('taxonomy is cached by category and invalidated with the Etsy cache', async () => {
  await etsy.getTaxonomyProperties(1027);
  await etsy.getTaxonomyProperties('1027');
  await etsy.getTaxonomyProperties(123);
  assert.equal(calls.filter(c => c[0] === 'get').length, 2);
  etsy.clearEtsyCache();
  await etsy.getTaxonomyProperties(1027);
  assert.equal(calls.filter(c => c[0] === 'get').length, 3);
});

test('property transport uses the documented form encoding and preserves parallel arrays', async () => {
  await etsy.updateListingProperty(123, 200, { value_ids: [10], values: ['Blue'] });
  const [, url, body, config] = calls.at(-1);
  assert.ok(url.endsWith('/shops/test-shop/listings/123/properties/200'));
  assert.equal(config.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(body.get('value_ids'), '10');
  assert.equal(body.get('values'), 'Blue');
  await etsy.updateListingProperty(123, 999, { value_ids: [7, 8], values: ['Living room', 'Bedroom'] });
  assert.equal(calls.at(-1)[2].get('value_ids'), '7,8');
  assert.equal(calls.at(-1)[2].get('values'), 'Living room,Bedroom');
});

test('clearing an absent colour tolerates 404 but propagates auth/service errors', async () => {
  deleteStatus = 404;
  await etsy.deleteListingProperty(123, 200);
  deleteStatus = 403;
  await assert.rejects(etsy.deleteListingProperty(123, 200));
});
