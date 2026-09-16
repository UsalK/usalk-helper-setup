import { createCanvas, loadImage } from '@napi-rs/canvas';

// Multiple shades vote for the same Etsy colour, so e.g. navy and sky blue
// cannot occupy both colour attributes. Metallic finishes cannot be inferred
// from RGB pixels; use ordinary colour families instead.
const SWATCHES = {
  Black: ['080808', '202020'],
  White: ['ffffff', 'f5f5f5'],
  Gray: ['555555', '808080', 'b5b5b5', 'd5d5d5'],
  Beige: ['f5f5dc', 'ead8bb', 'c9b79c', 'e8dfcf'],
  Brown: ['4b2e20', '795033', 'a07045', '967969'],
  Red: ['ff0000', 'cc2222', '800020'],
  Orange: ['ff8000', 'e56b2f', 'c45424'],
  Yellow: ['ffff00', 'f5d343', 'c8a527'],
  Green: ['00ff00', '008000', '245839', '7d9568', '808000', '8fcfa1'],
  Blue: ['0000ff', '0077cc', '172b55', '88bbdd', '008b9a', '00ffff'],
  Purple: ['800080', '663399', 'a080c0', 'aa00ff'],
  Pink: ['ffc0cb', 'ef85a9', 'ff1493', 'ff00ff']
};

// CIELAB distance groups colours by perceived difference instead of treating
// the non-linear RGB channel values as equally spaced.
function toLab(r, g, b) {
  const [R, G, B] = [r, g, b].map(v => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const x = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const y = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const z = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const palette = Object.entries(SWATCHES).flatMap(([name, hexes]) =>
  hexes.map(hex => ({ name, lab: toLab(...hex.match(/../g).map(v => parseInt(v, 16))) }))
);

export function rankArtworkColors(pixels) {
  const counts = new Map();
  const classified = new Map();
  let visible = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    if (!alpha) continue;
    const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const key = (r << 16) | (g << 8) | b;
    let name = classified.get(key);
    if (!name) {
      const lab = toLab(r, g, b);
      let nearest = Infinity;
      for (const swatch of palette) {
        const distance = swatch.lab.reduce((sum, v, j) => sum + (v - lab[j]) ** 2, 0);
        if (distance < nearest) {
          nearest = distance;
          name = swatch.name;
        }
      }
      classified.set(key, name);
    }
    counts.set(name, (counts.get(name) || 0) + alpha);
    visible += alpha;
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, share: count / visible }));
}

export async function detectArtworkColors(imagePath) {
  const image = await loadImage(imagePath);
  const ratio = Math.min(1, 256 / Math.max(image.width, image.height));
  const canvas = createCanvas(Math.max(1, Math.round(image.width * ratio)), Math.max(1, Math.round(image.height * ratio)));
  const ctx = canvas.getContext('2d');
  // Sample actual pixels without creating blended colours along edges.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const colors = rankArtworkColors(ctx.getImageData(0, 0, canvas.width, canvas.height).data).slice(0, 2);
  if (!colors.length) throw new Error('Görselde renk analizi yapılabilecek görünür piksel yok.');
  return colors;
}

const normalize = value => String(value || '').toLowerCase().replace(/colour/g, 'color').replace(/grey/g, 'gray').replace(/[^a-z]/g, '');

export function mapArtworkColorProperties(colors, taxonomyProperties) {
  const properties = ['primary', 'secondary'].map(role => taxonomyProperties.find(property =>
    property.supports_attributes && [property.name, property.display_name].some(name =>
      normalize(name) === `${role}color` || (role === 'primary' && normalize(name) === 'color')
    )
  ));
  const updates = colors.map((color, index) => {
    const property = properties[index];
    const value = property?.possible_values?.find(v => normalize(v.name) === normalize(color.name));
    if (!property || !value || !Number.isSafeInteger(value.value_id) || value.value_id <= 0) {
      throw new Error(`Etsy kategorisinde ${index === 0 ? 'ana' : 'ikincil'} renk için "${color.name}" seçeneği bulunamadı.`);
    }
    return {
      property_id: property.property_id,
      value_ids: [value.value_id],
      values: [value.name],
      ...(value.scale_id ? { scale_id: value.scale_id } : {})
    };
  });
  return { colors, updates, secondaryPropertyId: properties[1]?.property_id };
}

export async function prepareArtworkColors(imagePath, taxonomyId, etsy) {
  const colors = await detectArtworkColors(imagePath);
  return mapArtworkColorProperties(colors, await etsy.getTaxonomyProperties(taxonomyId));
}

export async function sendArtworkColors(listingId, prepared, etsy, { clearSecondary = false } = {}) {
  for (const { property_id, ...body } of prepared.updates) {
    await etsy.updateListingProperty(listingId, property_id, body);
  }
  if (clearSecondary && prepared.colors.length === 1 && prepared.secondaryPropertyId) {
    await etsy.deleteListingProperty(listingId, prepared.secondaryPropertyId);
  }
}
