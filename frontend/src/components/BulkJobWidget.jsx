import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Loader2, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  X, Ban, PackageCheck, AlertTriangle
} from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

/**
 * Sağ altta duran toplu yükleme durum göstergesi.
 *
 * İşin kendisi sunucuda çalıştığı için bu bileşen yalnızca bir göstergedir:
 * sayfa değiştirmek, F5 atmak veya tarayıcıyı kapatmak işi durdurmaz. Widget
 * her açılışta sunucudaki aktif işleri sorup kaldığı yerden göstermeye devam eder.
 */
export default function BulkJobWidget() {
  const [jobs, setJobs] = useState([]);
  const [expanded, setExpanded] = useState(true);
  const [cancelling, setCancelling] = useState(null);

  useEffect(() => {
    let alive = true;

    const poll = async () => {
      try {
        const res = await axios.get(`${API_BASE}/bulk-jobs`);
        if (alive) setJobs(res.data || []);
      } catch {
        // backend kapalıysa sessizce geç, bir sonraki turda tekrar dener
      }
    };

    poll();
    // çalışan iş varken sık, yokken seyrek yokla
    const id = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const handleCancel = async (jobId) => {
    if (!window.confirm('Bu yükleme işi iptal edilsin mi? Şu ana kadar yüklenenler Etsy\'de kalır.')) return;
    setCancelling(jobId);
    try {
      await axios.post(`${API_BASE}/bulk-jobs/${jobId}/cancel`);
      const res = await axios.get(`${API_BASE}/bulk-jobs`);
      setJobs(res.data || []);
    } catch (err) {
      alert('İptal edilemedi: ' + (err.response?.data?.error || err.message));
    } finally {
      setCancelling(null);
    }
  };

  const handleDismiss = async (jobId) => {
    try {
      await axios.delete(`${API_BASE}/bulk-jobs/${jobId}`);
      setJobs(prev => prev.filter(j => j.id !== jobId));
    } catch (err) {
      console.error('İş kaydı silinemedi:', err);
    }
  };

  if (jobs.length === 0) return null;

  const running = jobs.filter(j => j.status === 'running');

  return (
    <div className="fixed bottom-6 right-6 z-[9998] w-96 max-w-[calc(100vw-3rem)] space-y-3">
      {jobs.map(job => {
        const total = job.total_items || 0;
        const done = job.done_items || 0;
        const failed = job.failed_items || 0;
        const pct = total > 0 ? Math.round(((done + failed) / total) * 100) : 0;
        const isRunning = job.status === 'running';
        const isCancelled = job.status === 'cancelled';

        return (
          <div
            key={job.id}
            className="bg-[#0f172a] border border-[#1e293b] rounded-2xl shadow-2xl overflow-hidden animate-fade-in"
          >
            {/* Başlık */}
            <div className="flex items-center gap-3 p-4">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                isRunning ? 'bg-amber-500/15 text-amber-400'
                : isCancelled ? 'bg-slate-500/15 text-slate-400'
                : failed > 0 ? 'bg-rose-500/15 text-rose-400'
                : 'bg-emerald-500/15 text-emerald-400'
              }`}>
                {isRunning ? <Loader2 className="w-4 h-4 animate-spin" />
                  : isCancelled ? <Ban className="w-4 h-4" />
                  : failed > 0 ? <AlertTriangle className="w-4 h-4" />
                  : <PackageCheck className="w-4 h-4" />}
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-200 truncate">
                  {isRunning ? 'Toplu listing yükleniyor'
                    : isCancelled ? 'İptal edildi'
                    : failed > 0 ? 'Tamamlandı (hatalı var)'
                    : 'Tamamlandı'}
                  {job.config?.dry_run && <span className="ml-1.5 text-[9px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">DENEME</span>}
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {done + failed}/{total} · {job.current_step || '—'}
                </div>
              </div>

              <button
                onClick={() => setExpanded(e => !e)}
                className="text-slate-500 hover:text-slate-300 p-1 shrink-0"
                title={expanded ? 'Daralt' : 'Genişlet'}
              >
                {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>

              {isRunning ? (
                <button
                  onClick={() => handleCancel(job.id)}
                  disabled={cancelling === job.id}
                  className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 shrink-0 disabled:opacity-40"
                >
                  {cancelling === job.id ? '...' : 'İptal'}
                </button>
              ) : (
                <button
                  onClick={() => handleDismiss(job.id)}
                  className="text-slate-500 hover:text-white p-1 shrink-0"
                  title="Kapat"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* İlerleme çubuğu */}
            <div className="px-4 pb-3">
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isCancelled ? 'bg-slate-500'
                      : failed > 0 && !isRunning ? 'bg-rose-500'
                      : isRunning ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                      : 'bg-emerald-500'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-slate-500 mt-1.5 font-semibold">
                <span>%{pct}</span>
                <span>
                  {done > 0 && <span className="text-emerald-400">{done} başarılı</span>}
                  {failed > 0 && <span className="text-rose-400 ml-2">{failed} hatalı</span>}
                </span>
              </div>
            </div>

            {/* Öğe listesi */}
            {expanded && (
              <div className="max-h-56 overflow-y-auto border-t border-[#1e293b] divide-y divide-[#1e293b]/60">
                {job.items?.map(item => (
                  <div key={item.id} className="flex items-center gap-2.5 px-4 py-2 text-[10px]">
                    <span className="shrink-0">
                      {item.status === 'done' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        : item.status === 'error' ? <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        : item.status === 'processing' ? <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                        : item.status === 'cancelled' ? <Ban className="w-3.5 h-3.5 text-slate-500" />
                        : <div className="w-3.5 h-3.5 rounded-full border border-slate-700" />}
                    </span>
                    <span className="text-slate-300 truncate flex-1" title={item.file_name}>
                      {item.file_name}
                    </span>
                    <span className={`shrink-0 text-[9px] ${
                      item.status === 'error' ? 'text-rose-400' : 'text-slate-500'
                    }`} title={item.error || item.step || ''}>
                      {item.status === 'error'
                        ? (item.error || 'Hata').slice(0, 24)
                        : (item.step || '').slice(0, 24)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Kapatma uyarısı */}
            {isRunning && expanded && (
              <div className="px-4 py-2.5 bg-[#0b0f19] border-t border-[#1e293b] text-[9px] text-slate-500 leading-relaxed">
                İşlem sunucuda çalışıyor. Sayfayı değiştirebilir, yenileyebilir veya
                tarayıcıyı kapatabilirsin — yükleme durmaz.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
