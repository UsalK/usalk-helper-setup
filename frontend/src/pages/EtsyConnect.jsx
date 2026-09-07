import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Link2, Link2Off, RefreshCw, CheckCircle, AlertCircle, ShoppingBag, Clock, Zap, Trash2, ArrowRight } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

function formatTimeLeft(expiresAt) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Süresi doldu';
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `${hours} saat ${mins} dk`;
  return `${mins} dakika`;
}

export default function EtsyConnect({ etsyConnected, setEtsyConnected, activeShop, shops, onShopChange }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [polling, setPolling] = useState(false);
  const [timeLeft, setTimeLeft] = useState(null);
  const [autoRefreshing, setAutoRefreshing] = useState(false);

  const checkStatus = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/etsy/status`);
      setStatus(res.data);
      setEtsyConnected(res.data.connected);
      if (res.data.expires_at) {
        setTimeLeft(formatTimeLeft(res.data.expires_at));
      }
    } catch (err) {
      console.error('Etsy bağlantı durumu alınamadı:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [setEtsyConnected]);

  // Initial status check
  useEffect(() => {
    checkStatus();
  }, []);

  // Update countdown every 60 seconds
  useEffect(() => {
    if (!status?.expires_at) return;
    const id = setInterval(() => {
      setTimeLeft(formatTimeLeft(status.expires_at));
    }, 60000);
    return () => clearInterval(id);
  }, [status?.expires_at]);

  // Auto-refresh: poll status every 25 minutes when connected
  useEffect(() => {
    if (!etsyConnected) return;
    const id = setInterval(async () => {
      setAutoRefreshing(true);
      await checkStatus(true);
      setAutoRefreshing(false);
    }, 25 * 60 * 1000);
    return () => clearInterval(id);
  }, [etsyConnected, checkStatus]);

  // Poll status endpoint during authentication
  useEffect(() => {
    let intervalId;
    if (polling) {
      intervalId = setInterval(async () => {
        try {
          const res = await axios.get(`${API_BASE}/etsy/status`);
          if (res.data.connected && (!activeShop || res.data.activeShop?.shop_id !== activeShop.shop_id)) {
            setPolling(false);
            clearInterval(intervalId);
            onShopChange(); // Reload globally
          }
        } catch (err) {
          console.error('Polling error:', err);
        }
      }, 2000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [polling, activeShop, onShopChange]);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/etsy/auth-url`);
      const authUrl = res.data.url;
      
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      
      window.open(
        authUrl, 
        'Etsy OAuth', 
        `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes`
      );
      
      setPolling(true);
    } catch (err) {
      console.error('Auth url cannot be retrieved:', err);
      alert('Hata: Etsy API bilgileri yapılandırılmamış olabilir.');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async (shopId) => {
    const label = shopId === activeShop?.shop_id ? 'Aktif olan bu' : 'Bu';
    if (!confirm(`${label} mağaza bağlantısını kesmek istediğinize emin misiniz?`)) return;
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/etsy/disconnect`, { shopId });
      onShopChange(); // Reload globally
    } catch (err) {
      console.error('Etsy bağlantısı kesilemedi:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchShop = async (shopId) => {
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/etsy/switch`, { shopId });
      onShopChange(); // Reload globally
    } catch (err) {
      console.error('Mağaza değiştirilemedi:', err);
    } finally {
      setLoading(false);
    }
  };

  const tokenExpiringSoon = status?.expires_at && 
    (new Date(status.expires_at).getTime() - Date.now()) < 10 * 60 * 1000;

  return (
    <div className="max-w-5xl mx-auto py-12 px-4 animate-fade-in space-y-8">
      <div className="text-center">
        <div className="w-16 h-16 rounded-3xl bg-[#1e293b] flex items-center justify-center mx-auto mb-4 border border-[#334155] shadow-inner">
          <ShoppingBag className="w-8 h-8 text-amber-500" />
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Etsy Mağaza Entegrasyonu</h2>
        <p className="text-slate-400 text-sm mt-1">Birden fazla Etsy mağazasını güvenle bağlayın ve aralarında hızlıca geçiş yapın.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left Column: Connected Shops List */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-white mb-2">Bağlı Mağazalarınız</h3>
            
            <div className="space-y-3">
              {shops && shops.length > 0 ? (
                shops.map(s => {
                  const isActive = activeShop && s.shop_id === activeShop.shop_id;
                  return (
                    <div 
                      key={s.shop_id} 
                      className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${
                        isActive 
                          ? 'bg-amber-500/5 border-amber-500/20 shadow-md shadow-amber-500/5' 
                          : 'bg-[#151f32] border-[#1e293b] hover:border-slate-800'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <div className={`p-2.5 rounded-xl ${
                          isActive 
                            ? 'bg-amber-500/15 text-amber-500' 
                            : 'bg-[#0e1726] text-slate-400'
                        }`}>
                          <ShoppingBag className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-bold text-xs text-white flex items-center space-x-2">
                            <span>{s.shop_name}</span>
                            {isActive && (
                              <span className="bg-amber-500/15 border border-amber-500/30 text-amber-500 font-bold px-2 py-0.5 rounded-full text-[8px] uppercase tracking-wider">
                                Aktif
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono">ID: {s.shop_id}</span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        {!isActive ? (
                          <button
                            onClick={() => handleSwitchShop(s.shop_id)}
                            disabled={loading}
                            className="bg-[#0e1726] hover:bg-[#1a263c] border border-[#1e293b] text-slate-300 font-bold px-3 py-1.5 rounded-xl text-[10px] flex items-center space-x-1 transition-colors"
                          >
                            <span>Mağazaya Geç</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        ) : null}
                        
                        <button
                          onClick={() => handleDisconnect(s.shop_id)}
                          disabled={loading}
                          className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 rounded-xl transition-colors border border-rose-500/20"
                          title="Bağlantıyı Sil"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-8 bg-[#151f32] border border-dashed border-[#1e293b] rounded-2xl text-slate-500 text-xs italic">
                  Henüz bağlı bir Etsy mağazası bulunmuyor.
                </div>
              )}
            </div>
            
            {polling && (
              <div className="flex items-center justify-center space-x-2 text-xs text-amber-500 bg-amber-500/5 border border-amber-500/10 rounded-xl p-4 animate-pulse">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Etsy yetkilendirme penceresi açık, bağlantı kurulması bekleniyor...</span>
              </div>
            )}

            <button
              onClick={handleConnect}
              disabled={loading || polling}
              className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold py-3.5 rounded-xl shadow-lg shadow-amber-500/10 transition-colors flex items-center justify-center space-x-2 text-xs mt-4"
            >
              <Link2 className="w-4 h-4" />
              <span>Yeni Etsy Mağazası Bağla</span>
            </button>
          </div>
        </div>

        {/* Right Column: Connection Status Details of Active Shop */}
        <div className="space-y-6">
          <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 shadow-xl space-y-5">
            <h3 className="text-base font-bold text-white">Aktif Bağlantı Durumu</h3>
            
            <div className="flex items-center justify-between pb-4 border-b border-[#1e293b]">
              <div className="flex items-center space-x-2.5">
                <div className={`w-2.5 h-2.5 rounded-full ${etsyConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                <span className={`text-xs font-bold ${etsyConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {etsyConnected ? 'Bağlantı Aktif' : 'Bağlı Mağaza Yok'}
                </span>
              </div>
              <button
                onClick={() => checkStatus(false)}
                disabled={loading}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-xl transition-colors disabled:opacity-50"
                title="Yenile"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {etsyConnected && status && activeShop ? (
              <div className="space-y-4">
                <div className="bg-[#151f32] rounded-xl p-4 border border-[#1e293b] space-y-2.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Aktif Mağaza:</span>
                    <strong className="text-white font-semibold">{activeShop.shop_name}</strong>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Shop ID:</span>
                    <strong className="text-slate-300 font-mono bg-slate-800 px-2.5 py-0.5 rounded text-[10px]">{activeShop.shop_id}</strong>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Token Süresi:</span>
                    <div className="flex items-center space-x-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      <span className="font-semibold text-slate-300">
                        {timeLeft || new Date(status.expires_at).toLocaleTimeString('tr-TR')}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-start space-x-2 text-[10px] bg-blue-500/5 border border-blue-500/10 rounded-xl p-3 text-slate-400 leading-normal">
                  <Zap className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-blue-300 font-bold block">Otomatik Yenileme Aktif</span>
                    <span>Sistem, token süresi bitmeden önce arka planda yenileme yapacaktır.</span>
                  </div>
                </div>

                {tokenExpiringSoon && (
                  <div className="flex items-start space-x-2 text-[10px] bg-amber-500/5 border border-amber-500/10 rounded-xl p-3 text-amber-300">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <span>Token süresi bitmek üzere. Sunucu otomatik yenilemezse sayfayı yenileyin.</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-slate-400 leading-relaxed bg-[#151f32] p-4 rounded-xl border border-[#1e293b]">
                <strong className="text-slate-300 block mb-1">OAuth Entegrasyonu</strong>
                Öncelikle Genel Ayarlar kısmında Etsy API credentials bilgilerini ekleyin ve ardından sol paneldeki "Yeni Etsy Mağazası Bağla" butonuyla entegrasyonu başlatın.
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Informational Footer */}
      <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center space-x-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <span>Çoklu Mağaza Çalışma Prensibi</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-400">
          <div className="space-y-2">
            <p>• <strong className="text-slate-200">Bağımsız Ayarlar:</strong> Her mağazanın kargo şablonları, fiyatlandırma katsayıları, ürün taslakları ve mockup şablonları birbirine karışmayacak şekilde tamamen o mağazaya özel olarak saklanır.</p>
            <p>• <strong className="text-slate-200">Geçiş Kolaylığı:</strong> Sol menü üzerindeki veya bu sayfadaki menüden mağazalar arası geçiş yaptığınızda, tüm uygulama verileri otomatik olarak o mağazanın profiliyle yüklenir.</p>
          </div>
          <div className="space-y-2">
            <p>• <strong className="text-slate-200">Ayarları Kopyalama:</strong> Yeni bir mağaza eklediğinizde, en son aktif olan mağazanın ürün adlandırma, materyal listesi, açıklama şablonları gibi genel ayarları yeni mağazaya şablon olarak otomatik kopyalanır (Kargo profili gibi Etsy ID'leri hariç).</p>
            <p>• <strong className="text-slate-200">Otomatik Seeding:</strong> Bağlanan her yeni mağaza için 5 temel oran profili (2:3, 3:2, 1:1 vb.) otomatik olarak sıfırdan oluşturulur.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
