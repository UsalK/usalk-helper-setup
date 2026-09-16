// node --experimental-test-module-mocks --test backend/scripts/artworkColors.integration.test.mjs
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const root = fileURLToPath(new URL('../../', import.meta.url));
let product, calls, failSecondary, badTaxonomy, storageFolder;
const properties = [200, 52047899002].map((id, i) => ({
  property_id: id, display_name: i ? 'Secondary color' : 'Primary color', supports_attributes: true,
  possible_values: [{ value_id: 10 + i, name: 'Blue' }, { value_id: 20 + i, name: 'Red' }]
}));
const settings = { default_shipping_profile_id: 1, default_readiness_state_id: 2, default_listing_state: 'active' };
mock.module(new URL('../db/db.js', import.meta.url), {
  defaultExport: { prepare: sql => ({
    get: () => sql.includes('FROM products') ? { ...product } : undefined,
    all: () => Object.entries(settings).map(([key, value]) => ({ key, value: JSON.stringify(value) })),
    run: (...args) => {
      calls.push(['db', sql, ...args]);
      if (sql.startsWith('UPDATE products SET status')) {
        product.status = args[0];
        if (sql.includes('etsy_listing_id')) product.etsy_listing_id = args[1];
      } else if (sql.startsWith('UPDATE products SET etsy_listing_id')) product.etsy_listing_id = args[0];
    }
  }) },
  namedExports: {
    getActiveShop: () => ({ shop_id: 'test-shop' }),
    getShopStorageName: () => 'missing-test-shop',
    getProductStorageFolder: () => storageFolder,
    getSetProfileInfo: () => null
  }
});
mock.module(new URL('../services/MockupOrder.js', import.meta.url), { namedExports: { orderMockupFiles: files => files } });
mock.module(new URL('../services/KimiService.js', import.meta.url), { namedExports: {
  generateSEO: async () => ({ title: 'Blue artwork', description: 'Test', tags: [] })
} });
mock.module(new URL('../services/MockupPool.js', import.meta.url), { namedExports: {
  getMockupPool: () => ({ render: async () => {} })
} });
mock.module(new URL('../services/EtsyService.js', import.meta.url), { namedExports: {
  getTaxonomyProperties: async id => { calls.push(['taxonomy', id]); return badTaxonomy ? [] : properties; },
  createListing: async () => { calls.push(['create']); return { listing_id: 123 }; },
  updateListing: async (id, body) => { calls.push(['patch', id, body]); },
  updateListingProperty: async (id, property, body) => {
    calls.push(['color', id, property, body]);
    if (failSecondary && property === 52047899002) throw new Error('Secondary rejected');
  },
  deleteListingProperty: async (...args) => calls.push(['delete-color', ...args]),
  uploadListingImage: async (...args) => calls.push(['image', ...args]),
  getListingImages: async () => [],
  deleteListingImage: async () => {},
  updateListingInventory: async () => {},
  getListingsWithImages: async () => { calls.push(['get-listing']); return [{ taxonomy_id: 555 }]; }
} });
const { uploadProductToEtsy } = await import('../services/ListingUploadService.js');
const { updateListingFromProduct } = await import('../services/ListingUpdateService.js');

test('new uploads send area-ranked colours before activation; failed writes resume the same draft', async t => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'usalk-colors-'));
  t.after(() => {
    assert.ok(resolve(dir).startsWith(resolve(os.tmpdir()) + sep));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const canvas = createCanvas(100, 100);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0077cc'; ctx.fillRect(0, 0, 100, 100);
  ctx.fillStyle = '#cc2222'; ctx.fillRect(0, 0, 30, 100);
  const path = join(dir, 'art.png');
  fs.writeFileSync(path, canvas.toBuffer('image/png'));
  const reset = () => {
    calls = []; failSecondary = false; badTaxonomy = false; storageFolder = 'missing-test-shop';
    product = { id: 'colors-integration', shop_id: 'test-shop', image_path: relative(root, path), status: 'draft', tags: '[]', title: 'Test' };
  };

  await t.test('uses original image and sends two separate attributes before going live', async () => {
    reset();
    await uploadProductToEtsy({ productId: product.id });
    assert.deepEqual(calls.filter(c => c[0] === 'color'), [
      ['color', 123, 200, { value_ids: [10], values: ['Blue'] }],
      ['color', 123, 52047899002, { value_ids: [21], values: ['Red'] }]
    ]);
    assert.ok(calls.findIndex(c => c[0] === 'taxonomy') < calls.findIndex(c => c[0] === 'create'));
    assert.ok(calls.findLastIndex(c => c[0] === 'color') < calls.findIndex(c => c[0] === 'patch' && c[2].state === 'active'));
    assert.equal(product.status, 'live');
  });

  await t.test('colour failure keeps draft ID and retry does not duplicate the listing', async () => {
    reset(); failSecondary = true;
    await assert.rejects(uploadProductToEtsy({ productId: product.id }), /Secondary rejected/);
    assert.equal(product.status, 'error');
    assert.equal(product.etsy_listing_id, '123');
    assert.ok(!calls.some(c => c[0] === 'patch' && c[2].state === 'active'));
    failSecondary = false;
    await uploadProductToEtsy({ productId: product.id });
    assert.equal(calls.filter(c => c[0] === 'create').length, 1);
    assert.equal(product.status, 'live');
  });

  await t.test('unsupported taxonomy creates no remote listing', async () => {
    reset(); badTaxonomy = true;
    await assert.rejects(uploadProductToEtsy({ productId: product.id }), /seçeneği bulunamadı/);
    assert.ok(!calls.some(c => c[0] === 'create'));
  });

  await t.test('replacement dry run makes no Etsy calls', async () => {
    reset();
    await updateListingFromProduct({ productId: product.id, listingId: 456, dryRun: true });
    assert.ok(calls.every(c => c[0] === 'db'));
  });

  await t.test('replacement respects existing taxonomy and keeps colours if images were not replaced', async () => {
    reset();
    await updateListingFromProduct({ productId: product.id, listingId: 456 });
    assert.deepEqual(calls.find(c => c[0] === 'taxonomy'), ['taxonomy', 555]);
    assert.ok(!calls.some(c => c[0] === 'color' || c[0] === 'delete-color'));
  });

  await t.test('replacement sends original artwork colours even when mockup colours are different', async () => {
    reset();
    storageFolder = relative(join(root, 'storage'), dir);
    const mockupsDir = join(dir, 'mockups', product.id);
    fs.mkdirSync(mockupsDir, { recursive: true });
    const mockup = createCanvas(100, 100);
    const mockupCtx = mockup.getContext('2d');
    mockupCtx.fillStyle = '#008000'; mockupCtx.fillRect(0, 0, 100, 100);
    fs.writeFileSync(join(mockupsDir, 'green-room.png'), mockup.toBuffer('image/png'));
    await updateListingFromProduct({ productId: product.id, listingId: 456 });
    assert.deepEqual(calls.filter(c => c[0] === 'color').map(c => c[3].values[0]), ['Blue', 'Red']);
    assert.ok(calls.findIndex(c => c[0] === 'image') < calls.findIndex(c => c[0] === 'color'));
  });
});
