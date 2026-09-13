import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  X, Download, Wand2, Loader2, CheckCircle2, AlertCircle, TrendingUp, Receipt, ImageOff,
  ShoppingCart, Coins, Boxes, Trophy, CalendarDays, User, Ruler, Frame, Clock, Tag, Upload, RotateCw
} from 'lucide-react';

import { API_BASE, API_ORIGIN } from '../config';
import { formatMoney, formatDate, variationLabel, stateBadge } from '../utils/orderFormat';

const LOW_STOCK = 5; // 5'in altı düşük stok

const STAGES = {
  'sırada': 'Sırada bekliyor',
  'başlatılıyor': 'Model yükleniyor',
  filtre: 'Desen filtresi uygulanıyor',
  upscale: 'GPU ile büyütülüyor',
  keskinlestirme: 'Keskinleştiriliyor',
  kaydetme: 'Dosya kaydediliyor',
  bitti: 'Hazır'
};

const TONES = {
  gold: 'bg-amber-400/15 text-amber-300 border-amber-400/30',
  amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  sky: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  teal: 'bg-teal-500/10 text-teal-300 border-teal-500/20',
  rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  slate: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
  violet: 'bg-violet-500/10 text-violet-300 border-violet-500/20'
};

const BTN = 'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_PRIMARY = `${BTN} bg-gradient-to-r from-amber-500 to-rose-500 text-white shadow-lg shadow-amber-500/20 hover:brightness-110 disabled:shadow-none`;
const BTN_SUCCESS = `${BTN} bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20 hover:brightness-110`;
const BTN_SECONDARY = `${BTN} border bg-[#151f32] border-[#1e293b] text-slate-100 hover:bg-[#1e293b]`;

// Görselin oranı, mağazanın varyasyon profillerindeki en yakın orana yuvarlanır
// (1643x957 -> 12:7). Profiller gelene kadar uygulamanın varsayılan oranları.
const DEFAULT_RATIOS = ['2:3', '3:2', '1:1', '12:7', '7:12', '12:5', '1:2'];
function ratioLabel(w, h, ratios) {
  const r = w / h;
  let best = null;
  for (const label of (ratios?.length ? ratios : DEFAULT_RATIOS)) {
    const [a, b] = label.split(':').map(Number);
    const d = Math.abs(Math.log(r / (a / b))); // logaritmik: 2:3 ile 3:2 simetrik
    if (!best || d < best.d) best = { label, d };
  }
  return best.label;
}

function shipInfo(order, item) {
  const status = String(order.status).toLowerCase();
  if (order.state === 'canceled' || status === 'canceled') return { label: 'Gönderim yok (iptal)', tone: 'slate' };
  if (status === 'fully refunded') return { label: 'Gönderim yok (iade)', tone: 'slate' };
  if (item.is_digital) return { label: 'Dijital teslim', tone: 'violet' };
  if (order.is_delivered) return { label: 'Teslim edildi', tone: 'teal' };
  if (order.is_shipped || item.shipped_at) return { label: 'Kargolandı', tone: 'sky' };
  if (!item.expected_ship_date) return null;
  const ms = item.expected_ship_date * 1000 - Date.now();
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const span = d ? `${d} gün ${h} saat` : `${h} saat`;
  if (ms < 0) return { label: `${span} gecikti`, tone: 'rose' };
  return { label: `${span} kaldı`, tone: ms < 2 * 86400000 ? 'amber' : 'emerald' };
}

function Card({ icon: Icon, title, children }) {
  return (
    <section className="bg-[#0e1726] border border-[#1e293b] rounded-2xl px-4 py-3">
      <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
        <Icon className="w-4 h-4 text-amber-500" />
        {title}
      </h3>
      <div className="divide-y divide-[#1e293b]">{children}</div>
    </section>
  );
}

