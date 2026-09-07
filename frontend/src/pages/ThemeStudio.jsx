import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

const COLOR_PRESETS = [
  {
    name: 'Midnight Gallery (Koyu)',
    background: '#090D16',
    text: '#F8FAFC',
    accent: '#6366F1',
    border: '#1E293B',
    background_gradient: ''
  },
  {
    name: 'Clean Studio (Açık)',
    background: '#FFFFFF',
    text: '#0F172A',
    accent: '#4F46E5',
    border: '#E2E8F0',
    background_gradient: ''
  },
  {
    name: 'Vintage Museum (Klasik)',
    background: '#FDFBF7',
    text: '#1C1917',
    accent: '#854D0E',
    border: '#E7E5E4',
    background_gradient: ''
  }
];

export default function ThemeStudio() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Theme settings state
  const [colors, setColors] = useState({
    background: '',
    text: '',
    accent: '',
    border: '',
    background_gradient: ''
  });
  const [announcements, setAnnouncements] = useState(['', '']);
  const [hero, setHero] = useState({
    title: '',
    text: ''
  });

  useEffect(() => {
    fetchThemeData();
  }, []);

  const fetchThemeData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE}/shopify/theme/read`);
      setColors(res.data.colors || {});
      setAnnouncements(res.data.announcements || ['', '']);
      setHero(res.data.hero || { title: '', text: '' });
    } catch (err) {
      console.error('Failed to read Shopify theme configuration:', err);
      setError(err.response?.data?.error || 'Tema dosyaları okunamadı. Shopify bağlantı ayarlarından tema yolu tanımlandığından emin olun.');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyPreset = (preset) => {
    setColors({
      background: preset.background,
      text: preset.text,
      accent: preset.accent,
      border: preset.border,
      background_gradient: preset.background_gradient
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    try {
      const res = await axios.post(`${API_BASE}/shopify/theme/write`, {
        colors,
        announcements,
        hero
      });
      if (res.data.success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 4000);
      }
    } catch (err) {
      console.error('Failed to write theme data:', err);
      alert('Tema kaydedilemedi: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-emerald-500 font-medium text-sm">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Tema Verileri Okunuyor...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-6 text-center">
          <h2 className="text-lg font-semibold text-rose-400 mb-2">Tema Yüklenemedi</h2>
          <p className="text-slate-400 text-sm mb-6">{error}</p>
          <a
            href="#shopify-connect"
            onClick={() => window.location.reload()}
            className="inline-block bg-slate-800 hover:bg-slate-700 text-white font-semibold py-2.5 px-5 rounded-xl text-xs transition-all cursor-pointer"
          >
            Yeniden Dene & Bağlantıyı Kontrol Et
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 pb-6 border-b border-slate-800/60 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2 font-outfit">Tema Düzenleme Stüdyosu</h1>
          <p className="text-slate-400 text-sm">
            Pitch temasını yerel diskten doğrudan düzenle. Renkleri, sloganları ve duyuruları değiştirip otomatik senkronize et.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-semibold py-3 px-8 rounded-xl transition-all shadow-lg hover:shadow-emerald-500/10 flex items-center justify-center space-x-2 text-sm cursor-pointer"
        >
          {saving ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Kaydediliyor...</span>
            </>
          ) : (
            <span>Kaydet ve Senkronize Et</span>
          )}
        </button>
      </div>

      {saveSuccess && (
        <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs font-medium animate-fade-in flex items-center space-x-2">
          <span>✨ Tema başarıyla güncellendi ve kaydedildi! Shopify CLI dev sunucusu değişiklikleri otomatik olarak yayına senkronize edecektir.</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Customizer Fields */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Panel 1: Colors */}
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 p-6 shadow-xl space-y-6">
            <h3 className="text-base font-bold text-white font-outfit border-b border-slate-800/60 pb-3 flex items-center justify-between">
              <span>Renk Şeması (Scheme-1)</span>
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold">Aktif</span>
            </h3>

            {/* Presets */}
            <div>
              <label className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-3">Renk Şablonları</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {COLOR_PRESETS.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className="p-3 bg-[#0b0f19] border border-slate-800 hover:border-slate-700 rounded-xl text-left transition-all group flex flex-col justify-between h-20 cursor-pointer"
                  >
                    <span className="text-xs font-semibold text-slate-300 group-hover:text-white transition-all">{preset.name}</span>
                    <div className="flex space-x-1.5 mt-2">
                      <div className="w-4 h-4 rounded-full border border-slate-800" style={{ backgroundColor: preset.background }}></div>
                      <div className="w-4 h-4 rounded-full border border-slate-800" style={{ backgroundColor: preset.text }}></div>
                      <div className="w-4 h-4 rounded-full border border-slate-800" style={{ backgroundColor: preset.accent }}></div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Pickers */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-slate-800/40">
              <div>
                <label className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">Arka Plan Rengi</label>
                <div className="flex space-x-3">
                  <input
                    type="color"
                    value={colors.background}
                    onChange={(e) => setColors({ ...colors, background: e.target.value })}
                    className="w-10 h-10 border border-slate-800 rounded-lg cursor-pointer bg-transparent"
                  />
                  <input
                    type="text"
                    value={colors.background}
                    onChange={(e) => setColors({ ...colors, background: e.target.value })}
                    className="bg-[#0b0f19] border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-xs w-28 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">Metin Rengi</label>
                <div className="flex space-x-3">
                  <input
                    type="color"
                    value={colors.text}
                    onChange={(e) => setColors({ ...colors, text: e.target.value })}
                    className="w-10 h-10 border border-slate-800 rounded-lg cursor-pointer bg-transparent"
                  />
                  <input
                    type="text"
                    value={colors.text}
                    onChange={(e) => setColors({ ...colors, text: e.target.value })}
                    className="bg-[#0b0f19] border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-xs w-28 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">Accent / Düğme Rengi</label>
                <div className="flex space-x-3">
                  <input
                    type="color"
                    value={colors.accent}
                    onChange={(e) => setColors({ ...colors, accent: e.target.value })}
                    className="w-10 h-10 border border-slate-800 rounded-lg cursor-pointer bg-transparent"
                  />
                  <input
                    type="text"
                    value={colors.accent}
                    onChange={(e) => setColors({ ...colors, accent: e.target.value })}
                    className="bg-[#0b0f19] border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-xs w-28 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">Kenarlık Rengi</label>
                <div className="flex space-x-3">
                  <input
                    type="color"
                    value={colors.border}
                    onChange={(e) => setColors({ ...colors, border: e.target.value })}
                    className="w-10 h-10 border border-slate-800 rounded-lg cursor-pointer bg-transparent"
                  />
                  <input
                    type="text"
                    value={colors.border}
                    onChange={(e) => setColors({ ...colors, border: e.target.value })}
                    className="bg-[#0b0f19] border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-xs w-28 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Panel 2: Announcements */}
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 p-6 shadow-xl space-y-6">
            <h3 className="text-base font-bold text-white font-outfit border-b border-slate-800/60 pb-3">Duyuru Barları (Announcements)</h3>
            
            <div className="space-y-4">
              {announcements.map((text, idx) => (
                <div key={idx}>
                  <label className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">Duyuru Metni {idx + 1}</label>
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => {
                      const updated = [...announcements];
                      updated[idx] = e.target.value;
                      setAnnouncements(updated);
                    }}
                    placeholder={`Örn: Duyuru metni buraya yazılacak`}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-xl px-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Panel 3: Hero Philosophy */}
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 p-6 shadow-xl space-y-6">
            <h3 className="text-base font-bold text-white font-outfit border-b border-slate-800/60 pb-3">Kahraman Slogan & Açıklama (Hero Banner)</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">Ana Slogan / Başlık</label>
                <input
                  type="text"
                  value={hero.title}
                  onChange={(e) => setHero({ ...hero, title: e.target.value })}
                  placeholder="Örn: Transform Your Walls Into an Art Gallery"
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-xl px-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">Alt Açıklama Metni</label>
                <textarea
                  value={hero.text}
                  onChange={(e) => setHero({ ...hero, text: e.target.value })}
                  placeholder="Koleksiyonumuz hakkında kısa bir tanıtım..."
                  rows={4}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-xl px-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-sm"
                />
              </div>
            </div>
          </div>

        </div>

        {/* Right Preview Card */}
        <div className="bg-[#0f172a] rounded-2xl border border-slate-800 p-6 flex flex-col justify-between shadow-xl sticky top-8 h-fit">
          <div className="space-y-6">
            <h3 className="text-base font-bold text-white font-outfit border-b border-slate-800/60 pb-3">Canlı Önizleme Simülatörü</h3>
            
            {/* Simulation Block */}
            <div 
              className="rounded-xl border p-4 font-sans relative overflow-hidden transition-all duration-300"
              style={{ 
                backgroundColor: colors.background,
                color: colors.text,
                borderColor: colors.border
              }}
            >
              {/* Announcement Bar */}
              <div 
                className="w-full text-[10px] text-center py-1.5 border-b font-medium overflow-hidden whitespace-nowrap text-ellipsis"
                style={{ 
                  borderColor: colors.border,
                  backgroundColor: colors.text + '10' // subtle transparency
                }}
              >
                📢 {announcements[0] || 'Duyuru Metni Buraya Gelecek'}
              </div>

              {/* Header simulation */}
              <div className="flex justify-between items-center py-3 border-b text-[11px] font-bold tracking-wider" style={{ borderColor: colors.border }}>
                <span>USALK ART HOUSE</span>
                <div className="flex space-x-3 text-[10px]">
                  <span>Catalog</span>
                  <span>Contact</span>
                </div>
              </div>

              {/* Hero simulation */}
              <div className="py-8 text-center space-y-3">
                <h4 className="text-base font-extrabold font-outfit leading-tight">
                  {hero.title || 'Transform Your Walls Into an Art Gallery'}
                </h4>
                <p className="text-[10px] opacity-75 max-w-[200px] mx-auto leading-relaxed">
                  {hero.text || 'High-resolution custom canvas prints on museum-quality frames.'}
                </p>
                
                <button
                  type="button"
                  className="px-4 py-1.5 rounded text-[10px] font-bold transition-all"
                  style={{ 
                    backgroundColor: colors.accent,
                    color: colors.background 
                  }}
                >
                  Shop Now
                </button>
              </div>

              {/* Small info block simulating product card border */}
              <div className="border p-2.5 rounded-lg text-center" style={{ borderColor: colors.border }}>
                <div className="w-full h-12 bg-slate-500/10 rounded mb-1.5"></div>
                <div className="text-[9px] font-bold">Sample Art Card</div>
              </div>
            </div>
          </div>

          <div className="mt-8 text-[11px] text-slate-500 leading-relaxed bg-[#0b0f19] p-3 rounded-lg border border-slate-800/40">
            💡 **Nasıl çalışır?** Buradaki değişiklikler yerel tema dosyalarına yazıldığında, arka planda çalışan Shopify CLI sunucusu bunu anında algılar ve yayına yansıtır.
          </div>
        </div>
      </div>
    </div>
  );
}
