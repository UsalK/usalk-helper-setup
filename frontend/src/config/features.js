// Arayüzde açık/kapalı tutulan bölümler.

/**
 * Shopify entegrasyonu.
 *
 * `false` iken açılıştaki platform seçim ekranı ve kenar çubuğundaki
 * "Platform Değiştir" düğmesi gösterilmez; uygulama doğrudan Etsy moduyla
 * açılır.
 *
 * Kod arka planda olduğu gibi durur: Shopify sayfaları, servisleri ve API
 * yolları yerindedir ve `#/shopify/dashboard` adresi hâlâ çalışır. Yeniden
 * yayına almak için bu değeri `true` yapmak yeterlidir.
 */
export const SHOPIFY_ENABLED = false;
