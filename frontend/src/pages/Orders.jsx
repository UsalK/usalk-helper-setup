import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  ShoppingBag, RefreshCw, AlertCircle, ChevronLeft, ChevronRight, ImageOff, Loader2, TicketPercent, ArrowUpDown
} from 'lucide-react';

import { API_BASE, API_ORIGIN } from '../config';
import { formatMoney, formatDate, variationLabel, refundReason, ORDER_STATES, stateBadge } from '../utils/orderFormat';
import OrderDetail from '../components/OrderDetail';

const PAGE_LIMIT = 25;

const SORTS = [
  { id: 'date_desc', label: 'En yeni' },
  { id: 'date_asc', label: 'En eski' },
  { id: 'total_desc', label: 'Ücret: yüksekten düşüğe' },
  { id: 'total_asc', label: 'Ücret: düşükten yükseğe' },
  { id: 'product_revenue_desc', label: 'En çok kazandıran ürün' }
];

// Kaynak görselin durumu: noktanın rengi ve açıklaması.
const SOURCE = {
  local: { dot: 'bg-emerald-400', title: 'Kaynak görsel diskte (upscale edilecek dosya)' },
  missing: { dot: 'bg-slate-500', title: 'Kaynak görsel diskte bulunamadı — Etsy görseli gösteriliyor' },
  none: { dot: 'bg-slate-500', title: 'Listing usalk-helper veritabanında yok — Etsy görseli gösteriliyor' }
};

// Önce yerel kaynak görsel (upscale edilecek olan), yoksa Etsy listing görseli.
function ItemImage({ item }) {
  const sources = [
    item.source_image_path && `${API_ORIGIN}/${item.source_image_path}`,
    item.etsy_image_url
  ].filter(Boolean);
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [item.source_image_path]); // kaynak yüklenince yeniden dene
  const src = sources[idx];
  const source = SOURCE[item.source] || SOURCE.none;

  return (
    <div
      className="relative w-16 h-16 rounded-xl bg-[#151f32] border border-[#1e293b] overflow-hidden shrink-0"
      title={source.title}
    >
      {src ? (
        <img
          src={src}
          alt={item.title || ''}
          loading="lazy"
          onError={() => setIdx(i => i + 1)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-slate-600">
          <ImageOff className="w-5 h-5" />
        </div>
      )}
      <span className={`absolute bottom-1 right-1 w-2 h-2 rounded-full ring-2 ring-[#0e1726] ${source.dot}`} />
    </div>
  );
}

const TAG = 'self-start text-[10px] font-bold px-2 py-0.5 rounded-md border';

function ItemDetails({ item }) {
  return (
    <div className="h-16 flex flex-col justify-center min-w-0 space-y-0.5">
      {item.is_digital && (
        <span className={`${TAG} bg-violet-500/10 text-violet-300 border-violet-500/20`}>Dijital</span>
      )}
      {item.variations.map(v => (
        <div key={v.name} className="text-xs text-slate-200 truncate">
          <span className="text-slate-500">{variationLabel(v.name)}: </span>
          {v.value}
        </div>
      ))}
      {/* Seçeneksiz fiziksel ürünler custom order olarak açılıyor */}
      {!item.is_digital && item.variations.length === 0 && (
        <span className={`${TAG} bg-amber-500/10 text-amber-300 border-amber-500/20`} title={item.title}>Özel Sipariş</span>
      )}
      {item.quantity > 1 && <div className="text-[11px] font-semibold text-amber-400">× {item.quantity} adet</div>}
    </div>
  );
}

