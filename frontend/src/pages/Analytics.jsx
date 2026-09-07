import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  BarChart3, RefreshCw, Search, Filter, ArrowUpDown, FileSpreadsheet,
  Eye, Heart, ShoppingBag, DollarSign, Clock, Edit3, FolderOpen,
  Image as ImageIcon, Download, Rocket, Gauge, RefreshCcw
} from 'lucide-react';
import BulkReplaceModal from '../components/BulkReplaceModal';
import Modal from '../components/Modal';

const API_BASE = 'http://localhost:3001/api';

// Sıralama metrikleri. 'usalk_score' varsayılan: ölü listingleri bulmanın en hızlı yolu.
const SORT_METRICS = [
  { value: 'usalk_score', label: 'Usalk Puanı' },
  { value: 'views', label: 'Görüntülenme' },
  { value: 'num_favorers', label: 'Favori Sayısı' },
  { value: 'fav_rate', label: 'Favori Oranı (%)' },
  { value: 'sales_count', label: 'Sipariş Sayısı' },
  { value: 'total_revenue', label: 'Ciro ($)' },
  { value: 'age_days', label: 'Yaş (gün)' }
];

function scoreBand(score) {
  if (score >= 80) return { label: 'Güçlü', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' };
  if (score >= 55) return { label: 'İyi', cls: 'text-teal-400 bg-teal-500/10 border-teal-500/30' };
  if (score >= 30) return { label: 'Ortalama', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
  if (score >= 10) return { label: 'Zayıf', cls: 'text-orange-400 bg-orange-500/10 border-orange-500/30' };
  return { label: 'Ölü', cls: 'text-rose-400 bg-rose-500/10 border-rose-500/30' };
}

export default function Analytics({ etsyConnected, activeShop }) {
  const [dateRange, setDateRange] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [minAgeDays, setMinAgeDays] = useState(0);
  const [zeroVisitsOnly, setZeroVisitsOnly] = useState(false);
  const [zeroFavsOnly, setZeroFavsOnly] = useState(false);
  const [sortBy, setSortBy] = useState('usalk_score');
  const [sortOrder, setSortOrder] = useState('asc');

  const [listings, setListings] = useState([]);
  const [summary, setSummary] = useState({
    total_views: 0, total_favorites: 0, total_sales: 0, total_revenue: 0, avg_click_rate: 0
  });
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  const [replaceSingleModal, setReplaceSingleModal] = useState(null);
  const [singleNewTitle, setSingleNewTitle] = useState('');
  const [singleNewTags, setSingleNewTags] = useState('');
  const [singleNewImageFile, setSingleNewImageFile] = useState(null);
  const [replacingSingle, setReplacingSingle] = useState(false);

  const [currentPageNum, setCurrentPageNum] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  useEffect(() => {
    setCurrentPageNum(1);
    fetchListings();
  }, [dateRange, startDate, endDate, searchQuery, minAgeDays, zeroVisitsOnly, zeroFavsOnly, sortBy, sortOrder]);

  // Sayfa kaydırma kilidi Modal bileşeni tarafından yönetiliyor

  const fetchListings = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/etsy/analytics/listings`, {
        params: {
          range: dateRange, startDate, endDate, search: searchQuery,
          minAgeDays, zeroVisitsOnly, zeroFavsOnly, sortBy, sortOrder
        }
      });
      if (res.data.success) {
        setListings(res.data.listings);
        setSummary(res.data.summary);
        setTotalCount(res.data.total_count);
        if (res.data.listings[0]?.last_synced_at) {
          setLastSyncedAt(res.data.listings[0].last_synced_at);
        }
      }
    } catch (err) {
      console.error('Analiz verileri alınamadı:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await axios.get(`${API_BASE}/etsy/analytics/sync`);
      if (res.data.success) {
        setLastSyncedAt(res.data.last_synced_at);
        await fetchListings();
      }
    } catch (err) {
      alert('Etsy verileri senkronize edilemedi: ' + (err.response?.data?.error || err.message));
    } finally {
      setSyncing(false);
    }
  };

  const handleImportSalesCSV = async (file) => {
    try {
      const formData = new FormData();
      if (file) formData.append('file', file);
      const res = await axios.post(`${API_BASE}/etsy/analytics/import-sales-csv`, formData);
      if (res.data.success) {
        alert(`Sipariş CSV aktarıldı.\nSipariş: ${res.data.total_orders_parsed}\nEşleşen ürün: ${res.data.updated_listings}\nCiro: $${res.data.total_revenue_imported.toFixed(2)}`);
        await fetchListings();
      }
    } catch (err) {
      alert('Sipariş CSV aktarılamadı: ' + (err.response?.data?.error || err.message));
    }
  };

  const pageListings = useMemo(
    () => listings.slice((currentPageNum - 1) * itemsPerPage, currentPageNum * itemsPerPage),
    [listings, currentPageNum, itemsPerPage]
  );

  const pageAllSelected = pageListings.length > 0 && pageListings.every(l => selectedIds.includes(l.listing_id));

  const toggleSelectPage = () => {
    const pageIds = pageListings.map(l => l.listing_id);
    setSelectedIds(prev => pageAllSelected
      ? prev.filter(id => !pageIds.includes(id))
      : [...new Set([...prev, ...pageIds])]);
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const selectWorst = (n) => {
    const worst = [...listings]
      .sort((a, b) => a.usalk_score - b.usalk_score)
      .slice(0, n)
      .map(l => l.listing_id);
    setSelectedIds(worst);
  };

  const handleExecuteReplaceSingle = async (e) => {
    e.preventDefault();
    if (!replaceSingleModal) return;
    setReplacingSingle(true);
    try {
      const formData = new FormData();
      formData.append('listing_id', replaceSingleModal.listing_id);
      formData.append('title', singleNewTitle);
      formData.append('tags', singleNewTags);
      if (singleNewImageFile) formData.append('image', singleNewImageFile);

      const res = await axios.post(`${API_BASE}/etsy/analytics/replace-single`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (res.data.success) {
        alert(`Listing #${replaceSingleModal.listing_id} güncellendi.`);
        setReplaceSingleModal(null);
        await fetchListings();
      }
    } catch (err) {
      alert('Güncelleme başarısız: ' + (err.response?.data?.error || err.message));
    } finally {
      setReplacingSingle(false);
    }
  };

  const selectedListings = useMemo(
    () => listings.filter(l => selectedIds.includes(l.listing_id)),
    [listings, selectedIds]
  );

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fade-in">

      {/* Başlık & senkron */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0f172a] border border-[#1e293b] p-6 rounded-3xl shadow-xl">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center text-white shadow-lg shadow-amber-500/20">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-white font-outfit tracking-tight">
              Analiz & Optimizasyon
            </h1>
            <p className="text-xs text-slate-400">
              Veriler yerel önbellekten okunur — Etsy'ye yalnızca "Verileri Güncelle" dediğinde gidilir.
              {lastSyncedAt && (
                <span className="text-slate-500"> Son güncelleme: {new Date(lastSyncedAt).toLocaleString('tr-TR')}</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <a
            href={`${API_BASE}/etsy/analytics/export-csv`}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-semibold text-xs bg-[#151f32] hover:bg-slate-800 text-slate-200 border border-[#1e293b] transition-colors"
            title="Önbellekteki analiz verisini CSV olarak indir"
          >
            <Download className="w-4 h-4 text-cyan-400" />
            <span>CSV İndir</span>
          </a>

          <label className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-semibold text-xs bg-[#151f32] hover:bg-slate-800 text-slate-200 border border-[#1e293b] cursor-pointer transition-colors">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Sipariş CSV</span>
            <input
              type="file" accept=".csv" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleImportSalesCSV(e.target.files[0])}
            />
          </label>

          <button
            onClick={handleSync}
            disabled={syncing}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-xs transition-all shadow-lg ${
              syncing
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 text-white shadow-amber-500/20'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Çekiliyor…' : 'Verileri Güncelle'}</span>
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Aktif Ürün', value: totalCount, icon: FolderOpen, color: 'text-amber-500', text: 'text-white' },
          { label: 'Görüntülenme', value: summary.total_views.toLocaleString(), icon: Eye, color: 'text-cyan-400', text: 'text-white' },
          { label: 'Favoriler', value: summary.total_favorites.toLocaleString(), icon: Heart, color: 'text-rose-500', text: 'text-white' },
          { label: 'Sipariş', value: summary.total_sales, icon: ShoppingBag, color: 'text-emerald-400', text: 'text-white' },
          { label: 'Ciro', value: `$${summary.total_revenue.toFixed(2)}`, icon: DollarSign, color: 'text-emerald-500', text: 'text-emerald-400' }
        ].map(k => (
          <div key={k.label} className="bg-[#0f172a] border border-[#1e293b] p-5 rounded-2xl space-y-2">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-semibold uppercase">{k.label}</span>
              <k.icon className={`w-4 h-4 ${k.color}`} />
            </div>
            <p className={`text-2xl font-black font-outfit ${k.text}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filtreler */}
      <div className="bg-[#0f172a] border border-[#1e293b] p-6 rounded-2xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-1.5 bg-[#151f32] p-1 rounded-xl border border-[#1e293b] text-xs">
            {[['all', 'Tüm Zamanlar'], ['7d', 'Son 7 Gün'], ['30d', 'Son 30 Gün'], ['90d', 'Son 90 Gün'], ['custom', 'Özel']].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setDateRange(v)}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                  dateRange === v ? 'bg-amber-500 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Başlık veya etiket ara…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl pl-10 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 font-medium"
            />
          </div>
        </div>

        {dateRange === 'custom' && (
          <div className="flex items-center space-x-4 pt-2 border-t border-[#1e293b] text-xs">
            <div className="flex items-center space-x-2">
              <span className="text-slate-400">Başlangıç:</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="bg-[#151f32] border border-[#1e293b] rounded-lg px-3 py-1.5 text-white" />
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-slate-400">Bitiş:</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                className="bg-[#151f32] border border-[#1e293b] rounded-lg px-3 py-1.5 text-white" />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-[#1e293b] text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center space-x-2 bg-[#151f32] border border-[#1e293b] px-3 py-1.5 rounded-xl">
              <Clock className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-slate-400 font-medium">Min yaş:</span>
              <input
                type="number" min="0" placeholder="0" value={minAgeDays || ''}
                onChange={(e) => setMinAgeDays(parseInt(e.target.value) || 0)}
                className="w-14 bg-[#0f172a] border border-[#1e293b] rounded px-2 py-0.5 text-center text-amber-400 font-bold"
              />
              <span className="text-slate-400">gün</span>
            </div>

            <label className="flex items-center space-x-2 cursor-pointer bg-[#151f32] border border-[#1e293b] px-3 py-1.5 rounded-xl">
              <input type="checkbox" checked={zeroVisitsOnly} onChange={(e) => setZeroVisitsOnly(e.target.checked)}
                className="rounded border-[#1e293b] text-amber-500 focus:ring-0" />
              <span className="text-slate-300 font-medium">Hiç görüntülenmeyen</span>
            </label>

            <label className="flex items-center space-x-2 cursor-pointer bg-[#151f32] border border-[#1e293b] px-3 py-1.5 rounded-xl">
              <input type="checkbox" checked={zeroFavsOnly} onChange={(e) => setZeroFavsOnly(e.target.checked)}
                className="rounded border-[#1e293b] text-amber-500 focus:ring-0" />
              <span className="text-slate-300 font-medium">Hiç favori almayan</span>
            </label>
          </div>

          <div className="flex items-center space-x-2">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400 font-medium">Sırala:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-[#151f32] border border-[#1e293b] rounded-xl px-3 py-1.5 text-white font-medium focus:outline-none"
            >
              {SORT_METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <button
              onClick={() => setSortOrder(o => o === 'desc' ? 'asc' : 'desc')}
              className="px-2.5 py-1.5 bg-[#151f32] border border-[#1e293b] rounded-xl text-slate-300 font-bold uppercase"
              title={sortOrder === 'asc' ? 'Artan (en kötüler önce)' : 'Azalan (en iyiler önce)'}
            >
              {sortOrder === 'asc' ? '↑ artan' : '↓ azalan'}
            </button>
          </div>
        </div>
      </div>

      {/* Seçim aksiyon çubuğu */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#0f172a] border border-[#1e293b] p-4 rounded-2xl">
        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-400">
            <strong className="text-amber-400">{selectedIds.length}</strong> listing seçili
          </span>
          <span className="text-slate-700">|</span>
          <span className="text-slate-500">Hızlı seç:</span>
          {[10, 25, 50].map(n => (
            <button
              key={n}
              onClick={() => selectWorst(n)}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold border border-slate-700"
            >
              En kötü {n}
            </button>
          ))}
          {selectedIds.length > 0 && (
            <button onClick={() => setSelectedIds([])} className="text-slate-500 hover:text-slate-300 underline">
              temizle
            </button>
          )}
        </div>

        <button
          onClick={() => setBulkModalOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs bg-gradient-to-r from-amber-500 to-rose-500 text-white shadow-lg shadow-amber-500/20 hover:opacity-90"
        >
          {selectedIds.length > 0 ? <RefreshCcw className="w-4 h-4" /> : <Rocket className="w-4 h-4" />}
          {selectedIds.length > 0
            ? `Seçili ${selectedIds.length} Listing'i Güncelle`
            : 'Toplu Listing Yükle'}
        </button>
      </div>

      {/* Tablo */}
      <div className="bg-[#0f172a] border border-[#1e293b] rounded-3xl overflow-hidden shadow-xl">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-16 space-y-4 text-amber-500">
            <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-xs font-semibold">Analiz verileri yükleniyor…</span>
          </div>
        ) : listings.length === 0 ? (
          <div className="p-16 text-center text-slate-400 space-y-3">
            <Filter className="w-10 h-10 mx-auto text-slate-600" />
            <p className="text-sm font-semibold">Filtreye uyan ürün bulunamadı.</p>
            <p className="text-xs text-slate-500">Filtreleri sıfırlayın veya "Verileri Güncelle" deneyin.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#151f32] text-slate-400 font-semibold border-b border-[#1e293b]">
                <tr>
                  <th className="p-4 w-10">
                    <input type="checkbox" checked={pageAllSelected} onChange={toggleSelectPage}
                      className="rounded border-[#1e293b] text-amber-500" title="Bu sayfadakileri seç" />
                  </th>
                  <th className="p-4">Ürün</th>
                  <th className="p-4 text-center">Usalk Puanı</th>
                  <th className="p-4 text-center">Yaş</th>
                  <th className="p-4 text-center">Görüntülenme</th>
                  <th className="p-4 text-center">Favori</th>
                  <th className="p-4 text-center">Fav %</th>
                  <th className="p-4 text-center">Sipariş</th>
                  <th className="p-4 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e293b]">
                {pageListings.map(l => {
                  const band = scoreBand(l.usalk_score);
                  return (
                    <tr key={l.listing_id} className={`hover:bg-slate-800/40 transition-colors ${
                      selectedIds.includes(l.listing_id) ? 'bg-amber-500/5' : ''
                    }`}>
                      <td className="p-4">
                        <input type="checkbox" checked={selectedIds.includes(l.listing_id)}
                          onChange={() => toggleSelect(l.listing_id)}
                          className="rounded border-[#1e293b] text-amber-500" />
                      </td>

                      <td className="p-4 max-w-sm">
                        <div className="flex items-center space-x-4">
                          <div className="relative w-20 h-20 rounded-2xl bg-slate-800 border border-slate-700/80 flex items-center justify-center flex-shrink-0 overflow-hidden shadow-lg group hover:border-amber-500/50 transition-all">
                            {l.image_url ? (
                              <img src={l.image_url} alt={l.title}
                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" />
                            ) : (
                              <div className="flex flex-col items-center text-slate-600">
                                <ImageIcon className="w-6 h-6" />
                              </div>
                            )}
                            {l.image_width > 0 && (
                              <span className={`absolute bottom-0 inset-x-0 text-[8px] font-black text-center py-0.5 text-white backdrop-blur-md ${
                                l.is_high_res ? 'bg-emerald-600/80' : 'bg-amber-600/80'
                              }`}>
                                {l.image_width}x{l.image_height}
                              </span>
                            )}
                          </div>

                          <div className="min-w-0 flex-1 space-y-1">
                            <a href={l.url} target="_blank" rel="noreferrer"
                              className="font-bold text-slate-200 hover:text-amber-400 transition-colors line-clamp-2 leading-tight text-xs">
                              {l.title}
                            </a>
                            <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
                              <span className="font-mono text-slate-500">#{l.listing_id}</span>
                              <span>•</span>
                              {/* İndirim varsa orijinal fiyat üstü çizili gösterilir */}
                              {l.discounted_price !== null && l.discounted_price !== undefined ? (
                                <span className="flex items-center gap-1.5">
                                  <span className="text-slate-500 line-through">${l.price_amount}</span>
                                  <span className="text-emerald-400 font-extrabold text-xs">${l.discounted_price}</span>
                                  <span className="text-[8px] font-black text-rose-400 bg-rose-500/10 px-1 py-0.5 rounded border border-rose-500/20">
                                    -%{l.discount_percent}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-amber-400 font-extrabold text-xs">${l.price_amount}</span>
                              )}
                              <span>•</span>
                              <span className="text-slate-400">{l.section_title || 'Genel'}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="p-4">
                        <div className="flex flex-col items-center gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <Gauge className="w-3 h-3 text-slate-500" />
                            <span className="text-base font-black text-white font-outfit">{l.usalk_score}</span>
                          </div>
                          <div className="w-16 h-1 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-rose-500 via-amber-500 to-emerald-500"
                              style={{ width: `${l.usalk_score}%` }} />
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${band.cls}`}>
                            {band.label}
                          </span>
                        </div>
                      </td>

                      <td className="p-4 text-center font-bold text-slate-300">{l.age_days}g</td>
                      <td className="p-4 text-center font-extrabold text-cyan-400">{l.views}</td>
                      <td className="p-4 text-center font-extrabold text-rose-400">{l.num_favorers}</td>
                      <td className="p-4 text-center">
                        <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                          l.fav_rate > 5 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                          l.fav_rate > 0 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                          'bg-slate-800 text-slate-500'
                        }`}>
                          %{l.fav_rate}
                        </span>
                      </td>
                      <td className="p-4 text-center font-extrabold text-emerald-400">{l.sales_count}</td>

                      <td className="p-4 text-right">
                        <button
                          onClick={() => {
                            setReplaceSingleModal(l);
                            setSingleNewTitle(l.title || '');
                            setSingleNewTags(Array.isArray(l.tags) ? l.tags.join(', ') : (l.tags || ''));
                            setSingleNewImageFile(null);
                          }}
                          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-semibold border border-slate-700"
                          title="Tekli düzenle"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Sayfalama */}
        {listings.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-[#151f32] border-t border-[#1e293b] p-4 text-xs">
            <div className="flex items-center space-x-3 text-slate-400 font-medium">
              <span>
                <strong className="text-slate-200">{listings.length}</strong> üründen{' '}
                <strong className="text-amber-400">
                  {Math.min((currentPageNum - 1) * itemsPerPage + 1, listings.length)}–{Math.min(currentPageNum * itemsPerPage, listings.length)}
                </strong>
              </span>
              <span className="text-slate-600">|</span>
              <div className="flex items-center space-x-2">
                <span>Sayfa başı:</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPageNum(1); }}
                  className="bg-[#0f172a] border border-[#1e293b] text-slate-200 px-2.5 py-1 rounded-lg font-bold outline-none focus:border-amber-500"
                >
                  {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                disabled={currentPageNum <= 1}
                onClick={() => setCurrentPageNum(p => Math.max(1, p - 1))}
                className={`px-3 py-1.5 rounded-lg font-bold border ${
                  currentPageNum <= 1
                    ? 'bg-slate-800/40 text-slate-600 border-slate-800 cursor-not-allowed'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                }`}
              >
                ← Önceki
              </button>
              <div className="px-3 py-1.5 bg-[#0f172a] border border-[#1e293b] rounded-lg font-bold text-slate-300">
                <span className="text-amber-400">{currentPageNum}</span>
                <span className="text-slate-500"> / </span>
                <span>{Math.ceil(listings.length / itemsPerPage) || 1}</span>
              </div>
              <button
                disabled={currentPageNum >= Math.ceil(listings.length / itemsPerPage)}
                onClick={() => setCurrentPageNum(p => Math.min(Math.ceil(listings.length / itemsPerPage), p + 1))}
                className={`px-3 py-1.5 rounded-lg font-bold border ${
                  currentPageNum >= Math.ceil(listings.length / itemsPerPage)
                    ? 'bg-slate-800/40 text-slate-600 border-slate-800 cursor-not-allowed'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                }`}
              >
                Sonraki →
              </button>
            </div>
          </div>
        )}
      </div>

      <BulkReplaceModal
        open={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        selectedListings={selectedListings}
        onStarted={() => setSelectedIds([])}
      />

      {/* Tekli düzenleme */}
      <Modal open={!!replaceSingleModal} onClose={() => setReplaceSingleModal(null)} maxWidth="max-w-lg">
        <form onSubmit={handleExecuteReplaceSingle} className="flex flex-col overflow-hidden">
          <div className="flex items-center justify-between p-6 border-b border-[#1e293b] shrink-0">
            <h3 className="font-bold text-white text-base font-outfit">Tekli Ürün Güncelle</h3>
            <button type="button" onClick={() => setReplaceSingleModal(null)}
              className="text-slate-500 hover:text-white font-bold">✕</button>
          </div>

          <div className="space-y-4 text-xs p-6 overflow-y-auto">
            <div>
              <label className="block text-slate-400 font-semibold mb-1">Başlık</label>
              <input type="text" value={singleNewTitle} onChange={(e) => setSingleNewTitle(e.target.value)}
                className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-3 py-2 text-white" required />
            </div>
            <div>
              <label className="block text-slate-400 font-semibold mb-1">Etiketler (virgülle, maks 13)</label>
              <input type="text" value={singleNewTags} onChange={(e) => setSingleNewTags(e.target.value)}
                className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-3 py-2 text-white" />
            </div>
            <div>
              <label className="block text-slate-400 font-semibold mb-1">Yeni görsel (opsiyonel)</label>
              <input type="file" accept="image/*" onChange={(e) => setSingleNewImageFile(e.target.files[0])}
                className="w-full text-slate-300 text-xs" />
            </div>
          </div>

          <div className="flex justify-end space-x-3 p-6 border-t border-[#1e293b] shrink-0">
            <button type="button" onClick={() => setReplaceSingleModal(null)}
              className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl">İptal</button>
            <button type="submit" disabled={replacingSingle}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold rounded-xl shadow-lg shadow-amber-500/20">
              {replacingSingle ? 'Güncelleniyor…' : 'Kaydet'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
