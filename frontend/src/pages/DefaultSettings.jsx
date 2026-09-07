import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Save, AlertTriangle, Sliders, CheckCircle, RefreshCw,
  Settings, FolderKanban, Truck, Tag, FileText, Info, Check, Clock
} from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

const ROOM_OPTIONS = [
  'Bathroom', 'Bedroom', 'Dorm', 'Entryway', 'Game room',
  'Kids', 'Kitchen & dining', 'Laundry', 'Living room', 'Nursery', 'Office'
];

export default function DefaultSettings({ etsyConnected, appMode }) {
  const [activeTab, setActiveTab] = useState('ayarlar');
  const [loading, setLoading] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Settings state
  const [settings, setSettings] = useState({
    default_price: 35.00,
    shop_discount_percent: 0,
    mockup_min_short_edge_px: 2000,
    mockup_jpeg_quality: 92,
    default_taxonomy_id: 1027, // Wall Decor
    default_who_made: 'i_did',
    default_when_made: 'made_to_order',
    default_shipping_profile_id: '',
    default_return_policy_id: '',
    default_shop_section_id: '',
    default_readiness_state_id: '',
    default_listing_state: 'draft',
    default_is_digital: false,
    shop_style: 'vintage poster, art deco',
    target_market: 'US/UK',
    nvidia_model: 'qwen/qwen3.7-plus',

    // New tab settings
    timezone: 'UTC - Coordinated Universal Time',
    currency: 'US Dollar ($)',
    measurement_unit: 'Inches',
    default_processing_days: 6,
    auto_sync: false,
    auto_renew: true,

    // Attributes tab settings
    attribute_materials_enabled: true,
    attribute_materials: ['Canvas', 'Paper', 'Cotton', 'Wood', 'Fabric'],
    attribute_home_style_enabled: true,
    attribute_home_style: 'Art deco',
    attribute_occasion_enabled: true,
    attribute_occasion: 'Birthday',
    attribute_holiday_enabled: true,
    attribute_holiday: "Valentine's Day",
    attribute_room_enabled: true,
    attribute_rooms: ['Bedroom', 'Entryway', 'Kitchen & dining', 'Living room', 'Office'],
    attribute_width_enabled: true,
    attribute_width: 40,
    attribute_width_unit: 'Inches',
    attribute_height_enabled: true,
    attribute_height: 60,
    attribute_height_unit: 'Inches',

    // Description tab settings
    description_boilerplate: ''
  });

  const [shippingProfiles, setShippingProfiles] = useState([]);
  const [returnPolicies, setReturnPolicies] = useState([]);
  const [shopSections, setShopSections] = useState([]);
  const [readinessStates, setReadinessStates] = useState([]);
  const [materialSearch, setMaterialSearch] = useState('');
  const [showMaterialDropdown, setShowMaterialDropdown] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [addingSection, setAddingSection] = useState(false);
  const [collections, setCollections] = useState([]);

  useEffect(() => {
    fetchSettings();
    if (appMode === 'shopify') {
      fetchShopifyCollections();
    }
  }, [appMode]);

  useEffect(() => {
    if (etsyConnected && appMode === 'etsy') {
      fetchEtsyMetadata();
    }
  }, [etsyConnected, appMode]);

  const fetchShopifyCollections = async () => {
    try {
      const res = await axios.get(`${API_BASE}/shopify/collections`);
      setCollections(res.data);
    } catch (err) {
      console.error('Failed to load Shopify collections:', err);
    }
  };

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/settings`);
      if (res.data) {
        setSettings(prev => ({
          ...prev,
          ...res.data
        }));
      }
    } catch (err) {
      console.error('Ayarlar yüklenemedi:', err);
      setErrorMsg('Ayarlar veritabanından yüklenemedi.');
    } finally {
      setLoading(false);
    }
  };

  const fetchEtsyMetadata = async (force = false) => {
    setMetaLoading(true);
    try {
      if (force) {
        await axios.post(`${API_BASE}/etsy/clear-cache`).catch(() => { });
      }
      const [shipRes, returnRes, sectionRes, readinessRes] = await Promise.all([
        axios.get(`${API_BASE}/etsy/shipping-profiles`).catch(() => ({ data: [] })),
        axios.get(`${API_BASE}/etsy/return-policies`).catch(() => ({ data: [] })),
        axios.get(`${API_BASE}/etsy/shop-sections`).catch(() => ({ data: [] })),
        axios.get(`${API_BASE}/etsy/readiness-states`).catch(() => ({ data: [] }))
      ]);

      setShippingProfiles(shipRes.data || []);
      setReturnPolicies(returnRes.data || []);
      setShopSections(sectionRes.data || []);
      setReadinessStates(readinessRes.data || []);
    } catch (err) {
      console.error('Etsy bilgileri çekilemedi:', err);
    } finally {
      setMetaLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSettings(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : (type === 'number' ? Number(value) : value)
    }));
  };

  const handleRoomToggle = (room) => {
    setSettings(prev => {
      const currentRooms = prev.attribute_rooms || [];
      let newRooms;
      if (currentRooms.includes(room)) {
        newRooms = currentRooms.filter(r => r !== room);
      } else {
        if (currentRooms.length >= 5) {
          // Limit to maximum 5 selections
          return prev;
        }
        newRooms = [...currentRooms, room];
      }
      return {
        ...prev,
        attribute_rooms: newRooms
      };
    });
  };

  const handleMaterialToggle = (material) => {
    setSettings(prev => {
      const currentMaterials = prev.attribute_materials || [];
      let newMaterials;
      if (currentMaterials.includes(material)) {
        newMaterials = currentMaterials.filter(m => m !== material);
      } else {
        if (currentMaterials.length >= 13) {
          return prev;
        }
        newMaterials = [...currentMaterials, material];
      }
      return {
        ...prev,
        attribute_materials: newMaterials
      };
    });
  };

  const handleMaterialAdd = (material) => {
    setSettings(prev => {
      const currentMaterials = prev.attribute_materials || [];
      if (currentMaterials.includes(material)) {
        return prev;
      }
      if (currentMaterials.length >= 13) {
        return prev;
      }
      return {
        ...prev,
        attribute_materials: [...currentMaterials, material]
      };
    });
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setLoading(true);
    setSuccessMsg('');
    setErrorMsg('');
    try {
      await axios.post(`${API_BASE}/settings`, settings);
      setSuccessMsg('Ayarlar başarıyla kaydedildi!');
      setTimeout(() => setSuccessMsg(''), 3000);
      if (etsyConnected) {
        fetchEtsyMetadata();
      }
    } catch (err) {
      console.error('Ayarlar kaydedilemedi:', err);
      setErrorMsg('Kaydetme sırasında bir hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddSection = async (e) => {
    if (e) e.preventDefault();
    if (!newSectionTitle.trim()) return;
    setAddingSection(true);
    setSuccessMsg('');
    setErrorMsg('');
    try {
      await axios.post(`${API_BASE}/etsy/shop-sections`, { title: newSectionTitle });
      setNewSectionTitle('');
      setSuccessMsg('Bölüm başarıyla oluşturuldu!');
      setTimeout(() => setSuccessMsg(''), 3000);
      await fetchEtsyMetadata(true); // Force refresh sections list from Etsy
    } catch (err) {
      console.error('Bölüm oluşturulamadı:', err);
      setErrorMsg(err.response?.data?.error || 'Bölüm oluşturulurken hata oluştu.');
    } finally {
      setAddingSection(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Genel Ayarlar</h2>
          <p className="text-slate-400 text-sm">Mağazanızın temel ayarlarını ve tercihlerini yapılandırın.</p>
        </div>

        <div className="flex items-center space-x-3">
          {successMsg && (
            <div className="flex items-center space-x-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-2 rounded-lg text-sm">
              <CheckCircle className="w-4 h-4" />
              <span>{successMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="flex items-center space-x-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 px-4 py-2 rounded-lg text-sm">
              <AlertTriangle className="w-4 h-4" />
              <span>{errorMsg}</span>
            </div>
          )}

          {etsyConnected && (
            <button
              type="button"
              onClick={() => fetchEtsyMetadata(true)}
              disabled={metaLoading}
              className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-semibold px-4 py-2.5 rounded-xl border border-slate-700 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${metaLoading ? 'animate-spin' : ''}`} />
              <span>Verileri Güncelle</span>
            </button>
          )}

          <button
            onClick={handleSave}
            disabled={loading}
            className={`flex items-center space-x-2 ${
              appMode === 'shopify' 
                ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/10' 
                : 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-amber-500/10'
            } disabled:opacity-50 font-bold py-2.5 px-6 rounded-xl shadow-lg transition-colors text-sm`}
          >
            <Save className="w-4 h-4" />
            <span>{loading ? 'Kaydediliyor...' : 'Kaydet'}</span>
          </button>
        </div>
      </div>

      {/* Tabs list */}
      <div className="flex space-x-1 border-b border-[#1e293b] mb-6 overflow-x-auto pb-1 scrollbar-thin">
        {(appMode === 'shopify' ? [
          { id: 'ayarlar', label: 'Ayarlar', icon: Settings },
          { id: 'bolumler', label: 'Koleksiyonlar', icon: FolderKanban },
          { id: 'aciklama', label: 'Açıklama', icon: FileText },
          { id: 'magaza_bilgileri', label: 'Mağaza Bilgileri', icon: Info }
        ] : [
          { id: 'ayarlar', label: 'Ayarlar', icon: Settings },
          { id: 'bolumler', label: 'Bölümler', icon: FolderKanban },
          { id: 'kargo', label: 'Kargo', icon: Truck },
          { id: 'oznitelikler', label: 'Öznitelikler', icon: Tag },
          { id: 'aciklama', label: 'Açıklama', icon: FileText },
          { id: 'magaza_bilgileri', label: 'Mağaza Bilgileri', icon: Info }
        ]).map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${isActive
                  ? (appMode === 'shopify' ? 'border-emerald-500 text-emerald-500 bg-emerald-500/5' : 'border-amber-500 text-amber-500 bg-amber-500/5')
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/10'
                }`}
            >
              <Icon className="w-4.5 h-4.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 md:p-8">
        {/* TAB 1: AYARLAR (General Settings) */}
        {activeTab === 'ayarlar' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white mb-1">Genel Mağaza Ayarları</h3>
              <p className="text-xs text-slate-400">Mağazanız için temel yerelleştirme ve listeleme önayarlarını yapın.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-[#1e293b]">
              {/* Saat Dilimi */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Saat Dilimi</label>
                <select
                  name="timezone"
                  value={settings.timezone}
                  onChange={handleChange}
                  className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                >
                  <option>UTC - Coordinated Universal Time</option>
                  <option>Europe/Istanbul (GMT+3)</option>
                  <option>US/Eastern (GMT-5)</option>
                  <option>US/Pacific (GMT-8)</option>
                </select>
                <p className="text-[10px] text-slate-500">Mağazanız için saat dilimi seçin. Bu, sipariş zamanlarını ve raporları etkiler.</p>
              </div>

              {/* Para Birimi */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Mağaza Para Birimi</label>
                <input
                  type="text"
                  name="currency"
                  value={settings.currency}
                  onChange={handleChange}
                  readOnly
                  className="w-full bg-[#151f32]/50 border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-400 cursor-not-allowed"
                />
                <p className="text-[10px] text-slate-500">
                  Mağaza para birimi {appMode === 'shopify' ? 'Shopify' : 'Etsy'} ayarlarından otomatik olarak senkronize edilir.
                </p>
              </div>

              {/* Ölçü Birimi */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Ölçü Birimi</label>
                <select
                  name="measurement_unit"
                  value={settings.measurement_unit}
                  onChange={handleChange}
                  className={`w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none ${
                    appMode === 'shopify' ? 'focus:border-emerald-500' : 'focus:border-amber-500'
                  }`}
                >
                  <option value="Inches">Inches</option>
                  <option value="Centimeters">Centimeters</option>
                </select>
              </div>

              {/* Varsayılan İşleme Günü */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Varsayılan İşleme Günü</label>
                <input
                  type="number"
                  name="default_processing_days"
                  value={settings.default_processing_days}
                  onChange={handleChange}
                  className={`w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none ${
                    appMode === 'shopify' ? 'focus:border-emerald-500' : 'focus:border-amber-500'
                  }`}
                />
                <p className="text-[10px] text-slate-500">
                  Siparişleri işlemek ve göndermek için gereken varsayılan gün sayısı.
                </p>
              </div>

              {/* AI Model Seçimi */}
              <div className="space-y-2 md:col-span-2">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Aktif AI Modeli</label>
                <select
                  name="nvidia_model"
                  value={settings.nvidia_model || 'qwen/qwen3.7-plus'}
                  onChange={handleChange}
                  className={`w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none ${
                    appMode === 'shopify' ? 'focus:border-emerald-500' : 'focus:border-amber-500'
                  }`}
                >
                  <option value="qwen/qwen3.7-plus">Qwen 3.7 Plus (Önerilen)</option>
                  <option value="desktop-agent">AI Agent (Masaüstü)</option>
                  <option value="qwen/qwen3.7-flash">Qwen 3.7 Flash (Hızlı)</option>
                  <option value="qwen/qwen3-vl-32b-instruct">Qwen 3 VL 32B Instruct</option>
                  <option value="openai/gpt-5-mini">OpenAI GPT-5 Mini</option>
                  <option value="google/gemini-2.5-flash">Gemini 2.5 Flash</option>
                  <option value="google/gemini-3.5-flash">Gemini 3.5 Flash</option>
                  <option value="google/gemini-3.5-flash-lite">Gemini 3.5 Flash Lite</option>
                  <option value="google/gemini-3.7-flash">Gemini 3.7 Flash</option>
                  <option value="google/gemini-3.8-flash">Gemini 3.8 Flash</option>
                </select>
                <p className="text-[10px] text-slate-500">
                  {settings.nvidia_model === 'desktop-agent'
                    ? 'Başlık, etiket ve açıklama için masaüstü agentınızın sonucu beklenir; OpenRouter kullanılmaz. Agent sonucu teslim edince mevcut yükleme akışı devam eder. Agentı ayrıca çalıştırmanız gerekir.'
                    : 'Başlık, etiket ve açıklama seçtiğiniz modelle OpenRouter üzerinden hazırlanır. Masaüstü agentı yükleme akışını yönetebilir.'}
                </p>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const { data } = await axios.get(`${API_BASE}/ai/agent-guide`);
                        await navigator.clipboard.writeText(data.prompt);
                        setSuccessMsg('Agent talimatı kopyalandı. Masaüstü agentınıza yapıştırabilirsiniz.');
                      } catch {
                        setErrorMsg('Talimat kopyalanamadı. Arka uç bağlantısını kontrol edin veya agentınıza usalk-helper proje kökündeki agent-help.md dosyasını okutun.');
                      }
                    }}
                    className="px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-semibold hover:bg-amber-500/20"
                  >
                    Agent talimatını kopyala
                  </button>
                <p className="text-[10px] text-slate-500">Talimat tüm yükleme rehberinin dosya yolunu içerir. Agent kaydedilmiş model seçimini kullanır; seçimi değiştirdiyseniz önce kaydedin.</p>
              </div>

              {/* Otomatik Senkronizasyon Toggle */}
              <div className="flex items-center justify-between p-4 bg-[#151f32] border border-[#1e293b] rounded-2xl md:col-span-2">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-semibold text-white">Otomatik Senkronizasyon</span>
                    <span className={`text-[9px] font-bold ${
                      appMode === 'shopify' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                    } border px-2 py-0.5 rounded-full`}>Enterprise Özellik</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Ürünlerinizi {appMode === 'shopify' ? 'Shopify' : 'Etsy'} ile günlük olarak otomatik senkronize edin.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    name="auto_sync"
                    checked={settings.auto_sync}
                    onChange={handleChange}
                    className="sr-only peer"
                  />
                  <div className={`w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all ${
                    appMode === 'shopify' ? 'peer-checked:bg-emerald-500 peer-checked:after:bg-slate-950 peer-checked:after:border-slate-950' : 'peer-checked:bg-amber-500 peer-checked:after:bg-slate-950 peer-checked:after:border-slate-950'
                  }`}></div>
                </label>
              </div>
            </div>

            {appMode !== 'shopify' && (
              <div className="space-y-6 pt-6 border-t border-[#1e293b]">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider text-slate-400 mb-1">Liste Varsayılanları</h3>
                  <p className="text-xs text-slate-500">Ürün listelemeleri için varsayılan davranışı yapılandırın.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Varsayılan Kategori */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Varsayılan Kategori</label>
                    <select
                      name="default_taxonomy_id"
                      value={settings.default_taxonomy_id}
                      onChange={handleChange}
                      className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                    >
                      <option value={1027}>Wall Decor (ID: 1027)</option>
                      <option value={1021}>Art Prints (ID: 1021)</option>
                      <option value={101}>Wall Art (ID: 101)</option>
                    </select>
                    <p className="text-[10px] text-slate-500">Yeni ürün listelemeleri için varsayılan kategoriyi seçin.</p>
                  </div>

                  {/* Varsayılan Fiyat */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Varsayılan Fiyat (USD)</label>
                    <input
                      type="number"
                      step="0.01"
                      name="default_price"
                      value={settings.default_price}
                      onChange={handleChange}
                      className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  {/* Mockup Minimum Kısa Kenar */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Mockup Minimum Kısa Kenar (px)</label>
                    <input
                      type="number"
                      step="100"
                      min="2000"
                      name="mockup_min_short_edge_px"
                      value={settings.mockup_min_short_edge_px}
                      onChange={handleChange}
                      className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-[10px] text-slate-500 block leading-relaxed">
                      En az <strong className="text-slate-400">2000</strong> px. Küçük şablonlar mockup
                      üretilirken oranları korunarak büyütülür: 1024×3072 → 2000×6000.
                      Büyük şablonlar küçültülmez. Kaydettiğiniz şablon dosyası orijinal boyutunda kalır.
                    </span>
                  </div>

                  {/* Mockup JPEG Kalitesi */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Mockup JPEG Kalitesi</label>
                    <input
                      type="number"
                      step="1"
                      min="70"
                      max="100"
                      name="mockup_jpeg_quality"
                      value={settings.mockup_jpeg_quality}
                      onChange={handleChange}
                      className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-[10px] text-slate-500 block leading-relaxed">
                      70-100 arası. Varsayılan <strong className="text-slate-400">92</strong>; 95'e göre gözle
                      ayırt edilemiyor ama dosyalar ~%30 küçük, hem render hem Etsy'ye yükleme hızlanıyor.
                    </span>
                  </div>

                  {/* Mağaza İndirim Oranı */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Mağaza İndirim Oranı (%)</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="99"
                      name="shop_discount_percent"
                      value={settings.shop_discount_percent}
                      onChange={handleChange}
                      className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-[10px] text-slate-500 block leading-relaxed">
                      Etsy API'si kampanya bilgisi vermediği için buraya elle girilir. Analiz sekmesinde
                      fiyatlar bu orana göre üstü çizili gösterilir (örn. <span className="line-through">$100</span> $50).
                      0 girilirse indirim gösterilmez.
                    </span>
                  </div>

                  {/* Varsayılan Liste Durumu */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Varsayılan Liste Durumu</label>
                    <select
                      name="default_listing_state"
                      value={settings.default_listing_state}
                      onChange={handleChange}
                      className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                    >
                      <option value="draft">Taslak (Draft)</option>
                      <option value="active">Aktif (Live)</option>
                    </select>
                    <p className="text-[10px] text-slate-500">Yeni ürün listelemeleri için varsayılan durumu seçin.</p>
                  </div>


                  {/* Listeleri Otomatik Yenile */}
                  <div className="flex items-center justify-between p-4 bg-[#151f32] border border-[#1e293b] rounded-2xl md:col-span-2">
                    <div className="space-y-1">
                      <span className="text-sm font-semibold text-white">Listeleri Otomatik Yenile</span>
                      <p className="text-xs text-slate-500">Süresi dolan listeleri otomatik olarak yenile.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        name="auto_renew"
                        checked={settings.auto_renew}
                        onChange={handleChange}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500 peer-checked:after:bg-slate-950 peer-checked:after:border-slate-950"></div>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: BÖLÜMLER (Shop Sections / Shopify Collections) */}
        {activeTab === 'bolumler' && (
          <div className="space-y-6">
            {appMode === 'shopify' ? (
              <>
                <div>
                  <h3 className="text-lg font-bold text-white mb-1">Shopify Koleksiyonları</h3>
                  <p className="text-xs text-slate-400">Shopify mağazanızda bulunan ürün koleksiyonlarını inceleyin ve yeni koleksiyonlar oluşturun.</p>
                </div>

                {/* Add new custom collection */}
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newSectionTitle.trim()) return;
                  setAddingSection(true);
                  setSuccessMsg('');
                  setErrorMsg('');
                  try {
                    await axios.post(`${API_BASE}/shopify/collections/create`, { title: newSectionTitle });
                    setNewSectionTitle('');
                    setSuccessMsg('Koleksiyon başarıyla oluşturuldu!');
                    setTimeout(() => setSuccessMsg(''), 3000);
                    await fetchShopifyCollections();
                  } catch (err) {
                    console.error('Koleksiyon oluşturulamadı:', err);
                    setErrorMsg(err.response?.data?.error || 'Koleksiyon oluşturulurken hata oluştu.');
                  } finally {
                    setAddingSection(false);
                  }
                }} className="bg-[#151f32] border border-[#1e293b] rounded-3xl p-6 mb-6 space-y-4">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Yeni Koleksiyon Ekle (Create New Collection)</h4>
                  <div className="flex space-x-3">
                    <input
                      type="text"
                      placeholder="Koleksiyon başlığı (Örn: Minimalist Posterler)"
                      value={newSectionTitle}
                      onChange={(e) => setNewSectionTitle(e.target.value)}
                      className="flex-1 bg-[#0e1726] border border-[#1e293b] rounded-xl px-4 py-3 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      type="submit"
                      disabled={addingSection || !newSectionTitle.trim()}
                      className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold py-2.5 px-5 rounded-xl transition-colors text-xs flex items-center justify-center whitespace-nowrap"
                    >
                      {addingSection ? 'Ekleniyor...' : 'Koleksiyon Ekle'}
                    </button>
                  </div>
                </form>

                {collections.length === 0 ? (
                  <div className="text-center py-8 text-slate-500 text-sm">Mağazanızda hiç koleksiyon bulunmuyor.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-[#1e293b]">
                    {collections.map(c => (
                      <div key={c.id} className="bg-[#151f32] border border-[#1e293b] rounded-2xl p-4 flex items-center justify-between">
                        <div>
                          <strong className="text-white text-sm block">{c.title}</strong>
                          <span className="text-[10px] text-slate-500">ID: {c.id} ({c.rules ? 'Smart Collection' : 'Custom Collection'})</span>
                        </div>
                        <span className="text-xs font-semibold px-3 py-1 bg-slate-800 rounded-lg text-slate-400">
                          {c.published_scope || 'Global'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div>
                  <h3 className="text-lg font-bold text-white mb-1">Mağaza Bölümleri (Shop Sections)</h3>
                  <p className="text-xs text-slate-400">Etsy mağazanızda bulunan ürün bölümlerini inceleyin ve varsayılan bir bölüm seçin.</p>
                </div>

                {!etsyConnected ? (
                  <div className="flex items-start space-x-3 bg-amber-500/5 border border-amber-500/10 rounded-xl p-4 text-xs text-slate-400">
                    <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                    <span>Bölümleri listelemek için öncelikle Etsy hesabınızı bağlamalısınız.</span>
                  </div>
                ) : (
                  <>
                    {/* Default settings selector */}
                    <div className="bg-[#151f32] border border-[#1e293b] rounded-3xl p-6 mb-6">
                      <div className="space-y-2">
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                          Varsayılan Mağaza Bölümü (Default Shop Section)
                        </label>
                        {shopSections.length > 0 ? (
                          <select
                            name="default_shop_section_id"
                            value={settings.default_shop_section_id}
                            onChange={handleChange}
                            className="w-full bg-[#0e1726] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                          >
                            <option value="">Bölüm Seçilmesin (Bölümsüz)</option>
                            {shopSections.map(s => (
                              <option key={s.shop_section_id} value={s.shop_section_id.toString()}>
                                {s.title} ({s.shop_section_id})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            name="default_shop_section_id"
                            value={settings.default_shop_section_id}
                            onChange={handleChange}
                            placeholder="Bölüm ID değerini girin"
                            className="w-full bg-[#0e1726] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                          />
                        )}
                      </div>
                    </div>

                    {/* Add new shop section */}
                    <form onSubmit={handleAddSection} className="bg-[#151f32] border border-[#1e293b] rounded-3xl p-6 mb-6 space-y-4">
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">Yeni Bölüm Ekle (Create New Section)</h4>
                      <div className="flex space-x-3">
                        <input
                          type="text"
                          placeholder="Bölüm başlığı (Örn: Dijital Posterler)"
                          value={newSectionTitle}
                          onChange={(e) => setNewSectionTitle(e.target.value)}
                          className="flex-1 bg-[#0e1726] border border-[#1e293b] rounded-xl px-4 py-3 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                        />
                        <button
                          type="submit"
                          disabled={addingSection || !newSectionTitle.trim()}
                          className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold py-2.5 px-5 rounded-xl transition-colors text-xs flex items-center justify-center whitespace-nowrap"
                        >
                          {addingSection ? 'Ekleniyor...' : 'Bölüm Ekle'}
                        </button>
                      </div>
                    </form>

                    {shopSections.length === 0 ? (
                      <div className="text-center py-8 text-slate-500 text-sm">Mağazanızda hiç bölüm bulunmuyor.</div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-[#1e293b]">
                        {shopSections.map(sec => (
                          <div key={sec.shop_section_id} className="bg-[#151f32] border border-[#1e293b] rounded-2xl p-4 flex items-center justify-between">
                            <div>
                              <strong className="text-white text-sm block">{sec.title}</strong>
                              <span className="text-[10px] text-slate-500">ID: {sec.shop_section_id}</span>
                            </div>
                            <span className="text-xs font-semibold px-3 py-1 bg-slate-800 rounded-lg text-slate-400">
                              {sec.active_listing_count} Ürün
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* TAB 3: KARGO (Shipping Profiles) */}
        {activeTab === 'kargo' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white mb-1">Kargo & İade Şablonları</h3>
              <p className="text-xs text-slate-400">Etsy üzerinde tanımlı gönderim profilleriniz (Ready to ship) ve iade politikalarınız.</p>
            </div>

            {!etsyConnected ? (
              <div className="flex items-start space-x-3 bg-amber-500/5 border border-amber-500/10 rounded-xl p-4 text-xs text-slate-400">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <span>Kargo ve iade profillerini görüntülemek için öncelikle Etsy hesabınızı bağlamalısınız.</span>
              </div>
            ) : (
              <>
                {/* Default settings selector */}
                <div className="bg-[#151f32] border border-[#1e293b] rounded-3xl p-6 mb-6 space-y-6">
                  <h4 className="text-sm font-bold text-white uppercase tracking-wider text-slate-400">Varsayılan Kargo & İade Seçenekleri</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Shipping Profile Selector */}
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Varsayılan Kargo Şablonu (Shipping Profile ID)
                      </label>
                      {shippingProfiles.length > 0 ? (
                        <select
                          name="default_shipping_profile_id"
                          value={settings.default_shipping_profile_id}
                          onChange={handleChange}
                          className="w-full bg-[#0e1726] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                        >
                          <option value="">Seçiniz...</option>
                          {shippingProfiles.map(p => (
                            <option key={p.shipping_profile_id} value={p.shipping_profile_id.toString()}>
                              {p.title} ({p.shipping_profile_id})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          name="default_shipping_profile_id"
                          value={settings.default_shipping_profile_id}
                          onChange={handleChange}
                          placeholder="Şablon ID değerini girin"
                          className="w-full bg-[#0e1726] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                        />
                      )}
                    </div>

                    {/* Return Policy Selector */}
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Varsayılan İade Politikası (Return Policy ID)
                      </label>
                      {returnPolicies.length > 0 ? (
                        <select
                          name="default_return_policy_id"
                          value={settings.default_return_policy_id}
                          onChange={handleChange}
                          className="w-full bg-[#0e1726] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                        >
                          <option value="">Seçiniz...</option>
                          {returnPolicies.map(p => (
                            <option key={p.return_policy_id} value={p.return_policy_id.toString()}>
                              {p.name} ({p.return_policy_id})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          name="default_return_policy_id"
                          value={settings.default_return_policy_id}
                          onChange={handleChange}
                          placeholder="Politika ID değerini girin"
                          className="w-full bg-[#0e1726] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                        />
                      )}
                    </div>

                    {/* Readiness State Selector */}
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Varsayılan Hazırlık Profili (Readiness State ID)
                      </label>
                      {readinessStates.length > 0 ? (
                        <select
                          name="default_readiness_state_id"
                          value={settings.default_readiness_state_id}
                          onChange={handleChange}
                          className="w-full bg-[#0e1726] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                        >
                          <option value="">Seçiniz...</option>
                          {readinessStates.map(r => (
                            <option key={r.readiness_state_id} value={r.readiness_state_id.toString()}>
                              {r.readiness_state} ({r.processing_days_display_label})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          name="default_readiness_state_id"
                          value={settings.default_readiness_state_id}
                          onChange={handleChange}
                          placeholder="Hazırlık ID değerini girin"
                          className="w-full bg-[#0e1726] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pt-4 border-t border-[#1e293b]">
                  {/* Left: Shipping Profiles List */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-amber-500 uppercase tracking-wider flex items-center space-x-1.5">
                      <Truck className="w-3.5 h-3.5" />
                      <span>Kargo Profilleri (Shipping Profiles)</span>
                    </h4>
                    {shippingProfiles.length === 0 ? (
                      <div className="p-4 bg-[#151f32]/40 border border-[#1e293b]/50 rounded-2xl text-slate-500 text-xs italic">Kargo profili bulunamadı.</div>
                    ) : (
                      <div className="space-y-4">
                        {shippingProfiles.map(profile => (
                          <div key={profile.shipping_profile_id} className="bg-[#151f32] border border-[#1e293b] rounded-2xl p-5 space-y-3">
                            <div className="flex items-start justify-between">
                              <div>
                                <strong className="text-white text-md block font-bold">{profile.title}</strong>
                                <span className="text-xs text-slate-400 font-semibold">ID: {profile.shipping_profile_id}</span>
                              </div>
                              <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1 rounded-full">
                                {profile.origin_country_iso} Çıkışlı
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-800 text-xs text-slate-400">
                              <div>
                                <span className="text-slate-500 block text-[10px] uppercase font-semibold">İşleme Süresi</span>
                                <span className="font-semibold text-slate-300">
                                  {profile.processing_min}-{profile.processing_max} {profile.processing_time_unit}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Gönderim Tipi</span>
                                <span className="font-semibold text-slate-300">{profile.min_processing_days ? `${profile.min_processing_days} Gün` : 'Standart'}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Middle: Return Policies List */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-amber-500 uppercase tracking-wider flex items-center space-x-1.5">
                      <Info className="w-3.5 h-3.5" />
                      <span>İade Politikaları (Return Policies)</span>
                    </h4>
                    {returnPolicies.length === 0 ? (
                      <div className="p-4 bg-[#151f32]/40 border border-[#1e293b]/50 rounded-2xl text-slate-500 text-xs italic">İade politikası bulunamadı.</div>
                    ) : (
                      <div className="space-y-4">
                        {returnPolicies.map(policy => (
                          <div key={policy.return_policy_id} className="bg-[#151f32] border border-[#1e293b] rounded-2xl p-5 space-y-3">
                            <div className="flex items-start justify-between">
                              <div>
                                <strong className="text-white text-md block font-bold">{policy.name || 'İade Politikası'}</strong>
                                <span className="text-xs text-slate-400 font-semibold">ID: {policy.return_policy_id}</span>
                              </div>
                              <span className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full ${policy.accepts_returns
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                }`}>
                                {policy.accepts_returns ? 'İade Alınır' : 'İade Alınmaz'}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-800 text-xs text-slate-400">
                              <div>
                                <span className="text-slate-500 block text-[10px] uppercase font-semibold">İade Süresi</span>
                                <span className="font-semibold text-slate-300">
                                  {policy.return_deadline_days ? `${policy.return_deadline_days} Gün` : '-'}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Kargo Ücreti</span>
                                <span className="font-semibold text-slate-300">
                                  {policy.shipping_cost_responsibility === 'buyer' ? 'Alıcıya Ait' : 'Satıcıya Ait'}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right: Readiness States List */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-amber-500 uppercase tracking-wider flex items-center space-x-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Hazırlık Profilleri (Readiness States)</span>
                    </h4>
                    {readinessStates.length === 0 ? (
                      <div className="p-4 bg-[#151f32]/40 border border-[#1e293b]/50 rounded-2xl text-slate-500 text-xs italic">Hazırlık profili bulunamadı.</div>
                    ) : (
                      <div className="space-y-4">
                        {readinessStates.map(state => (
                          <div key={state.readiness_state_id} className="bg-[#151f32] border border-[#1e293b] rounded-2xl p-5 space-y-3">
                            <div className="flex items-start justify-between">
                              <div>
                                <strong className="text-white text-md block font-bold">
                                  {state.readiness_state === 'ready_to_ship' ? 'Hazır Gönderim' : state.readiness_state}
                                </strong>
                                <span className="text-xs text-slate-400 font-semibold">ID: {state.readiness_state_id}</span>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-800 text-xs text-slate-400">
                              <div>
                                <span className="text-slate-500 block text-[10px] uppercase font-semibold">İşleme Süresi</span>
                                <span className="font-semibold text-slate-300">{state.processing_days_display_label}</span>
                              </div>
                              <div>
                                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Min-Max</span>
                                <span className="font-semibold text-slate-300">{state.min_processing_days}-{state.max_processing_days} Gün</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* TAB 4: ÖZNİTELİKLER (Attributes) */}
        {activeTab === 'oznitelikler' && (
          <div className="space-y-8">
            <div>
              <h3 className="text-lg font-bold text-white mb-1">Listeleme Özellikleri (Attributes)</h3>
              <p className="text-xs text-slate-400">Ürün listeleriniz için varsayılan özellikleri yapılandırın.</p>
              <div className="mt-2 text-[10px] text-amber-500 bg-amber-500/5 border border-amber-500/10 rounded-lg p-2.5">
                Note: Mağazanızın geçerli kategorisi için geçerli olmayan özellikler devre dışı bırakılmıştır. Değerleri korunur ancak geçerli kategoride kullanılamaz.
              </div>
            </div>

            {/* Visual Style */}
            <div className="space-y-4 pt-6 border-t border-[#1e293b]">
              <h4 className="text-sm font-bold text-white tracking-wide">Visual Style</h4>

              <div className="space-y-4">
                {/* Home style */}
                <div className="bg-[#151f32] border border-[#1e293b] rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">Home style</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        name="attribute_home_style_enabled"
                        checked={settings.attribute_home_style_enabled}
                        onChange={handleChange}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500 peer-checked:after:bg-slate-950 peer-checked:after:border-slate-950"></div>
                    </label>
                  </div>
                  {settings.attribute_home_style_enabled && (
                    <select
                      name="attribute_home_style"
                      value={settings.attribute_home_style}
                      onChange={handleChange}
                      className="w-full bg-[#0e1726] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    >
                      <option value="Art deco">Art deco</option>
                      <option value="Boho">Boho</option>
                      <option value="Modern">Modern</option>
                      <option value="Minimalist">Minimalist</option>
                      <option value="Vintage">Vintage</option>
                    </select>
                  )}
                </div>

                {/* Framing (Not applicable) */}
                <div className="bg-[#151f32]/40 border border-[#1e293b]/50 rounded-2xl p-4 flex items-center justify-between opacity-50">
                  <div className="space-y-0.5">
                    <span className="text-xs font-semibold text-slate-400">Framing</span>
                    <span className="text-[10px] text-slate-500 block">(Geçerli kategoride uygulanamaz)</span>
                  </div>
                  <div className="w-9 h-5 bg-slate-900 rounded-full relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-700 after:rounded-full after:h-4 after:w-4"></div>
                </div>

                {/* Orientation (Not applicable) */}
                <div className="bg-[#151f32]/40 border border-[#1e293b]/50 rounded-2xl p-4 flex items-center justify-between opacity-50">
                  <div className="space-y-0.5">
                    <span className="text-xs font-semibold text-slate-400">Orientation</span>
                    <span className="text-[10px] text-slate-500 block">(Geçerli kategoride uygulanamaz)</span>
                  </div>
                  <div className="w-9 h-5 bg-slate-900 rounded-full relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-700 after:rounded-full after:h-4 after:w-4"></div>
                </div>
              </div>
            </div>

            {/* Usage Context */}
            <div className="space-y-4 pt-6 border-t border-[#1e293b]">
              <h4 className="text-sm font-bold text-white tracking-wide">Usage Context</h4>

              <div className="space-y-4">
                {/* Occasion */}
                <div className="bg-[#151f32] border border-[#1e293b] rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">Occasion</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        name="attribute_occasion_enabled"
                        checked={settings.attribute_occasion_enabled}
                        onChange={handleChange}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500 peer-checked:after:bg-slate-950 peer-checked:after:border-slate-950"></div>
                    </label>
                  </div>
                  {settings.attribute_occasion_enabled && (
                    <select
                      name="attribute_occasion"
                      value={settings.attribute_occasion}
                      onChange={handleChange}
                      className="w-full bg-[#0e1726] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    >
                      <option value="Birthday">Birthday</option>
                      <option value="Anniversary">Anniversary</option>
                      <option value="Wedding">Wedding</option>
                      <option value="Housewarming">Housewarming</option>
                    </select>
                  )}
                </div>

                {/* Holiday */}
                <div className="bg-[#151f32] border border-[#1e293b] rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">Holiday</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        name="attribute_holiday_enabled"
                        checked={settings.attribute_holiday_enabled}
                        onChange={handleChange}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500 peer-checked:after:bg-slate-950 peer-checked:after:border-slate-950"></div>
                    </label>
                  </div>
                  {settings.attribute_holiday_enabled && (
                    <select
                      name="attribute_holiday"
                      value={settings.attribute_holiday}
                      onChange={handleChange}
                      className="w-full bg-[#0e1726] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none"
                    >
                      <option value="Valentine's Day">Valentine's Day</option>
                      <option value="Halloween">Halloween</option>
                      <option value="Thanksgiving">Thanksgiving</option>
                      <option value="Christmas">Christmas</option>
                    </select>
                  )}
                </div>

                {/* Room checkboxes with max 5 limit */}
                <div className="bg-[#151f32] border border-[#1e293b] rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#1e293b] pb-2">
                    <span className="text-xs font-semibold text-slate-300">Room</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        name="attribute_room_enabled"
                        checked={settings.attribute_room_enabled}
                        onChange={handleChange}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500 peer-checked:after:bg-slate-950 peer-checked:after:border-slate-950"></div>
                    </label>
                  </div>

                  {settings.attribute_room_enabled && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {ROOM_OPTIONS.map(room => {
                          const isChecked = (settings.attribute_rooms || []).includes(room);
                          return (
                            <label key={room} className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleRoomToggle(room)}
                                className="w-3.5 h-3.5 accent-amber-500 rounded border-slate-700 bg-slate-950"
                              />
                              <span>{room}</span>
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-slate-500">
                        5 seçeneğe kadar seçin (Seçilen: {(settings.attribute_rooms || []).length})
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Product Specs */}
            <div className="space-y-4 pt-6 border-t border-[#1e293b]">
              <h4 className="text-sm font-bold text-white tracking-wide">Product Specs</h4>

              <div className="space-y-4">
                {/* Width */}
                <div className="bg-[#151f32] border border-[#1e293b] rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">Width</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        name="attribute_width_enabled"
                        checked={settings.attribute_width_enabled}
                        onChange={handleChange}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500 peer-checked:after:bg-slate-950 peer-checked:after:bg-slate-950"></div>
                    </label>
                  </div>
                  {settings.attribute_width_enabled && (
                    <div className="flex space-x-2">
                      <input
                        type="number"
                        name="attribute_width"
                        value={settings.attribute_width}
                        onChange={handleChange}
                        className="flex-1 bg-[#0e1726] border border-[#1e293b] rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                      />
                      <select
                        name="attribute_width_unit"
                        value={settings.attribute_width_unit}
                        onChange={handleChange}
                        className="bg-[#0e1726] border border-[#1e293b] rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none"
                      >
                        <option value="Inches">İnç</option>
                        <option value="Centimeters">Cm</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Height */}
                <div className="bg-[#151f32] border border-[#1e293b] rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">Height</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        name="attribute_height_enabled"
                        checked={settings.attribute_height_enabled}
                        onChange={handleChange}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500 peer-checked:after:bg-slate-950 peer-checked:after:bg-slate-950"></div>
                    </label>
                  </div>
                  {settings.attribute_height_enabled && (
                    <div className="flex space-x-2">
                      <input
                        type="number"
                        name="attribute_height"
                        value={settings.attribute_height}
                        onChange={handleChange}
                        className="flex-1 bg-[#0e1726] border border-[#1e293b] rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                      />
                      <select
                        name="attribute_height_unit"
                        value={settings.attribute_height_unit}
                        onChange={handleChange}
                        className="bg-[#0e1726] border border-[#1e293b] rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none"
                      >
                        <option value="Inches">İnç</option>
                        <option value="Centimeters">Cm</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Materials */}
                <div className="bg-[#151f32] border border-[#1e293b] rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-slate-300 block">Materials</span>
                      <span className="text-[10px] text-slate-500 font-medium">
                        {(settings.attribute_materials || []).length === 5 ? 'All 5 selected' : `${(settings.attribute_materials || []).length} selected`}
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        name="attribute_materials_enabled"
                        checked={settings.attribute_materials_enabled}
                        onChange={handleChange}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500 peer-checked:after:bg-slate-950 peer-checked:after:bg-slate-950"></div>
                    </label>
                  </div>
                  {settings.attribute_materials_enabled && (
                    <div className="space-y-3 relative">
                      {/* Searchable Dropdown */}
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Type to search..."
                          value={materialSearch}
                          onFocus={() => setShowMaterialDropdown(true)}
                          onChange={(e) => setMaterialSearch(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const val = materialSearch.trim();
                              if (val) {
                                handleMaterialAdd(val);
                                setMaterialSearch('');
                              }
                            }
                          }}
                          className="w-full bg-[#0e1726] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 pr-10"
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>

                        {showMaterialDropdown && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={() => setShowMaterialDropdown(false)}
                            />
                            <div className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-[#0e1726] border border-[#1e293b] rounded-xl shadow-xl divide-y divide-[#151f32]">
                              {/* Filter standard materials */}
                              {['Canvas', 'Cotton', 'Fabric', 'Paper', 'Wood', 'Glass', 'Metal', 'Leather', 'Ceramic', 'Plastic', 'Stone', 'Ink', 'Cardstock', 'Polyester', 'Bamboo', 'Acrylic', 'Parchment']
                                .filter(mat => !(settings.attribute_materials || []).includes(mat))
                                .filter(mat => mat.toLowerCase().includes(materialSearch.toLowerCase()))
                                .map(mat => (
                                  <div
                                    key={mat}
                                    onClick={() => {
                                      handleMaterialAdd(mat);
                                      setShowMaterialDropdown(false);
                                    }}
                                    className="px-4 py-2.5 text-xs text-slate-300 hover:bg-[#151f32] hover:text-white cursor-pointer"
                                  >
                                    {mat}
                                  </div>
                                ))}
                            </div>
                          </>
                        )}
                      </div>

                      {/* Selected Materials Chips */}
                      {(settings.attribute_materials || []).length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {(settings.attribute_materials || []).map(mat => (
                            <span
                              key={mat}
                              className="inline-flex items-center space-x-1 bg-slate-200 text-slate-800 px-3 py-1.5 rounded-full text-xs font-semibold shadow-sm hover:bg-slate-300 transition-colors"
                            >
                              <span>{mat}</span>
                              <button
                                type="button"
                                onClick={() => handleMaterialToggle(mat)}
                                className="text-slate-500 hover:text-rose-600 font-bold ml-1.5 focus:outline-none flex items-center justify-center"
                                style={{ fontSize: '13px', lineHeight: '10px' }}
                              >
                                &times;
                              </button>
                            </span>
                          ))}
                        </div>
                      )}

                      <p className="text-[10px] text-slate-500">
                        En fazla 13 malzeme ekleyebilirsiniz (Seçilen: {(settings.attribute_materials || []).length}/13)
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: AÇIKLAMA (Description Boilerplate) */}
        {activeTab === 'aciklama' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white mb-1">Sabit Açıklama Şablonu (Boilerplate Description)</h3>
              <p className="text-xs text-slate-400">Tüm ürün listelemelerinin altına otomatik olarak eklenecek sabit metin/açıklama.</p>
            </div>

            <div className="space-y-3 pt-4 border-t border-[#1e293b]">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Sabit Açıklama Yazısı</label>
              <textarea
                name="description_boilerplate"
                value={settings.description_boilerplate}
                onChange={handleChange}
                placeholder="Örn: Kargo ve teslimat süreleri, iade koşulları, çerçeve özellikleri vb. hakkında genel açıklamalarınız..."
                rows={10}
                className="w-full bg-[#151f32] border border-[#1e293b] rounded-2xl px-4 py-4 text-sm text-slate-200 focus:outline-none focus:border-amber-500 font-mono scrollbar-thin"
              />
              <p className="text-[10px] text-slate-500">
                Buraya yazdığınız metin, Etsy'ye yükleme sırasında ürünün yapay zeka tarafından üretilen açıklamasının altına iki boş satır bırakılarak eklenecektir.
              </p>
            </div>
          </div>
        )}

        {/* TAB 6: MAĞAZA BİLGİLERİ (Shop Info / Etsy Metadata Lists) */}
        {activeTab === 'magaza_bilgileri' && (
          <div className="space-y-8">
            <div>
              <h3 className="text-lg font-bold text-white mb-1">Etsy Mağaza Bilgileri</h3>
              <p className="text-xs text-slate-400">Bağlı olan Etsy hesabınıza ait kargo şablonları, mağaza bölümleri ve iade politikalarının listesi.</p>
            </div>

            {!etsyConnected ? (
              <div className="flex items-start space-x-3 bg-amber-500/5 border border-amber-500/10 rounded-xl p-4 text-xs text-slate-400">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <span>Mağaza bilgilerini listelemek için öncelikle Etsy hesabınızı bağlamalısınız.</span>
              </div>
            ) : (
              <div className="space-y-8 pt-4 border-t border-[#1e293b]">
                {/* 1. Shipping profiles */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-amber-500 uppercase tracking-wider flex items-center space-x-1.5">
                    <Truck className="w-3.5 h-3.5" />
                    <span>Kargo Profilleri (Shipping Profiles)</span>
                  </h4>
                  <div className="bg-[#151f32]/60 border border-[#1e293b] rounded-2xl overflow-hidden divide-y divide-slate-800">
                    {shippingProfiles.length === 0 ? (
                      <div className="p-4 text-slate-500 text-xs italic">Kargo profili bulunamadı.</div>
                    ) : (
                      shippingProfiles.map(p => (
                        <div key={p.shipping_profile_id} className="p-4 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-bold text-white block">{p.title}</span>
                            <span className="text-[10px] text-slate-500">ID: {p.shipping_profile_id}</span>
                          </div>
                          <span className="bg-[#0e1726] border border-[#1e293b] px-3 py-1 rounded text-slate-400">
                            {p.processing_min}-{p.processing_max} {p.processing_time_unit}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* 2. Shop sections */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-amber-500 uppercase tracking-wider flex items-center space-x-1.5">
                    <FolderKanban className="w-3.5 h-3.5" />
                    <span>Mağaza Bölümleri (Shop Sections)</span>
                  </h4>
                  <div className="bg-[#151f32]/60 border border-[#1e293b] rounded-2xl overflow-hidden divide-y divide-slate-800">
                    {shopSections.length === 0 ? (
                      <div className="p-4 text-slate-500 text-xs italic">Bölüm bulunamadı.</div>
                    ) : (
                      shopSections.map(s => (
                        <div key={s.shop_section_id} className="p-4 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-bold text-white block">{s.title}</span>
                            <span className="text-[10px] text-slate-500">ID: {s.shop_section_id}</span>
                          </div>
                          <span className="bg-[#0e1726] border border-[#1e293b] px-3 py-1 rounded text-slate-400 font-semibold">
                            {s.active_listing_count} Listeleme
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* 3. Return policies */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-amber-500 uppercase tracking-wider flex items-center space-x-1.5">
                    <Info className="w-3.5 h-3.5" />
                    <span>İade Politikaları (Return Policies)</span>
                  </h4>
                  <div className="bg-[#151f32]/60 border border-[#1e293b] rounded-2xl overflow-hidden divide-y divide-slate-800">
                    {returnPolicies.length === 0 ? (
                      <div className="p-4 text-slate-500 text-xs italic">İade politikası bulunamadı.</div>
                    ) : (
                      returnPolicies.map(p => (
                        <div key={p.return_policy_id} className="p-4 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-bold text-white block">{p.name}</span>
                            <span className="text-[10px] text-slate-500">ID: {p.return_policy_id}</span>
                          </div>
                          <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[10px] font-bold">
                            {p.accepts_returns ? 'İade Kabul Edilir' : 'İade Kabul Edilmez'}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* 4. Readiness states */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-amber-500 uppercase tracking-wider flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Hazırlık Profilleri (Readiness States)</span>
                  </h4>
                  <div className="bg-[#151f32]/60 border border-[#1e293b] rounded-2xl overflow-hidden divide-y divide-slate-800">
                    {readinessStates.length === 0 ? (
                      <div className="p-4 text-slate-500 text-xs italic">Hazırlık profili bulunamadı.</div>
                    ) : (
                      readinessStates.map(r => (
                        <div key={r.readiness_state_id} className="p-4 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-bold text-white block">{r.readiness_state}</span>
                            <span className="text-[10px] text-slate-500">ID: {r.readiness_state_id}</span>
                          </div>
                          <span className="bg-[#0e1726] border border-[#1e293b] px-3 py-1 rounded text-slate-400">
                            {r.processing_days_display_label}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
