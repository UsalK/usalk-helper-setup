// Düz kanvas baskıya "3D/Textured/Wood" gibi yanıltıcı yüzey-malzeme iddiası yazılmasın.
//   node --test backend/scripts/productAccuracy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasSurfaceClaim, stripSurfaceClaims, stripSurfaceClaimSentences, PRODUCT_ACCURACY_PROMPT
} from '../services/KimiService.js';

test('yanıltıcı öbekler temizlenir, anlamlı kısım kalır', () => {
  const cases = [
    ['3D Wave Wall Art', 'Wave Wall Art'],
    ['Textured Abstract Landscape', 'Abstract Landscape'],
    ['Neutral 3-D Textured Wave Art', 'Neutral Wave Art'],
    ['Abstract Stone Mosaic Wall Art', 'Abstract Mosaic Wall Art'],
    ['Sculpted Face Wall Art', 'Face Wall Art'],
    ['Hand Painted Olive Branch', 'Olive Branch'],
    ['Beige Plaster Look Art', 'Beige Art'],
    ['boho wood wall art', 'boho wall art'],
    ['Gold Leaf Abstract', 'Abstract'],
    ['impasto flower art', 'flower art']
  ];
  for (const [input, expected] of cases) assert.equal(stripSurfaceClaims(input), expected, input);
});

test('geriye yalnızca generic kelime kalan öbek düşer', () => {
  for (const input of ['Textured Wall Art', 'Plaster Relief Art', '3D Wall Sculpture', 'wood print', 'Faux Plaster Effect']) {
    assert.equal(stripSurfaceClaims(input), '', input);
  }
});

test('resmedilen nesne ve üslup adları yanlış pozitif vermez', () => {
  for (const input of [
    'Stone Bridge Landscape', 'Wooden Boat Art', 'Stained Glass Wall Art', 'Byzantine Mosaic Portrait',
    'Mosaic Pattern Wall Art', 'Woodland Deer Print', 'Marble Statue Painting', 'Oil Painting Style Art',
    'Set Of 3 Dreamy Clouds', 'Metallic Gold Abstract', 'Contextual Art'
  ]) {
    assert.equal(hasSurfaceClaim(input), false, input);
  }
});

test('açıklamada iddia taşıyan cümle çıkarılır', () => {
  const r = stripSurfaceClaimSentences('Soft ivory waves bring calm to any room. The sculpted plaster surface adds real depth. Perfect for a minimalist bedroom.');
  assert.equal(r.text, 'Soft ivory waves bring calm to any room. Perfect for a minimalist bedroom.');
  assert.equal(r.removed, 1);

  const all = stripSurfaceClaimSentences('A textured 3D wave piece.');
  assert.equal(all.unresolved, true);
  assert.equal(all.text, 'A textured 3D wave piece.');
});

test('prompt kuralı iki platform prompt metnine giriyor', () => {
  assert.match(PRODUCT_ACCURACY_PROMPT, /FLAT print on smooth canvas/);
});

test('iddia içermeyen generic öbeklere dokunulmaz', () => {
  for (const input of ['Wall Art', 'canvas print', 'Canvas Wall Art', 'Living Room Decor']) {
    assert.equal(stripSurfaceClaims(input), input, input);
  }
});
