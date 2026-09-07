import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { HardDrive, Trash2, RefreshCw, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

const CATEGORY_META = {
  live: {
    label: 'Yüklenmiş ürünler',
    hint: 'Etsy/Shopify’a yüklenmiş ürünlerin mockup’ları. Görseller mağazada duruyor, yerel kopyaya gerek yok.',
    accent: 'emerald',
    defaultOn: true
  },
  orphan: {
    label: 'Sahipsiz klasörler',
    hint: 'Veritabanında karşılığı kalmamış mockup klasörleri. Silinen ürünlerden artakalmış.',
    accent: 'amber',
    defaultOn: true
  },
  draft: {
    label: 'Taslak ürünler',
    hint: 'Henüz yüklenmemiş ürünlerin mockup’ları. Silersen yeniden üretmen gerekir.',
    accent: 'rose',
    defaultOn: false
  }
};

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function StorageCleanup() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [selected, setSelected] = useState(
    Object.fromEntries(Object.entries(CATEGORY_META).map(([k, v]) => [k, v.defaultOn]))
  );
  const [useAgeFilter, setUseAgeFilter] = useState(false);
  const [olderThanDays, setOlderThanDays] = useState(30);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE}/storage/mockup-stats`);
      setStats(res.data);
    } catch (err) {
      console.error('Mockup istatistikleri alınamadı:', err);
      setError(err.response?.data?.error || 'İstatistikler alınamadı. Backend çalışıyor mu?');
    } finally {
      setLoading(false);
    }
  };

  const activeCategories = Object.keys(selected).filter(k => selected[k]);

  const buildPayload = (dryRun) => ({
    categories: activeCategories,
    olderThanDays: useAgeFilter ? Number(olderThanDays) : null,
    dryRun
  });

  const runPreview = async () => {
    if (activeCategories.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await axios.post(`${API_BASE}/storage/mockup-cleanup`, buildPayload(true));
      setPreview(res.data);
      setConfirmOpen(true);
    } catch (err) {
      console.error('Önizleme başarısız:', err);
      setError(err.response?.data?.error || 'Önizleme alınamadı.');
    } finally {
      setBusy(false);
    }
  };

  const runCleanup = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await axios.post(`${API_BASE}/storage/mockup-cleanup`, buildPayload(false));
      setResult(res.data);
      setConfirmOpen(false);
      setPreview(null);
      await fetchStats();
    } catch (err) {
      console.error('Temizlik başarısız:', err);
      setError(err.response?.data?.error || 'Temizlik sırasında hata oluştu.');
    } finally {
      setBusy(false);
    }
  };

  const totals = stats?.totals;

  return (
    <div className="p-8 max-w-5xl mx-auto animate-fade-in">
      <div className="mb-8 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2 font-outfit flex items-center gap-3">
            <HardDrive className="w-7 h-7 text-amber-500" />
            Depolama Temizliği
          </h1>
          <p className="text-slate-400 text-sm max-w-2xl">
            Üretilmiş mockup görselleri disk alanının büyük kısmını kaplar. Bu araç <span className="text-slate-200 font-semibold">yalnızca mockup dosyalarını</span> siler.
          </p>
        </div>
        <button
          onClick={fetchStats}
          disabled={loading || busy}
          className="shrink-0 flex items-center gap-2 text-xs font-semibold py-2.5 px-4 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-[#1e293b] text-slate-300 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Yeniden Tara
        </button>
      </div>

      {/* Koruma bildirimi */}
      <div className="mb-8 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-5 flex gap-4">
        <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <div className="text-xs leading-relaxed">
          <p className="text-emerald-300 font-semibold mb-1.5">Ham görsellerin korunuyor</p>
          <p className="text-slate-400">
            Bu araç <code className="text-slate-200 bg-slate-800/70 px-1.5 py-0.5 rounded">mockups</code> klasörlerinin dışına hiçbir koşulda çıkmaz.
            Şu klasörlere <span className="text-slate-200 font-semibold">dokunulmaz</span>:
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {(stats?.protectedDirs || ['uploads', 'upscaled', 'templates', 'theme', 'exports', 'digital_files']).map(d => (
              <span key={d} className="text-[10px] font-mono bg-slate-800/70 text-slate-300 px-2 py-1 rounded-md border border-slate-700/50">
                {d}/
              </span>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-rose-300 text-sm flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <div className="mb-6 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-emerald-300 text-sm flex items-center gap-3">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>
            <strong>{result.deletedFiles}</strong> mockup dosyası silindi, <strong>{formatBytes(result.freedBytes)}</strong> yer açıldı
            {result.deletedFolders > 0 && ` (${result.deletedFolders} boş klasör kaldırıldı)`}.
            {result.errors?.length > 0 && ` ${result.errors.length} dosya atlandı.`}
          </span>
        </div>
      )}

      {/* Özet kartları */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-[#0f172a] rounded-2xl border border-slate-800 p-5">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">Toplam Mockup</div>
          <div className="text-2xl font-bold text-white font-outfit">{loading ? '…' : formatBytes(totals?.all.bytes)}</div>
          <div className="text-[11px] text-slate-500 mt-1">{totals?.all.files || 0} dosya · {totals?.all.folders || 0} ürün</div>
        </div>
        {Object.entries(CATEGORY_META).map(([key, meta]) => {
          const t = totals?.[key];
          const colors = {
            emerald: 'text-emerald-400',
            amber: 'text-amber-400',
            rose: 'text-rose-400'
          };
          return (
            <div key={key} className="bg-[#0f172a] rounded-2xl border border-slate-800 p-5">
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">{meta.label}</div>
              <div className={`text-2xl font-bold font-outfit ${colors[meta.accent]}`}>
                {loading ? '…' : formatBytes(t?.bytes)}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">{t?.files || 0} dosya · {t?.folders || 0} ürün</div>
            </div>
          );
        })}
      </div>

      {/* Seçim paneli */}
      <div className="bg-[#0f172a] rounded-2xl border border-slate-800 p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl pointer-events-none"></div>

        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-5">Silinecekleri Seç</h2>

        <div className="space-y-3 mb-6">
          {Object.entries(CATEGORY_META).map(([key, meta]) => {
            const t = totals?.[key];
            const disabled = !t || t.folders === 0;
            return (
              <label
                key={key}
                className={`flex items-start gap-3 p-4 rounded-xl border transition-colors cursor-pointer ${
                  disabled
                    ? 'border-slate-800/50 bg-slate-900/30 opacity-50 cursor-not-allowed'
                    : selected[key]
                      ? 'border-amber-500/30 bg-amber-500/5'
                      : 'border-slate-800 bg-[#0b0f19] hover:border-slate-700'
                }`}
              >
                <input
                  type="checkbox"
                  checked={!!selected[key] && !disabled}
                  disabled={disabled}
                  onChange={(e) => setSelected(s => ({ ...s, [key]: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-amber-500 shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-200">{meta.label}</span>
                    <span className="text-[11px] text-slate-500">
                      {t?.folders || 0} ürün · {formatBytes(t?.bytes)}
                    </span>
                    {key === 'draft' && (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                        Dikkat
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{meta.hint}</p>
                </div>
              </label>
            );
          })}
        </div>

        <label className="flex items-center gap-3 mb-6 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={useAgeFilter}
            onChange={(e) => setUseAgeFilter(e.target.checked)}
            className="w-4 h-4 accent-amber-500"
          />
          <span>Sadece</span>
          <input
            type="number"
            min="1"
            value={olderThanDays}
            disabled={!useAgeFilter}
            onChange={(e) => setOlderThanDays(e.target.value)}
            className="w-20 bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-amber-500 disabled:opacity-40"
          />
          <span>günden eski mockup’ları sil</span>
        </label>

        <div className="flex items-center gap-3 pt-5 border-t border-slate-800">
          <button
            onClick={runPreview}
            disabled={busy || loading || activeCategories.length === 0 || !totals?.all.folders}
            className="flex items-center gap-2 text-xs font-bold py-3 px-6 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 text-white shadow-lg shadow-amber-500/20 hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none"
          >
            <Trash2 className="w-4 h-4" />
            {busy ? 'Hesaplanıyor…' : 'Temizliği Hesapla'}
          </button>
          <span className="text-[11px] text-slate-500">
            Silmeden önce ne kadar yer açılacağını gösterir.
          </span>
        </div>
      </div>

      {/* Onay penceresi */}
      {confirmOpen && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6">
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 p-7 max-w-lg w-full shadow-2xl">
            <h3 className="text-lg font-bold text-white font-outfit mb-2 flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Silme Onayı
            </h3>

            {preview.deletedFiles === 0 ? (
              <p className="text-slate-400 text-sm mb-6">
                Seçilen filtrelere uyan mockup dosyası bulunamadı. Silinecek bir şey yok.
              </p>
            ) : (
              <>
                <p className="text-slate-400 text-sm mb-5">
                  Aşağıdakiler kalıcı olarak silinecek. Bu işlem geri alınamaz.
                </p>
                <div className="bg-[#0b0f19] rounded-xl border border-slate-800 p-4 space-y-2.5 mb-5">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Mockup dosyası</span>
                    <span className="text-slate-200 font-bold">{preview.deletedFiles}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Ürün klasörü</span>
                    <span className="text-slate-200 font-bold">{preview.affectedFolders}</span>
                  </div>
                  <div className="flex justify-between text-sm pt-2.5 border-t border-slate-800">
                    <span className="text-slate-500">Açılacak alan</span>
                    <span className="text-emerald-400 font-bold">{formatBytes(preview.freedBytes)}</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mb-6 leading-relaxed">
                  Ham görsellerin (<code className="text-slate-300">uploads/</code>, <code className="text-slate-300">UPSCALED/</code>)
                  ve şablonların etkilenmez.
                </p>
              </>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setConfirmOpen(false); setPreview(null); }}
                disabled={busy}
                className="flex-1 text-xs font-semibold py-3 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-[#1e293b] text-slate-300 transition-colors disabled:opacity-40"
              >
                Vazgeç
              </button>
              {preview.deletedFiles > 0 && (
                <button
                  onClick={runCleanup}
                  disabled={busy}
                  className="flex-1 text-xs font-bold py-3 rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 text-white shadow-lg shadow-rose-500/20 hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {busy ? 'Siliniyor…' : 'Evet, Sil'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* En büyük klasörler */}
      {stats?.items?.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4">En Çok Yer Kaplayanlar</h2>
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 overflow-hidden">
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#0b0f19] sticky top-0">
                  <tr className="text-slate-500 uppercase tracking-wider text-[10px]">
                    <th className="text-left font-bold px-4 py-3">Ürün</th>
                    <th className="text-left font-bold px-4 py-3">Durum</th>
                    <th className="text-right font-bold px-4 py-3">Dosya</th>
                    <th className="text-right font-bold px-4 py-3">Boyut</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.items.slice(0, 50).map(it => (
                    <tr key={it.relPath} className="border-t border-slate-800/50 hover:bg-slate-800/20">
                      <td className="px-4 py-2.5 text-slate-300 max-w-xs truncate">
                        {it.title || <span className="text-slate-600 font-mono text-[10px]">{it.productId}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                          it.category === 'live' ? 'text-emerald-400 bg-emerald-500/10'
                          : it.category === 'orphan' ? 'text-amber-400 bg-amber-500/10'
                          : 'text-slate-400 bg-slate-500/10'
                        }`}>
                          {CATEGORY_META[it.category]?.label || it.category}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-400">{it.files}</td>
                      <td className="px-4 py-2.5 text-right text-slate-300 font-semibold">{formatBytes(it.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
