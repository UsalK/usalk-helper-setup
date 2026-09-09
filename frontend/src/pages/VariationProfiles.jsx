import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  ArrowLeft, Plus, Trash2, Save, Grid, CheckCircle, 
  HelpCircle, Sparkles, AlertTriangle, Layers, RefreshCw, X
} from 'lucide-react';
import RECOMMENDED_DATA from './recommended_data.json';
import { filterActiveProfiles, isSetProfile } from '../utils/profileFlags';
import { buildPriceColumns, columnPriceOf, setColumnPrice } from '../utils/frameGroups';

const API_BASE = 'http://localhost:3001/api';

const DEFAULT_PROFILES = filterActiveProfiles([
  { id: 'ratio_2_3', name: '2:3 Oranı (Dikey)', ratio: '2:3' },
  { id: 'ratio_3_2', name: '3:2 Oranı (Yatay)', ratio: '3:2' },
  { id: 'ratio_1_1', name: '1:1 Oranı (Kare)', ratio: '1:1' },
  { id: 'ratio_12_7', name: '12:7 Oranı (Geniş)', ratio: '12:7' },
  { id: 'ratio_7_12', name: '7:12 Oranı (Uzun)', ratio: '7:12' },
  { id: 'ratio_12_5', name: '12:5 Oranı (Panoramik)', ratio: '12:5' },
  { id: 'ratio_1_2', name: '1:2 Oranı (Uzun Panoramik)', ratio: '1:2' },
  {
    id: 'set_of_2_1_2',
    name: 'Set of 2 (1:2) — İkili Panel',
    ratio: '1:2x2',
    kind: 'set',
    panel_count: 2,
    panel_ratio: '1:2'
  },
  {
    id: 'set_of_2_2_3',
    name: 'Set of 2 (2:3) — İkili Panel',
    ratio: '2:3x2',
    kind: 'set',
    panel_count: 2,
    panel_ratio: '2:3'
  }
]);

// Önerilen boyut/fiyat tablosunda profilin hangi anahtarla arandığı.
// Set profilleri kendi ID'leriyle, tek panelli profiller oranlarıyla eşleşir.
const recommendedKey = (profile) =>
  isSetProfile(profile) ? profile.id : profile.ratio;

