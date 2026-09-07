/**
 * Usalk Puanı — listing performansının zamana göre normalize edilmiş 0-100 skoru.
 *
 * NEDEN BÖYLE:
 *
 * 1) Ham sayılar karşılaştırılamaz. 87 günlük bir listing'in 10 görüntülenmesi ile
 *    5 günlük bir listing'in 10 görüntülenmesi aynı şey değil. O yüzden her metrik
 *    "gün başına" oranına çevrilir.
 *
 * 2) Genç listing gürültüsü. 3 günlük bir ürün 48 görüntülenme aldıysa günlük oranı
 *    16 çıkar ve tüm mağazayı domine eder — oysa bu istatistiksel olarak güvenilir
 *    değil. Paydaya sabit bir yumuşatma (SMOOTHING_DAYS) eklenerek genç listingler
 *    ortalamaya doğru çekilir; yaş arttıkça bu etki kendiliğinden kaybolur.
 *
 * 3) Uzun kuyruk. Görüntülenme dağılımı çok çarpık (medyan 4, maksimum 604).
 *    Doğrusal ölçekleme her şeyi dibe yığar, bu yüzden her bileşen log1p ile
 *    sıkıştırılır: aradaki fark korunur ama uçlar ezmez.
 *
 * 4) Ölçek çarpanları. Favori ve satış, görüntülenmeye göre çok daha seyrek olaylar.
 *    Aynı log ölçeğinde anlamlı bir aralığa yayılsınlar diye her biri kendi doğal
 *    periyoduna göre çarpılır (görüntülenme aylık, favori/satış yıllık bazda).
 *
 * 5) Son adım yüzdelik sıralama. Kullanıcının istediği "en iyi 100, en kötü 0"
 *    tam olarak budur ve "bu ürün mağazanın %88'inden kötü" şeklinde okunur.
 *    Beraberlikler aynı puanı alır (hiçbir şey almamış tüm listingler eşit).
 */

// Bileşen ağırlıkları — toplamı 1.0
export const WEIGHTS = {
  views: 0.30,     // Etsy ürünü gösteriyor mu (SEO/etiket çalışıyor mu)
  favs: 0.30,      // gören ilgileniyor mu (görsel ve başlık ikna ediyor mu)
  sales: 0.25,     // asıl sonuç
  favRate: 0.15    // verimlilik: 20 görüntülenmede 3 favori, 200'de 0'dan iyidir
};

// Genç listinglerin oranlarını şişmekten koruyan yumuşatma sabiti (gün)
export const SMOOTHING_DAYS = 14;

// favori oranının anlamlı sayılması için gereken en az görüntülenme
const MIN_VIEWS_FOR_RATE = 10;

/** Tek bir listing'in ham bileşik skorunu hesaplar (sıralama için yeterli). */
export function computeComposite(listing, nowSec = Math.floor(Date.now() / 1000)) {
  const ageDays = listing.creation_timestamp > 0
    ? Math.max(1, (nowSec - listing.creation_timestamp) / 86400)
    : 1;

  // yumuşatılmış payda
  const eff = ageDays + SMOOTHING_DAYS;

  const views = listing.views || 0;
  const favs = listing.num_favorers || 0;
  const sales = listing.sales_count || 0;

  const favRate = views >= MIN_VIEWS_FOR_RATE ? favs / views : 0;

  return (
    WEIGHTS.views * Math.log1p((views / eff) * 30) +
    WEIGHTS.favs * Math.log1p((favs / eff) * 365) +
    WEIGHTS.sales * Math.log1p((sales / eff) * 365 * 5) +
    WEIGHTS.favRate * Math.log1p(favRate * 100)
  );
}

/**
 * Bir listing kümesine Usalk puanı atar (0-100).
 * Puan mağazanın kendi içinde görecelidir: en iyi 100, en kötü 0.
 * Beraberlikte grubun en düşük sırası kullanılır, böylece "hiçbir şey almamış"
 * tüm listingler eşit şekilde 0 alır.
 *
 * @param {Array} listings etsy_analytics_cache satırları
 * @returns {Array} her satıra usalk_score ve usalk_raw eklenmiş kopya
 */
export function assignUsalkScores(listings, nowSec = Math.floor(Date.now() / 1000)) {
  if (!Array.isArray(listings) || listings.length === 0) return [];

  const withRaw = listings.map(l => ({ ...l, usalk_raw: computeComposite(l, nowSec) }));

  if (withRaw.length === 1) {
    return withRaw.map(l => ({ ...l, usalk_score: 100 }));
  }

  // artan sırada benzersiz skorlar -> her skorun en düşük sırası
  const sortedRaw = [...withRaw].map(l => l.usalk_raw).sort((a, b) => a - b);
  const minRankOf = new Map();
  sortedRaw.forEach((v, idx) => {
    if (!minRankOf.has(v)) minRankOf.set(v, idx);
  });

  const denom = withRaw.length - 1;
  return withRaw.map(l => ({
    ...l,
    usalk_score: Math.round((minRankOf.get(l.usalk_raw) / denom) * 1000) / 10
  }));
}

/**
 * Puanı okunabilir bir kategoriye çevirir (kart rozetleri için).
 */
export function scoreBand(score) {
  if (score >= 80) return { key: 'strong', label: 'Güçlü' };
  if (score >= 55) return { key: 'good', label: 'İyi' };
  if (score >= 30) return { key: 'average', label: 'Ortalama' };
  if (score >= 10) return { key: 'weak', label: 'Zayıf' };
  return { key: 'dead', label: 'Ölü' };
}
