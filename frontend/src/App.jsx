import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import BulkUpload from './pages/BulkUpload';
import TemplateStudio from './pages/TemplateStudio';
import VariationProfiles from './pages/VariationProfiles';
import DefaultSettings from './pages/DefaultSettings';
import EtsyConnect from './pages/EtsyConnect';
import PriceUpdate from './pages/PriceUpdate';
import Analytics from './pages/Analytics';
import RenewManager from './pages/RenewManager';
import SetupWizard from './pages/SetupWizard';

// Shopify Pages
import ShopifyConnect from './pages/ShopifyConnect';
import ThemeStudio from './pages/ThemeStudio';
import ShopifyBulkUpload from './pages/ShopifyBulkUpload';
import StorageCleanup from './pages/StorageCleanup';
import BulkJobWidget from './components/BulkJobWidget';
import { SHOPIFY_ENABLED } from './config/features';

const API_BASE = 'http://localhost:3001/api';

// Adres çubuğu ile senkronize edilen sayfalar. Sidebar menüsüyle aynı olmalı.
const VALID_PAGES = {
  etsy: [
    'dashboard', 'renew-manager', 'analytics', 'price-update', 'bulk-upload',
    'templates', 'variations', 'storage', 'settings', 'etsy-connect', 'setup'
  ],
  shopify: [
    'dashboard', 'shopify-upload', 'templates', 'variations',
    'theme-studio', 'storage', 'shopify-connect', 'settings'
  ]
};

