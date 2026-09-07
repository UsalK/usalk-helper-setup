import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  Coins, Search, CheckSquare, Square, Play, Eye, 
  AlertCircle, Check, Loader2, ArrowRight, RefreshCw, XCircle, Ban
} from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

export default function PriceUpdate({ etsyConnected, activeShop }) {
  const [listings, setListings] = useState([]);
  const [variationProfiles, setVariationProfiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRatio, setSelectedRatio] = useState('all');
  const [selectedListingIds, setSelectedListingIds] = useState([]);
  
  // Pricing configuration
  const [percentage, setPercentage] = useState(20);
  const [updateMode, setUpdateMode] = useState('percentage'); // 'percentage' or 'csv'
  const [priceMode, setPriceMode] = useState('increase'); // 'increase' or 'decrease'

  
  // Execution status
  const [executing, setExecuting] = useState(false);
  const [currentProgress, setCurrentProgress] = useState(0);
  const [totalToProcess, setTotalToProcess] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [logs, setLogs] = useState([]);
  
  const cancelExecutionRef = useRef(false);

  useEffect(() => {
    if (etsyConnected) {
      fetchListings();
      fetchVariationProfiles();
    }
  }, [etsyConnected, activeShop]);

  const fetchListings = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/etsy/listings-with-variations`);
      setListings(res.data || []);
    } catch (err) {
      console.error("Listingler çekilemedi:", err);
      alert("Etsy ürünleri çekilirken bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  };

  const fetchVariationProfiles = async () => {
    try {
      const res = await axios.get(`${API_BASE}/variations`);
      setVariationProfiles(res.data || []);
    } catch (err) {
      console.error("Varyasyon profilleri çekilemedi:", err);
    }
  };

  // Helper to map ratio IDs to human-readable names or ratios
  const getRatioString = (profileId) => {
    if (!profileId) return 'Bilinmiyor';
    const profile = variationProfiles.find(p => p.id === profileId);
    return profile ? profile.ratio || profile.name : 'Belirsiz';
  };

  // Filtering listings based on search and ratio filter
  const filteredListings = listings.filter(l => {
    const matchesSearch = l.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          l.listing_id.toString().includes(searchTerm);
    
    if (selectedRatio === 'all') return matchesSearch;
    if (selectedRatio === 'none') return matchesSearch && !l.variation_profile_id;
    return matchesSearch && l.variation_profile_id === selectedRatio;
  });

  // Select / Deselect handlers
  const handleSelectAll = () => {
    const allFilteredIds = filteredListings.map(l => l.listing_id.toString());
    setSelectedListingIds(allFilteredIds);
  };

  const handleDeselectAll = () => {
    setSelectedListingIds([]);
  };

  const handleToggleSelect = (id) => {
    const idStr = id.toString();
    setSelectedListingIds(prev => 
      prev.includes(idStr) 
        ? prev.filter(x => x !== idStr) 
        : [...prev, idStr]
    );
  };

  // Run bulk update in batches on the backend
  const startUpdate = async (isExecute = false) => {
    if (selectedListingIds.length === 0) {
      alert("Lütfen en az bir ürün seçin.");
      return;
    }

    const actionText = priceMode === 'increase' ? 'ZAM' : 'İNDİRİM';
    if (isExecute && !window.confirm(`${selectedListingIds.length} ürünün fiyatlarına Etsy üzerinde GERÇEKTEN %${percentage} ${actionText} uygulamak istediğinizden emin misiniz?`)) {
      return;
    }

    setExecuting(true);
    cancelExecutionRef.current = false;
    setTotalToProcess(selectedListingIds.length);
    setCurrentProgress(0);
    setSuccessCount(0);
    setFailCount(0);
    setLogs([]);

    const batchSize = 10; // Process in small batches to show UI progress and prevent gateway timeouts
    const idsToProcess = [...selectedListingIds];
    
    const signedPercentage = priceMode === 'decrease' ? -Math.abs(Number(percentage)) : Math.abs(Number(percentage));
    addLog(`Başlatılıyor... Mod: ${isExecute ? 'Etsy CANLI UYGULAMA' : 'Dry Run (SİMÜLASYON)'}. İşlem: ${actionText} (%${percentage})`);

    for (let i = 0; i < idsToProcess.length; i += batchSize) {
      if (cancelExecutionRef.current) {
        addLog("❌ İşlem kullanıcı tarafından durduruldu.");
        break;
      }

      const batch = idsToProcess.slice(i, i + batchSize);
      addLog(`Paket işleniyor (${i + 1} - ${Math.min(i + batchSize, idsToProcess.length)})...`);

      try {
        const res = await axios.post(`${API_BASE}/etsy/listings/bulk-price-update`, {
          listingIds: batch,
          percentage: signedPercentage,
          execute: isExecute
        });


        if (res.data && res.data.results) {
          res.data.results.forEach(result => {
            const listing = listings.find(l => l.listing_id.toString() === result.listingId);
            const title = listing ? listing.title.substring(0, 45) + '...' : result.listingId;
            
            if (result.status === 'updated' || result.status === 'dry-run-success') {
              setSuccessCount(prev => prev + 1);
              const isVar = result.hasVariations ? 'Varyasyon' : 'Basit';
              const minOrig = result.originalPrices ? Math.min(...result.originalPrices) : 0;
              const maxOrig = result.originalPrices ? Math.max(...result.originalPrices) : 0;
              const minNew = result.newPrices ? Math.min(...result.newPrices) : 0;
              const maxNew = result.newPrices ? Math.max(...result.newPrices) : 0;

              addLog(`✅ [${isVar}] ${title}: $${minOrig}-${maxOrig} ==> $${minNew}-${maxNew}`);
            } else if (result.status === 'skipped') {
              setFailCount(prev => prev + 1);
              addLog(`⚠️ Atlandı ${title}: Varyasyon bulunamadı.`);
            } else {
              setFailCount(prev => prev + 1);
              addLog(`❌ Hata ${title}: ${result.error || 'Bilinmeyen Hata'}`);
            }
          });
        }
      } catch (err) {
        batch.forEach(id => {
          setFailCount(prev => prev + 1);
          const listing = listings.find(l => l.listing_id.toString() === id);
          const title = listing ? listing.title.substring(0, 45) : id;
          addLog(`❌ Hata ${title}: Bağlantı hatası oluştu.`);
        });
      }

      setCurrentProgress(prev => Math.min(prev + batch.length, idsToProcess.length));
      
      // Wait a tiny bit between batches to be nice to the browser state
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    setExecuting(false);
    addLog(`✨ İşlem tamamlandı! Başarılı: ${successCount + (cancelExecutionRef.current ? 0 : 0)}, Hatalı: ${failCount}`);
    
    // Refresh listings after live execution
    if (isExecute) {
      fetchListings();
    }
  };

  const addLog = (message) => {
    setLogs(prev => [
      `[${new Date().toLocaleTimeString()}] ${message}`,
      ...prev
    ]);
  };

  const cancelExecution = () => {
    cancelExecutionRef.current = true;
  };

  if (!etsyConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] p-8 text-center">
        <AlertCircle className="w-16 h-16 text-amber-500/80 mb-6 animate-pulse" />
        <h2 className="text-2xl font-bold text-white mb-2 font-outfit">Etsy Bağlantısı Gerekli</h2>
        <p className="text-slate-400 max-w-md text-sm leading-relaxed mb-6">
          Listing fiyatlarını güncellemek için öncelikle Etsy hesabınızı bağlamanız gerekmektedir.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 select-none relative z-10">
      
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between bg-gradient-to-r from-[#1e293b]/80 to-[#0f172a]/80 p-8 rounded-3xl border border-slate-800 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-amber-500/5 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="space-y-2 relative z-10">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-400 shadow-md">
              <Coins className="w-5 h-5 animate-bounce" />
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight font-outfit uppercase">
              LİSTİNG FİYAT GÜNCELLE
            </h1>
          </div>
          <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
            DDP (Gümrük Vergisi Ödenmiş) kargo gönderim maliyetlerini karşılamak için aktif listing fiyatlarınızı toplu olarak simüle edebilir veya Etsy üzerinde güncelleyebilirsiniz.
          </p>
        </div>
        <button 
          onClick={fetchListings}
          disabled={loading || executing}
          className="mt-6 md:mt-0 flex items-center space-x-2 text-xs font-semibold py-3 px-5 rounded-2xl bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900/40 text-slate-200 border border-slate-700/60 transition-colors shadow-lg cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Yükleniyor...' : 'Listeyi Yenile'}</span>
        </button>
      </div>

      {/* Grid Settings Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Step 1: Filter and Select Products */}
        <div className="lg:col-span-2 bg-[#0e1726] border border-slate-800/80 rounded-3xl p-6 shadow-xl flex flex-col space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <h3 className="text-lg font-bold text-white font-outfit flex items-center space-x-2">
              <span className="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400 text-xs font-bold font-outfit">1</span>
              <span>Ürün Seçimi</span>
            </h3>
            <span className="text-xs text-slate-500 font-semibold bg-[#151f32] py-1 px-3 rounded-full border border-slate-800">
              Seçilen: {selectedListingIds.length} / {filteredListings.length} Ürün
            </span>
          </div>

          {/* Filtering row */}
          <div className="flex flex-col md:flex-row gap-4">
            
            {/* Search Input */}
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Ürün adı veya Listing ID ile ara..."
                className="w-full bg-[#151f32] border border-[#1e293b] rounded-2xl pl-10 pr-4 py-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
              />
            </div>

            {/* Ratio Filter */}
            <div className="w-full md:w-64">
              <select
                value={selectedRatio}
                onChange={(e) => setSelectedRatio(e.target.value)}
                className="w-full bg-[#151f32] border border-[#1e293b] rounded-2xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500 cursor-pointer appearance-none pr-10 transition-colors"
              >
                <option value="all">Tüm Varyasyon Tipleri (Oranlar)</option>
                <option value="none">Oransız / Basit Ürünler</option>
                {variationProfiles.map(profile => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.ratio || 'Oransız'})
                  </option>
                ))}
              </select>
            </div>

          </div>

          {/* Select all & Deselect buttons */}
          <div className="flex items-center space-x-3 text-xs">
            <button
              onClick={handleSelectAll}
              disabled={filteredListings.length === 0}
              className="flex items-center space-x-1.5 py-2 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-850 hover:text-white border border-slate-700/60 text-slate-300 font-semibold transition-all cursor-pointer disabled:opacity-40"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>Filtrelenenleri Tümünü Seç</span>
            </button>
            <button
              onClick={handleDeselectAll}
              disabled={selectedListingIds.length === 0}
              className="flex items-center space-x-1.5 py-2 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-850 hover:text-white border border-slate-700/60 text-slate-300 font-semibold transition-all cursor-pointer disabled:opacity-40"
            >
              <Square className="w-3.5 h-3.5" />
              <span>Seçimi Temizle</span>
            </button>
          </div>

          {/* Listings List (Scrollable grid/list) */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <Loader2 className="w-10 h-10 text-amber-500 animate-spin mb-4" />
              <span className="text-sm font-medium">Etsy mağazanızdaki aktif ürünler çekiliyor...</span>
            </div>
          ) : filteredListings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-slate-800 rounded-2xl text-slate-500">
              <AlertCircle className="w-8 h-8 text-slate-600 mb-2" />
              <span className="text-sm font-medium">Filtrelere uygun ürün bulunamadı.</span>
            </div>
          ) : (
            <div className="max-h-[500px] overflow-y-auto pr-2 space-y-2 border border-slate-800/60 rounded-2xl p-2 bg-[#090d16]">
              {filteredListings.map(listing => {
                const isSelected = selectedListingIds.includes(listing.listing_id.toString());
                const firstImg = listing.images?.[0]?.url_75x75 || 'https://via.placeholder.com/75';
                const ratioStr = getRatioString(listing.variation_profile_id);

                return (
                  <div
                    key={listing.listing_id}
                    onClick={() => handleToggleSelect(listing.listing_id)}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all duration-200 cursor-pointer ${
                      isSelected 
                        ? 'bg-amber-500/5 border-amber-500/30 shadow-md shadow-amber-500/5' 
                        : 'bg-[#101726]/40 hover:bg-[#101726]/80 border-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center space-x-4">
                      {/* Checkbox Icon */}
                      <div>
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-amber-500" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                        )}
                      </div>
                      {/* Thumbnail */}
                      <img 
                        src={firstImg} 
                        alt="" 
                        className="w-10 h-10 rounded-lg object-cover border border-slate-800"
                        onError={(e) => { e.target.src = 'https://via.placeholder.com/75'; }}
                      />
                      {/* Title & Info */}
                      <div>
                        <h4 className="text-xs font-semibold text-slate-200 line-clamp-1 max-w-lg">
                          {listing.title}
                        </h4>
                        <div className="flex items-center space-x-2.5 mt-1">
                          <span className="text-[10px] text-slate-500 font-bold uppercase">ID: {listing.listing_id}</span>
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-800"></span>
                          <span className="text-[10px] text-amber-500/90 font-bold uppercase bg-amber-500/5 border border-amber-500/10 px-2 py-0.5 rounded">
                            {ratioStr}
                          </span>
                        </div>
                      </div>
                    </div>
                    {/* Base Price */}
                    <div className="text-right pl-4">
                      <span className="text-xs font-bold text-slate-300 bg-[#151f32] border border-slate-800 px-3 py-1.5 rounded-lg shadow-sm">
                        ${listing.price ? (listing.price.amount / (listing.price.divisor || 100)).toFixed(2) : '0.00'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>

        {/* Step 2: Settings & Execution */}
        <div className="flex flex-col space-y-8">
          
          {/* Settings Card */}
          <div className="bg-[#0e1726] border border-slate-800/80 rounded-3xl p-6 shadow-xl space-y-6">
            <h3 className="text-lg font-bold text-white font-outfit flex items-center space-x-2 border-b border-slate-800 pb-4">
              <span className="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400 text-xs font-bold font-outfit">2</span>
              <span>Fiyat Hesaplama & Zam Ayarı</span>
            </h3>

            {/* Selector Options */}
            <div className="space-y-3">
              {/* Option 1: Percentage Increase */}
              <div 
                onClick={() => setUpdateMode('percentage')}
                className={`p-4 rounded-2xl border transition-all duration-200 cursor-pointer relative overflow-hidden ${
                  updateMode === 'percentage'
                    ? 'bg-amber-500/5 border-amber-500/30'
                    : 'bg-[#101726]/40 hover:bg-[#101726]/70 border-slate-850'
                }`}
              >
                <div className="flex items-start space-x-3">
                  <input
                    type="radio"
                    checked={updateMode === 'percentage'}
                    onChange={() => {}}
                    className="mt-1 accent-amber-500 cursor-pointer"
                  />
                  <div>
                    <h4 className="text-sm font-bold text-white">Yüzdelik Zam Uygula</h4>
                    <p className="text-slate-400 text-xs mt-1">
                      Mevcut varyasyon fiyatlarının üzerine yüzdesel olarak zam ekler.
                    </p>
                  </div>
                </div>
              </div>

              {/* Option 2: CSV Upload (Disabled) */}
              <div 
                className="p-4 rounded-2xl border bg-slate-900/40 border-slate-850 opacity-50 cursor-not-allowed relative"
              >
                <div className="absolute top-3 right-3 text-[9px] bg-slate-800 text-slate-400 font-bold px-2 py-0.5 rounded border border-slate-700">
                  AKTİF DEĞİL
                </div>
                <div className="flex items-start space-x-3">
                  <input
                    type="radio"
                    checked={false}
                    disabled={true}
                    className="mt-1"
                  />
                  <div>
                    <h4 className="text-sm font-bold text-slate-400">CSV Dosyası ile Güncelle</h4>
                    <p className="text-slate-500 text-xs mt-1">
                      Dosyadaki yeni varyasyon fiyatlarını doğrudan Etsy'e yazar.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Segmented Control for Increase/Decrease */}
            {updateMode === 'percentage' && (
              <div className="flex bg-[#151f32] p-1 rounded-2xl border border-slate-800 animate-fade-in">
                <button
                  type="button"
                  onClick={() => setPriceMode('increase')}
                  className={`flex-1 py-2.5 px-3 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                    priceMode === 'increase'
                      ? 'bg-rose-500/20 text-rose-500 border border-rose-500/30'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  ZAM MODU
                </button>
                <button
                  type="button"
                  onClick={() => setPriceMode('decrease')}
                  className={`flex-1 py-2.5 px-3 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                    priceMode === 'decrease'
                      ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  İNDİRİM MODU
                </button>
              </div>
            )}

            {/* Percentage Input */}
            {updateMode === 'percentage' && (
              <div className={`space-y-2.5 p-4 border rounded-2xl animate-fade-in transition-colors ${
                priceMode === 'increase' ? 'bg-rose-500/5 border-rose-500/15' : 'bg-emerald-500/5 border-emerald-500/15'
              }`}>
                <label className={`block text-xs font-bold uppercase tracking-wider ${
                  priceMode === 'increase' ? 'text-rose-400' : 'text-emerald-400'
                }`}>
                  {priceMode === 'increase' ? 'Zam Yüzdesi (%)' : 'İndirim Yüzdesi (%)'}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={percentage}
                    onChange={(e) => setPercentage(Math.max(1, parseFloat(e.target.value) || 0))}
                    disabled={executing}
                    min="1"
                    className={`w-full bg-[#151f32] border rounded-xl px-4 py-3 text-sm font-bold text-white focus:outline-none transition-colors ${
                      priceMode === 'increase' ? 'border-[#1e293b] focus:border-rose-500' : 'border-[#1e293b] focus:border-emerald-500'
                    }`}
                  />
                  <span className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-500 font-bold text-sm">%</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {priceMode === 'increase' 
                    ? `Örn: %${percentage} zam yapıldığında $100'lık varyasyon $${(100 * (1 + percentage/100)).toFixed(2)}, $2420.00'lık varyasyon $${(2420 * (1 + percentage/100)).toFixed(2)} olur.`
                    : `Örn: %${percentage} indirim yapıldığında $100'lık varyasyon $${(100 * (1 - percentage/100)).toFixed(2)}, $2420.00'lık varyasyon $${(2420 * (1 - percentage/100)).toFixed(2)} olur.`
                  }
                </p>
              </div>
            )}

            {/* Actions Button */}
            <div className="space-y-3 pt-2">
              {/* Simulation Mode button */}
              <button
                onClick={() => startUpdate(false)}
                disabled={executing || loading || selectedListingIds.length === 0}
                className="w-full flex items-center justify-center space-x-2 text-sm font-bold py-3.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-750 disabled:bg-slate-900/40 text-slate-300 hover:text-white border border-slate-700/60 transition-all cursor-pointer shadow-lg disabled:opacity-40"
              >
                {executing ? (
                  <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                ) : (
                  <Eye className="w-4 h-4 text-slate-400" />
                )}
                <span>Simülasyonu Çalıştır (Dry Run)</span>
              </button>

              {/* Execution (Live) Mode button */}
              <button
                onClick={() => startUpdate(true)}
                disabled={executing || loading || selectedListingIds.length === 0}
                className={`w-full flex items-center justify-center space-x-2 text-sm font-bold py-3.5 px-4 rounded-2xl text-white shadow-xl transition-all cursor-pointer disabled:opacity-45 ${
                  priceMode === 'increase'
                    ? 'bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 shadow-rose-500/10 hover:shadow-rose-500/20'
                    : 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 shadow-emerald-500/10 hover:shadow-emerald-500/20'
                }`}
              >
                {executing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 fill-current" />
                )}
                <span>Fiyatları Etsy'de Güncelle (Live)</span>
              </button>
            </div>

          </div>

          {/* Running Status / Progress card */}
          {(executing || logs.length > 0) && (
            <div className="bg-[#0e1726] border border-slate-800/80 rounded-3xl p-6 shadow-xl space-y-4 animate-fade-in">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white font-outfit uppercase">İşlem Durumu</h3>
                {executing && (
                  <button
                    onClick={cancelExecution}
                    className="flex items-center space-x-1 text-[10px] text-rose-500 hover:text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 rounded-full font-bold uppercase transition-colors cursor-pointer"
                  >
                    <Ban className="w-3 h-3" />
                    <span>Durdur</span>
                  </button>
                )}
              </div>

              {/* Progress stats */}
              <div className="grid grid-cols-3 gap-2.5 text-center">
                <div className="bg-[#151f32]/60 p-2.5 rounded-xl border border-slate-850">
                  <div className="text-xs text-slate-500 font-bold">Toplam</div>
                  <div className="text-sm font-extrabold text-white mt-0.5">{totalToProcess}</div>
                </div>
                <div className="bg-emerald-500/5 p-2.5 rounded-xl border border-emerald-500/10">
                  <div className="text-xs text-emerald-500 font-bold">Başarılı</div>
                  <div className="text-sm font-extrabold text-emerald-400 mt-0.5">{successCount}</div>
                </div>
                <div className="bg-rose-500/5 p-2.5 rounded-xl border border-rose-500/10">
                  <div className="text-xs text-rose-500 font-bold">Hatalı</div>
                  <div className="text-sm font-extrabold text-rose-400 mt-0.5">{failCount}</div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] text-slate-500 font-bold uppercase">
                  <span>İlerleme</span>
                  <span>{Math.round((currentProgress / (totalToProcess || 1)) * 100)}%</span>
                </div>
                <div className="w-full h-2 bg-[#151f32] rounded-full overflow-hidden border border-slate-800">
                  <div 
                    className="h-full bg-gradient-to-r from-amber-500 to-rose-500 rounded-full transition-all duration-300"
                    style={{ width: `${(currentProgress / (totalToProcess || 1)) * 100}%` }}
                  ></div>
                </div>
              </div>

              {/* Real-time Logs Console */}
              <div className="space-y-1.5">
                <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider">İşlem Günlüğü</label>
                <div className="bg-[#090d16] border border-slate-850 rounded-2xl p-4 h-[160px] overflow-y-auto font-mono text-[10px] leading-relaxed text-slate-400 space-y-1 select-text">
                  {logs.map((log, index) => (
                    <div key={index} className="border-b border-slate-900/50 pb-0.5 last:border-0 truncate">
                      {log}
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

        </div>

      </div>

    </div>
  );
}
