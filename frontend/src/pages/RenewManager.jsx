import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { 
  CalendarClock, Search, Filter, ArrowUpDown, RefreshCw, CheckCircle2, 
  AlertTriangle, ShieldAlert, CheckSquare, Square, ExternalLink, Eye, 
  Heart, ShoppingBag, DollarSign, Layers, ChevronLeft, ChevronRight,
  Power, PowerOff, Sparkles, X, Check, Clock, AlertCircle, Loader2
} from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';
const PAGE_LIMIT = 20;

export default function RenewManager({ etsyConnected, activeShop }) {
  // Data state
  const [listings, setListings] = useState([]);
  const [summary, setSummary] = useState({
    total_listings: 0,
    auto_renew_count: 0,
    manual_count: 0,
    urgent_count: 0,
    critical_count: 0,
    potential_cost: '0.00'
  });
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [shopSections, setShopSections] = useState([]);

  // Filter & sorting states
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [renewFilter, setRenewFilter] = useState('all'); // 'all' | 'auto' | 'manual'
  const [daysFilter, setDaysFilter] = useState('all');   // 'all' | 'urgent' | 'warning' | 'safe'
  const [selectedSection, setSelectedSection] = useState('');
  const [sortBy, setSortBy] = useState('days_remaining');
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' | 'desc'

  // Selection & bulk action states
  const [selectedIds, setSelectedIds] = useState([]);
  const [togglingIds, setTogglingIds] = useState(new Set()); // robust switch lock
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [notification, setNotification] = useState(null); // { type: 'success'|'error'|'info', message }

  const searchTimerRef = useRef(null);

  // Debounce search input
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearch(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 350);
  };

  // Toast notification helper
  const showToast = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4500);
  };

  // Fetch shop sections for filter
  useEffect(() => {
    if (!etsyConnected) return;
    axios.get(`${API_BASE}/etsy/shop-sections`)
      .then(res => setShopSections(res.data || []))
      .catch(err => console.warn('Could not fetch sections:', err.message));
  }, [etsyConnected, activeShop]);

  // Main data fetcher
  const fetchListings = useCallback(async () => {
    if (!etsyConnected) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/etsy/renew-manager/listings`, {
        params: {
          page,
          limit: PAGE_LIMIT,
          search: debouncedSearch,
          renewFilter,
          daysFilter,
          shop_section_id: selectedSection,
          sortBy,
          sortOrder
        }
      });

      if (res.data?.success) {
        setListings(res.data.listings || []);
        setSummary(res.data.summary || {});
        setTotalCount(res.data.total || 0);
        setTotalPages(res.data.total_pages || 1);
      }
    } catch (err) {
      console.error('Failed to load renew manager listings:', err);
      showToast(err.response?.data?.error || 'Listing verileri yüklenirken hata oluştu.', 'error');
    } finally {
      setLoading(false);
    }
  }, [etsyConnected, page, debouncedSearch, renewFilter, daysFilter, selectedSection, sortBy, sortOrder]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  // Selection Handlers
  const handleSelectAllOnPage = () => {
    const pageIds = listings.map(l => l.listing_id_str);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !pageIds.includes(id)));
    } else {
      const merged = Array.from(new Set([...selectedIds, ...pageIds]));
      setSelectedIds(merged);
    }
  };

  const handleToggleSelectRow = (idStr, e) => {
    e.stopPropagation();
    setSelectedIds(prev => 
      prev.includes(idStr) ? prev.filter(id => id !== idStr) : [...prev, idStr]
    );
  };

  // Robust Single Switch Toggle (Zero Bug Guarantee)
  const handleToggleAutoRenew = async (listing, e) => {
    e.stopPropagation();
    const idStr = listing.listing_id_str;

    // If currently toggling, prevent double click
    if (togglingIds.has(idStr)) return;

    const currentVal = listing.should_auto_renew;
    const targetVal = !currentVal;

    // Lock switch immediately
    setTogglingIds(prev => new Set(prev).add(idStr));

    // Optimistic UI update
    setListings(prev => prev.map(item => 
      item.listing_id_str === idStr ? { ...item, should_auto_renew: targetVal } : item
    ));

    try {
      const res = await axios.post(`${API_BASE}/etsy/listings/batch-auto-renew`, {
        listingIds: [idStr],
        should_auto_renew: targetVal
      });

      if (res.data?.success && res.data.updatedCount > 0) {
        showToast(
          `#${idStr} listelemesi ${targetVal ? 'Otomatik Yenileme (Açık)' : 'Manuel Yenileme (Kapalı)'} moduna alındı.`,
          'success'
        );
        // Update summary counter
        setSummary(prev => ({
          ...prev,
          auto_renew_count: targetVal ? prev.auto_renew_count + 1 : Math.max(0, prev.auto_renew_count - 1),
          manual_count: targetVal ? Math.max(0, prev.manual_count - 1) : prev.manual_count + 1,
          potential_cost: ((targetVal ? prev.auto_renew_count + 1 : Math.max(0, prev.auto_renew_count - 1)) * 0.20).toFixed(2)
        }));
      } else {
        throw new Error(res.data?.results?.[0]?.error || 'Etsy güncelleme başarısız oldu.');
      }
    } catch (err) {
      console.error(`Toggle failed for listing ${idStr}:`, err);
      // Rollback to original state on failure
      setListings(prev => prev.map(item => 
        item.listing_id_str === idStr ? { ...item, should_auto_renew: currentVal } : item
      ));
      showToast(`Hata (#${idStr}): ${err.response?.data?.error || err.message}`, 'error');
    } finally {
      // Release lock
      setTogglingIds(prev => {
        const next = new Set(prev);
        next.delete(idStr);
        return next;
      });
    }
  };

  // Bulk Auto-Renew Action
  const handleBulkToggle = async (targetVal) => {
    if (selectedIds.length === 0) return;

    const actionName = targetVal ? 'Otomatik Yenileme (Açık)' : 'Manuel Yenileme (Kapalı)';
    if (!window.confirm(`Seçili ${selectedIds.length} adet listing'i ${actionName} moduna almak istediğinize emin misiniz?`)) {
      return;
    }

    setBulkActionLoading(true);

    try {
      const res = await axios.post(`${API_BASE}/etsy/listings/batch-auto-renew`, {
        listingIds: selectedIds,
        should_auto_renew: targetVal
      });

      if (res.data?.success) {
        showToast(
          `İşlem tamamlandı! ${res.data.updatedCount} ürün güncellendi.${res.data.failedCount > 0 ? ` (${res.data.failedCount} başarısız)` : ''}`,
          res.data.failedCount > 0 ? 'info' : 'success'
        );
        // Refresh listings and summary
        await fetchListings();
        setSelectedIds([]);
      }
    } catch (err) {
      console.error('Bulk auto-renew error:', err);
      showToast(err.response?.data?.error || 'Toplu işlem sırasında hata oluştu.', 'error');
    } finally {
      setBulkActionLoading(false);
    }
  };

  const isAllPageSelected = listings.length > 0 && listings.every(l => selectedIds.includes(l.listing_id_str));

  // Life progress bar renderer (4 months = 120 days)
  const renderLifeBar = (daysRemaining, lifePercent, endingTimestamp) => {
    let barColor = 'from-emerald-500 to-green-400';
    let textColor = 'text-emerald-300';
    let bgPulse = '';
    let badgeText = `${daysRemaining} gün kaldı`;

    if (daysRemaining <= 0) {
      barColor = 'from-slate-600 to-slate-500';
      textColor = 'text-slate-400';
      badgeText = 'Süresi Doldu';
    } else if (daysRemaining <= 15) {
      barColor = 'from-rose-600 to-red-500';
      textColor = 'text-rose-200';
      bgPulse = 'shadow-[0_0_12px_rgba(244,63,94,0.35)]';
      badgeText = `⚠️ ${daysRemaining} gün kaldı`;
    } else if (daysRemaining <= 30) {
      barColor = 'from-amber-500 to-yellow-400';
      textColor = 'text-amber-200';
      badgeText = `${daysRemaining} gün kaldı`;
    }

    const expiryDateStr = endingTimestamp > 0 
      ? new Date(endingTimestamp * 1000).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'Belirsiz';

    return (
      <div className="w-full space-y-1.5" title={`Bitiş Tarihi: ${expiryDateStr} (4 aylık toplam ömür)`}>
        <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400">
          <span className="flex items-center space-x-1">
            <Clock className="w-3 h-3 text-slate-500" />
            <span>4 Aylık Ömür</span>
          </span>
          <span className={`${textColor} font-bold`}>{badgeText}</span>
        </div>

        {/* Progress Bar Track */}
        <div className={`w-full h-4 bg-slate-950 rounded-full overflow-hidden border border-slate-800 p-0.5 relative ${bgPulse}`}>
          {/* Fill */}
          <div 
            className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-500 relative flex items-center justify-end pr-1`}
            style={{ width: `${Math.max(8, lifePercent)}%` }}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-white/70 shadow-sm"></div>
          </div>
          {/* Percentage badge overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[9px] font-extrabold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] tracking-tight">
              %{lifePercent}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between text-[9px] text-slate-500">
          <span>0 gün</span>
          <span>Bitiş: {expiryDateStr}</span>
          <span>120 gün</span>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto select-none">
      {/* Toast Notification */}
      {notification && (
        <div className={`fixed top-5 right-5 z-50 flex items-center space-x-3 px-4 py-3 rounded-2xl border shadow-2xl backdrop-blur-xl animate-fade-in ${
          notification.type === 'error' 
            ? 'bg-rose-950/90 border-rose-500/40 text-rose-200' 
            : notification.type === 'info'
            ? 'bg-sky-950/90 border-sky-500/40 text-sky-200'
            : 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
        }`}>
          {notification.type === 'error' ? <AlertCircle className="w-5 h-5 text-rose-400" /> : <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
          <span className="text-xs font-semibold">{notification.message}</span>
          <button onClick={() => setNotification(null)} className="text-slate-400 hover:text-white ml-2">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1e293b] pb-6">
        <div className="space-y-1">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center font-bold text-white shadow-lg shadow-amber-500/20">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white font-outfit tracking-tight">Yenileme Yöneticisi</h1>
              <p className="text-xs text-slate-400">
                Etsy listinglerinin 4 aylık ömürlerini takip edin, gereksiz otomatik yenileme ücretlerini tek tıkla engelleyin.
              </p>
            </div>
          </div>
        </div>

        {/* Quick Refresh Button */}
        <button
          onClick={fetchListings}
          disabled={loading}
          className="flex items-center space-x-2 bg-[#151f32] hover:bg-[#1e293b] text-slate-200 border border-[#1e293b] px-4 py-2.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-amber-500 ${loading ? 'animate-spin' : ''}`} />
          <span>Yenile</span>
        </button>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Active */}
        <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Aktif Listingler</span>
            <Layers className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-extrabold text-white font-outfit">
            {summary.total_listings}
          </div>
          <p className="text-[10px] text-slate-500">Mağazadaki toplam yayındaki ürün</p>
        </div>

        {/* Auto Renew On (Risk) */}
        <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-4 space-y-2 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl pointer-events-none"></div>
          <div className="flex items-center justify-between text-amber-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Otomatik Yenileme</span>
            <Power className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-extrabold text-amber-400 font-outfit">{summary.auto_renew_count}</span>
            <span className="text-[10px] text-amber-500/80 font-bold">(~${summary.potential_cost})</span>
          </div>
          <p className="text-[10px] text-slate-500">Süre bitiminde $0.20 kesilerek yenilenir</p>
        </div>

        {/* Manual Renew (Safe) */}
        <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-emerald-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Manuel Yenileme</span>
            <PowerOff className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-400 font-outfit">
            {summary.manual_count}
          </div>
          <p className="text-[10px] text-slate-500">Süresi bitince otomatik ücret kesilmez</p>
        </div>

        {/* Expiring Soon (<30 days & auto-renew) */}
        <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-rose-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Yakında Yenilenecek</span>
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-extrabold text-rose-400 font-outfit">{summary.urgent_count}</span>
            <span className="text-[10px] text-rose-400/80 font-bold">(&lt;30 gün)</span>
          </div>
          <p className="text-[10px] text-slate-500">Otomatik yenilenmek üzere olanlar</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search Box */}
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={handleSearchChange}
              placeholder="Ürün başlığı veya Listing ID ara..."
              className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl pl-10 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
            />
            {search && (
              <button 
                onClick={() => { setSearch(''); setDebouncedSearch(''); setPage(1); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Auto-Renew Filter */}
          <div>
            <select
              value={renewFilter}
              onChange={(e) => { setRenewFilter(e.target.value); setPage(1); }}
              className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 cursor-pointer font-medium"
            >
              <option value="all">Yenileme: Tümü ({summary.total_listings})</option>
              <option value="auto">🔄 Yalnızca Otomatik ({summary.auto_renew_count})</option>
              <option value="manual">⏸️ Yalnızca Manuel ({summary.manual_count})</option>
            </select>
          </div>

          {/* Days Remaining Filter */}
          <div>
            <select
              value={daysFilter}
              onChange={(e) => { setDaysFilter(e.target.value); setPage(1); }}
              className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 cursor-pointer font-medium"
            >
              <option value="all">Kalan Süre: Tümü</option>
              <option value="urgent">🚨 Acil (&lt; 15 Gün)</option>
              <option value="warning">⚠️ Yaklaşan (&lt; 30 Gün)</option>
              <option value="safe">✅ Güvenli (&gt; 30 Gün)</option>
            </select>
          </div>

          {/* Sort By Selector */}
          <div>
            <select
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [by, ord] = e.target.value.split('-');
                setSortBy(by);
                setSortOrder(ord);
                setPage(1);
              }}
              className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 cursor-pointer font-medium"
            >
              <option value="days_remaining-asc">Süre: En Az Kalan (Acil)</option>
              <option value="days_remaining-desc">Süre: En Çok Kalan</option>
              <option value="num_favorers-desc">Favori: En Çoktan Aza</option>
              <option value="views-desc">Görüntülenme: En Çok</option>
              <option value="sales_count-desc">Satış: En Çok Satan</option>
              <option value="price-desc">Fiyat: En Yüksek</option>
              <option value="price-asc">Fiyat: En Düşük</option>
            </select>
          </div>
        </div>

        {/* Secondary Filter: Shop Sections */}
        {shopSections.length > 0 && (
          <div className="flex items-center space-x-3 pt-2 border-t border-[#1e293b]/70">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center space-x-1">
              <Layers className="w-3.5 h-3.5 text-amber-500" />
              <span>Bölüm:</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => { setSelectedSection(''); setPage(1); }}
                className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-all ${
                  selectedSection === '' 
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' 
                    : 'bg-[#151f32] text-slate-400 border-[#1e293b] hover:text-white'
                }`}
              >
                Tümü
              </button>
              {shopSections.slice(0, 8).map(sec => (
                <button
                  key={sec.shop_section_id}
                  onClick={() => { setSelectedSection(sec.shop_section_id.toString()); setPage(1); }}
                  className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-all ${
                    selectedSection === sec.shop_section_id.toString()
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' 
                      : 'bg-[#151f32] text-slate-400 border-[#1e293b] hover:text-white'
                  }`}
                >
                  {sec.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Floating / Sticky Bulk Actions Toolbar */}
      {selectedIds.length > 0 && (
        <div className="sticky top-4 z-40 bg-[#0e1726]/95 border border-amber-500/40 rounded-2xl p-4 shadow-2xl backdrop-blur-xl flex flex-wrap items-center justify-between gap-4 animate-fade-in">
          <div className="flex items-center space-x-3">
            <span className="w-7 h-7 rounded-xl bg-amber-500 text-slate-950 font-extrabold text-xs flex items-center justify-center">
              {selectedIds.length}
            </span>
            <span className="text-xs font-bold text-white">
              {selectedIds.length} adet listing seçildi
            </span>
            <button
              onClick={() => setSelectedIds([])}
              className="text-[11px] text-slate-400 hover:text-rose-400 underline underline-offset-2 ml-2"
            >
              Seçimi Temizle
            </button>
          </div>

          <div className="flex items-center space-x-2">
            {/* Bulk Turn OFF (Manuel Yap) */}
            <button
              onClick={() => handleBulkToggle(false)}
              disabled={bulkActionLoading}
              className="flex items-center space-x-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/40 text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-lg hover:shadow-rose-500/10 disabled:opacity-50"
            >
              <PowerOff className="w-3.5 h-3.5 text-rose-400" />
              <span>Seçilenlerde Auto-Renew Kapat (Manuel Yap)</span>
            </button>

            {/* Bulk Turn ON (Otomatik Yap) */}
            <button
              onClick={() => handleBulkToggle(true)}
              disabled={bulkActionLoading}
              className="flex items-center space-x-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-lg hover:shadow-emerald-500/10 disabled:opacity-50"
            >
              <Power className="w-3.5 h-3.5 text-emerald-400" />
              <span>Seçilenlerde Auto-Renew Aç</span>
            </button>
          </div>
        </div>
      )}

      {/* Bulk Action Loading Modal / Progress */}
      {bulkActionLoading && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-8 max-w-md w-full text-center space-y-4 shadow-2xl">
            <Loader2 className="w-10 h-10 text-amber-500 animate-spin mx-auto" />
            <h3 className="text-lg font-bold text-white">Etsy Güncelleniyor...</h3>
            <p className="text-xs text-slate-400">
              Seçili listinglerin yenileme ayarları Etsy API üzerinden güvenli şekilde güncelleniyor. Lütfen bekleyin.
            </p>
          </div>
        </div>
      )}

      {/* Listings Table Layout */}
      <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl overflow-hidden shadow-xl">
        {/* Table Header Bar */}
        <div className="p-4 border-b border-[#1e293b] flex items-center justify-between bg-[#151f32]/40">
          <div className="flex items-center space-x-3">
            <button
              onClick={handleSelectAllOnPage}
              className="flex items-center space-x-2 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
            >
              {isAllPageSelected ? (
                <CheckSquare className="w-4 h-4 text-amber-500" />
              ) : (
                <Square className="w-4 h-4 text-slate-500" />
              )}
              <span>Bu Sayfadaki 20 Ürünü Seç</span>
            </button>
          </div>

          <span className="text-xs text-slate-400 font-semibold">
            Toplam {totalCount} listing (Sayfa {page} / {totalPages})
          </span>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 space-y-3">
            <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
            <span className="text-xs text-slate-400 font-medium">Listingler ve ömür verileri hesaplanıyor...</span>
          </div>
        ) : listings.length === 0 ? (
          /* Empty State */
          <div className="py-24 text-center space-y-3">
            <CalendarClock className="w-12 h-12 text-slate-600 mx-auto" />
            <h4 className="text-sm font-bold text-white">Eşleşen Listing Bulunamadı</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Seçilen arama veya filtre kriterlerine uygun herhangi bir aktif Etsy ürünü bulunamadı.
            </p>
          </div>
        ) : (
          /* Table Rows */
          <div className="divide-y divide-[#1e293b]/70">
            {listings.map(listing => {
              const isSelected = selectedIds.includes(listing.listing_id_str);
              const isToggling = togglingIds.has(listing.listing_id_str);
              const isAuto = listing.should_auto_renew;

              return (
                <div 
                  key={listing.listing_id_str}
                  onClick={(e) => handleToggleSelectRow(listing.listing_id_str, e)}
                  className={`p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-all cursor-pointer hover:bg-[#151f32]/50 ${
                    isSelected ? 'bg-amber-500/5 border-l-4 border-l-amber-500' : ''
                  }`}
                >
                  {/* Left: Checkbox + Thumbnail + Details */}
                  <div className="flex items-start space-x-3.5 flex-1 min-w-0">
                    {/* Checkbox */}
                    <div 
                      className="pt-1"
                      onClick={(e) => handleToggleSelectRow(listing.listing_id_str, e)}
                    >
                      <button className="w-5 h-5 rounded-lg border border-[#1e293b] bg-slate-900 flex items-center justify-center transition-colors">
                        {isSelected && <Check className="w-3.5 h-3.5 text-amber-500 font-bold" />}
                      </button>
                    </div>

                    {/* Thumbnail */}
                    <div className="w-16 h-16 rounded-xl bg-slate-950 overflow-hidden shrink-0 border border-[#1e293b] relative">
                      {listing.image_url ? (
                        <img 
                          src={listing.image_url} 
                          alt={listing.title} 
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-600">
                          <ShoppingBag className="w-6 h-6" />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center space-x-2">
                        <h4 className="font-bold text-xs text-white truncate hover:text-amber-400 transition-colors">
                          {listing.title}
                        </h4>
                        <a 
                          href={listing.url} 
                          target="_blank" 
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-slate-500 hover:text-amber-400 shrink-0"
                          title="Etsy'de Görüntüle"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                        <span className="font-mono text-slate-500">ID: {listing.listing_id_str}</span>
                        <span>•</span>
                        <span className="font-bold text-white">${listing.price.toFixed(2)}</span>
                        <span>•</span>
                        <span className="text-slate-400">Stok: {listing.quantity}</span>
                      </div>

                      {/* Performance Stats: Fav, View, Sales */}
                      <div className="flex items-center space-x-3 text-[10px] text-slate-400 pt-0.5">
                        <span className="flex items-center space-x-1 text-rose-400/90 font-medium" title="Favori Sayısı">
                          <Heart className="w-3 h-3 fill-rose-500/20" />
                          <span>{listing.num_favorers} favori</span>
                        </span>
                        <span>•</span>
                        <span className="flex items-center space-x-1 text-sky-400/90 font-medium" title="Görüntülenme Sayısı">
                          <Eye className="w-3 h-3" />
                          <span>{listing.views} görüntülenme</span>
                        </span>
                        <span>•</span>
                        <span className="flex items-center space-x-1 text-emerald-400/90 font-medium" title="Satış Sayısı">
                          <ShoppingBag className="w-3 h-3" />
                          <span>{listing.sales_count} satış</span>
                        </span>
                        {listing.total_revenue > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-amber-400 font-bold" title="Toplam Ciro">
                              ${listing.total_revenue.toFixed(2)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Middle: 4 Months Lifespan Bar */}
                  <div className="lg:w-72 shrink-0 py-2 lg:py-0">
                    {renderLifeBar(listing.days_remaining, listing.life_percent, listing.ending_timestamp)}
                  </div>

                  {/* Right: Robust Auto-Renew Switch */}
                  <div className="flex items-center justify-between lg:justify-end space-x-3 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-[#1e293b]">
                    <div className="text-right">
                      <span className={`text-xs font-bold block ${isAuto ? 'text-amber-400' : 'text-slate-400'}`}>
                        {isAuto ? 'Otomatik Yenileme' : 'Manuel Yenileme'}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        {isAuto ? '4 ayda bir $0.20' : 'Yenilenmez (Güvende)'}
                      </span>
                    </div>

                    {/* Toggle Switch Component */}
                    <button
                      type="button"
                      disabled={isToggling}
                      onClick={(e) => handleToggleAutoRenew(listing, e)}
                      className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                        isAuto ? 'bg-amber-500' : 'bg-slate-700'
                      }`}
                      title={isAuto ? 'Otomatik Yenilemeyi Kapat (Manuel Yap)' : 'Otomatik Yenilemeyi Aç'}
                    >
                      <span className="sr-only">Auto Renew Switch</span>
                      <span
                        className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out flex items-center justify-center ${
                          isAuto ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      >
                        {isToggling ? (
                          <Loader2 className="w-3.5 h-3.5 text-slate-900 animate-spin" />
                        ) : isAuto ? (
                          <Check className="w-3.5 h-3.5 text-amber-600 font-bold" />
                        ) : (
                          <X className="w-3.5 h-3.5 text-slate-500" />
                        )}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Bar (20 per page) */}
        {!loading && totalPages > 1 && (
          <div className="p-4 border-t border-[#1e293b] flex items-center justify-between bg-[#151f32]/40">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#151f32] hover:bg-[#1e293b] text-slate-200 border border-[#1e293b] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Önceki Sayfa</span>
            </button>

            <div className="flex items-center space-x-1.5 text-xs text-slate-400 font-semibold">
              <span>Sayfa</span>
              <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 font-bold">
                {page}
              </span>
              <span>/ {totalPages}</span>
              <span className="text-slate-500 text-[11px] ml-2">(Her sayfada 20 ürün)</span>
            </div>

            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#151f32] hover:bg-[#1e293b] text-slate-200 border border-[#1e293b] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <span>Sonraki Sayfa</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