function FilterChip({ active, onClick, label, count, cls }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${active
        ? (cls || 'bg-amber-500/10 text-amber-400 border-amber-500/30')
        : 'text-slate-400 border-[#1e293b] hover:text-slate-200 hover:border-slate-600'}`}
    >
      {label}
      {count != null && <span className={`text-[10px] font-mono ${active ? 'opacity-90' : 'text-slate-500'}`}>{count}</span>}
    </button>
  );
}

export default function Orders({ etsyConnected, activeShop }) {
  const [orders, setOrders] = useState([]);
  const [count, setCount] = useState(0);
  const [counts, setCounts] = useState(null);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('date_desc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // detayı açık sipariş

  const fetchOrders = useCallback(async (refresh = false) => {
    if (!etsyConnected) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE}/orders`, {
        params: {
          limit: PAGE_LIMIT,
          offset,
          sort,
          state: filter === 'all' ? undefined : filter,
          refresh: refresh ? 1 : undefined
        }
      });
      setOrders(res.data.orders || []);
      setCount(res.data.count || 0);
      setCounts(res.data.counts || null);
    } catch (err) {
      console.error('Siparişler yüklenemedi:', err);
      setError(err.response?.data?.error || 'Siparişler yüklenirken hata oluştu.');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [etsyConnected, offset, filter, sort]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Detayda kaynak görsel yüklenince / silinmiş bulununca listeyi güncelle. Kaynak
  // görsel listinge bağlı olduğu için aynı listingin TÜM siparişleri birlikte değişir.
  const patchListing = useCallback((listingId, patch) => {
    setOrders(list => list.map(o => (!o.items.some(it => it.listing_id === listingId) ? o : {
      ...o,
      items: o.items.map(it => (it.listing_id === listingId ? { ...it, ...patch } : it))
    })));
  }, []);

  const changeFilter = (f) => { setOffset(0); setFilter(f); };
  const changeSort = (s) => { setOffset(0); setSort(s); };

  const page = Math.floor(offset / PAGE_LIMIT) + 1;
  const totalPages = Math.max(1, Math.ceil(count / PAGE_LIMIT));

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1e293b] pb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center text-white shadow-lg shadow-amber-500/20">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white font-outfit tracking-tight">Siparişler</h1>
            <p className="text-xs text-slate-400">
              {activeShop?.shop_name ? `${activeShop.shop_name} mağazasının` : 'Aktif mağazanın'} Etsy siparişleri.
            </p>
          </div>
        </div>

        <button
          onClick={() => fetchOrders(true)}
          disabled={loading || !etsyConnected}
          className="flex items-center space-x-2 bg-[#151f32] hover:bg-[#1e293b] text-slate-200 border border-[#1e293b] px-4 py-2.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-amber-500 ${loading ? 'animate-spin' : ''}`} />
          <span>Yenile</span>
        </button>
      </div>

      {!etsyConnected ? (
        <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-8 text-center text-sm text-slate-400">
          Siparişleri görmek için önce Etsy Bağlantısı sayfasından bir mağaza bağlayın.
        </div>
      ) : error ? (
        <div className="flex items-start space-x-3 bg-rose-950/40 border border-rose-500/30 text-rose-200 rounded-2xl p-5">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <span className="text-sm">{error}</span>
        </div>
      ) : (
        <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl overflow-hidden">
          {/* Filtre ve sıralama */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-[#1e293b]">
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip active={filter === 'all'} onClick={() => changeFilter('all')} label="Tümü" count={counts?.all} />
              {ORDER_STATES.map(s => (
                <FilterChip
                  key={s.id}
                  active={filter === s.id}
                  onClick={() => changeFilter(s.id)}
                  label={s.label}
                  count={counts?.[s.id]}
                  cls={s.cls}
                />
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
              <select
                value={sort}
                onChange={e => changeSort(e.target.value)}
                className="bg-[#151f32] border border-[#1e293b] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-x-5 px-5 py-2 border-b border-[#1e293b] text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" />Kaynak görsel diskte</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-500" />Kaynak görsel yok</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#1e293b] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3.5">Ürün Görseli</th>
                  <th className="px-5 py-3.5">Müşteri</th>
                  <th className="px-5 py-3.5">Ürün Detayları</th>
                  <th className="px-5 py-3.5 text-right">Sipariş Ücreti</th>
                  <th className="px-5 py-3.5">Tarih</th>
                  <th className="px-5 py-3.5 text-center">Kupon</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e293b]">
                {loading && orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-16 text-center text-slate-400 text-sm">
                      <Loader2 className="w-5 h-5 animate-spin text-amber-500 inline-block mr-2 align-middle" />
                      Siparişler yükleniyor...
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-16 text-center text-slate-500 text-sm">
                      {filter === 'all' ? 'Henüz sipariş yok.' : 'Bu filtrede sipariş yok.'}
                    </td>
                  </tr>
                ) : orders.map(o => {
                  const badge = stateBadge(o);
                  return (
                    <tr
                      key={o.receipt_id}
                      onClick={() => setSelected(o)}
                      className={`align-top cursor-pointer hover:bg-slate-800/30 transition-colors ${loading ? 'opacity-60' : ''}`}
                    >
                      <td className="px-5 py-4">
                        <div className="space-y-2">
                          {o.items.map(it => <ItemImage key={it.transaction_id} item={it} />)}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="h-16 flex flex-col justify-center">
                          <span className="text-sm font-semibold text-slate-100">{o.customer_name || '—'}</span>
                          <span className="text-[11px] text-slate-500 font-mono">#{o.receipt_id}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 max-w-xs">
                        <div className="space-y-2">
                          {o.items.map(it => <ItemDetails key={it.transaction_id} item={it} />)}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="h-16 flex flex-col items-end justify-center">
                          <span className="text-sm font-bold text-white font-outfit">{formatMoney(o.grandtotal)}</span>
                          {o.refunded_total && (
                            <span className="text-[11px] font-semibold text-rose-400">−{formatMoney(o.refunded_total)} iade</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="h-16 flex flex-col justify-center items-start space-y-1">
                          <span className="text-xs text-slate-300 whitespace-nowrap">{formatDate(o.created_at)}</span>
                          {badge && (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${badge.cls}`}>{badge.label}</span>
                          )}
                          {o.refunds.length > 0 && (
                            <span
                              className="text-[10px] text-rose-300/90 max-w-[11rem] truncate"
                              title={o.refunds.map(f => [refundReason(f.reason), f.note].filter(Boolean).join(' — ')).join('\n')}
                            >
                              {refundReason(o.refunds[0].reason) || 'Sebep belirtilmemiş'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="h-16 flex items-center justify-center">
                          {o.discount ? (
                            <span
                              className="inline-flex items-center space-x-1 text-xs font-bold px-2.5 py-1 rounded-lg border bg-rose-500/10 text-rose-300 border-rose-500/20"
                              title={`${formatMoney(o.discount)} indirim`}
                            >
                              <TicketPercent className="w-3.5 h-3.5" />
                              <span>%{o.discount.percent}</span>
                            </span>
                          ) : (
                            <span className="text-slate-600 text-xs">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Sayfalama */}
          {count > PAGE_LIMIT && (
            <div className="flex items-center justify-between border-t border-[#1e293b] px-5 py-3 text-xs text-slate-400">
              <span>{offset + 1}–{Math.min(offset + PAGE_LIMIT, count)} / {count} sipariş</span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setOffset(o => Math.max(0, o - PAGE_LIMIT))}
                  disabled={loading || page <= 1}
                  className="p-2 rounded-lg bg-[#151f32] border border-[#1e293b] hover:bg-[#1e293b] disabled:opacity-40"
                  aria-label="Önceki sayfa"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-semibold text-slate-300">{page} / {totalPages}</span>
                <button
                  onClick={() => setOffset(o => o + PAGE_LIMIT)}
                  disabled={loading || page >= totalPages}
                  className="p-2 rounded-lg bg-[#151f32] border border-[#1e293b] hover:bg-[#1e293b] disabled:opacity-40"
                  aria-label="Sonraki sayfa"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} onListingUpdated={patchListing} />}
    </div>
  );
}