// URL hash'ini (#/etsy/dashboard) uygulama durumuna çevirir.
// Geçersiz değerlerde güvenli varsayılana düşer.
function parseHash() {
  const raw = (window.location.hash || '').replace(/^#\/?/, '');
  const [mode, page] = raw.split('/');

  if (mode !== 'etsy' && mode !== 'shopify') {
    return { mode: null, page: 'dashboard' };
  }
  return {
    mode,
    page: VALID_PAGES[mode].includes(page) ? page : 'dashboard'
  };
}

export default function App() {
  const initialRoute = parseHash();
  // Shopify kapaliyken secilecek tek bir platform kaliyor; kullaniciyi tek
  // secenekli bir secim ekraninda bekletmeden dogrudan Etsy moduna geciyoruz.
  // Adres cubugundan #/shopify/... yazilirsa o mod yine acilir.
  const [appMode, setAppMode] = useState(
    initialRoute.mode || (SHOPIFY_ENABLED ? null : 'etsy')
  );
  const [currentPage, setCurrentPage] = useState(initialRoute.page);
  const [etsyConnected, setEtsyConnected] = useState(false);
  const [activeShop, setActiveShop] = useState(null);
  const [shops, setShops] = useState([]);
  const [checkingAuth, setCheckingAuth] = useState(true);
  // null = henuz bilinmiyor. Kurulum tamamlanmamissa sihirbaz tam ekran acilir;
  // Etsy tarafinda hicbir sayfa magaza/kargo profili olmadan anlamli calismiyor.
  const [setupCompleted, setSetupCompleted] = useState(null);
  const isFirstRouteSync = useRef(true);

  useEffect(() => {
    if (appMode === 'etsy') {
      checkEtsyAuth();
      checkSetupStatus();
    } else {
      setCheckingAuth(false);
    }
  }, [appMode]);

  // Kurulum durumu backend'de saklaniyor (settings tablosu), boylece tarayici
  // verisi silinse de tamamlanmis kurulum tekrar sorulmuyor.
  const checkSetupStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/setup/status`);
      // allDone: her adim zaten yapilandirilmis demek. Calisan bir kurulumu
      // sirf 'tamamlandi' bayragi yok diye sihirbaza kilitlemiyoruz.
      setSetupCompleted(Boolean(res.data.completed || res.data.allDone));
    } catch (err) {
      // Durum okunamazsa kullaniciyi sihirbaza hapsetmeyelim.
      console.error('Kurulum durumu alinamadi:', err);
      setSetupCompleted(true);
    }
  };

  // Durum -> URL. Normal gezinmede hash ataması yapılır ki tarayıcı geri/ileri
  // tuşları çalışsın. İlk render ve geçersiz adres düzeltmelerinde ise replaceState
  // kullanılır: geçmişe çöp kayıt eklenmez ve düzeltme ikinci bir hashchange
  // tetiklemez (aksi halde hızlı gezinmede eski adres geri gelebiliyor).
  useEffect(() => {
    const target = appMode ? `#/${appMode}/${currentPage}` : '#/';
    const current = window.location.hash;
    if (current === target) return;

    const parsed = parseHash();
    const canonical = parsed.mode ? `#/${parsed.mode}/${parsed.page}` : '#/';
    const isCorrection = current !== canonical;

    if (isFirstRouteSync.current || isCorrection) {
      window.history.replaceState(null, '', target);
    } else {
      window.location.hash = target;
    }
  }, [appMode, currentPage]);

  useEffect(() => {
    isFirstRouteSync.current = false;
  }, []);

  // URL -> durum. Geri/ileri tuşu ve elle girilen adresler için.
  useEffect(() => {
    const onHashChange = () => {
      const { mode, page } = parseHash();
      // '#/' gibi modsuz bir adreste, seçim ekranı kapalıysa boş ekranda
      // kalmamak için Etsy moduna dönülür.
      const nextMode = mode || (SHOPIFY_ENABLED ? null : 'etsy');
      setAppMode(prev => (prev === nextMode ? prev : nextMode));
      setCurrentPage(prev => (prev === page ? prev : page));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const checkEtsyAuth = async () => {
    try {
      const res = await axios.get(`${API_BASE}/etsy/status`);
      setEtsyConnected(res.data.connected);
      if (res.data.connected) {
        setActiveShop(res.data.activeShop);
        setShops(res.data.shops || []);
      } else {
        setActiveShop(null);
        setShops(res.data.shops || []);
      }
    } catch (err) {
      console.error('Cannot check Etsy connection status:', err);
    } finally {
      setCheckingAuth(false);
    }
  };

  const handleSwitchShop = async (shopId) => {
    try {
      setCheckingAuth(true);
      await axios.post(`${API_BASE}/etsy/switch`, { shopId });
      await checkEtsyAuth();
    } catch (err) {
      console.error('Failed to switch shop:', err);
      alert('Mağaza değiştirilemedi.');
    } finally {
      setCheckingAuth(false);
    }
  };

  const selectMode = (mode) => {
    localStorage.setItem('appMode', mode);
    setAppMode(mode);
    setCurrentPage('dashboard');
  };

  const renderPage = () => {
    const shopKey = activeShop?.shop_id || 'default';
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard key={shopKey} appMode={appMode} etsyConnected={appMode === 'etsy' ? etsyConnected : false} activeShop={appMode === 'etsy' ? activeShop : null} />;
      case 'renew-manager':
        return <RenewManager key={shopKey} etsyConnected={etsyConnected} activeShop={activeShop} />;
      case 'analytics':
        return <Analytics key={shopKey} etsyConnected={etsyConnected} activeShop={activeShop} />;
      case 'price-update':
        return <PriceUpdate key={shopKey} etsyConnected={etsyConnected} activeShop={activeShop} />;
      case 'bulk-upload':


        return <BulkUpload key={shopKey} etsyConnected={etsyConnected} activeShop={activeShop} />;
      case 'shopify-upload':
        return <ShopifyBulkUpload />;
      case 'templates':
        return <TemplateStudio key={shopKey} activeShop={activeShop} />;
      case 'variations':
        return <VariationProfiles key={shopKey} activeShop={activeShop} />;
      case 'theme-studio':
        return <ThemeStudio />;
      case 'shopify-connect':
        return <ShopifyConnect />;
      case 'storage':
        return <StorageCleanup />;
      case 'settings':
        return <DefaultSettings key={shopKey} appMode={appMode} etsyConnected={appMode === 'etsy' ? etsyConnected : false} activeShop={activeShop} />;
      case 'setup':
        return <SetupWizard onFinish={() => { setSetupCompleted(true); setCurrentPage('dashboard'); }} onShopChange={checkEtsyAuth} />;
      case 'etsy-connect':
        return (
          <EtsyConnect 
            key={shopKey}
            etsyConnected={etsyConnected} 
            setEtsyConnected={setEtsyConnected} 
            activeShop={activeShop}
            shops={shops}
            onShopChange={checkEtsyAuth}
          />
        );
      default:
        return <Dashboard key={shopKey} etsyConnected={appMode === 'etsy' ? etsyConnected : false} activeShop={activeShop} />;
    }
  };

  // Kurulum tamamlanmadiysa Etsy tarafinda once sihirbaz acilir. setupCompleted
  // null iken hicbir sey cizmiyoruz ki dashboard bir an gorunup kaybolmasin.
  if (appMode === 'etsy' && !checkingAuth && setupCompleted === false) {
    return (
      <SetupWizard
        onFinish={() => { setSetupCompleted(true); setCurrentPage('dashboard'); }}
        onShopChange={checkEtsyAuth}
      />
    );
  }

  // If checking authentication for Etsy
  if (appMode === 'etsy' && (checkingAuth || setupCompleted === null)) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0b0f19] text-amber-500 font-semibold text-sm">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Altyapı Yükleniyor...</span>
        </div>
      </div>
    );
  }

  // 1. Landing Mode Selection Page
  // Yalnizca birden fazla platform aciksa gosterilir.
  if (!appMode && SHOPIFY_ENABLED) {
    return (
      <div className="relative min-h-screen bg-[#0b0f19] flex items-center justify-center p-6 text-slate-100 overflow-hidden select-none">
        {/* Background glows */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-amber-500/5 rounded-full blur-[120px] pointer-events-none"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-emerald-500/5 rounded-full blur-[120px] pointer-events-none"></div>

        <div className="relative z-10 max-w-4xl w-full text-center space-y-12">
          {/* Logo / Header */}
          <div className="space-y-4">
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight bg-gradient-to-r from-amber-400 via-white to-emerald-400 bg-clip-text text-transparent font-outfit uppercase">
              USALK HELPER
            </h1>
            <p className="text-slate-400 text-sm md:text-base max-w-lg mx-auto font-medium">
              Mağaza yönetim ve SEO otomasyon aracı. Devam etmek istediğiniz satış platformunu seçin.
            </p>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">
            
            {/* Etsy Card */}
            <div 
              onClick={() => selectMode('etsy')}
              className="bg-[#0f172a] rounded-3xl border border-slate-800 hover:border-amber-500/30 p-8 text-left transition-all duration-300 transform hover:scale-[1.02] cursor-pointer group shadow-xl hover:shadow-amber-500/5 flex flex-col justify-between h-[320px]"
            >
              <div>
                <div className="w-12 h-12 bg-gradient-to-tr from-amber-500 to-rose-500 rounded-2xl flex items-center justify-center font-bold text-white shadow-lg shadow-amber-500/20 text-lg group-hover:scale-110 transition-transform mb-6">
                  E
                </div>
                <h3 className="text-xl font-bold text-white group-hover:text-amber-400 transition-colors font-outfit mb-2">Etsy Entegrasyonu</h3>
                <p className="text-slate-400 text-xs leading-relaxed font-normal">
                  Etsy API entegrasyonu, mockup şablon stüdyosu, varyasyon profilleri, AI SEO açıklaması ve toplu ürün yükleme aracı.
                </p>
              </div>
              <div className="text-amber-500 font-bold text-xs flex items-center space-x-1.5 pt-4">
                <span>Etsy Modunu Aç</span>
                <span>→</span>
              </div>
            </div>

            {/* Shopify Card */}
            <div 
              onClick={() => selectMode('shopify')}
              className="bg-[#0f172a] rounded-3xl border border-slate-800 hover:border-emerald-500/30 p-8 text-left transition-all duration-300 transform hover:scale-[1.02] cursor-pointer group shadow-xl hover:shadow-emerald-500/5 flex flex-col justify-between h-[320px]"
            >
              <div>
                <div className="w-12 h-12 bg-gradient-to-tr from-emerald-500 to-teal-500 rounded-2xl flex items-center justify-center font-bold text-white shadow-lg shadow-emerald-500/20 text-lg group-hover:scale-110 transition-transform mb-6">
                  S
                </div>
                <h3 className="text-xl font-bold text-white group-hover:text-emerald-400 transition-colors font-outfit mb-2">Shopify Entegrasyonu</h3>
                <p className="text-slate-400 text-xs leading-relaxed font-normal">
                  Shopify Admin API entegrasyonu, Pitch tema yönetimi ve visual özelleştirici stüdyo, indirimli fiyat hesaplama ve bulk variant uploader.
                </p>
              </div>
              <div className="text-emerald-500 font-bold text-xs flex items-center space-x-1.5 pt-4">
                <span>Shopify Modunu Aç</span>
                <span>→</span>
              </div>
            </div>

          </div>
        </div>
      </div>
    );
  }

  // 2. Active Platform Main Screen Layout
  const accentColorClass = appMode === 'etsy' ? 'bg-amber-500/5' : 'bg-emerald-500/5';
  
  return (
    <div className="flex h-screen bg-[#0b0f19] overflow-hidden text-slate-100">
      <Sidebar 
        currentPage={currentPage} 
        setCurrentPage={setCurrentPage} 
        etsyConnected={etsyConnected} 
        activeShop={activeShop}
        shops={shops}
        onSwitchShop={handleSwitchShop}
        appMode={appMode}
        setAppMode={setAppMode}
      />
      
      <main className="flex-1 overflow-y-auto bg-[#0b0f19]">
        {/* Decorative background glows */}
        <div className={`absolute top-0 right-0 w-[500px] h-[500px] ${accentColorClass} rounded-full blur-[120px] pointer-events-none z-0`}></div>
        <div className="absolute top-1/3 left-1/4 w-[300px] h-[300px] bg-rose-500/5 rounded-full blur-[100px] pointer-events-none z-0"></div>
        
        <div className="relative z-10">
          {renderPage()}
        </div>
      </main>

      {/* Sayfadan bağımsız çalışır: iş sunucuda olduğu için gezinme onu etkilemez */}
      <BulkJobWidget />
    </div>
  );
}