function Row({ icon: Icon, label, children, sub }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="flex items-center gap-2 text-xs text-slate-400 shrink-0 pt-0.5">
        <Icon className="w-3.5 h-3.5 text-slate-500" />
        {label}
      </span>
      <div className="text-right min-w-0">
        <div className="text-sm font-semibold text-slate-100 break-words">{children}</div>
        {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

const Pill = ({ tone, children }) => (
  <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-md border ${TONES[tone]}`}>{children}</span>
);

const ErrorLine = ({ children }) => (
  <p className="flex items-start gap-1.5 text-[11px] text-rose-300"><AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />{children}</p>
);

function PerformanceCard({ insights, error }) {
  if (error) {
    return <Card icon={TrendingUp} title="Ürün Performansı"><p className="py-3 text-xs text-rose-300">{error}</p></Card>;
  }
  if (!insights) {
    return (
      <Card icon={TrendingUp} title="Ürün Performansı">
        <div className="py-6 flex items-center justify-center text-xs text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin text-amber-500 mr-2" /> Satış geçmişi hesaplanıyor...
        </div>
      </Card>
    );
  }
  const variantStock = insights.stock?.variant ?? null;
  const sameDay = insights.first_sale_at && insights.last_sale_at &&
    formatDate(insights.first_sale_at, false) === formatDate(insights.last_sale_at, false);
  return (
    <Card icon={TrendingUp} title="Ürün Performansı">
      {insights.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 py-2">
          {insights.tags.map(t => (
            <Pill key={t.label} tone={t.tone}>{t.tone === 'gold' && <Trophy className="w-3 h-3 mr-1" />}{t.label}</Pill>
          ))}
        </div>
      )}
      <Row icon={ShoppingCart} label="Satış adedi">{insights.units_sold} adet</Row>
      <Row icon={Coins} label="Toplam kazanç" sub="Kupon ve iadeler düşülmüş">{formatMoney(insights.revenue)}</Row>
      {/* Stok: satın alınan boyut+çerçeve varyantının adedi */}
      <Row icon={Boxes} label="Stok" sub={insights.stock ? null : 'Envanter okunamadı'}>
        {variantStock === null ? '—' : (
          <Pill tone={variantStock < LOW_STOCK ? 'rose' : 'emerald'}>
            {variantStock} adet{variantStock < LOW_STOCK ? ' · düşük' : ''}
          </Pill>
        )}
      </Row>
      {/* Sıra satış adedine göre; kazançtaki yeri ayrıca gösterilir */}
      <Row
        icon={Trophy}
        label="Satış sıralaması"
        sub={insights.rank_revenue ? `Kazançta #${insights.rank_revenue} / ${insights.ranked_listings}` : null}
      >
        {insights.rank_units ? `#${insights.rank_units} / ${insights.ranked_listings}` : '—'}
      </Row>
      <Row
        icon={CalendarDays}
        label="İlk satış"
        sub={insights.last_sale_at && !sameDay ? `Son satış: ${formatDate(insights.last_sale_at, false)}` : null}
      >
        {insights.first_sale_at ? formatDate(insights.first_sale_at, false) : '—'}
      </Row>
    </Card>
  );
}

function OrderCard({ order, item }) {
  const ship = shipInfo(order, item);
  const unitNet = item.price && item.coupon_discount
    ? { value: item.price.value - item.coupon_discount.value / item.quantity, currency: item.price.currency }
    : null;
  const find = (key) => item.variations.find(v => variationLabel(v.name) === key)?.value;
  const size = find('Boyut');
  const frame = find('Çerçeve');
  const others = item.variations.filter(v => !['Boyut', 'Çerçeve'].includes(variationLabel(v.name)));

  return (
    <Card icon={Receipt} title="Sipariş Bilgisi">
      <Row
        icon={Tag}
        label="Ürün fiyatı"
        sub={[
          unitNet && `%${Math.round((1 - unitNet.value / item.price.value) * 100)} kupon indirimi`,
          item.quantity > 1 && `× ${item.quantity} adet`
        ].filter(Boolean).join(' · ') || null}
      >
        {unitNet ? <><span className="line-through text-slate-500 font-normal mr-1.5">{formatMoney(item.price)}</span>{formatMoney(unitNet)}</> : formatMoney(item.price)}
      </Row>
      <Row icon={User} label="Alıcı">{order.customer_name || '—'}</Row>
      {item.is_digital ? (
        <Row icon={Ruler} label="Tür"><Pill tone="violet">Dijital</Pill></Row>
      ) : item.variations.length === 0 ? (
        <Row icon={Ruler} label="Tür"><Pill tone="amber">Özel Sipariş</Pill></Row>
      ) : (
        <>
          <Row icon={Ruler} label="Boyut">{size || '—'}</Row>
          <Row icon={Frame} label="Çerçeve">{frame || '—'}</Row>
          {others.map(v => <Row key={v.name} icon={Tag} label={v.name}>{v.value}</Row>)}
        </>
      )}
      <Row
        icon={Clock}
        label="Gönderim"
        sub={item.expected_ship_date && !order.is_shipped && !order.is_delivered && ship?.tone !== 'slate'
          ? `Son gönderim: ${formatDate(item.expected_ship_date, false)}` : null}
      >
        {ship ? <Pill tone={ship.tone}>{ship.label}</Pill> : '—'}
      </Row>
    </Card>
  );
}

// Dosya Explorer'dan silinmiş olabilir: indirmeden önce hâlâ yerinde olduğunu doğrula,
// yoksa tarayıcı JSON hata sayfasına gitmesin.
async function guardedDownload(url, stillThere, onMissing) {
  if (await stillThere().catch(() => false)) window.location.href = url;
  else onMissing();
}

const statusOf = (item, shopId) => axios
  .get(`${API_BASE}/upscale/status`, { params: { listing_id: item.listing_id, shop_id: shopId } })
  .then(r => r.data);

/** Kaynak görsel varsa indir; yoksa kullanıcı tanıtsın (yükle). */
function SourceAction({ item, shopId, onUploaded, onSourceMissing }) {
  const inputRef = useRef(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { setError(null); setProgress(null); }, [item.transaction_id, item.source]);

  if (item.source === 'local') {
    return (
      <button
        onClick={() => guardedDownload(
          `${API_BASE}/orders/listing/${item.listing_id}/source`,
          async () => (await statusOf(item, shopId)).status !== 'unavailable',
          onSourceMissing
        )}
        className={BTN_SECONDARY}
      >
        <Download className="w-4 h-4" /> Orijinal görseli indir
      </button>
    );
  }

  const upload = async (file) => {
    if (!file) return;
    setError(null);
    setProgress(0);
    const form = new FormData();
    form.append('title', item.title || '');
    form.append('image', file);
    try {
      const r = await axios.post(`${API_BASE}/orders/listing/${item.listing_id}/source`, form, {
        params: { shop_id: shopId },
        onUploadProgress: (e) => e.total && setProgress(Math.round((e.loaded / e.total) * 100))
      });
      onUploaded(r.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Görsel yüklenemedi.');
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-1.5">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={e => upload(e.target.files?.[0])}
      />
      <button onClick={() => inputRef.current?.click()} disabled={progress !== null} className={BTN_SECONDARY}>
        {progress !== null
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Yükleniyor %{progress}</>
          : <><Upload className="w-4 h-4" /> Görseli yükle</>}
      </button>
      <p className="text-[11px] text-slate-500">
        {item.source === 'missing'
          ? 'Bu ürünün kaynak görseli diskte bulunamadı.'
          : 'Bu listing uygulamada kayıtlı değil.'} Yüklediğiniz dosya mağazanın uploads klasörüne kopyalanıp ürüne bağlanır.
      </p>
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}

function ConfirmReupscale({ scale, onDownload, onForce, onCancel }) {
  // Esc yalnızca bu pencereyi kapatsın, arkadaki sipariş penceresini değil
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="alertdialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative w-full max-w-md bg-[#0e1726] border border-[#1e293b] rounded-2xl p-5 shadow-2xl animate-fade-in">
        <h3 className="text-base font-bold text-white font-outfit">Upscale edilmiş hali var</h3>
        <p className="text-sm text-slate-400 mt-1.5">
          Bu görselin {scale}x upscale edilmiş hali zaten mevcut. Yine de yeniden upscale etmek ister misiniz?
        </p>
        <div className="mt-5 space-y-2">
          <button onClick={onDownload} className={BTN_SUCCESS}><Download className="w-4 h-4" /> Upscale edilmiş görseli indir</button>
          <button onClick={onForce} className={BTN_SECONDARY}><RotateCw className="w-4 h-4" /> Yine de upscale et</button>
          <button onClick={onCancel} className="w-full text-xs text-slate-500 hover:text-slate-300 py-1.5">Vazgeç</button>
        </div>
      </div>
    </div>
  );
}

function UpscalePanel({ item, dims, shopId, onSourceMissing }) {
  const [config, setConfig] = useState(null);
  const [job, setJob] = useState(null);
  const [starting, setStarting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const hasSource = item.source === 'local';

  useEffect(() => {
    axios.get(`${API_BASE}/upscale/config`).then(r => setConfig(r.data)).catch(() => setConfig({ enabled: false }));
  }, []);

  const listingId = item.listing_id;
  const refresh = useCallback(async () => {
    const s = await statusOf({ listing_id: listingId }, shopId);
    // Kaynak dosya bu arada diskten silindiyse "yükle" moduna geç
    if (s.status === 'unavailable') onSourceMissing();
    setJob(s);
    return s;
  }, [listingId, shopId, onSourceMissing]);

  useEffect(() => {
    setJob(null);
    setError(null);
    setConfirming(false);
    if (hasSource) refresh().catch(() => {});
    // yalnızca ürün/kaynak değişince yeniden sor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSource, item.transaction_id, item.source_image_path]);

  // Sürerken saniyede bir durum sor
  useEffect(() => {
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return undefined;
    const t = setTimeout(() => refresh().catch(() => {}), 1000);
    return () => clearTimeout(t);
  }, [job, refresh]);

  const start = async (force = false) => {
    setConfirming(false);
    setStarting(true);
    setError(null);
    try {
      const r = await axios.post(`${API_BASE}/upscale`, { listing_id: item.listing_id, shop_id: shopId, force });
      setJob(r.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Upscale başlatılamadı.');
    } finally {
      setStarting(false);
    }
  };

  // Upscale edilmiş hali varsa önce sor
  const onUpscaleClick = async () => {
    const s = await refresh().catch(() => null);
    if (s?.status === 'done') setConfirming(true);
    else if (s?.status !== 'queued' && s?.status !== 'running') start(false);
  };

  const download = () => guardedDownload(
    `${API_BASE}/upscale/download?listing_id=${item.listing_id}&shop_id=${shopId}`,
    async () => (await refresh()).status === 'done',
    () => { setConfirming(false); setError('Upscale edilmiş dosya bulunamadı (silinmiş olabilir). Yeniden upscale edebilirsiniz.'); }
  );

  const scale = config?.scale || 6;
  const outDims = dims ? `${dims.w * scale}×${dims.h * scale}` : null;
  const engine = config?.engine_label ? ` · ${config.engine_label}` : '';
  const disabledReason = !hasSource
    ? 'Upscale için önce kaynak görseli yükleyin.'
    : config && !config.enabled ? 'Upscale motoru yapılandırılmamış (backend .env).' : null;

  if (job?.status === 'queued' || job?.status === 'running') {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-2 text-amber-300 font-semibold">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {STAGES[job.stage] || job.stage}
          </span>
          <span className="text-slate-300 font-mono">%{job.progress}</span>
        </div>
        <div className="h-2.5 rounded-full bg-[#151f32] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-rose-500 transition-[width] duration-700 ease-out"
            style={{ width: `${job.progress}%` }}
          />
        </div>
        <div className="text-[11px] text-slate-500">
          {scale}x · {Math.round(job.elapsed_ms / 1000)} sn geçti{outDims ? ` · çıktı ${outDims}` : ''}{engine}
        </div>
      </div>
    );
  }

  const done = job?.status === 'done';
  return (
    <div className="space-y-2">
      {done && (
        <>
          <div className="flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle2 className="w-4 h-4" /> {scale}x upscale hazır{outDims ? ` · ${outDims}` : ''}
          </div>
          <button onClick={download} className={BTN_SUCCESS}><Download className="w-4 h-4" /> Upscale görselini indir</button>
        </>
      )}
      <button
        onClick={onUpscaleClick}
        disabled={Boolean(disabledReason) || starting || !config}
        className={done ? BTN_SECONDARY : BTN_PRIMARY}
      >
        {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
        {job?.status === 'error' ? 'Tekrar dene' : `Görseli ${scale}x upscale et`}
      </button>
      {(error || job?.error) && <ErrorLine>{error || job.error}</ErrorLine>}
      {disabledReason && hasSource && <p className="text-[11px] text-slate-500">{disabledReason}</p>}
      {confirming && (
        <ConfirmReupscale
          scale={scale}
          onDownload={() => { setConfirming(false); download(); }}
          onForce={() => start(true)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

export default function OrderDetail({ order, onClose, onListingUpdated }) {
  const [idx, setIdx] = useState(0);
  // Yükleme / silinmiş kaynak gibi yerel değişiklikler, listing bazında: kaynak görsel
  // siparişe değil listinge bağlı (liste de onListingUpdated ile güncellenir)
  const [overrides, setOverrides] = useState({});
  const base = order.items[idx];
  const item = { ...base, ...(overrides[base.listing_id] || {}) };
  const [dims, setDims] = useState(null);
  const [insights, setInsights] = useState(null);
  const [insightsError, setInsightsError] = useState(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    setInsights(null);
    setInsightsError(null);
    axios.get(`${API_BASE}/orders/listing/${item.listing_id}/insights`, {
      params: { product_id: item.etsy_product_id, shop_id: order.shop_id }
    })
      .then(r => { if (alive) setInsights(r.data); })
      .catch(err => { if (alive) setInsightsError(err.response?.data?.error || 'Satış geçmişi alınamadı.'); });
    return () => { alive = false; };
  }, [item.listing_id, item.etsy_product_id, order.shop_id]);

  const patchItem = useCallback((patch) => {
    const lid = base.listing_id;
    setOverrides(o => ({ ...o, [lid]: { ...(o[lid] || {}), ...patch } }));
    onListingUpdated?.(lid, patch);
  }, [base.listing_id, onListingUpdated]);

  const onSourceMissing = useCallback(() => {
    if (item.source === 'local') patchItem({ source: 'missing', source_image_path: null });
  }, [item.source, patchItem]);

  const imageSrc = item.source === 'local' ? `${API_ORIGIN}/${item.source_image_path}` : item.etsy_image_full_url;
  useEffect(() => { setDims(null); }, [imageSrc]);
  const badge = stateBadge(order);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Yükseklik ekrana sabitlenir; içerik yalnızca çok küçük ekranlarda kayar */}
      <div className="relative w-full max-w-6xl max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden bg-[#0b1220] border border-[#1e293b] rounded-3xl shadow-2xl animate-fade-in">
        {/* Başlık */}
        <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-3 border-b border-[#1e293b]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-white font-outfit">Sipariş #{order.receipt_id}</h2>
              {badge && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${badge.cls}`}>{badge.label}</span>}
            </div>
            <p className="text-xs text-slate-400 truncate" title={item.title}>{formatDate(order.created_at)} · {item.title}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Birden çok ürünlü siparişte ürün seçici */}
            {order.items.length > 1 && order.items.map((it, i) => (
              <button
                key={it.transaction_id}
                onClick={() => setIdx(i)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${i === idx
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : 'text-slate-400 border-[#1e293b] hover:text-slate-200'}`}
              >
                Ürün {i + 1}
              </button>
            ))}
            <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/60" aria-label="Kapat">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto grid lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-5 p-5">
          {/* Sol: orijinal görsel + işlemler; sağ sütunun yüksekliğinde dikey ortalı */}
          <div className="flex flex-col justify-center gap-3">
            <div className="rounded-2xl border border-[#1e293b] bg-[#070b14] p-3">
              <div className="flex items-center justify-center min-h-[240px]">
                {imageSrc ? (
                  <img
                    key={imageSrc}
                    src={imageSrc}
                    alt={item.title || ''}
                    onLoad={e => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                    onError={onSourceMissing}
                    className="max-h-[54vh] max-w-full w-auto h-auto object-contain rounded-lg shadow-2xl shadow-black/60"
                  />
                ) : (
                  <div className="flex flex-col items-center text-slate-600 text-xs gap-2"><ImageOff className="w-8 h-8" />Görsel yok</div>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 mt-2 text-[11px] text-slate-500">
                <span>{item.source === 'local' ? 'Orijinal kaynak görsel' : 'Etsy listing görseli (kaynak görsel yok)'}</span>
                {dims && <span className="font-mono">{dims.w}×{dims.h} · {ratioLabel(dims.w, dims.h, insights?.variation_ratios)}</span>}
              </div>
            </div>

            <SourceAction
              item={item}
              shopId={order.shop_id}
              onUploaded={(d) => patchItem({ source: 'local', source_image_path: d.source_image_path, product_id: d.product_id })}
              onSourceMissing={onSourceMissing}
            />

            <UpscalePanel
              item={item}
              dims={item.source === 'local' ? dims : null}
              shopId={order.shop_id}
              onSourceMissing={onSourceMissing}
            />
          </div>

          {/* Sağ: dikey kartlar */}
          <div className="space-y-3">
            <PerformanceCard insights={insights} error={insightsError} />
            <OrderCard order={order} item={item} />
          </div>
        </div>
      </div>
    </div>
  );
}
