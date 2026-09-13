// Siparişler sayfası ve sipariş detayı için ortak biçimlendiriciler.

export const formatMoney = (m) => (m
  ? new Intl.NumberFormat('tr-TR', { style: 'currency', currency: m.currency }).format(m.value)
  : '—');

export const formatDate = (epoch, withTime = true) => new Date(epoch * 1000).toLocaleString('tr-TR', {
  day: '2-digit', month: 'short', year: 'numeric',
  ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
});

// Sipariş durum grupları (backend orders.js stateOf ile aynı). Etsy'nin kendi durumları
// iade ile iptali, kargo ile teslimi ayırmadığı için listede bunlar gösterilir.
export const ORDER_STATES = [
  { id: 'paid', label: 'Ödendi', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  { id: 'shipped', label: 'Kargoda', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/20' },
  { id: 'completed', label: 'Tamamlandı', cls: 'bg-teal-500/10 text-teal-300 border-teal-500/20' },
  { id: 'refunded', label: 'İade', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
  { id: 'canceled', label: 'İptal', cls: 'bg-slate-500/10 text-slate-300 border-slate-500/25' }
];
const STATE_BY_ID = Object.fromEntries(ORDER_STATES.map(s => [s.id, s]));

export function stateBadge(order) {
  const s = STATE_BY_ID[order.state];
  if (!s) return null;
  if (order.state === 'refunded' && String(order.status).toLowerCase() === 'partially refunded') {
    return { ...s, label: 'Kısmi iade' };
  }
  return s;
}

// Etsy varyasyon adları mağazanın dilinde (İngilizce) geliyor.
export const VARIATION_LABELS = { dimensions: 'Boyut', size: 'Boyut', frame: 'Çerçeve' };
export const variationLabel = (name) => VARIATION_LABELS[name?.toLowerCase()] || name;

// Etsy'nin sabit iade sebepleri; bilinmeyenler olduğu gibi gösterilir.
const REFUND_REASONS = {
  'item has arrived damaged': 'Ürün hasarlı ulaştı',
  'item was not as described': 'Ürün açıklamadaki gibi değil',
  'item has not arrived': 'Ürün ulaşmadı',
  'cancellation requested': 'Alıcı iptal istedi',
  'buyer and shop owner agreed to cancel transaction': 'Alıcı ve satıcı iptalde anlaştı',
  'account adjustment': 'Hesap düzeltmesi'
};
export const refundReason = (r) => (r ? REFUND_REASONS[r.toLowerCase()] || r : null);
