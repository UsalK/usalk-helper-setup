import { 
  LayoutDashboard, 
  Layers, 
  Tag, 
  Settings, 
  Link, 
  UploadCloud,
  Palette,
  Shuffle,
  Coins,
  BarChart3,
  HardDrive,
  Wrench,
  CalendarClock
} from 'lucide-react';
import VersionBadge from './VersionBadge';
import { SHOPIFY_ENABLED } from '../config/features';

export default function Sidebar({ 
  currentPage, 
  setCurrentPage, 
  etsyConnected, 
  activeShop, 
  shops, 
  onSwitchShop,
  appMode,
  setAppMode
}) {

  // Dynamic menu based on platform mode
  const menuItems = appMode === 'etsy' ? [
    { id: 'dashboard', name: 'Ürün Paneli', icon: LayoutDashboard },
    { id: 'renew-manager', name: 'Yenileme Yöneticisi', icon: CalendarClock },
    { id: 'analytics', name: 'Analiz & Optimizasyon', icon: BarChart3 },
    { id: 'price-update', name: 'Listing Fiyat Güncelle', icon: Coins },
    { id: 'bulk-upload', name: 'Toplu Yükleme Sihirbazı', icon: UploadCloud },
    { id: 'templates', name: 'Şablon Stüdyosu', icon: Layers },
    { id: 'variations', name: 'Varyasyon Profilleri', icon: Tag },
    { id: 'storage', name: 'Depolama Temizliği', icon: HardDrive },
    { id: 'settings', name: 'Genel Ayarlar', icon: Settings },
    { id: 'etsy-connect', name: 'Etsy Bağlantısı', icon: Link },
    { id: 'setup', name: 'Kurulum Sihirbazı', icon: Wrench }
  ] : [

    { id: 'dashboard', name: 'Ürün Paneli', icon: LayoutDashboard },
    { id: 'shopify-upload', name: 'Shopify Ürün Yükleyici', icon: UploadCloud },
    { id: 'templates', name: 'Şablon Stüdyosu', icon: Layers },
    { id: 'variations', name: 'Varyasyon Profilleri', icon: Tag },
    { id: 'theme-studio', name: 'Tema Stüdyosu', icon: Palette },
    { id: 'storage', name: 'Depolama Temizliği', icon: HardDrive },
    { id: 'shopify-connect', name: 'Shopify Bağlantısı', icon: Link },
    { id: 'settings', name: 'Genel Ayarlar', icon: Settings }
  ];

  const accentColorClass = appMode === 'etsy' ? 'from-amber-500 to-rose-500' : 'from-emerald-500 to-teal-500';
  const shadowGlowClass = appMode === 'etsy' ? 'shadow-amber-500/20' : 'shadow-emerald-500/20';
  const activeLinkClass = appMode === 'etsy' 
    ? 'from-amber-500/10 to-amber-500/5 text-amber-500 border-amber-500/20' 
    : 'from-emerald-500/10 to-emerald-500/5 text-emerald-500 border-emerald-500/20';
  
  const iconColorClass = (isActive) => {
    if (isActive) {
      return appMode === 'etsy' ? 'text-amber-500' : 'text-emerald-500';
    }
    return 'text-slate-500 group-hover:text-slate-400 group-hover:scale-110';
  };

  const handleSwitchMode = () => {
    localStorage.removeItem('appMode');
    setAppMode(null);
  };

  return (
    <aside className="w-64 bg-[#0e1726] border-r border-[#1e293b] flex flex-col h-screen sticky top-0">
      {/* Brand Header */}
      <div className="p-6 border-b border-[#1e293b] flex items-end space-x-3">
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-tr ${accentColorClass} flex items-center justify-center font-bold text-white shadow-lg ${shadowGlowClass} shrink-0`}>
          {appMode === 'etsy' ? 'E' : 'S'}
        </div>
        <div className="min-w-0">
          <h1 className="font-bold text-lg leading-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent font-outfit">
            Usalk Helper
          </h1>
          <span className="text-[9px] text-slate-500 font-semibold tracking-wider uppercase">
            {appMode === 'etsy' ? 'Etsy SEO & Mockup' : 'Shopify Theme & CMS'}
          </span>
        </div>
        {/* Sürüm rozeti — başlığın sağ altı */}
        <div className="ml-auto shrink-0">
          <VersionBadge />
        </div>
      </div>

      {/* Shop Selector Dropdown (Etsy only) */}
      {appMode === 'etsy' && etsyConnected && shops && shops.length > 0 && (
        <div className="px-4 py-4 border-b border-[#1e293b] space-y-1.5 animate-fade-in">
          <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider">Aktif Mağaza</label>
          <div className="relative">
            <select
              value={activeShop?.shop_id || ''}
              onChange={(e) => onSwitchShop(e.target.value)}
              className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 cursor-pointer appearance-none pr-8 font-semibold transition-colors"
            >
              {shops.map(s => (
                <option key={s.shop_id} value={s.shop_id} className="bg-[#151f32]">
                  {s.shop_name}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        {menuItems.map(item => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id)}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 group text-left border ${
                isActive 
                  ? `bg-gradient-to-r ${activeLinkClass} font-medium`
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 border-transparent'
              }`}
            >
              <Icon className={`w-5 h-5 transition-transform duration-200 ${iconColorClass(isActive)}`} />
              <span className="text-sm">{item.name}</span>
            </button>
          );
        })}
      </nav>

      {/* Bottom Switch Mode Control */}
      {/* Gecilecek ikinci bir platform yoksa dugme gosterilmez */}
      {SHOPIFY_ENABLED && (
        <div className="p-4 border-t border-[#1e293b] space-y-3">
          <button
            onClick={handleSwitchMode}
            className="w-full flex items-center justify-center space-x-2 text-xs font-semibold py-2.5 px-3 rounded-xl bg-slate-800/50 hover:bg-slate-850 hover:text-white border border-[#1e293b] text-slate-400 transition-colors cursor-pointer"
          >
            <Shuffle className="w-3.5 h-3.5" />
            <span>Platform Değiştir</span>
          </button>
        </div>
      )}
    </aside>
  );
}
