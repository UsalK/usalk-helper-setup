import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../db/db.js';

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

// products.etsy_listing_id bazı kayıtlarda "4571950064.0" gibi float metni olarak
// saklanmış; sayıya çevirip karşılaştırıyoruz. Başlıkla eşleştirme güvenilir değil:
// Etsy'deki başlık sonradan değişmiş olabiliyor.
const findProductByListing = db.prepare(
  'SELECT id, image_path FROM products WHERE CAST(CAST(etsy_listing_id AS REAL) AS INTEGER) = ? LIMIT 1'
);

/**
 * Siparişteki listingin kaynak görseli (upscale edilecek dosya).
 * source: 'local'   -> dosya diskte
 *         'missing' -> ürün DB'de var ama dosya diskte yok
 *         'none'    -> listing DB'de yok (uygulama dışından açılmış)
 */
export function findSourceByListing(listingId) {
  const product = findProductByListing.get(Number(listingId));
  if (!product) return { source: 'none', product: null, relPath: null, absPath: null };
  const absPath = product.image_path ? join(PROJECT_ROOT, product.image_path) : null;
  const onDisk = Boolean(absPath) && fs.existsSync(absPath);
  return {
    source: onDisk ? 'local' : 'missing',
    product,
    relPath: onDisk ? product.image_path : null,
    absPath: onDisk ? absPath : null
  };
}
