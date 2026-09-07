import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  FolderOpen, Images, Rocket, AlertTriangle, RefreshCcw, Sparkles, X
} from 'lucide-react';
import Modal from './Modal';

const API_BASE = 'http://localhost:3001/api';

/**
 * Toplu yükleme / güncelleme başlatıcı.
 *
 * İki mod:
 *   update — seçili listing'ler yerinde yenilenir (ID, URL, yaş, satış korunur)
 *   create — her görsel için yeni listing açılır
 *
 * Görsel seçimi yerel Windows Gezgini penceresiyle yapılır; son kullanılan
 * klasör sunucuda saklanır ve bir sonraki açılışta oradan başlar.
 */
export default function BulkReplaceModal({ open, onClose, onStarted, selectedListings = [] }) {
  const [mode, setMode] = useState('update');
  const [picked, setPicked] = useState(null); // { files[], folder, count }
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);

  const [meta, setMeta] = useState({ sections: [] });
  const [settings, setSettings] = useState({});

  const [config, setConfig] = useState({
    listing_state: 'draft',
    shop_section_id: '',
    auto_section: true,
    dry_run: false
  });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPicked(null);
    setMode(selectedListings.length > 0 ? 'update' : 'create');
    loadMeta();
  }, [open]);

  const loadMeta = async () => {
    try {
      const [sec, st] = await Promise.all([
        axios.get(`${API_BASE}/etsy/shop-sections`).catch(() => ({ data: [] })),
        axios.get(`${API_BASE}/settings`).catch(() => ({ data: {} }))
      ]);
      setMeta({ sections: sec.data || [] });
      setSettings(st.data || {});
    } catch (err) {
      console.error('Etsy meta verileri alınamadı:', err);
    }
  };

  const pick = async (pickMode) => {
    setPicking(true);
    setError(null);
    try {
      const res = await axios.post(`${API_BASE}/bulk-jobs/pick`, { mode: pickMode });
      if (res.data.cancelled) return;

      if (pickMode === 'folder') {
        setPicked({ files: null, folder: res.data.folder, count: res.data.imageCount });
      } else {
        setPicked({ files: res.data.files, folder: res.data.folder, count: res.data.files.length });
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Dosya seçici açılamadı.');
    } finally {
      setPicking(false);
    }
  };

  const imageCount = picked?.count || 0;
  const targetCount = selectedListings.length;
  const effectiveCount = mode === 'update' ? Math.min(imageCount, targetCount) : imageCount;

  const handleStart = async () => {
    if (effectiveCount === 0) return;
    setStarting(true);
    setError(null);

    try {
      const payload = {
        mode,
        config: {
          ...config,
          shipping_profile_id: settings.default_shipping_profile_id,
          return_policy_id: settings.default_return_policy_id,
          readiness_state_id: settings.default_readiness_state_id
        }
      };

      if (picked.files) payload.filePaths = picked.files;
      else payload.sourceFolder = picked.folder;

      if (mode === 'update') {
        payload.targetListingIds = selectedListings.map(l => l.listing_id);
      }

      const res = await axios.post(`${API_BASE}/bulk-jobs`, payload);
      onStarted?.(res.data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'İş başlatılamadı.');
    } finally {
      setStarting(false);
    }
  };

  const missingDefaults = [];
  if (mode === 'create') {
    if (!settings.default_shipping_profile_id) missingDefaults.push('kargo şablonu');
    if (!settings.default_readiness_state_id) missingDefaults.push('hazırlık profili');
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-2xl">
      {/* Başlık */}
      <div className="flex items-center justify-between p-6 border-b border-[#1e293b] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center text-white shadow-lg">
            {mode === 'update' ? <RefreshCcw className="w-5 h-5" /> : <Rocket className="w-5 h-5" />}
          </div>
          <div>
            <h3 className="font-extrabold text-lg text-white font-outfit">
              {mode === 'update' ? 'Listing Güncelle' : 'Yeni Listing Yükle'}
            </h3>
            <p className="text-xs text-slate-400">
              {mode === 'update'
                ? 'Mevcut listing yerinde yenilenir — ID, bağlantı, yaş ve satış geçmişi korunur.'
                : 'Her görsel için yeni bir listing açılır.'}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white p-1">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="overflow-y-auto p-6 space-y-5">

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3.5 text-rose-300 text-xs flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Mod seçimi */}
        <div>
          <label className="block text-slate-300 text-xs font-bold uppercase tracking-wider mb-2.5">
            1. Ne yapılacak
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setMode('update')}
              disabled={targetCount === 0}
              className={`p-4 rounded-xl border text-left transition-colors ${
                targetCount === 0
                  ? 'border-slate-800/50 bg-slate-900/30 opacity-40 cursor-not-allowed'
                  : mode === 'update'
                    ? 'border-amber-500/40 bg-amber-500/5'
                    : 'border-slate-800 bg-[#0b0f19] hover:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <RefreshCcw className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-bold text-slate-200">Mevcutları güncelle</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {targetCount > 0
                  ? `Seçili ${targetCount} listing yenilenir. Mockup, başlık, etiket, açıklama ve bölüm değişir.`
                  : 'Önce tablodan güncellenecek listing seçin.'}
              </p>
            </button>

            <button
              onClick={() => setMode('create')}
              className={`p-4 rounded-xl border text-left transition-colors ${
                mode === 'create'
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-slate-800 bg-[#0b0f19] hover:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Rocket className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-bold text-slate-200">Yeni listing aç</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Her görsel için sıfırdan listing oluşturulur.
              </p>
            </button>
          </div>
        </div>

        {/* Görsel seçimi */}
        <div>
          <label className="block text-slate-300 text-xs font-bold uppercase tracking-wider mb-2.5">
            2. Görseller
          </label>

          <div className="flex gap-3">
            <button
              onClick={() => pick('files')}
              disabled={picking}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[#151f32] hover:bg-slate-800 border border-[#1e293b] text-xs font-semibold text-slate-200 disabled:opacity-40"
            >
              <Images className="w-4 h-4 text-cyan-400" />
              {picking ? 'Pencere açık…' : 'Görsel seç'}
            </button>
            <button
              onClick={() => pick('folder')}
              disabled={picking}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[#151f32] hover:bg-slate-800 border border-[#1e293b] text-xs font-semibold text-slate-200 disabled:opacity-40"
            >
              <FolderOpen className="w-4 h-4 text-amber-400" />
              {picking ? 'Pencere açık…' : 'Klasör seç'}
            </button>
          </div>

          {picking && (
            <p className="text-[11px] text-amber-400 mt-2">
              Windows Gezgini penceresi açıldı — görev çubuğunda arkada kalmış olabilir.
            </p>
          )}

          {picked && (
            <div className="mt-3 bg-[#0b0f19] border border-slate-800 rounded-xl p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-emerald-400">
                    {imageCount} görsel seçildi
                    {picked.files ? ' (tek tek)' : ' (klasörün tamamı)'}
                  </p>
                  <p className="text-[10px] font-mono text-slate-500 truncate mt-0.5" title={picked.folder}>
                    {picked.folder}
                  </p>
                </div>
                <button onClick={() => setPicked(null)} className="text-slate-500 hover:text-slate-300 shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Eşleştirme özeti (güncelleme modu) */}
        {mode === 'update' && picked && (
          <div className={`rounded-xl p-3.5 border text-xs ${
            imageCount === targetCount
              ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'
              : 'bg-amber-500/5 border-amber-500/20 text-amber-300'
          }`}>
            {imageCount === targetCount ? (
              <span>{targetCount} listing, {imageCount} görselle sırayla eşleştirilecek.</span>
            ) : (
              <span>
                {targetCount} listing seçili ama {imageCount} görsel var —
                ilk <strong>{effectiveCount}</strong> tanesi eşleştirilecek, fazlası atlanacak.
              </span>
            )}
          </div>
        )}

        {/* Bölüm */}
        <div>
          <label className="block text-slate-300 text-xs font-bold uppercase tracking-wider mb-2.5">
            3. Mağaza bölümü
          </label>

          <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-800 bg-[#0b0f19] cursor-pointer hover:border-slate-700 mb-2.5">
            <input
              type="checkbox"
              checked={config.auto_section}
              onChange={(e) => setConfig(c => ({ ...c, auto_section: e.target.checked }))}
              className="mt-0.5 w-4 h-4 accent-amber-500 shrink-0"
            />
            <div>
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-purple-400" />
                Bölümü AI seçsin
              </span>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                Mağazandaki {meta.sections.length} bölüm AI'a gönderilir, görsele en uygun olanı seçer.
              </p>
            </div>
          </label>

          {!config.auto_section && (
            <select
              value={config.shop_section_id}
              onChange={(e) => setConfig(c => ({ ...c, shop_section_id: e.target.value }))}
              className="w-full bg-[#0b0f19] border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="">Değiştirme / varsayılan</option>
              {meta.sections.map(s => (
                <option key={s.shop_section_id} value={s.shop_section_id}>{s.title}</option>
              ))}
            </select>
          )}
        </div>

        {/* Yeni listing seçenekleri */}
        {mode === 'create' && (
          <div>
            <label className="block text-slate-300 text-xs font-bold uppercase tracking-wider mb-2.5">
              4. Yayın durumu
            </label>
            <select
              value={config.listing_state}
              onChange={(e) => setConfig(c => ({ ...c, listing_state: e.target.value }))}
              className="w-full bg-[#0b0f19] border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
            >
              <option value="draft">Taslak olarak yükle (önerilen)</option>
              <option value="active">Doğrudan yayına al</option>
            </select>
          </div>
        )}

        {missingDefaults.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 text-amber-300 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Genel Ayarlar'da <strong>{missingDefaults.join(' ve ')}</strong> seçili değil.
              Yeni listing açarken bu gerekli.
            </span>
          </div>
        )}

        <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-800 bg-[#0b0f19] cursor-pointer hover:border-slate-700">
          <input
            type="checkbox"
            checked={config.dry_run}
            onChange={(e) => setConfig(c => ({ ...c, dry_run: e.target.checked }))}
            className="mt-0.5 w-4 h-4 accent-amber-500 shrink-0"
          />
          <div>
            <span className="text-xs font-semibold text-slate-200">Deneme modu</span>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              Mockup ve SEO üretilir ama Etsy'ye hiçbir şey gönderilmez.
              {mode === 'update' && ' Mevcut listing\'lere dokunulmaz.'}
            </p>
          </div>
        </label>
      </div>

      {/* Alt bar */}
      <div className="flex items-center justify-between gap-4 p-6 border-t border-[#1e293b] shrink-0">
        <div className="text-xs text-slate-400">
          {effectiveCount > 0 ? (
            <>
              <strong className="text-amber-400">{effectiveCount}</strong>{' '}
              {mode === 'update' ? 'listing güncellenecek' : 'listing açılacak'}
              {config.dry_run && <span className="text-amber-400 ml-1.5">(deneme)</span>}
            </>
          ) : (
            <span className="text-slate-500">
              {mode === 'update' && targetCount === 0 ? 'Tablodan listing seçin' : 'Görsel seçin'}
            </span>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
          >
            Vazgeç
          </button>
          <button
            onClick={handleStart}
            disabled={starting || effectiveCount === 0}
            className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-rose-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-amber-500/20 disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {starting ? 'Başlatılıyor…' : mode === 'update' ? 'Güncellemeyi Başlat' : 'Yüklemeyi Başlat'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
