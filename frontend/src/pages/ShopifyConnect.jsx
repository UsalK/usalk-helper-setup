import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

export default function ShopifyConnect() {
  const [shopUrl, setShopUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [themePath, setThemePath] = useState('');
  const [loading, setLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null); // 'success', 'error', null
  const [activeShop, setActiveShop] = useState(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/shopify/status`);
      if (res.data.connected) {
        setActiveShop(res.data);
        setShopUrl(res.data.shopUrl || '');
        setThemePath(res.data.themePath || '');
      }
    } catch (err) {
      console.error('Failed to fetch Shopify connection status:', err);
    }
  };

  const handleConnect = async (e) => {
    e.preventDefault();
    setLoading(true);
    setConnectionStatus(null);
    try {
      const res = await axios.post(`${API_BASE}/shopify/connect`, {
        shopUrl,
        accessToken,
        themePath
      });
      if (res.data.success) {
        setConnectionStatus('success');
        fetchStatus();
      }
    } catch (err) {
      console.error('Shopify connection failed:', err);
      setConnectionStatus('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white mb-2 font-outfit">Shopify Mağaza Bağlantısı</h1>
        <p className="text-slate-400 text-sm">
          Shopify Admin API credentials bilgilerini girerek mağazanı entegre et. Bu sayede toplu ürün yükleyebilir ve yerel temanı yönetebilirsin.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left Form */}
        <div className="md:col-span-2 bg-[#0f172a] rounded-2xl border border-slate-800 p-6 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none"></div>
          
          <form onSubmit={handleConnect} className="space-y-6">
            <div>
              <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">Shopify Mağaza URL'si</label>
              <input
                type="text"
                value={shopUrl}
                onChange={(e) => setShopUrl(e.target.value)}
                placeholder="ornek.myshopify.com"
                required
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-xl px-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all text-sm"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Yalnızca domain ismini (örnek.myshopify.com) yazınız.</span>
            </div>

            <div>
              <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">Admin API Access Token (shpat_...)</label>
              <input
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Admin API access token"
                required={!activeShop} // Required only if not connected before
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-xl px-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all text-sm"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Shopify panelinizden aldığınız `write_products`, `read_products` yetkili erişim tokenı.</span>
            </div>

            <div>
              <label className="block text-slate-300 text-xs font-semibold uppercase tracking-wider mb-2">Yerel Tema Klasör Yolu</label>
              <input
                type="text"
                value={themePath}
                onChange={(e) => setThemePath(e.target.value)}
                placeholder="C:\Users\...\Desktop\theme_export..."
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-xl px-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all text-sm"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Tema düzenleme stüdyosu için yerel bilgisayarınızdaki Pitch tema klasör yolu.</span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg hover:shadow-emerald-500/10 flex items-center justify-center space-x-2 text-sm cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Bağlantı Kuruluyor...</span>
                </>
              ) : (
                <span>Mağazayı Bağla</span>
              )}
            </button>
          </form>

          {connectionStatus === 'success' && (
            <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs font-medium animate-fade-in">
              🎉 Shopify bağlantısı başarıyla kuruldu ve kaydedildi!
            </div>
          )}

          {connectionStatus === 'error' && (
            <div className="mt-4 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs font-medium animate-fade-in">
              ❌ Bağlantı hatası. Lütfen API anahtarını, URL'yi ve izinleri kontrol edip tekrar deneyin.
            </div>
          )}
        </div>

        {/* Right Status Card */}
        <div className="bg-[#0f172a] rounded-2xl border border-slate-800 p-6 flex flex-col justify-between shadow-xl">
          <div>
            <h3 className="text-base font-bold text-white mb-4 font-outfit">Bağlantı Durumu</h3>
            {activeShop ? (
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse"></div>
                  <span className="text-emerald-400 text-sm font-semibold">Bağlı</span>
                </div>
                <div className="space-y-2 text-xs text-slate-300">
                  <p><span className="text-slate-500 font-medium">Mağaza:</span> {activeShop.shopName}</p>
                  <p><span className="text-slate-500 font-medium">URL:</span> {activeShop.shopUrl}</p>
                  <p><span className="text-slate-500 font-medium">Tema Klasörü:</span> {activeShop.themePath ? 'Ayarlandı' : 'Ayarlandı Değil'}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <div className="w-2.5 h-2.5 bg-slate-600 rounded-full"></div>
                  <span className="text-slate-400 text-sm font-semibold">Bağlantı Yok</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Şu an aktif bir Shopify bağlantısı bulunmamaktadır. Lütfen sol taraftaki formu doldurarak API bağlantısı oluşturun.
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 border-t border-slate-800/60 pt-4 text-[10px] text-slate-500">
            * Admin API tokenınız yerel şifrelenmiş veritabanında saklanır ve dışarı sızdırılmaz.
          </div>
        </div>
      </div>
    </div>
  );
}
