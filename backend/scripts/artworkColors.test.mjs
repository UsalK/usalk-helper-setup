// node --test backend/scripts/artworkColors.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { detectArtworkColors, mapArtworkColorProperties, sendArtworkColors } from '../services/ArtworkColors.js';

function artwork(stripes, transparent = false) {
  const canvas = createCanvas(100, 100);
  const ctx = canvas.getContext('2d');
  if (!transparent) { ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 100, 100); }
  let x = 0;
  for (const [color, width] of stripes) {
    ctx.fillStyle = color;
    ctx.fillRect(x, 0, width, 100);
    x += width;
  }
  return canvas.toBuffer('image/png');
}

const properties = [
  { property_id: 17, name: 'primary_color', supports_attributes: true, possible_values: [
    { value_id: 1001, name: 'Blue' }, { value_id: 1002, name: 'Red' }, { value_id: 1003, name: 'Grey' }
  ] },
  { property_id: 29, display_name: 'Secondary color', supports_attributes: true, possible_values: [
    { value_id: 2001, name: 'Blue' }, { value_id: 2002, name: 'Red' }
  ] }
];

test('primary/secondary are ordered by area, with all tones in one colour family', async () => {
  const colors = await detectArtworkColors(artwork([['#172b55', 35], ['#88bbdd', 30], ['#cc2222', 25], ['#008000', 10]]));
  assert.deepEqual(colors.map(c => c.name), ['Blue', 'Red']);
  assert.ok(Math.abs(colors[0].share - 0.65) < 0.01);
  assert.ok(Math.abs(colors[1].share - 0.25) < 0.01);
});

test('neutral colours and artwork backgrounds count towards visible area', async () => {
  assert.deepEqual((await detectArtworkColors(artwork([['#ead8bb', 60], ['#080808', 40]]))).map(c => c.name), ['Beige', 'Black']);
  assert.deepEqual((await detectArtworkColors(artwork([['#ffffff', 70], ['#808080', 30]]))).map(c => c.name), ['White', 'Gray']);
});

test('transparent background contributes no black or white; monochrome has no invented secondary', async () => {
  const colors = await detectArtworkColors(artwork([['#008000', 20]], true));
  assert.deepEqual(colors, [{ name: 'Green', share: 1 }]);
  await assert.rejects(detectArtworkColors(artwork([], true)), /görünür piksel/);
});

test('corrupt input fails instead of using generic/AI colours', async () => {
  await assert.rejects(detectArtworkColors(Buffer.from('not an image')));
});

test('maps each role to its own current taxonomy value IDs and keeps Etsy spelling', () => {
  const prepared = mapArtworkColorProperties([{ name: 'Blue' }, { name: 'Red' }], properties);
  assert.deepEqual(prepared.updates, [
    { property_id: 17, value_ids: [1001], values: ['Blue'] },
    { property_id: 29, value_ids: [2002], values: ['Red'] }
  ]);
  assert.equal(mapArtworkColorProperties([{ name: 'Gray' }], properties).updates[0].values[0], 'Grey');
});

test('unsupported category/colour fails before sending invented or hardcoded IDs', () => {
  assert.throws(() => mapArtworkColorProperties([{ name: 'Green' }], properties), /seçeneği bulunamadı/);
  assert.throws(() => mapArtworkColorProperties([{ name: 'Blue' }], []), /seçeneği bulunamadı/);
  assert.throws(() => mapArtworkColorProperties([{ name: 'Blue' }], properties.map(p => ({ ...p, supports_attributes: false }))), /seçeneği bulunamadı/);
});

test('sends the two attributes independently, and clears stale secondary on a monochrome replacement', async () => {
  const calls = [];
  const etsy = {
    updateListingProperty: async (...args) => calls.push(['put', ...args]),
    deleteListingProperty: async (...args) => calls.push(['delete', ...args])
  };
  await sendArtworkColors(123, mapArtworkColorProperties([{ name: 'Blue' }, { name: 'Red' }], properties), etsy);
  assert.deepEqual(calls, [
    ['put', 123, 17, { value_ids: [1001], values: ['Blue'] }],
    ['put', 123, 29, { value_ids: [2002], values: ['Red'] }]
  ]);
  calls.length = 0;
  await sendArtworkColors(123, mapArtworkColorProperties([{ name: 'Blue' }], properties), etsy, { clearSecondary: true });
  assert.deepEqual(calls.at(-1), ['delete', 123, 29]);
});

test('Etsy write errors propagate so incomplete colour uploads cannot pass as success', async () => {
  await assert.rejects(sendArtworkColors(123, mapArtworkColorProperties([{ name: 'Blue' }], properties), {
    updateListingProperty: async () => { throw new Error('Etsy unavailable'); }
  }), /Etsy unavailable/);
});
