import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  Check, Copy, ExternalLink, Loader2, AlertCircle, ShieldCheck,
  Globe, Store, Truck, Sparkles, PartyPopper, ChevronRight, RefreshCw, SkipForward
} from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

const STEPS = [
  { id: 'hosts', title: 'Alan Adı & Etsy App', icon: Globe, hint: 'hosts dosyası ve API bilgileri' },
  { id: 'shop', title: 'Mağaza Bağlantısı', icon: Store, hint: 'Etsy hesabınıza yetki verin' },
  { id: 'profiles', title: 'Satış Profilleri', icon: Truck, hint: 'kargo, iade ve işleme süresi' },
  { id: 'ai', title: 'Yapay Zekâ Anahtarı', icon: Sparkles, hint: 'OpenRouter API key' },
  { id: 'done', title: 'Hazır', icon: PartyPopper, hint: 'kuruluma son verin' }
];

/** Tıklanınca panoya kopyalayan, kopyalandığını 2 saniye gösteren buton. */
function CopyButton({ value, label = 'Kopyala' }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Panoya erişim reddedilirse (izin yok / güvensiz köken) gizli bir
      // textarea üzerinden eski yöntemle kopyalıyoruz.
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors shrink-0 ${
        copied
          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
          : 'bg-[#151f32] hover:bg-[#1e293b] text-slate-300 border border-[#1e293b]'
      }`}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Kopyalandı' : label}
    </button>
  );
}

function Field({ label, children, hint }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-semibold text-slate-400">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

const inputClass =
  'w-full bg-[#0b0f19] border border-[#1e293b] rounded-xl px-3 py-2.5 text-xs text-slate-200 ' +
  'placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50 transition-colors';

function ErrorBox({ message }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3 py-2.5">
      <AlertCircle size={14} className="text-rose-400 mt-0.5 shrink-0" />
      <p className="text-[11px] text-rose-300 leading-relaxed">{message}</p>
    </div>
  );
}

export default function SetupWizard({ onFinish, onShopChange }) {
  const [status, setStatus] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Adım 1
  const [domain, setDomain] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [hostsConfirmed, setHostsConfirmed] = useState(false);

  // Adım 2
  const [polling, setPolling] = useState(false);

  // Adım 3
  const [shippingChoice, setShippingChoice] = useState('');
  const [returnChoice, setReturnChoice] = useState('');
  const [readinessChoice, setReadinessChoice] = useState('');
  const [newShipping, setNewShipping] = useState({
    title: 'Standart Gönderim',
    origin_country_iso: 'TR',
    primary_cost: 0,
    secondary_cost: 0,
    min_processing_time: 1,
    max_processing_time: 3,
    destination_region: 'none',
    min_delivery_days: 5,
    max_delivery_days: 12
  });
  const [newReturn, setNewReturn] = useState({
    accepts_returns: true,
    accepts_exchanges: false,
    return_deadline: 30
  });
  const [newReadiness, setNewReadiness] = useState({
    readiness_state: 'made_to_order',
    min_processing_time: 1,
    max_processing_time: 3,
    processing_time_unit: 'days'
  });

  // Adım 4
  const [openRouterKey, setOpenRouterKey] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/setup/status`);
      setStatus(res.data);
      if (res.data.selectedDomain && !domain) setDomain(res.data.selectedDomain);
      if (res.data.hostsConfirmed) setHostsConfirmed(true);
      return res.data;
    } catch (err) {
      setError('Kurulum durumu okunamadı. Backend çalışıyor mu?');
      return null;
    }
  }, [domain]);

  useEffect(() => {
    loadStatus().then(s => {
      if (!s) return;
      // Kullanıcıyı ilk tamamlanmamış adıma bırak, baştan başlatma.
      const order = ['hosts', 'shop', 'profiles', 'ai'];
      const firstOpen = order.findIndex(k => !s.steps?.[k]);
      setStepIndex(firstOpen === -1 ? 4 : firstOpen);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OAuth penceresi açıkken bağlantıyı yokla.
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const id = setInterval(async () => {
      const s = await loadStatus();
      if (!cancelled && s?.shopConnected) {
        setPolling(false);
        onShopChange?.();
        setStepIndex(2);
      }
    }, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [polling, loadStatus, onShopChange]);

  // Profil adımına gelindiğinde mevcut kayıtları varsayılan seçim yap.
  useEffect(() => {
    if (!status) return;
    if (!shippingChoice && status.shippingProfiles?.length) {
      setShippingChoice(String(status.defaults?.default_shipping_profile_id || status.shippingProfiles[0].shipping_profile_id));
    }
    if (!returnChoice && status.returnPolicies?.length) {
      setReturnChoice(String(status.defaults?.default_return_policy_id || status.returnPolicies[0].return_policy_id));
    }
    if (!readinessChoice && status.readinessStates?.length) {
      const first = status.readinessStates[0];
      setReadinessChoice(String(status.defaults?.default_readiness_state_id || first.readiness_state_id || ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const selectedDomainInfo = status?.domains?.find(d => d.domain === domain) || null;

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const data = err.response?.data;
      setError(data?.error || data?.message || err.message || 'Beklenmeyen bir hata oluştu.');
    } finally {
      setBusy(false);
    }
  };

  const saveStep1 = () => run(async () => {
    await axios.post(`${API_BASE}/setup/env/etsy`, {
      domain,
      client_id: clientId,
      client_secret: clientSecret,
      hostsConfirmed
    });
    await loadStatus();
    setStepIndex(1);
  });

  const connectShop = () => run(async () => {
    const res = await axios.get(`${API_BASE}/etsy/auth-url`);
    const w = 600, h = 700;
    window.open(
      res.data.url,
      'Etsy OAuth',
      `width=${w},height=${h},left=${window.screen.width / 2 - w / 2},top=${window.screen.height / 2 - h / 2},status=no,resizable=yes`
    );
    setPolling(true);
  });

  const saveProfiles = () => run(async () => {
    let shippingId = shippingChoice;
    let returnId = returnChoice;
    let readinessId = readinessChoice;

    if (shippingChoice === '__new__') {
      const res = await axios.post(`${API_BASE}/setup/shipping-profile`, newShipping);
      shippingId = res.data.profile?.shipping_profile_id;
    }
    if (returnChoice === '__new__') {
      const res = await axios.post(`${API_BASE}/setup/return-policy`, newReturn);
      returnId = res.data.policy?.return_policy_id;
    }
    if (readinessChoice === '__new__') {
      const res = await axios.post(`${API_BASE}/setup/readiness-state`, newReadiness);
      readinessId = res.data.readinessState?.readiness_state_id;
    }

    if (!shippingId) throw new Error('Kargo şablonu seçilmedi veya oluşturulamadı.');
    if (!returnId) throw new Error('İade politikası seçilmedi veya oluşturulamadı.');

    const payload = {
      default_shipping_profile_id: shippingId,
      default_return_policy_id: returnId
    };
    if (readinessId) payload.default_readiness_state_id = readinessId;

    await axios.post(`${API_BASE}/settings`, payload);
    await loadStatus();
    setStepIndex(3);
  });

  const saveAiKey = () => run(async () => {
    await axios.post(`${API_BASE}/setup/env/openrouter`, { api_key: openRouterKey });
    await loadStatus();
    setStepIndex(4);
  });

  const goToStep = (index) => {
    setPolling(false);
    setError(null);
    setStepIndex(index);
  };

  const finish = () => run(async () => {
    setPolling(false);
    await axios.post(`${API_BASE}/setup/complete`);
    onFinish?.();
  });

  if (!status) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0b0f19] text-slate-100 p-6">
        <div className="max-w-md w-full space-y-4 text-center">
          <h1 className="text-xl font-bold">Usalk Helper Kurulumu</h1>
          {error ? <ErrorBox message={error} /> : <Loader2 className="animate-spin mx-auto text-amber-500" size={28} />}
          <button onClick={finish} disabled={busy} className="px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold inline-flex items-center gap-2">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <SkipForward size={14} />}
            Hepsini atla
          </button>
          {error && <button onClick={loadStatus} disabled={busy} className="block mx-auto text-xs text-slate-400 hover:text-slate-200">Yeniden dene</button>}
        </div>
      </div>
    );
  }

  const stepDone = (id) => status.steps?.[id] === true;
  const current = STEPS[stepIndex];

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 p-6 lg:p-10">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Başlık */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">Usalk Helper Kurulumu</h1>
            <p className="text-xs text-slate-400">
              İstediğiniz adıma geçebilir veya kurulumu atlayıp daha sonra tamamlayabilirsiniz.
            </p>
          </div>
          <button onClick={finish} disabled={busy} className="shrink-0 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold inline-flex items-center justify-center gap-2">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <SkipForward size={14} />}
            Hepsini atla
          </button>
        </div>

        {/* Adım göstergesi */}
        <div className="flex flex-wrap gap-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = s.id !== 'done' && stepDone(s.id);
            const active = i === stepIndex;
            return (
              <button
                key={s.id}
                disabled={busy}
                aria-current={active ? 'step' : undefined}
                aria-label={`${i + 1}. ${s.title}`}
                onClick={() => goToStep(i)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] font-semibold transition-colors ${
                  active
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    : done
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                    : 'bg-[#0e1726] border-[#1e293b] text-slate-400 hover:text-slate-200'
                }`}
              >
                {done ? <Check size={13} /> : <Icon size={13} />}
                <span className="hidden sm:inline">{i + 1}. {s.title}</span>
                <span className="sm:hidden">{i + 1}</span>
              </button>
            );
          })}
        </div>

        {/* Adım gövdesi */}
        <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 lg:p-8 space-y-6">
          <div className="flex items-center gap-3 border-b border-[#1e293b] pb-4">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <current.icon size={16} className="text-amber-500" />
            </div>
            <div>
              <h2 className="text-sm font-bold">{stepIndex + 1}. {current.title}</h2>
              <p className="text-[11px] text-slate-500">{current.hint}</p>
            </div>
          </div>

          <ErrorBox message={error} />

          {/* ADIM 1 — hosts + Etsy app */}
          {current.id === 'hosts' && (
            <div className="space-y-6">
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 space-y-2">
                <p className="text-[11px] text-amber-200/90 leading-relaxed">
                  Etsy, OAuth dönüş adresinde <strong>IP kabul etmiyor</strong> — sadece alan adı.
                  Bu yüzden seçtiğiniz alan adının bilgisayarınızda <code className="text-amber-400">127.0.0.1</code>'e
                  yönlenmesi gerekiyor. Bu işlem yönetici izni istediği için <strong>uygulama sizin adınıza yapamaz</strong>.
                </p>
              </div>

              <Field label="Alan adı seçin" hint="Üçü de Etsy uygulamasına callback olarak kayıtlı. Herhangi birini seçebilirsiniz.">
                <div className="grid sm:grid-cols-3 gap-2">
                  {status.domains?.map(d => (
                    <button
                      key={d.domain}
                      onClick={() => setDomain(d.domain)}
                      className={`px-3 py-3 rounded-xl border text-xs font-semibold transition-colors ${
                        domain === d.domain
                          ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
                          : 'bg-[#0b0f19] border-[#1e293b] text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </Field>

              {selectedDomainInfo && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-slate-400">
                      1) Şu satırı hosts dosyasının sonuna ekleyin:
                    </p>
                    <div className="flex items-center gap-2 bg-[#0b0f19] border border-[#1e293b] rounded-xl px-3 py-2.5">
                      <code className="flex-1 text-xs text-emerald-400 font-mono truncate">
                        {selectedDomainInfo.hostsLine.replace('\t', '    ')}
                      </code>
                      <CopyButton value={selectedDomainInfo.hostsLine} label="Satırı kopyala" />
                    </div>
                    <div className="flex items-center gap-2 bg-[#0b0f19] border border-[#1e293b] rounded-xl px-3 py-2.5">
                      <code className="flex-1 text-[11px] text-slate-400 font-mono truncate">{status.hostsFile}</code>
                      <CopyButton value={status.hostsFile} label="Yolu kopyala" />
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Not Defteri'ni <strong>yönetici olarak</strong> açıp bu dosyayı düzenleyin, kaydedin.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-slate-400">
                      2) Etsy uygulamanızın callback adresi bu olmalı:
                    </p>
                    <div className="flex items-center gap-2 bg-[#0b0f19] border border-[#1e293b] rounded-xl px-3 py-2.5">
                      <code className="flex-1 text-xs text-sky-400 font-mono truncate">{selectedDomainInfo.redirectUri}</code>
                      <CopyButton value={selectedDomainInfo.redirectUri} label="Kopyala" />
                    </div>
                    <a
                      href="https://www.etsy.com/developers/your-apps"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[11px] text-sky-400 hover:text-sky-300 font-semibold"
                    >
                      Etsy Developers panelini aç <ExternalLink size={11} />
                    </a>
                  </div>

                  <label className="flex items-start gap-2.5 bg-[#0b0f19] border border-[#1e293b] rounded-xl px-3 py-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hostsConfirmed}
                      onChange={e => setHostsConfirmed(e.target.checked)}
                      className="mt-0.5 accent-amber-500"
                    />
                    <span className="text-[11px] text-slate-300 leading-relaxed">
                      hosts dosyasına satırı ekledim ve kaydettim, callback adresi Etsy uygulamamda kayıtlı.
                    </span>
                  </label>

                  <div className="grid sm:grid-cols-2 gap-4 pt-2">
                    <Field label="Etsy API Key (client_id)">
                      <input className={inputClass} value={clientId} onChange={e => setClientId(e.target.value)} placeholder="abcd1234..." />
                    </Field>
                    <Field label="Etsy Shared Secret (client_secret)">
                      <input type="password" className={inputClass} value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="••••••••" />
                    </Field>
                  </div>
                  <p className="text-[10px] text-slate-500 flex items-center gap-1.5">
                    <ShieldCheck size={11} className="text-emerald-500" />
                    Bu bilgiler yalnızca bilgisayarınızdaki <code>backend/.env</code> dosyasına yazılır; git'e dahil edilmez.
                  </p>
                </div>
              )}

              <button
                onClick={saveStep1}
                disabled={busy || !domain || !hostsConfirmed || !clientId || !clientSecret}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-[#1e293b] disabled:text-slate-600 text-slate-950 font-bold text-xs py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
                Kaydet ve devam et
              </button>
            </div>
          )}

          {/* ADIM 2 — mağaza bağlama */}
          {current.id === 'shop' && (
            <div className="space-y-5">
              {status.shopConnected ? (
                <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl px-4 py-4">
                  <Check size={16} className="text-emerald-400" />
                  <div>
                    <p className="text-xs font-bold text-emerald-300">{status.shopName} bağlandı</p>
                    <p className="text-[10px] text-emerald-400/70">Varyasyon profilleri varsayılan fiyatlarla oluşturuldu.</p>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Açılan Etsy penceresinde mağazanıza erişim izni verin. Pencere kapandığında bağlantı
                  otomatik algılanır.
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={connectShop}
                  disabled={busy || polling}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:bg-[#1e293b] disabled:text-slate-600 text-slate-950 font-bold text-xs py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {polling ? <Loader2 size={14} className="animate-spin" /> : <Store size={14} />}
                  {polling ? 'Bağlantı bekleniyor...' : status.shopConnected ? 'Başka mağaza bağla' : 'Etsy mağazamı bağla'}
                </button>
                {status.shopConnected && (
                  <button
                    onClick={() => goToStep(2)}
                    disabled={busy}
                    className="px-5 bg-[#151f32] hover:bg-[#1e293b] border border-[#1e293b] text-slate-200 font-bold text-xs rounded-xl transition-colors flex items-center gap-2"
                  >
                    Devam <ChevronRight size={14} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ADIM 3 — satış profilleri */}
          {current.id === 'profiles' && (
            <div className="space-y-6">
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Etsy, kargo şablonu ve iade politikası olmayan bir ürünü yayına almaz.
                Mağazanızda hazır kayıt varsa seçin, yoksa buradan oluşturun.
              </p>

              {status.etsyFetchError && <ErrorBox message={`Etsy'den profiller okunamadı: ${status.etsyFetchError}`} />}

              {/* Kargo */}
              <div className="space-y-3 border border-[#1e293b] rounded-2xl p-4">
                <h3 className="text-xs font-bold flex items-center gap-2"><Truck size={13} className="text-amber-500" /> Kargo Şablonu <span className="text-rose-400">*</span></h3>
                <select className={inputClass} value={shippingChoice} onChange={e => setShippingChoice(e.target.value)}>
                  <option value="">Seçin...</option>
                  {status.shippingProfiles?.map(p => (
                    <option key={p.shipping_profile_id} value={p.shipping_profile_id}>{p.title}</option>
                  ))}
                  <option value="__new__">+ Yeni kargo şablonu oluştur</option>
                </select>

                {shippingChoice === '__new__' && (
                  <div className="grid sm:grid-cols-2 gap-3 pt-1">
                    <Field label="Şablon adı">
                      <input className={inputClass} value={newShipping.title} onChange={e => setNewShipping({ ...newShipping, title: e.target.value })} />
                    </Field>
                    <Field label="Gönderim ülkesi (ISO)" hint="Türkiye için TR">
                      <input className={inputClass} value={newShipping.origin_country_iso} onChange={e => setNewShipping({ ...newShipping, origin_country_iso: e.target.value.toUpperCase() })} />
                    </Field>
                    <Field label="İlk ürün kargo ücreti" hint="Ücretsiz kargo için 0">
                      <input type="number" step="0.01" className={inputClass} value={newShipping.primary_cost} onChange={e => setNewShipping({ ...newShipping, primary_cost: Number(e.target.value) })} />
                    </Field>
                    <Field label="Ek ürün kargo ücreti">
                      <input type="number" step="0.01" className={inputClass} value={newShipping.secondary_cost} onChange={e => setNewShipping({ ...newShipping, secondary_cost: Number(e.target.value) })} />
                    </Field>
                    <Field label="Min. hazırlık (iş günü)">
                      <input type="number" className={inputClass} value={newShipping.min_processing_time} onChange={e => setNewShipping({ ...newShipping, min_processing_time: Number(e.target.value) })} />
                    </Field>
                    <Field label="Maks. hazırlık (iş günü)">
                      <input type="number" className={inputClass} value={newShipping.max_processing_time} onChange={e => setNewShipping({ ...newShipping, max_processing_time: Number(e.target.value) })} />
                    </Field>
                  </div>
                )}
              </div>

              {/* İade */}
              <div className="space-y-3 border border-[#1e293b] rounded-2xl p-4">
                <h3 className="text-xs font-bold flex items-center gap-2"><ShieldCheck size={13} className="text-amber-500" /> İade Politikası <span className="text-rose-400">*</span></h3>
                <select className={inputClass} value={returnChoice} onChange={e => setReturnChoice(e.target.value)}>
                  <option value="">Seçin...</option>
                  {status.returnPolicies?.map(p => (
                    <option key={p.return_policy_id} value={p.return_policy_id}>
                      {p.accepts_returns ? `İade kabul · ${p.return_deadline || '-'} gün` : 'İade kabul edilmiyor'}
                      {p.accepts_exchanges ? ' · değişim var' : ''}
                    </option>
                  ))}
                  <option value="__new__">+ Yeni iade politikası oluştur</option>
                </select>

                {returnChoice === '__new__' && (
                  <div className="space-y-3 pt-1">
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-[11px] text-slate-300">
                        <input type="checkbox" className="accent-amber-500" checked={newReturn.accepts_returns} onChange={e => setNewReturn({ ...newReturn, accepts_returns: e.target.checked })} />
                        İade kabul ediyorum
                      </label>
                      <label className="flex items-center gap-2 text-[11px] text-slate-300">
                        <input type="checkbox" className="accent-amber-500" checked={newReturn.accepts_exchanges} onChange={e => setNewReturn({ ...newReturn, accepts_exchanges: e.target.checked })} />
                        Değişim kabul ediyorum
                      </label>
                    </div>
                    {(newReturn.accepts_returns || newReturn.accepts_exchanges) && (
                      <Field label="İade süresi (gün)">
                        <select className={inputClass} value={newReturn.return_deadline} onChange={e => setNewReturn({ ...newReturn, return_deadline: Number(e.target.value) })}>
                          {[14, 21, 30, 45, 60, 90].map(d => <option key={d} value={d}>{d} gün</option>)}
                        </select>
                      </Field>
                    )}
                  </div>
                )}
              </div>

              {/* İşleme süresi */}
              <div className="space-y-3 border border-[#1e293b] rounded-2xl p-4">
                <h3 className="text-xs font-bold flex items-center gap-2"><RefreshCw size={13} className="text-amber-500" /> İşleme Süresi <span className="text-slate-600 font-normal">(opsiyonel)</span></h3>
                <select className={inputClass} value={readinessChoice} onChange={e => setReadinessChoice(e.target.value)}>
                  <option value="">Kullanma</option>
                  {status.readinessStates?.map(r => (
                    <option key={r.readiness_state_id} value={r.readiness_state_id}>
                      {r.readiness_state === 'made_to_order' ? 'Siparişe özel' : 'Stokta hazır'}
                      {' · '}
                      {r.processing_days_display_label || `${r.min_processing_days}-${r.max_processing_days} gün`}
                    </option>
                  ))}
                  <option value="__new__">+ Yeni işleme süresi oluştur</option>
                </select>

                {readinessChoice === '__new__' && (
                  <div className="grid sm:grid-cols-3 gap-3 pt-1">
                    <Field label="Tip">
                      <select className={inputClass} value={newReadiness.readiness_state} onChange={e => setNewReadiness({ ...newReadiness, readiness_state: e.target.value })}>
                        <option value="made_to_order">Siparişe özel üretim</option>
                        <option value="ready_to_ship">Stokta hazır</option>
                      </select>
                    </Field>
                    <Field label="Min. süre">
                      <input type="number" className={inputClass} value={newReadiness.min_processing_time} onChange={e => setNewReadiness({ ...newReadiness, min_processing_time: Number(e.target.value) })} />
                    </Field>
                    <Field label="Maks. süre">
                      <input type="number" className={inputClass} value={newReadiness.max_processing_time} onChange={e => setNewReadiness({ ...newReadiness, max_processing_time: Number(e.target.value) })} />
                    </Field>
                  </div>
                )}
              </div>

              <button
                onClick={saveProfiles}
                disabled={busy || !shippingChoice || !returnChoice}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-[#1e293b] disabled:text-slate-600 text-slate-950 font-bold text-xs py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
                Kaydet ve devam et
              </button>
            </div>
          )}

          {/* ADIM 4 — OpenRouter */}
          {current.id === 'ai' && (
            <div className="space-y-5">
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Bir AI modeli seçtiğinizde başlık, açıklama ve etiket üretimi için OpenRouter anahtarı gerekir.
                AI Agent kullanacaksanız bu adımı atlayıp Genel Ayarlar'dan AI Agent seçebilirsiniz.
              </p>

              <Field label="OpenRouter API Key" hint="openrouter.ai/keys adresinden alabilirsiniz.">
                <input type="password" className={inputClass} value={openRouterKey} onChange={e => setOpenRouterKey(e.target.value)} placeholder="sk-or-v1-..." />
              </Field>

              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] text-sky-400 hover:text-sky-300 font-semibold"
              >
                OpenRouter anahtar sayfasını aç <ExternalLink size={11} />
              </a>

              <button
                onClick={saveAiKey}
                disabled={busy || !openRouterKey}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-[#1e293b] disabled:text-slate-600 text-slate-950 font-bold text-xs py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
                Kaydet ve devam et
              </button>
            </div>
          )}

          {/* ADIM 5 — bitti */}
          {current.id === 'done' && (
            <div className="space-y-5 text-center py-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mx-auto">
                <PartyPopper size={22} className="text-emerald-400" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-sm font-bold">{status.allDone ? 'Kurulum tamamlandı' : 'Kuruluma daha sonra devam edebilirsiniz'}</h3>
                <p className="text-[11px] text-slate-400 max-w-md mx-auto leading-relaxed">
                  {status.allDone
                    ? 'Kayıtlı kurulum adımlarınız hazır. Ayarlarınızı ilgili sayfalardan dilediğiniz zaman düzenleyebilirsiniz.'
                    : 'Atladığınız adımları menüdeki Kurulum Sihirbazı üzerinden tamamlayabilirsiniz. Kayıtlı ayarlarınız korunur.'}
                </p>
              </div>
              {!status.allDone && (
                <div className="flex flex-wrap justify-center gap-2">
                  {STEPS.filter(s => s.id !== 'done' && !stepDone(s.id)).map(s => (
                    <button key={s.id} onClick={() => goToStep(STEPS.findIndex(step => step.id === s.id))} disabled={busy} className="px-3 py-2 rounded-lg bg-[#151f32] border border-[#1e293b] text-xs text-slate-300 hover:text-white">
                      {s.title}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={finish}
                disabled={busy}
                className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-[#1e293b] text-slate-950 font-bold text-xs px-6 py-3 rounded-xl transition-colors inline-flex items-center gap-2"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Ana sayfaya geç
              </button>
            </div>
          )}

          {current.id !== 'done' && (
            <div className="flex justify-end border-t border-[#1e293b] pt-4">
              <button onClick={() => goToStep(stepIndex + 1)} disabled={busy} className="px-4 py-2.5 rounded-xl border border-slate-600 bg-[#151f32] hover:bg-[#1e293b] disabled:opacity-50 text-slate-200 text-xs font-semibold inline-flex items-center gap-2">
                Bu adımı atla <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>

        <p className="text-[11px] text-slate-500 text-center">Atlanan adımlar ayarları değiştirmez. Kurulum Sihirbazı'nı menüden tekrar açabilirsiniz.</p>
      </div>
    </div>
  );
}