export default function VariationProfiles() {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);
  
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('list'); // 'list' | 'editor'
  const [editorTab, setEditorTab] = useState('settings'); // 'settings' | 'upload'
  const [uploadFiles, setUploadFiles] = useState([]); // Selected files for custom draft upload
  const [isUploading, setIsUploading] = useState(false);

  // Editor states for active ratio
  const [sizes, setSizes] = useState([]);
  const [newSize, setNewSize] = useState('');
  
  const [frames, setFrames] = useState([]);
  const [newFrame, setNewFrame] = useState('');

  // "Uyumlu Mockup Odaları" arayüzü kaldırıldı. Değer yine de okunup geri
  // yazılır: eskiden elle eşlenmiş şablonlar kaydetmede sessizce düşmesin.
  // Şablon eşleşmesi artık Şablon Stüdyosu'ndaki "Uyumlu Oranlar" ile yapılır.
  const [selectedTemplateIds, setSelectedTemplateIds] = useState([]);
  
  // Matrix prices: { "size_frame": price }
  const [priceMap, setPriceMap] = useState({});
  
  // Bulk tool
  const [bulkBasePrice, setBulkBasePrice] = useState('35');
  const [bulkFrameAddon, setBulkFrameAddon] = useState('50');

  // Fiyat matrisinde çerçeveleri tek sütunda toplama tercihi (profil başına)
  const [priceGrouping, setPriceGrouping] = useState('none');

  // Yeni varyasyon oluşturma
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', w: '', h: '', kind: 'single', panelCount: 2 });

  // Listede hem koddaki varsayılan profiller hem de kullanıcının kendi
  // oluşturdukları görünür. Varsayılanlar veritabanında varsa oradaki
  // (sayaçları dolu) kayıt kullanılır.
  const allProfiles = [
    ...DEFAULT_PROFILES.map(def => profiles.find(p => p.id === def.id) || def),
    ...profiles.filter(p => !DEFAULT_PROFILES.some(d => d.id === p.id))
  ];

  useEffect(() => {
    fetchProfiles();
  }, []);

  const fetchProfiles = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/variations`);
      const active = filterActiveProfiles(res.data);
      setProfiles(active);
      return active;
    } catch (err) {
      console.error('Profiller yüklenemedi:', err);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const handleEditRatio = (profile) => {
    setSelectedProfile(profile);
    setSizes(profile.sizes || []);
    setFrames(profile.frames || []);
    setSelectedTemplateIds(profile.template_ids || []);
    
    // Convert array combinations back to map
    const map = {};
    if (profile.combinations) {
      profile.combinations.forEach(c => {
        map[`${c.size}_${c.frame}`] = c.price;
      });
    }
    setPriceMap(map);
    setPriceGrouping(profile.price_grouping === 'frames' ? 'frames' : 'none');
    setEditorTab('settings');
    setUploadFiles([]);
    setIsUploading(false);
    setView('editor');
  };

  const loadRecommendedSizesAndFrames = () => {
    const key = recommendedKey(selectedProfile);
    const config = RECOMMENDED_DATA[key];
    if (config) {
      setSizes(config.sizes);
      setFrames(config.frames);
    }
  };

  const isRecommendedConfig = () => {
    if (!selectedProfile) return false;
    const key = recommendedKey(selectedProfile);
    const config = RECOMMENDED_DATA[key];
    if (!config) return false;
    
    const sizeSet = new Set(sizes);
    const frameSet = new Set(frames);
    const recSizeSet = new Set(config.sizes);
    const recFrameSet = new Set(config.frames);
    
    if (sizeSet.size !== recSizeSet.size || frameSet.size !== recFrameSet.size) return false;
    for (let s of sizeSet) {
      if (!recSizeSet.has(s)) return false;
    }
    for (let f of frameSet) {
      if (!recFrameSet.has(f)) return false;
    }
    return true;
  };

  const loadRecommendedPrices = () => {
    const key = recommendedKey(selectedProfile);
    const config = RECOMMENDED_DATA[key];
    if (config && config.prices) {
      const newMap = { ...priceMap };
      sizes.forEach(s => {
        frames.forEach(f => {
          const key = `${s}_${f}`;
          if (config.prices[key] !== undefined) {
            newMap[key] = config.prices[key];
          }
        });
      });
      setPriceMap(newMap);
    }
  };

  // Size additions and deletions
  const handleAddSize = (e) => {
    e.preventDefault();
    const size = newSize.trim().toLowerCase();
    if (!size) return;
    if (sizes.includes(size)) {
      setNewSize('');
      return;
    }
    setSizes([...sizes, size]);
    setNewSize('');
  };

  const handleRemoveSize = (size) => {
    setSizes(sizes.filter(s => s !== size));
    
    // Clean priceMap
    const updatedMap = { ...priceMap };
    frames.forEach(f => {
      delete updatedMap[`${size}_${f}`];
    });
    setPriceMap(updatedMap);
  };

  // Frame additions and deletions
  const handleAddFrame = (e) => {
    e.preventDefault();
    const frame = newFrame.trim();
    if (!frame) return;
    if (frames.includes(frame)) {
      setNewFrame('');
      return;
    }
    setFrames([...frames, frame]);
    setNewFrame('');
  };

  const handleRemoveFrame = (frame) => {
    setFrames(frames.filter(f => f !== frame));
    
    // Clean priceMap
    const updatedMap = { ...priceMap };
    sizes.forEach(s => {
      delete updatedMap[`${s}_${frame}`];
    });
    setPriceMap(updatedMap);
  };

  // Bulk price fill matrix tool
  const applyBulkPricing = () => {
    const base = Number(bulkBasePrice) || 0;
    const addon = Number(bulkFrameAddon) || 0;

    const newMap = { ...priceMap };
    sizes.forEach(s => {
      frames.forEach(f => {
        const isRoll = f.toLowerCase().includes('roll') || f.toLowerCase().includes('çerçevesiz') || f.toLowerCase().includes('canvas');
        newMap[`${s}_${f}`] = isRoll ? base : base + addon;
      });
    });

    setPriceMap(newMap);
  };

  const handleSave = async () => {
    if (sizes.length === 0 || frames.length === 0) {
      alert('Lütfen en az bir boyut ve çerçeve ekleyin.');
      return;
    }

    // Convert map to combos array
    const combinations = [];
    sizes.forEach(s => {
      frames.forEach(f => {
        combinations.push({
          size: s,
          frame: f,
          price: priceMap[`${s}_${f}`] || 0
        });
      });
    });

    const payload = {
      ...selectedProfile,
      sizes,
      frames,
      combinations,
      // "Uyumlu Mockup Odaları" arayüzü kaldırıldı; mevcut değer olduğu gibi
      // korunur ki eskiden elle eklenen şablonlar sessizce düşmesin.
      template_ids: selectedTemplateIds,
      price_grouping: priceGrouping
    };

    setLoading(true);
    try {
      await axios.put(`${API_BASE}/variations/${selectedProfile.id}`, payload);
      setView('list');
      fetchProfiles();
    } catch (err) {
      console.error(err);
      alert('Kaydedilirken hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Kendi varyasyonunu oluşturma                                        */
  /* ------------------------------------------------------------------ */

  /** Varsayılan (kod içinde tanımlı) profiller silinemez. */
  const isBuiltIn = (id) => DEFAULT_PROFILES.some(d => d.id === id);

  const handleCreateProfile = async (e) => {
    e.preventDefault();

    const name = draft.name.trim();
    const w = Number(draft.w);
    const h = Number(draft.h);
    const isSet = draft.kind === 'set';
    const panelCount = Math.max(2, Number(draft.panelCount) || 2);

    if (!name) return alert('Varyasyon için bir ad girin.');
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return alert('Oran için iki pozitif sayı girin (örn. 4 ve 5).');
    }

    const panelRatio = `${w}:${h}`;
    const ratio = isSet ? `${panelRatio}x${panelCount}` : panelRatio;

    // Aynı oran anahtarına sahip iki profil olursa görselden otomatik profil
    // seçimi hangisini kullanacağını bilemez.
    if (allProfiles.some(p => p.ratio === ratio)) {
      return alert(`"${ratio}" oranında bir varyasyon zaten var. Önce onu düzenleyin ya da farklı bir oran girin.`);
    }

    const id = `custom_${w}_${h}${isSet ? `x${panelCount}` : ''}_${Date.now().toString(36)}`;

    setCreating(true);
    try {
      await axios.post(`${API_BASE}/variations`, {
        id,
        name,
        ratio,
        sizes: [],
        frames: [],
        combinations: [],
        template_ids: [],
        kind: isSet ? 'set' : 'single',
        panel_count: isSet ? panelCount : 1,
        panel_ratio: panelRatio,
        price_grouping: 'none'
      });

      setShowCreate(false);
      setDraft({ name: '', w: '', h: '', kind: 'single', panelCount: 2 });
      const list = await fetchProfiles();
      const created = (list || []).find(p => p.id === id);
      if (created) handleEditRatio(created);
    } catch (err) {
      console.error(err);
      alert('Varyasyon oluşturulamadı: ' + (err.response?.data?.error || err.message));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteProfile = async (profile) => {
    if (!confirm(`"${profile.name}" varyasyonu silinecek. Bu profile bağlı ürünler oran eşleşmesini kaybeder. Devam edilsin mi?`)) return;
    try {
      await axios.delete(`${API_BASE}/variations/${profile.id}`);
      fetchProfiles();
    } catch (err) {
      console.error(err);
      alert('Silinemedi: ' + (err.response?.data?.error || err.message));
    }
  };

  /* ------------------------------------------------------------------ */
  /* Gruplu fiyat matrisi                                                */
  /* ------------------------------------------------------------------ */

  const isGrouped = priceGrouping === 'frames';
  const priceColumns = buildPriceColumns(frames, isGrouped);
  const groupedColumn = priceColumns.find(c => c.grouped);

  const handleColumnPriceChange = (size, column, value) => {
    setPriceMap(prev => setColumnPrice(prev, size, column, value));
  };

  /**
   * Gruplama açılırken, çerçeve fiyatları birbirinden farklıysa ilk çerçevenin
   * fiyatı hepsine yayılır; böylece sütun tek bir değer gösterebilir.
   */
  const enableGrouping = () => {
    const columns = buildPriceColumns(frames, true);
    setPriceMap(prev => {
      let next = prev;
      sizes.forEach(size => {
        columns.filter(c => c.grouped).forEach(column => {
          if (columnPriceOf(next, size, column) === null) {
            next = setColumnPrice(next, size, column, next[`${size}_${column.frames[0]}`] || 0);
          }
        });
      });
      return next;
    });
    setPriceGrouping('frames');
  };

  const handleCustomDraftUpload = async () => {
    if (uploadFiles.length === 0) return;
    
    setIsUploading(true);
    const formData = new FormData();
    uploadFiles.forEach((file) => {
      formData.append('mockups', file);
    });
    formData.append('profileId', selectedProfile.id);
    
    try {
      const res = await axios.post(`${API_BASE}/etsy/upload-custom-draft`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      if (res.data.success) {
        alert('Taslak ürün Etsy\'ye başarıyla yüklendi! ID: ' + res.data.listing_id);
        setUploadFiles([]);
        setView('list');
      } else {
        alert('Yükleme başarısız oldu.');
      }
    } catch (err) {
      console.error(err);
      const errMsg = err.response?.data?.error || err.message;
      alert('Hata oluştu: ' + errMsg);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 animate-fade-in">
      {view === 'list' ? (
        <>
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Oran Bazlı Varyasyon Ayarları</h2>
              <p className="text-slate-400 text-sm mt-0.5">Her oran için ayrı sayfalarda boyut, çerçeve ve fiyat şablonlarını yönetin.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex items-center space-x-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-3 px-5 rounded-xl shadow-lg shadow-amber-500/10 transition-colors shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Yeni Varyasyon</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {allProfiles.map(defProf => {
              const profile = profiles.find(p => p.id === defProf.id);
              const totalSizes = profile?.sizes?.length || 0;
              const totalFrames = profile?.frames?.length || 0;
              const totalCombos = profile?.combinations?.length || 0;
              const custom = !isBuiltIn(defProf.id);

              return (
                <div 
                  key={defProf.id} 
                  className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-6 flex flex-col justify-between hover:border-amber-500/20 transition-all group"
                >
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-12 h-12 rounded-xl bg-slate-900 border border-[#334155] flex flex-col items-center justify-center font-bold text-white text-md leading-none">
                        <span>{String(defProf.ratio).split('x')[0]}</span>
                        {isSetProfile(defProf) && (
                          <span className="text-[9px] text-amber-500 font-bold mt-0.5">
                            ×{defProf.panel_count || 2}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${custom ? 'text-amber-500' : 'text-slate-500'}`}>
                          {custom ? 'Kendi Varyasyonun' : (isSetProfile(defProf) ? 'Özel Set' : 'Oran Sayfası')}
                        </span>
                        {custom && (
                          <button
                            type="button"
                            onClick={() => handleDeleteProfile(defProf)}
                            title="Bu varyasyonu sil"
                            className="text-slate-600 hover:text-rose-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <h3 className="text-lg font-bold text-white group-hover:text-amber-500 transition-colors mb-4">
                      {defProf.name}
                    </h3>

                    <div className="space-y-2.5 text-xs text-slate-400">
                      <div className="flex justify-between">
                        <span>Aktif Boyutlar:</span>
                        <strong className="text-slate-200">{totalSizes} adet</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Çerçeve Seçeneği:</span>
                        <strong className="text-slate-200">{totalFrames} adet</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Fiyat Girilmiş:</span>
                        <strong className="text-slate-200">{totalCombos} kombinasyon</strong>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleEditRatio(profile || defProf)}
                    className="w-full text-center text-xs font-semibold py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl mt-6 border border-[#334155] transition-colors"
                  >
                    Varyasyon Ayarlarını Düzenle
                  </button>
                </div>
              );
            })}
          </div>

          {/* Yeni varyasyon oluşturma */}
          {showCreate && (
            <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <form
                onSubmit={handleCreateProfile}
                className="bg-[#0e1726] border border-[#1e293b] rounded-3xl w-full max-w-md p-6 space-y-5 shadow-2xl"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-white">Yeni Varyasyon</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Kendi oranınızı tanımlayın. Boyut, çerçeve ve fiyatları sonraki adımda girersiniz.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    className="p-1.5 text-slate-500 hover:text-white rounded-lg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ad</label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Örn: 4:5 Oranı (Dikey)"
                    className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Oran</label>
                  <div className="flex items-center space-x-3">
                    <input
                      type="number" min="1" step="1"
                      value={draft.w}
                      onChange={(e) => setDraft({ ...draft, w: e.target.value })}
                      placeholder="4"
                      className="w-24 bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 text-center focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-slate-500 font-bold">:</span>
                    <input
                      type="number" min="1" step="1"
                      value={draft.h}
                      onChange={(e) => setDraft({ ...draft, h: e.target.value })}
                      placeholder="5"
                      className="w-24 bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 text-center focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-[11px] text-slate-500">
                      genişlik : yükseklik
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tip</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'single', label: 'Tek Panel' },
                      { key: 'set', label: 'Çok Panelli Set' }
                    ].map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setDraft({ ...draft, kind: opt.key })}
                        className={`py-2.5 px-4 border rounded-xl font-semibold text-xs transition-all ${
                          draft.kind === opt.key
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                            : 'bg-[#151f32] border-[#1e293b] text-slate-400'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {draft.kind === 'set' && (
                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Panel Sayısı</label>
                    <input
                      type="number" min="2" max="6" step="1"
                      value={draft.panelCount}
                      onChange={(e) => setDraft({ ...draft, panelCount: e.target.value })}
                      className="w-24 bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 text-center focus:outline-none focus:border-amber-500"
                    />
                    <p className="text-[10px] text-slate-500">
                      Girdiğiniz oran <strong className="text-slate-400">panel başına</strong> geçerlidir.
                    </p>
                  </div>
                )}

                <div className="p-3 bg-[#151f32] border border-[#1e293b] rounded-xl">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Oluşacak oran anahtarı</span>
                  <p className="text-sm font-bold text-amber-500 mt-0.5 tabular-nums">
                    {draft.w && draft.h
                      ? `${draft.w}:${draft.h}${draft.kind === 'set' ? `x${draft.panelCount}` : ''}`
                      : '—'}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                    Bu anahtar Şablon Stüdyosu'ndaki "Uyumlu Oranlar" listesinde ve
                    görselden otomatik profil eşleşmesinde kullanılır.
                  </p>
                </div>

                <div className="flex space-x-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold border border-[#334155]"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 text-sm font-bold"
                  >
                    {creating ? 'Oluşturuluyor…' : 'Oluştur ve Düzenle'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </>
      ) : (
        // Ratio Sub-page Editor view
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                type="button"
                onClick={() => setView('list')}
                className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl transition-colors border border-[#334155]"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">
                  {isSetProfile(selectedProfile)
                    ? `${selectedProfile.name} Ayarları`
                    : `${selectedProfile.ratio} Oranı Ayarları`}
                </h2>
                <p className="text-slate-400 text-sm mt-0.5">
                  {isSetProfile(selectedProfile)
                    ? `Panel başına ${selectedProfile.panel_ratio || '1:2'} · ${selectedProfile.panel_count || 2} panel · Boyutlar panel başınadır.`
                    : 'Boyut, Çerçeve, Mockup Şablonları ve Fiyatlandırma.'}
                </p>
              </div>
            </div>

            {editorTab === 'settings' && (
              <button
                type="button"
                onClick={handleSave}
                disabled={loading}
                className="flex items-center space-x-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold py-3.5 px-6 rounded-xl shadow-lg shadow-amber-500/10 transition-colors"
              >
                <Save className="w-5 h-5" />
                <span>Ayarları Kaydet</span>
              </button>
            )}
          </div>

          {isSetProfile(selectedProfile) && (
            <div className="flex space-x-4 border-b border-[#1e293b] pb-2">
              <button
                type="button"
                onClick={() => setEditorTab('settings')}
                className={`pb-1 text-sm font-bold border-b-2 transition-all ${
                  editorTab === 'settings'
                    ? 'border-amber-500 text-amber-500'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                Varyasyon & Fiyat Ayarları
              </button>
              <button
                type="button"
                onClick={() => setEditorTab('upload')}
                className={`pb-1 text-sm font-bold border-b-2 transition-all ${
                  editorTab === 'upload'
                    ? 'border-amber-500 text-amber-500'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                Özel Dosya Yükle (Etsy Taslak)
              </button>
            </div>
          )}

          {editorTab === 'upload' ? (
            <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-8 space-y-6 max-w-2xl mx-auto animate-fade-in">
              <div className="text-center space-y-2">
                <h3 className="text-lg font-bold text-white">Özel Dosya Yükleme ({selectedProfile.name})</h3>
                <p className="text-slate-400 text-xs">
                  Mockup görsellerini manuel yükleyin. Bu işlem başlık, açıklama ve etiketler olmadan, sadece bu varyasyon şablonunu ve fiyatlarını kullanarak doğrudan Etsy'ye <strong>taslak (draft)</strong> olarak yükler.
                </p>
              </div>

              <div className="border-2 border-dashed border-[#1e293b] rounded-2xl p-8 text-center hover:border-amber-500/40 transition-colors relative cursor-pointer">
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={(e) => {
                    const files = Array.from(e.target.files);
                    setUploadFiles(prev => [...prev, ...files]);
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  disabled={isUploading}
                />
                <Plus className="w-10 h-10 text-slate-500 mx-auto mb-2" />
                <span className="text-sm text-slate-300 font-semibold block">
                  Mockup Görsellerini Seçin veya Sürükleyin
                </span>
                <span className="text-[10px] text-slate-500 block mt-1">
                  Birden fazla görsel seçebilirsiniz
                </span>
              </div>

              {uploadFiles.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-400 border-b border-[#1e293b] pb-2">
                    <span>Seçilen Görseller ({uploadFiles.length})</span>
                    <button
                      type="button"
                      onClick={() => setUploadFiles([])}
                      className="text-rose-500 hover:text-rose-400"
                      disabled={isUploading}
                    >
                      Tümünü Temizle
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 max-h-[220px] overflow-y-auto pr-1">
                    {uploadFiles.map((file, idx) => (
                      <div key={idx} className="bg-[#151f32] border border-[#1e293b] rounded-xl p-2.5 flex items-center justify-between">
                        <div className="flex items-center space-x-2.5 truncate">
                          <div className="w-10 h-10 rounded bg-slate-950 overflow-hidden flex-shrink-0">
                            <img
                              src={URL.createObjectURL(file)}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <span className="text-xs text-slate-300 truncate max-w-[120px]">{file.name}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setUploadFiles(prev => prev.filter((_, i) => i !== idx))}
                          className="text-slate-500 hover:text-rose-500"
                          disabled={isUploading}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-[#1e293b] flex justify-end">
                <button
                  type="button"
                  onClick={handleCustomDraftUpload}
                  disabled={isUploading || uploadFiles.length === 0}
                  className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold py-3.5 px-8 rounded-xl transition-all shadow-lg shadow-amber-500/10 flex items-center space-x-2"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>Etsy'ye Yükleniyor...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      <span>Taslak Olarak Etsy'ye Gönder</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left side: Sizes & Frames Management */}
              <div className="space-y-6 lg:col-span-1">
                
                {/* Sizes Management */}
                <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-6 space-y-4">
                  <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                    <Grid className="w-4 h-4 text-amber-500" />
                    <span>Boyut Yönetimi (Sizes)</span>
                  </h3>
                  
                  <form onSubmit={handleAddSize} className="flex space-x-2">
                    <input
                      type="text"
                      value={newSize}
                      onChange={(e) => setNewSize(e.target.value)}
                      placeholder="Örn: 8x12 veya 10x15"
                      className="flex-1 bg-[#151f32] border border-[#1e293b] rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    />
                    <button
                      type="submit"
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-[#334155] px-3.5 rounded-xl text-xs font-semibold"
                    >
                      Ekle
                    </button>
                  </form>

                  <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                    {sizes.map(s => (
                      <div key={s} className="flex items-center justify-between bg-[#151f32] border border-[#1e293b] px-3.5 py-2 rounded-xl text-xs">
                        <span className="text-slate-300 font-semibold uppercase">{s}</span>
                        <button 
                          type="button" 
                          onClick={() => handleRemoveSize(s)}
                          className="text-slate-500 hover:text-rose-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {sizes.length === 0 && (
                      <div className="text-center py-4 text-slate-600 text-xs italic">
                        Henüz boyut girilmemiş.
                      </div>
                    )}
                  </div>
                </div>

                {/* Frames Management */}
                <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-6 space-y-4">
                  <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                    <Grid className="w-4 h-4 text-amber-500" />
                    <span>Çerçeve Yönetimi (Frames)</span>
                  </h3>
                  
                  <form onSubmit={handleAddFrame} className="flex space-x-2">
                    <input
                      type="text"
                      value={newFrame}
                      onChange={(e) => setNewFrame(e.target.value)}
                      placeholder="Örn: Roll veya Siyah Çerçeve"
                      className="flex-1 bg-[#151f32] border border-[#1e293b] rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    />
                    <button
                      type="submit"
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-[#334155] px-3.5 rounded-xl text-xs font-semibold"
                    >
                      Ekle
                    </button>
                  </form>

                  <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                    {frames.map(f => (
                      <div key={f} className="flex items-center justify-between bg-[#151f32] border border-[#1e293b] px-3.5 py-2 rounded-xl text-xs">
                        <span className="text-slate-300 font-semibold">{f}</span>
                        <button 
                          type="button" 
                          onClick={() => handleRemoveFrame(f)}
                          className="text-slate-500 hover:text-rose-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {frames.length === 0 && (
                      <div className="text-center py-4 text-slate-600 text-xs italic">
                        Henüz çerçeve seçeneği girilmemiş.
                      </div>
                    )}
                  </div>
                </div>

              </div>

              {/* Right side: Dynamic Price Matrix grid */}
              <div className="lg:col-span-2 space-y-6">
                {sizes.length > 0 && frames.length > 0 ? (
                  <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-6 space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#1e293b]">
                      <div>
                        <h3 className="text-md font-semibold text-white">Oran Fiyat Matrisi</h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {isGrouped
                            ? 'Çerçeveli seçenekler tek sütunda; Roll ve Stretched Wood kendi fiyatlarında kalır.'
                            : 'Boyut ve çerçeve kesişim fiyatlarını girin.'}
                        </p>
                        <label className="flex items-center space-x-2 mt-2 cursor-pointer w-fit">
                          <input
                            type="checkbox"
                            checked={isGrouped}
                            onChange={(e) => (e.target.checked ? enableGrouping() : setPriceGrouping('none'))}
                            className="w-3.5 h-3.5 accent-amber-500 rounded cursor-pointer"
                          />
                          <span className="text-[11px] text-slate-300 font-semibold">Çerçeveleri grupla</span>
                          <span className="text-[10px] text-slate-500">
                            ({frames.length} → {buildPriceColumns(frames, true).length} sütun)
                          </span>
                        </label>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {isRecommendedConfig() && (
                          <button
                            type="button"
                            onClick={loadRecommendedPrices}
                            className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-bold px-4.5 py-3 rounded-xl shadow-lg shadow-emerald-500/10 flex items-center space-x-1.5 transition-all transform hover:scale-[1.02]"
                          >
                            <Sparkles className="w-4 h-4" />
                            <span>Önerilen Fiyatları Ekle</span>
                          </button>
                        )}

                        {/* Bulk Matrix Fills */}
                        <div className="flex items-center space-x-2 bg-[#151f32] border border-[#1e293b] rounded-xl p-2.5">
                          <div className="w-24">
                            <label className="text-[9px] text-slate-500 uppercase font-bold block mb-0.5">Taban Fiyat</label>
                            <input
                              type="number"
                              value={bulkBasePrice}
                              onChange={(e) => setBulkBasePrice(e.target.value)}
                              className="w-full bg-[#0e1726] border border-[#1e293b] rounded px-1.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                            />
                          </div>
                          <div className="w-24">
                            <label className="text-[9px] text-slate-500 uppercase font-bold block mb-0.5">Çerçeve Farkı</label>
                            <input
                              type="number"
                              value={bulkFrameAddon}
                              onChange={(e) => setBulkFrameAddon(e.target.value)}
                              className="w-full bg-[#0e1726] border border-[#1e293b] rounded px-1.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={applyBulkPricing}
                            className="bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold px-3 py-2 rounded-lg self-end"
                          >
                            Matrisi Doldur
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse min-w-[500px]">
                        <thead>
                          <tr className="border-b border-[#1e293b] text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                            <th className="py-3 px-4">Boyut / Çerçeve</th>
                            {priceColumns.map(col => (
                              <th key={col.key} className="py-3 px-4">
                                {col.label}
                                {col.grouped && (
                                  <span className="block text-[9px] text-amber-500/70 font-medium normal-case tracking-normal">
                                    {col.frames.length} çerçeve birlikte
                                  </span>
                                )}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#1e293b]">
                          {sizes.map(s => (
                            <tr key={s} className="text-xs hover:bg-[#151f32]/10">
                              <td className="py-3 px-4 text-slate-200 font-bold uppercase">{s}</td>
                              {priceColumns.map(col => {
                                const common = columnPriceOf(priceMap, s, col);
                                return (
                                  <td key={col.key} className="py-2 px-4">
                                    <div className="relative flex items-center w-28">
                                      <span className="absolute left-2.5 text-slate-500">$</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={common === null ? '' : (common || '')}
                                        onChange={(e) => handleColumnPriceChange(s, col, e.target.value)}
                                        placeholder={common === null ? 'farklı' : '0'}
                                        title={col.grouped ? col.frames.join(', ') : col.label}
                                        className={`w-full bg-[#151f32] border rounded-lg pl-6 pr-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 ${
                                          common === null ? 'border-amber-500/40' : 'border-[#1e293b]'
                                        }`}
                                      />
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#0e1726]/40 border border-dashed border-[#1e293b] rounded-2xl p-12 text-center text-slate-600 flex flex-col items-center justify-center space-y-4">
                    <Sparkles className="w-10 h-10 text-amber-500 animate-pulse" />
                    <div>
                      <h4 className="text-sm font-bold text-slate-300">Önerilen Şablonu Kullanın</h4>
                      <p className="text-xs leading-normal text-slate-500 mt-1 max-w-md mx-auto">
                        Yeni açılan mağazalar için ana mağazada kullanılan dikey/yatay/kare oranlarına özel hazır boyut ve çerçeve şablonlarını tek tıkla yükleyebilirsiniz.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={loadRecommendedSizesAndFrames}
                      className="bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold px-6 py-3 rounded-xl transition-all shadow-lg shadow-amber-500/10 flex items-center space-x-1.5 transform hover:scale-[1.02]"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Önerilen Boyut ve Çerçeveleri Ekle</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
