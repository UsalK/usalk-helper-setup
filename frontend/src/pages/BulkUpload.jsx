import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  Upload, Sparkles, Layers, Tag, Sliders, ShoppingBag, 
  ChevronRight, ChevronLeft, Check, Play, RefreshCw, X, AlertTriangle,
  Wand2, Plus, ArrowLeft, Trash2, Eye, CheckCircle, Trash, Folder
} from 'lucide-react';
import { warpImage } from '../utils/homography';
import { getMockupOutputSize } from '../utils/mockupOutput';
import { filterAutoMatchProfiles, isSetProfile } from '../utils/profileFlags';
import {
  parseRatio, parseRatioKey, ratioKeyLabel, sourceRatioLabel,
  getTemplateSlots, buildPanelSources, composePanelsImage,
  DEFAULT_PLACEMENT, DEFAULT_CORNERS
} from '../utils/panels';

const API_BASE = 'http://localhost:3001/api';

const matchProfileForImage = (imageSrc, profiles) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const imgRatio = img.width / img.height;
      let closestProfile = null;
      let minDiff = Infinity;
      for (const profile of filterAutoMatchProfiles(profiles)) {
        const profileRatioVal = parseRatio(profile.ratio);
        const diff = Math.abs(imgRatio - profileRatioVal);
        if (diff < minDiff) {
          minDiff = diff;
          closestProfile = profile;
        }
      }
      resolve(closestProfile ? closestProfile.id : null);
    };
    img.onerror = () => {
      resolve(null);
    };
    img.src = imageSrc;
  });
};

const getLockedPlacement = (px, py, pw, ph, targetRatio) => {
  const currentRatio = pw / ph;
  let finalW = pw;
  let finalH = ph;
  if (currentRatio > targetRatio) {
    finalW = ph * targetRatio;
  } else {
    finalH = pw / targetRatio;
  }
  const finalX = px + (pw - finalW) / 2;
  const finalY = py + (ph - finalH) / 2;
  return { x: finalX, y: finalY, width: finalW, height: finalH };
};

const drawRealisticFrame = (ctx, x, y, w, h, style, thickness) => {
  if (!style || style === 'stretched') return;
  
  const t = parseFloat(thickness) || 4;
  
  // Inner corners (matches the original bounds of the artwork)
  const itl = { x: x, y: y };
  const itr = { x: x + w, y: y };
  const ibr = { x: x + w, y: y + h };
  const ibl = { x: x, y: y + h };

  // Outer corners (expands outwards by thickness 't')
  const otl = { x: x - t, y: y - t };
  const otr = { x: x + w + t, y: y - t };
  const obr = { x: x + w + t, y: y + h + t };
  const obl = { x: x - t, y: y + h + t };

  const drawTrapezoid = (p1, p2, p3, p4, fillStyle) => {
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
  };

  const drawWoodGrains = (p1, p2, p3, p4, isHorizontal, darkColor) => {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.clip();

    ctx.strokeStyle = darkColor;
    ctx.lineWidth = 1;

    const minX = Math.min(p1.x, p2.x, p3.x, p4.x);
    const maxX = Math.max(p1.x, p2.x, p3.x, p4.x);
    const minY = Math.min(p1.y, p2.y, p3.y, p4.y);
    const maxY = Math.max(p1.y, p2.y, p3.y, p4.y);

    if (isHorizontal) {
      const height = maxY - minY;
      const steps = Math.max(3, Math.floor(height / 2.5));
      for (let i = 0; i < steps; i++) {
        const yOffset = minY + (i / steps) * height + Math.random() * 1.5;
        ctx.beginPath();
        ctx.moveTo(minX, yOffset);
        ctx.bezierCurveTo(
          minX + (maxX - minX) * 0.25, yOffset - 1,
          minX + (maxX - minX) * 0.75, yOffset + 1,
          maxX, yOffset
        );
        ctx.stroke();
      }
    } else {
      const width = maxX - minX;
      const steps = Math.max(3, Math.floor(width / 2.5));
      for (let i = 0; i < steps; i++) {
        const xOffset = minX + (i / steps) * width + Math.random() * 1.5;
        ctx.beginPath();
        ctx.moveTo(xOffset, minY);
        ctx.bezierCurveTo(
          xOffset - 1, minY + (maxY - minY) * 0.25,
          xOffset + 1, minY + (maxY - minY) * 0.75,
          xOffset, maxY
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  if (style === 'black_frame') {
    const gTop = ctx.createLinearGradient(otl.x, otl.y, itl.x, itl.y);
    gTop.addColorStop(0, '#374151');
    gTop.addColorStop(1, '#111827');
    drawTrapezoid(otl, otr, itr, itl, gTop);

    const gLeft = ctx.createLinearGradient(otl.x, otl.y, itl.x, itl.y);
    gLeft.addColorStop(0, '#1f2937');
    gLeft.addColorStop(1, '#0f172a');
    drawTrapezoid(otl, obl, ibl, itl, gLeft);

    const gBottom = ctx.createLinearGradient(obl.x, obl.y, ibl.x, ibl.y);
    gBottom.addColorStop(0, '#0f172a');
    gBottom.addColorStop(1, '#020617');
    drawTrapezoid(obl, obr, ibr, ibl, gBottom);

    const gRight = ctx.createLinearGradient(otr.x, otr.y, itr.x, itr.y);
    gRight.addColorStop(0, '#0f172a');
    gRight.addColorStop(1, '#020617');
    drawTrapezoid(otr, obr, ibr, itr, gRight);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  } else if (style === 'white_frame') {
    drawTrapezoid(otl, otr, itr, itl, '#f8fafc');
    drawTrapezoid(otl, obl, ibl, itl, '#f1f5f9');
    drawTrapezoid(obl, obr, ibr, ibl, '#cbd5e1');
    drawTrapezoid(otr, obr, ibr, itr, '#e2e8f0');

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - t, y - t, w + 2*t, h + 2*t);
    ctx.strokeRect(x, y, w, h);
  } else if (style === 'gold_frame') {
    const gTop = ctx.createLinearGradient(otl.x, otl.y, otr.x, otr.y);
    gTop.addColorStop(0, '#c5a059');
    gTop.addColorStop(0.3, '#fdf5e6');
    gTop.addColorStop(0.5, '#aa7c11');
    gTop.addColorStop(0.7, '#fdf5e6');
    gTop.addColorStop(1, '#c5a059');
    drawTrapezoid(otl, otr, itr, itl, gTop);

    const gLeft = ctx.createLinearGradient(otl.x, otl.y, obl.x, obl.y);
    gLeft.addColorStop(0, '#c5a059');
    gLeft.addColorStop(0.5, '#aa7c11');
    gLeft.addColorStop(1, '#8c6308');
    drawTrapezoid(otl, obl, ibl, itl, gLeft);

    const gBottom = ctx.createLinearGradient(obl.x, obl.y, obr.x, obr.y);
    gBottom.addColorStop(0, '#8c6308');
    gBottom.addColorStop(0.5, '#c5a059');
    gBottom.addColorStop(1, '#5a3f00');
    drawTrapezoid(obl, obr, ibr, ibl, gBottom);

    const gRight = ctx.createLinearGradient(otr.x, otr.y, obr.x, obr.y);
    gRight.addColorStop(0, '#c5a059');
    gRight.addColorStop(0.5, '#aa7c11');
    gRight.addColorStop(1, '#5a3f00');
    drawTrapezoid(otr, obr, ibr, itr, gRight);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - t + 0.5, y - t + 0.5, w + 2*t - 1, h + 2*t - 1);
  } else if (style === 'silver_frame') {
    const gTop = ctx.createLinearGradient(otl.x, otl.y, otr.x, otr.y);
    gTop.addColorStop(0, '#94a3b8');
    gTop.addColorStop(0.3, '#f8fafc');
    gTop.addColorStop(0.5, '#64748b');
    gTop.addColorStop(0.7, '#f8fafc');
    gTop.addColorStop(1, '#94a3b8');
    drawTrapezoid(otl, otr, itr, itl, gTop);

    const gLeft = ctx.createLinearGradient(otl.x, otl.y, obl.x, obl.y);
    gLeft.addColorStop(0, '#94a3b8');
    gLeft.addColorStop(0.5, '#64748b');
    gLeft.addColorStop(1, '#475569');
    drawTrapezoid(otl, obl, ibl, itl, gLeft);

    const gBottom = ctx.createLinearGradient(obl.x, obl.y, obr.x, obr.y);
    gBottom.addColorStop(0, '#475569');
    gBottom.addColorStop(0.5, '#cbd5e1');
    gBottom.addColorStop(1, '#334155');
    drawTrapezoid(obl, obr, ibr, ibl, gBottom);

    const gRight = ctx.createLinearGradient(otr.x, otr.y, obr.x, obr.y);
    gRight.addColorStop(0, '#94a3b8');
    gRight.addColorStop(0.5, '#64748b');
    gRight.addColorStop(1, '#334155');
    drawTrapezoid(otr, obr, ibr, itr, gRight);
  } else if (style === 'natural_wood') {
    drawTrapezoid(otl, otr, itr, itl, '#dfb17b');
    drawTrapezoid(otl, obl, ibl, itl, '#d2a26c');
    drawTrapezoid(obl, obr, ibr, ibl, '#bd8d58');
    drawTrapezoid(otr, obr, ibr, itr, '#bd8d58');

    drawWoodGrains(otl, otr, itr, itl, true, 'rgba(90, 60, 30, 0.08)');
    drawWoodGrains(otl, obl, ibl, itl, false, 'rgba(90, 60, 30, 0.08)');
    drawWoodGrains(obl, obr, ibr, ibl, true, 'rgba(90, 60, 30, 0.08)');
    drawWoodGrains(otr, obr, ibr, itr, false, 'rgba(90, 60, 30, 0.08)');
  } else if (style === 'walnut') {
    drawTrapezoid(otl, otr, itr, itl, '#5c4033');
    drawTrapezoid(otl, obl, ibl, itl, '#4e3629');
    drawTrapezoid(obl, obr, ibr, ibl, '#3d2b1f');
    drawTrapezoid(otr, obr, ibr, itr, '#3d2b1f');

    drawWoodGrains(otl, otr, itr, itl, true, 'rgba(30, 15, 5, 0.15)');
    drawWoodGrains(otl, obl, ibl, itl, false, 'rgba(30, 15, 5, 0.15)');
    drawWoodGrains(obl, obr, ibr, ibl, true, 'rgba(30, 15, 5, 0.15)');
    drawWoodGrains(otr, obr, ibr, itr, false, 'rgba(30, 15, 5, 0.15)');
  }

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(otl.x, otl.y); ctx.lineTo(itl.x, itl.y);
  ctx.moveTo(otr.x, otr.y); ctx.lineTo(itr.x, itr.y);
  ctx.moveTo(obr.x, obr.y); ctx.lineTo(ibr.x, ibr.y);
  ctx.moveTo(obl.x, obl.y); ctx.lineTo(ibl.x, ibl.y);
  ctx.stroke();
};

export default function BulkUpload({ etsyConnected }) {
  const [view, setView] = useState('drafts'); // 'drafts' | 'active' | 'upload'
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  // Main lists
  const [products, setProducts] = useState([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState([]);
  
  // Metadata & Templates
  const [templates, setTemplates] = useState([]);
  const [variationProfiles, setVariationProfiles] = useState([]);
  
  // Settings overrides / metadata
  const [overrides, setOverrides] = useState({
    shipping_profile_id: '',
    return_policy_id: '',
    shop_section_id: '',
    readiness_state_id: '',
    listing_state: 'draft'
  });


  const [shippingProfiles, setShippingProfiles] = useState([]);
  const [returnPolicies, setReturnPolicies] = useState([]);
  const [shopSections, setShopSections] = useState([]);
  const [readinessStates, setReadinessStates] = useState([]);

  // Detail View State
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedProductMockups, setSelectedProductMockups] = useState([]);
  
  // Detail View Edit Fields
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTags, setEditTags] = useState([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [editProfileId, setEditProfileId] = useState('');
  const [editSectionId, setEditSectionId] = useState('');
  const [showAllVariations, setShowAllVariations] = useState(false);

  // File Queue upload states
  const [filesQueue, setFilesQueue] = useState([]);
  const [defaultUploadSectionId, setDefaultUploadSectionId] = useState('');
  const [dragActive, setDragActive] = useState(false);

  // Yükleme modu: tekli ürün mü, çok panelli set mi
  const [uploadMode, setUploadMode] = useState('single'); // 'single' | 'set2' | 'set3'
  const [setMethod, setSetMethod] = useState('auto');     // 'auto' | 'manual'
  const [setProfileId, setSetProfileId] = useState('');
  // Manuel eşleştirilmiş set ürünleri
  const [pairQueue, setPairQueue] = useState([]);
  // Manuel eşleştirme modalı
  const [pairModal, setPairModal] = useState(null); // { files: File[], order: number[] }
  const [pairBusy, setPairBusy] = useState(false);

  // Toast notifications state
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
  };

  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => {
        setToast(prev => ({ ...prev, show: false }));
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast.show]);

  // Mockup generation canvas helper
  const renderCanvasRef = useRef(null);

  useEffect(() => {
    fetchProducts();
    fetchTemplates();
    fetchProfiles();
    if (etsyConnected) {
      fetchEtsyMetadata();
    }
  }, [etsyConnected]);

  const fetchProducts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/products?platform=etsy`);
      setProducts(res.data);
    } catch (err) {
      console.error(err);
      showToast('Ürünler yüklenirken hata oluştu.', 'error');
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await axios.get(`${API_BASE}/templates`);
      setTemplates(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchProfiles = async () => {
    try {
      const res = await axios.get(`${API_BASE}/variations`);
      setVariationProfiles(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchEtsyMetadata = async () => {
    try {
      const [shipRes, returnRes, sectionRes, readinessRes, settingsRes] = await Promise.all([
        axios.get(`${API_BASE}/etsy/shipping-profiles`).catch(() => ({ data: [] })),
        axios.get(`${API_BASE}/etsy/return-policies`).catch(() => ({ data: [] })),
        axios.get(`${API_BASE}/etsy/shop-sections`).catch(() => ({ data: [] })),
        axios.get(`${API_BASE}/etsy/readiness-states`).catch(() => ({ data: [] })),
        axios.get(`${API_BASE}/settings`).catch(() => ({ data: {} }))
      ]);

      setShippingProfiles(shipRes.data || []);
      setReturnPolicies(returnRes.data || []);
      setShopSections(sectionRes.data || []);
      setReadinessStates(readinessRes.data || []);
      
      if (settingsRes.data) {

        setOverrides({
          shipping_profile_id: settingsRes.data.default_shipping_profile_id || '',
          return_policy_id: settingsRes.data.default_return_policy_id || '',
          shop_section_id: settingsRes.data.default_shop_section_id || '',
          readiness_state_id: settingsRes.data.default_readiness_state_id || '',
          listing_state: settingsRes.data.default_listing_state || 'draft'
        });
      }
    } catch (err) {
      console.error('Metadata fetch error:', err);
    }
  };

  // Drag & drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleQueueFiles({ target: { files: e.dataTransfer.files } });
    }
  };

  // Helper formats
  const formatBytes = (bytes, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  const getAspectOfFile = (file) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve(img.width / img.height);
      };
      img.onerror = () => {
        resolve(1.0);
      };
      img.src = URL.createObjectURL(file);
    });
  };

  const findClosestProfileForRatio = (ratioVal) => {
    let closest = null;
    let minDiff = Infinity;
    for (const p of filterAutoMatchProfiles(variationProfiles)) {
      const pRatio = parseRatio(p.ratio);
      const diff = Math.abs(ratioVal - pRatio);
      if (diff < minDiff) {
        minDiff = diff;
        closest = p;
      }
    }
    return closest;
  };

  /* ---------------- Set (çok panelli) yükleme yardımcıları ---------------- */

  // Panel sayısına göre kullanılabilir set profilleri
  const setProfilesFor = (panelCount) =>
    variationProfiles.filter(p => isSetProfile(p) && (p.panel_count || 2) === panelCount);

  const activePanelCount = uploadMode === 'set3' ? 3 : 2;
  const availableSetProfiles = setProfilesFor(activePanelCount);
  const activeSetProfile = availableSetProfiles.find(p => p.id === setProfileId) || availableSetProfiles[0] || null;
  const activePanelRatio = activeSetProfile ? parseRatio(activeSetProfile.panel_ratio || activeSetProfile.ratio) : 0.5;

  // Set profili listesi geldiğinde varsayılanı seç
  useEffect(() => {
    if (!setProfileId && availableSetProfiles.length > 0) {
      setSetProfileId(availableSetProfiles[0].id);
    }
  }, [variationProfiles, uploadMode]);

  /**
   * Seçilen set profilinin yüklemeye hazır olup olmadığını kontrol eder.
   * Şablon ve fiyat eksikse kullanıcıya burada geri dönüş yapılır.
   */
  const setProfileReadiness = () => {
    if (!activeSetProfile) {
      return { ok: false, issues: ['Bu panel sayısı için tanımlı bir set profili yok.'], templateCount: 0, priceCount: 0 };
    }

    const matchedTemplates = templates.filter(t => {
      if (activeSetProfile.template_ids && activeSetProfile.template_ids.includes(t.id)) return true;
      const tplRatios = (t.config?.compatible_ratios && t.config.compatible_ratios.length > 0)
        ? t.config.compatible_ratios
        : ['2:3'];
      return tplRatios.includes(activeSetProfile.ratio);
    });

    const panelTemplates = matchedTemplates.filter(
      t => t.type === 'static' || (getTemplateSlots(t.config || {}).length === activePanelCount)
    );

    const combos = activeSetProfile.combinations || [];
    const pricedCombos = combos.filter(c => Number(c.price) > 0);

    const issues = [];
    if (panelTemplates.filter(t => t.type !== 'static').length === 0) {
      issues.push(`Bu profile bağlı ${activePanelCount} panelli mockup şablonu yok. Şablon Stüdyosu'ndan "${ratioKeyLabel(activeSetProfile.ratio)}" oranıyla bir şablon çizin.`);
    }
    if (pricedCombos.length === 0) {
      issues.push('Profilde fiyatlandırılmış varyasyon yok. Varyasyon Profilleri sayfasından boyut, çerçeve ve fiyatları girin.');
    }

    return {
      ok: issues.length === 0,
      issues,
      templateCount: panelTemplates.filter(t => t.type !== 'static').length,
      staticCount: panelTemplates.filter(t => t.type === 'static').length,
      priceCount: pricedCombos.length
    };
  };

  /** Manuel eşleştirme modalını açar. */
  const handlePairFilesSelected = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    if (files.length < activePanelCount) {
      showToast(`${activePanelCount} panelli set için en az ${activePanelCount} görsel seçmelisiniz.`, 'error');
      return;
    }

    const picked = files.slice(0, activePanelCount);
    setPairModal({
      files: picked,
      order: picked.map((_, i) => i),
      urls: picked.map(f => URL.createObjectURL(f))
    });
  };

  /** Modaldaki iki paneli yer değiştirir. */
  const swapPairOrder = (a, b) => {
    setPairModal(prev => {
      if (!prev) return prev;
      const order = [...prev.order];
      [order[a], order[b]] = [order[b], order[a]];
      return { ...prev, order };
    });
  };

  /** Modaldaki eşleştirmeyi onaylar ve kuyruğa ekler. */
  const confirmPair = async () => {
    if (!pairModal || !activeSetProfile) return;
    setPairBusy(true);
    try {
      const ordered = pairModal.order.map(i => pairModal.files[i]);
      const composed = await composePanelsImage(ordered, activePanelRatio);
      const aspects = await Promise.all(ordered.map(getAspectOfFile));

      setPairQueue(prev => [...prev, {
        id: Math.random().toString(36).substring(7),
        panels: ordered.map((f, i) => ({
          name: f.name,
          size: formatBytes(f.size),
          url: URL.createObjectURL(f),
          ratioVal: aspects[i],
          // Panel oranından belirgin sapma varsa mockup'ta kırpılacak
          cropped: Math.abs(aspects[i] - activePanelRatio) > 0.02
        })),
        file: composed,
        profileId: activeSetProfile.id,
        sectionId: defaultUploadSectionId || ''
      }]);

      pairModal.urls.forEach(u => URL.revokeObjectURL(u));
      setPairModal(null);
      showToast('Set ürünü kuyruğa eklendi.', 'success');
    } catch (err) {
      console.error(err);
      showToast('Görseller birleştirilirken hata oluştu.', 'error');
    } finally {
      setPairBusy(false);
    }
  };

  const closePairModal = () => {
    if (pairModal) pairModal.urls.forEach(u => URL.revokeObjectURL(u));
    setPairModal(null);
  };

  /** Manuel eşleştirilmiş set ürünlerini yükler. */
  const handleUploadPairs = async () => {
    if (pairQueue.length === 0) return;
    setLoading(true);

    const formData = new FormData();
    pairQueue.forEach(pair => formData.append('images', pair.file));

    try {
      const res = await axios.post(`${API_BASE}/products/upload?platform=etsy`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      for (let i = 0; i < res.data.length; i++) {
        const productRecord = res.data[i];
        const pair = pairQueue[i];
        if (!pair) continue;
        await axios.put(`${API_BASE}/products/${productRecord.id}`, {
          ...productRecord,
          variation_profile_id: pair.profileId || null,
          shop_section_id: pair.sectionId || null
        });
      }

      showToast(`${pairQueue.length} set ürünü taslağa eklendi.`, 'success');
      pairQueue.forEach(p => p.panels.forEach(panel => URL.revokeObjectURL(panel.url)));
      setPairQueue([]);
      await fetchProducts();
      setView('drafts');
    } catch (err) {
      console.error(err);
      showToast('Set ürünleri yüklenirken hata oluştu.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleQueueFiles = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // Otomatik set modunda profil sabittir: görsel panel sayısı kadar dilime
    // bölüneceği için kaynağın oranı, panellerin yan yana dizilmiş halidir.
    const autoSet = uploadMode !== 'single' && setMethod === 'auto' && activeSetProfile;
    const expectedAspect = autoSet ? activePanelRatio * activePanelCount : null;

    const newQueueItems = [];
    for (const file of files) {
      const id = Math.random().toString(36).substring(7);
      const ratioVal = await getAspectOfFile(file);

      if (autoSet) {
        newQueueItems.push({
          id,
          file,
          name: file.name,
          size: formatBytes(file.size),
          ratioVal,
          profileId: activeSetProfile.id,
          profileName: activeSetProfile.name,
          ratioName: ratioKeyLabel(activeSetProfile.ratio),
          isSet: true,
          panelCount: activePanelCount,
          // Beklenen kaynak oranı (1:2 × 2 panel → 1:1). Sapma varsa uyarılır.
          aspectOk: Math.abs(ratioVal - expectedAspect) <= 0.02,
          expectedAspect,
          sectionId: defaultUploadSectionId || ''
        });
        continue;
      }

      const closestProfile = findClosestProfileForRatio(ratioVal);
      newQueueItems.push({
        id,
        file,
        name: file.name,
        size: formatBytes(file.size),
        ratioVal,
        profileId: closestProfile ? closestProfile.id : '',
        profileName: closestProfile ? closestProfile.name : 'Belirlenemedi',
        ratioName: closestProfile ? closestProfile.ratio : '2:3',
        isSet: false,
        sectionId: defaultUploadSectionId || ''
      });
    }

    setFilesQueue(prev => [...prev, ...newQueueItems]);
  };

  const handleUploadQueue = async () => {
    if (filesQueue.length === 0) return;
    setLoading(true);
    
    const formData = new FormData();
    filesQueue.forEach(item => {
      formData.append('images', item.file);
    });

    try {
      const res = await axios.post(`${API_BASE}/products/upload?platform=etsy`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      // Map profiles and sections index-by-index
      for (let i = 0; i < res.data.length; i++) {
        const productRecord = res.data[i];
        const queueItem = filesQueue[i];
        
        if (queueItem) {
          await axios.put(`${API_BASE}/products/${productRecord.id}`, {
            ...productRecord,
            variation_profile_id: queueItem.profileId || null,
            shop_section_id: queueItem.sectionId || null
          });
        }
      }

      showToast('Görseller başarıyla yüklendi ve taslağa eklendi.', 'success');
      setFilesQueue([]);
      await fetchProducts();
      setView('drafts');
    } catch (err) {
      console.error(err);
      showToast('Dosyalar yüklenirken hata oluştu.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Operation queue state
  const [queue, setQueue] = useState([]);

  // Add items to queue
  const addToQueue = (productIds, type) => {
    const newTasks = productIds.map(productId => {
      const p = products.find(prod => prod.id === productId);
      return {
        id: `${type}-${productId}-${Date.now()}-${Math.random()}`,
        productId,
        productTitle: p?.title || 'İsimsiz Ürün',
        type,
        status: 'pending'
      };
    });
    setQueue(prev => [...prev, ...newTasks]);
  };

  // Mockup generation helper loads image
  const loadImage = (src) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  };

  // High-quality canvas stepping-down scaling to prevent blurriness and aliasing
  const getStepScaledCanvas = (img, targetW, targetH) => {
    let srcCanvas = img;
    let w = img.width;
    let h = img.height;
    
    while (w > targetW * 2 && h > targetH * 2) {
      w = Math.floor(w / 2);
      h = Math.floor(h / 2);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = w;
      tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.imageSmoothingEnabled = true;
      tempCtx.imageSmoothingQuality = 'high';
      tempCtx.drawImage(srcCanvas, 0, 0, w, h);
      srcCanvas = tempCanvas;
    }
    
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = targetW;
    finalCanvas.height = targetH;
    const finalCtx = finalCanvas.getContext('2d');
    finalCtx.imageSmoothingEnabled = true;
    finalCtx.imageSmoothingQuality = 'high';
    finalCtx.drawImage(srcCanvas, 0, 0, targetW, targetH);
    return finalCanvas;
  };

  const drawCoverImage = (ctx, img, x, y, w, h) => {
    let srcImage = img;
    const targetW = Math.ceil(w);
    const targetH = Math.ceil(h);
    
    if (img.width > targetW * 2 || img.height > targetH * 2) {
      srcImage = getStepScaledCanvas(img, targetW, targetH);
    }

    const imgRatio = srcImage.width / srcImage.height;
    const targetRatio = w / h;
    let sx, sy, sw, sh;
    if (imgRatio > targetRatio) {
      sh = srcImage.height;
      sw = sh * targetRatio;
      sx = (srcImage.width - sw) / 2;
      sy = 0;
    } else {
      sw = srcImage.width;
      sh = sw / targetRatio;
      sx = 0;
      sy = (srcImage.height - sh) / 2;
    }
    ctx.drawImage(srcImage, sx, sy, sw, sh, x, y, w, h);
  };

  const generateMockupsForProduct = async (p) => {
    if (!p.variation_profile_id) {
      throw new Error('Varyasyon profili seçilmemiş.');
    }
    const activeTpls = templates;
    const profile = variationProfiles.find(vp => vp.id === p.variation_profile_id);
    const productTpls = profile 
      ? activeTpls.filter(t => {
          if (profile.template_ids && profile.template_ids.includes(t.id)) return true;
          const tplRatios = (t.config.compatible_ratios && t.config.compatible_ratios.length > 0)
            ? t.config.compatible_ratios
            : ['2:3'];
          return tplRatios.includes(profile.ratio);
        })
      : activeTpls;

    // Filter templates between normal mockups and static mockups
    const mockupTpls = productTpls.filter(t => t.type !== 'static');
    const staticTpls = productTpls.filter(t => t.type === 'static');

    if (mockupTpls.length === 0 && staticTpls.length === 0) {
      throw new Error('Uyumlu şablon veya statik görsel bulunamadı.');
    }

    const { data: mockupSettings } = await axios.get(`${API_BASE}/settings`);
    const minShortEdge = mockupSettings.mockup_min_short_edge_px;
    const requestedQuality = Number(mockupSettings.mockup_jpeg_quality ?? 92);
    const jpegQuality = Number.isFinite(requestedQuality)
      ? Math.min(100, Math.max(70, requestedQuality)) / 100 : 0.92;

    // 1. Generate normal mockups
    if (mockupTpls.length > 0) {
      const productImg = await loadImage(`http://localhost:3001/${p.image_path}`);
      
      for (const tpl of mockupTpls) {
        const bgImg = await loadImage(`http://localhost:3001/${tpl.background_path}`);
        const ratios = (tpl.config.compatible_ratios && tpl.config.compatible_ratios.length > 0)
          ? tpl.config.compatible_ratios
          : ['2:3'];

        // Panel yerleşimleri ve her panele girecek görsel. Tek panelli şablonlarda
        // tek elemanlı bir dizi olduğu için akış eskisiyle birebir aynı kalır.
        const slots = getTemplateSlots(tpl.config);
        const setSource = tpl.config.set_source === 'duplicate' ? 'duplicate' : 'split';
        const panelSources = buildPanelSources(productImg, slots.length, setSource);

        for (const ratio of ratios) {
          if (profile && ratio !== profile.ratio) continue;

          const canvas = renderCanvasRef.current;
          const ctx = canvas.getContext('2d');
          const { width: W, height: H } = getMockupOutputSize(bgImg.width, bgImg.height, minShortEdge);
          canvas.width = W;
          canvas.height = H;

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          ctx.drawImage(bgImg, 0, 0, W, H);

          // Oran anahtarı '1:2x2' gibi olabilir; kilitlenecek oran tek panelinkidir.
          const targetRatioVal = parseRatio(ratio);

          if (tpl.type === 'flat') {
            const editorWidth = tpl.config.editorWidth || 800;
            const scaleFactor = W / editorWidth;
            const shadow = tpl.config.shadow || { enabled: false };
            const frame = tpl.config.frame || { style: 'stretched', thickness: 3 };

            slots.forEach((slot, slotIdx) => {
              const placement = slot.placement || DEFAULT_PLACEMENT;
              const px = placement.x * W;
              const py = placement.y * H;
              const pw = placement.width * W;
              const ph = placement.height * H;

              const { x: finalX, y: finalY, width: finalW, height: finalH } = getLockedPlacement(px, py, pw, ph, targetRatioVal);

              if (shadow.enabled) {
                ctx.save();
                ctx.shadowColor = `rgba(0, 0, 0, ${(parseFloat(shadow.opacity) || 3) / 10})`;
                ctx.shadowBlur = (parseFloat(shadow.blur) || 5) * scaleFactor;
                const dist = (parseFloat(shadow.distance) || 5) * scaleFactor;
                if (shadow.sides === 'all' || shadow.sides === 'bottom') ctx.shadowOffsetY = dist;
                if (shadow.sides === 'all' || shadow.sides === 'right') ctx.shadowOffsetX = dist;
                if (shadow.sides === 'left') ctx.shadowOffsetX = -dist;
                if (shadow.sides === 'top') ctx.shadowOffsetY = -dist;

                const t = (frame.style !== 'stretched') ? (parseFloat(frame.thickness) || 3) * scaleFactor : 0;
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(finalX - t, finalY - t, finalW + 2 * t, finalH + 2 * t);
                ctx.restore();
              }

              ctx.save();
              ctx.beginPath();
              ctx.rect(finalX, finalY, finalW, finalH);
              ctx.clip();
              drawCoverImage(ctx, panelSources[slotIdx] || productImg, finalX, finalY, finalW, finalH);
              ctx.restore();

              if (frame.style !== 'stretched') {
                const thickness = (parseFloat(frame.thickness) || 3) * scaleFactor;
                drawRealisticFrame(ctx, finalX, finalY, finalW, finalH, frame.style, thickness);
              }
            });
          } else {
            slots.forEach((slot, slotIdx) => {
              const corners = slot.corners || DEFAULT_CORNERS;
              const tl = { x: corners.tl.x * W, y: corners.tl.y * H };
              const tr = { x: corners.tr.x * W, y: corners.tr.y * H };
              const br = { x: corners.br.x * W, y: corners.br.y * H };
              const bl = { x: corners.bl.x * W, y: corners.bl.y * H };

              // Calculate destination quad bounding box size
              const xs = [tl.x, tr.x, br.x, bl.x];
              const ys = [tl.y, tr.y, br.y, bl.y];
              const targetW = Math.max(10, Math.ceil(Math.max(...xs) - Math.min(...xs)));
              const targetH = Math.max(10, Math.ceil(Math.max(...ys) - Math.min(...ys)));

              // Pre-scale the high-res panel image to target quad dimensions
              const src = panelSources[slotIdx] || productImg;
              const preScaledImg = getStepScaledCanvas(src, targetW, targetH);
              warpImage(ctx, preScaledImg, [tl, tr, br, bl], 24);
            });
          }
          const base64Data = canvas.toDataURL('image/jpeg', jpegQuality);
          await axios.post(`${API_BASE}/mockup/save`, {
            productId: p.id,
            templateId: tpl.id,
            ratio,
            image: base64Data
          });
        }
      }
    }

    // 2. Statik şablonlarda da kısa kenarı tamamla.
    for (const tpl of staticTpls) {
      try {
        const staticImg = await loadImage(`http://localhost:3001/${tpl.background_path}`);
        const ratios = (tpl.config.compatible_ratios && tpl.config.compatible_ratios.length > 0)
          ? tpl.config.compatible_ratios
          : ['2:3'];

        for (const ratio of ratios) {
          if (profile && ratio !== profile.ratio) continue;
          
          const canvas = renderCanvasRef.current;
          const ctx = canvas.getContext('2d');
          const { width: W, height: H } = getMockupOutputSize(staticImg.width, staticImg.height, minShortEdge);
          canvas.width = W;
          canvas.height = H;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(staticImg, 0, 0, W, H);
          
          const base64Data = canvas.toDataURL('image/jpeg', jpegQuality);
          await axios.post(`${API_BASE}/mockup/save`, {
            productId: p.id,
            templateId: `static_${tpl.id}`,
            ratio,
            image: base64Data
          });
        }
      } catch (staticErr) {
        console.error("Static template copy failed:", staticErr);
      }
    }
  };

  // Queue Worker useEffect
  useEffect(() => {
    const CONCURRENCY_LIMIT = 4;
    const activeTasks = queue.filter(t => t.status === 'processing');
    const pendingTasks = queue.filter(t => t.status === 'pending');

    if (activeTasks.length < CONCURRENCY_LIMIT && pendingTasks.length > 0) {
      const nextTask = pendingTasks[0];

      // Mark the task as processing immediately in state
      setQueue(prev => prev.map(t => t.id === nextTask.id ? { ...t, status: 'processing' } : t));

      // Asynchronously process the task to allow subsequent tasks to begin
      (async () => {
        try {
            if (nextTask.type === 'seo') {
              const { data: aiSettings } = await axios.get(`${API_BASE}/settings`);
              if (aiSettings.nvidia_model === 'desktop-agent') {
                setQueue(prev => prev.map(t => t.id === nextTask.id
                  ? { ...t, detail: 'AI Agent sonucu bekleniyor' } : t));
              }
              const res = await axios.post(`${API_BASE}/ai/generate`, { productId: nextTask.productId });
              const modelUsed = res.data._meta?.model === 'desktop-agent'
                ? 'AI Agent' : res.data._meta?.model || 'Bilinmeyen Model';
            const isFallback = res.data._meta?.fallbackUsed ? ' (Yedek Model)' : '';
            showToast(`"${nextTask.productTitle}" SEO içerikleri ${modelUsed}${isFallback} ile oluşturuldu.`, 'success');
            if (selectedProduct && selectedProduct.id === nextTask.productId) {
              setEditTitle(res.data.title);
              setEditTags(res.data.tags);
              setEditDescription(res.data.description);
            }
          } else if (nextTask.type === 'mockup') {
            const p = products.find(prod => prod.id === nextTask.productId);
            if (p) {
              await generateMockupsForProduct(p);
              showToast(`"${nextTask.productTitle}" mockupları oluşturuldu.`, 'success');
              if (selectedProduct && selectedProduct.id === p.id) {
                fetchProductMockups(p.id);
              }
            }
          } else if (nextTask.type === 'publish') {
            const p = products.find(prod => prod.id === nextTask.productId);
            if (p) {
              const res = await axios.post(`${API_BASE}/etsy/upload-listing`, {
                productId: p.id,
                shipping_profile_id: overrides.shipping_profile_id || null,
                return_policy_id: overrides.return_policy_id || null,
                shop_section_id: overrides.shop_section_id || null,
                readiness_state_id: overrides.readiness_state_id || null,
                listing_state: overrides.listing_state || 'draft'
              });
              
              await axios.put(`${API_BASE}/products/${p.id}`, {
                status: 'live',
                etsy_listing_id: res.data.listing_id
              });
              showToast(`"${nextTask.productTitle}" başarıyla Etsy'de yayınlandı!`, 'success');
              if (selectedProduct && selectedProduct.id === p.id) {
                setSelectedProduct(null);
              }
            }
          }

          setQueue(prev => prev.map(t => t.id === nextTask.id ? { ...t, status: 'completed' } : t));
        } catch (err) {
          console.error(`Queue task failed:`, err);
          showToast(`"${nextTask.productTitle}" işlemi başarısız oldu.`, 'error');
          setQueue(prev => prev.map(t => t.id === nextTask.id ? { ...t, status: 'failed' } : t));
        } finally {
          await fetchProducts();
        }
      })();
    }
  }, [queue, products, selectedProduct, overrides]);

  // Queue Idle Cleanup useEffect
  useEffect(() => {
    const activeCount = queue.filter(t => t.status === 'pending' || t.status === 'processing').length;
    if (activeCount === 0 && queue.length > 0) {
      const timer = setTimeout(() => {
        setQueue([]);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [queue]);

  // SEO Generating logic
  const handleSingleSEO = (productId) => {
    addToQueue([productId], 'seo');
  };

  const handleGenerateAllSEO = () => {
    const drafts = products.filter(p => p.status !== 'live');
    const targets = selectedDraftIds.length > 0 
      ? drafts.filter(p => selectedDraftIds.includes(p.id)) 
      : drafts;

    if (targets.length === 0) {
      showToast('Sihirlenecek taslak ürün bulunmamaktadır.', 'info');
      return;
    }
    addToQueue(targets.map(t => t.id), 'seo');
  };

  // Mockup generation logic
  const handleSingleMockup = (p) => {
    if (!p.variation_profile_id) {
      showToast('Lütfen önce varyasyon profili seçin.', 'error');
      return;
    }
    addToQueue([p.id], 'mockup');
  };

  const handleGenerateAllMockups = () => {
    const drafts = products.filter(p => p.status !== 'live');
    const targets = selectedDraftIds.length > 0 
      ? drafts.filter(p => selectedDraftIds.includes(p.id)) 
      : drafts;

    if (targets.length === 0) {
      showToast('Taslak ürün bulunmamaktadır.', 'info');
      return;
    }

    const noProfileTargets = targets.filter(t => !t.variation_profile_id);
    if (noProfileTargets.length > 0) {
      showToast(`${noProfileTargets.length} adet ürünün varyasyon profili seçilmemiş.`, 'error');
      return;
    }

    addToQueue(targets.map(t => t.id), 'mockup');
  };

  // Publishing to Etsy
  const handlePublishSingle = (productId) => {
    addToQueue([productId], 'publish');
  };

  const handlePublishAllReady = () => {
    const readyProducts = products.filter(p => p.status !== 'live' && isProductReady(p));
    const targets = selectedDraftIds.length > 0 
      ? readyProducts.filter(p => selectedDraftIds.includes(p.id)) 
      : readyProducts;

    if (targets.length === 0) {
      showToast('Yayınlanmaya hazır taslak ürün bulunamadı.', 'info');
      return;
    }
    addToQueue(targets.map(t => t.id), 'publish');
  };

  // Deleting product
  const handleDeleteProduct = async (productId) => {
    if (!confirm('Bu ürünü ve oluşturulmuş mockuplarını silmek istediğinizden emin misiniz?')) return;
    try {
      await axios.delete(`${API_BASE}/products/${productId}`);
      showToast('Ürün başarıyla silindi.', 'success');
      setSelectedProduct(null);
      await fetchProducts();
    } catch (err) {
      console.error(err);
      showToast('Ürün silinirken hata oluştu.', 'error');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedDraftIds.length === 0) return;
    if (!confirm(`Seçilen ${selectedDraftIds.length} ürünü silmek istediğinizden emin misiniz?`)) return;
    
    setLoading(true);
    try {
      for (const id of selectedDraftIds) {
        await axios.delete(`${API_BASE}/products/${id}`);
      }
      showToast('Seçilen ürünler silindi.', 'success');
      setSelectedDraftIds([]);
      await fetchProducts();
    } catch (err) {
      console.error(err);
      showToast('Silme işlemi sırasında hata oluştu.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Mockup list in detail view
  const fetchProductMockups = async (productId) => {
    try {
      const res = await axios.get(`${API_BASE}/mockup/list/${productId}`);
      setSelectedProductMockups(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteMockup = async (productId, filename) => {
    try {
      await axios.delete(`${API_BASE}/mockup/delete/${productId}/${filename}`);
      showToast('Mockup silindi.', 'success');
      await fetchProductMockups(productId);
      await fetchProducts();
    } catch (err) {
      console.error(err);
      showToast('Mockup silinemedi.', 'error');
    }
  };

  // Open detail panel
  const handleOpenDetail = (p) => {
    setSelectedProduct(p);
    setEditTitle(p.title || '');
    setEditDescription(p.description || '');
    setEditTags(p.tags || []);
    setEditProfileId(p.variation_profile_id || '');
    setEditSectionId(p.shop_section_id || '');

    fetchProductMockups(p.id);
  };

  // Save detail panel changes
  const handleSaveProductDetails = async () => {
    if (!selectedProduct) return;
    setLoading(true);
    try {


      await axios.put(`${API_BASE}/products/${selectedProduct.id}`, {
        title: editTitle,
        description: editDescription,
        tags: editTags,
        variation_profile_id: editProfileId || null,
        shop_section_id: editSectionId || null,
        status: selectedProduct.status
      });
      showToast('Ürün detayları kaydedildi.', 'success');
      await fetchProducts();
      setSelectedProduct(null);
    } catch (err) {
      console.error(err);
      showToast(err.response?.data?.error || 'Ürün kaydedilirken hata oluştu.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Tag editing functions
  const handleAddTag = () => {
    const cleanTag = newTagInput.trim();
    if (!cleanTag) return;
    if (cleanTag.length > 20) {
      showToast('Tag uzunluğu 20 karakteri aşamaz.', 'error');
      return;
    }
    if (editTags.length >= 13) {
      showToast('En fazla 13 tag ekleyebilirsiniz.', 'error');
      return;
    }
    if (editTags.includes(cleanTag)) {
      showToast('Bu tag zaten eklenmiş.', 'error');
      return;
    }
    setEditTags([...editTags, cleanTag]);
    setNewTagInput('');
  };

  const handleRemoveTag = (tagToRemove) => {
    setEditTags(editTags.filter(t => t !== tagToRemove));
  };

  const getParsedArray = (val) => {
    if (!val) return [];
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch (e) {
        return [];
      }
    }
    return val;
  };

  // Segregate drafts vs active
  const draftProducts = products.filter(p => p.status !== 'live');
  const activeProducts = products.filter(p => p.status === 'live');
  const isQueueActive = queue.some(t => t.status === 'pending' || t.status === 'processing');

  // Verify readiness status
  const isProductReady = (p) => {
    return p.title && p.description && p.tags && p.tags.length > 0 && p.mockup_count > 0;
  };

  return (
    <>
      <div className="max-w-7xl mx-auto py-8 px-4 animate-fade-in text-slate-100">
      {/* Hidden canvas for high-res mockup render */}
      <canvas ref={renderCanvasRef} className="hidden" />

      {/* Detail View Panel */}
      {selectedProduct ? (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between bg-[#0e1726] border border-[#1e293b] rounded-2xl p-4">
            <div className="flex items-center space-x-3">
              <button 
                onClick={() => setSelectedProduct(null)}
                className="p-2 hover:bg-[#151f32] rounded-xl text-slate-400 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h3 className="text-base font-bold text-white max-w-lg truncate">{editTitle || 'İsimsiz Ürün'}</h3>
                <span className={`inline-flex items-center mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  selectedProduct.status === 'live' 
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                }`}>
                  {selectedProduct.status === 'live' ? 'Live on Etsy' : 'Draft'}
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => handleDeleteProduct(selectedProduct.id)}
                className="flex items-center space-x-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 py-2 px-4 rounded-xl text-xs font-semibold transition-colors"
              >
                <Trash className="w-4 h-4" />
                <span>Sil</span>
              </button>
              <button
                onClick={handleSaveProductDetails}
                disabled={loading}
                className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 py-2 px-5 rounded-xl text-xs font-bold transition-colors"
              >
                Değişiklikleri Kaydet
              </button>
            </div>
          </div>

          {/* Grid Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Form Info */}
            <div className="lg:col-span-7 space-y-6">
              {/* Product Information Card */}
              <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-[#1e293b] pb-3">
                  <h4 className="text-sm font-bold text-white">Product Information</h4>
                  <button
                    onClick={() => handleSingleSEO(selectedProduct.id)}
                    disabled={loading}
                    className="flex items-center space-x-1 bg-[#8b5cf6]/10 hover:bg-[#8b5cf6]/20 text-[#a78bfa] border border-[#8b5cf6]/20 py-1.5 px-3 rounded-lg text-xs font-semibold transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Sihir (SEO)</span>
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-[11px] font-semibold text-slate-400">
                    <label>Title</label>
                    <span className={editTitle.length > 140 ? "text-rose-400" : ""}>{editTitle.length}/140</span>
                  </div>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    maxLength={140}
                    placeholder="Başlık girin"
                    className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold text-slate-400">Description</label>
                  <textarea
                    rows={6}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Açıklama girin"
                    className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-sans"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-[11px] font-semibold text-slate-400">
                    <label>Tags</label>
                    <span>{editTags.length}/13</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 bg-[#151f32] border border-[#1e293b] rounded-xl p-3 min-h-[80px]">
                    {editTags.map(tag => (
                      <span key={tag} className="inline-flex items-center space-x-1 bg-[#0e1726] border border-[#1e293b] text-slate-300 text-[10px] font-medium px-2 py-1 rounded-lg">
                        <span>{tag}</span>
                        <button onClick={() => handleRemoveTag(tag)} className="text-slate-500 hover:text-rose-400">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    {editTags.length === 0 && (
                      <span className="text-[10px] text-slate-500 italic">SEO etiketi girilmedi.</span>
                    )}
                  </div>
                  <div className="flex space-x-2 mt-1">
                    <input
                      type="text"
                      placeholder="Yeni tag ekle (Virgül ile ayırabilirsiniz)"
                      value={newTagInput}
                      onChange={(e) => {
                        if (e.target.value.endsWith(',')) {
                          const tag = e.target.value.slice(0, -1).trim();
                          if (tag && !editTags.includes(tag) && editTags.length < 13) {
                            setEditTags([...editTags, tag]);
                          }
                          setNewTagInput('');
                        } else {
                          setNewTagInput(e.target.value);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddTag();
                        }
                      }}
                      className="flex-1 bg-[#151f32] border border-[#1e293b] rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    />
                    <button
                      onClick={handleAddTag}
                      className="bg-[#151f32] border border-[#1e293b] hover:border-slate-500 px-3.5 py-2 rounded-xl text-slate-300 hover:text-white transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <span className="block text-[9px] text-slate-500">Kelimelerin arasına virgül koyarak veya Enter'a basarak ekleyebilirsiniz.</span>
                </div>
              </div>


              {/* Variations Card */}
              <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-[#1e293b] pb-3">
                  <h4 className="text-sm font-bold text-white">Variations</h4>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] text-slate-400 font-medium">Profil Seç:</span>
                    <select
                      value={editProfileId}
                      onChange={(e) => setEditProfileId(e.target.value)}
                      className="bg-[#151f32] border border-[#1e293b] rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none"
                    >
                      <option value="">Profil Yok</option>
                      {variationProfiles.map(vp => (
                        <option key={vp.id} value={vp.id}>{ratioKeyLabel(vp.ratio)} ({vp.name})</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Table */}
                {editProfileId ? (() => {
                  const selectedProfile = variationProfiles.find(vp => vp.id === editProfileId);
                  const combinations = getParsedArray(selectedProfile?.combinations) || [];
                  const displayedCombos = showAllVariations ? combinations : combinations.slice(0, 10);

                  return (
                    <div className="space-y-3">
                      <div className="overflow-x-auto border border-[#1e293b] rounded-xl">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-[#151f32] text-slate-400 font-bold border-b border-[#1e293b]">
                              <th className="px-4 py-2.5">DIMENSION</th>
                              <th className="px-4 py-2.5">FRAME</th>
                              <th className="px-4 py-2.5 text-right">PRICE ($)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayedCombos.map((c, idx) => (
                              <tr key={idx} className="border-b border-[#1e293b]/50 hover:bg-[#151f32]/20 text-slate-300">
                                <td className="px-4 py-2.5 font-medium">{c.size}</td>
                                <td className="px-4 py-2.5">{c.frame}</td>
                                <td className="px-4 py-2.5 text-right font-semibold text-emerald-400">${c.price ? Number(c.price).toFixed(2) : '0.00'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      
                      {combinations.length > 10 && (
                        <button
                          onClick={() => setShowAllVariations(!showAllVariations)}
                          className="w-full bg-[#151f32] hover:bg-[#151f32]/80 border border-[#1e293b] py-2 rounded-xl text-xs text-slate-400 font-semibold transition-colors"
                        >
                          {showAllVariations ? 'Daha Az Göster' : `Show More (${combinations.length - 10} more)`}
                        </button>
                      )}
                    </div>
                  );
                })() : (
                  <p className="text-xs text-slate-500 italic text-center py-4">Lütfen listeleme fiyat varyasyonlarını görmek için varyasyon profili seçin.</p>
                )}
              </div>
            </div>

            {/* Right Column: Images / Section */}
            <div className="lg:col-span-5 space-y-6">
              {/* Images / Mockups Card */}
              <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 space-y-4">
                <div className="border-b border-[#1e293b] pb-3">
                  <h4 className="text-sm font-bold text-white">Images</h4>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-slate-400">Base Image</label>
                  <div className="aspect-[4/3] rounded-2xl bg-slate-950 border border-[#1e293b] overflow-hidden relative">
                    <img
                      src={`http://localhost:3001/${selectedProduct.image_path}`}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <button
                    onClick={() => handleSingleMockup(selectedProduct)}
                    disabled={loading || !editProfileId}
                    className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-xs transition-colors shadow-lg shadow-purple-600/10 flex items-center justify-center space-x-2"
                  >
                    <Layers className="w-4 h-4" />
                    <span>Generate Mockups</span>
                  </button>

                  <div className="space-y-2">
                    <div className="flex justify-between text-[11px] font-semibold text-slate-400">
                      <label>Product Images ({selectedProductMockups.length}/20)</label>
                    </div>

                    <div className="grid grid-cols-3 gap-2 max-h-[200px] overflow-y-auto pr-1">
                      {selectedProductMockups.map((mockup, idx) => (
                        <div key={idx} className="aspect-square bg-slate-950 border border-[#1e293b] rounded-xl overflow-hidden relative group">
                          <img
                            src={mockup.url}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                          <button
                            onClick={() => handleDeleteMockup(selectedProduct.id, mockup.filename)}
                            className="absolute inset-0 bg-slate-950/70 opacity-0 group-hover:opacity-100 flex items-center justify-center text-rose-400 hover:text-rose-300 transition-opacity"
                          >
                            <Trash className="w-5 h-5" />
                          </button>
                        </div>
                      ))}
                      {selectedProductMockups.length === 0 && (
                        <div className="col-span-3 text-center py-6 border border-dashed border-[#1e293b] rounded-xl">
                          <p className="text-[10px] text-slate-500 italic">Mockup görseli oluşturulmadı.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Shop Section Card */}
              <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 space-y-4">
                <div className="border-b border-[#1e293b] pb-3">
                  <h4 className="text-sm font-bold text-white">Shop Section</h4>
                </div>

                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold text-slate-400">Section</label>
                  {shopSections.length > 0 ? (
                    <select
                      value={editSectionId}
                      onChange={(e) => setEditSectionId(e.target.value)}
                      className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none"
                    >
                      <option value="">Bölüm Yok (Bölümsüz)</option>
                      {shopSections.map(s => (
                        <option key={s.shop_section_id} value={s.shop_section_id.toString()}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={editSectionId}
                      onChange={(e) => setEditSectionId(e.target.value)}
                      placeholder="Bölüm ID girin"
                      className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Dashboard view */
        <div className="space-y-6">
          {/* Top Tabs */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-[#1e293b] pb-4 gap-4">
            <div className="flex space-x-2">
              {[
                { id: 'drafts', label: `Taslaklar (${draftProducts.length})` },
                { id: 'active', label: `Aktif Ürünler (${activeProducts.length})` },
                { id: 'upload', label: 'Yeni Görsel Yükle' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setView(tab.id)}
                  className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    view === tab.id
                      ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10'
                      : 'bg-[#0e1726] border border-[#1e293b] text-slate-400 hover:text-white hover:border-[#334155]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="text-xs text-slate-500 font-semibold flex items-center space-x-2">
              <span className={`w-2 h-2 rounded-full ${etsyConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              <span>{etsyConnected ? 'Etsy Mağazası Bağlı' : 'Etsy Bağlantısı Yok'}</span>
            </div>
          </div>

          {/* VIEW: DRAFTS */}
          {view === 'drafts' && (
            <div className="space-y-6">
              {/* Action Toolbar */}
              <div className="flex flex-wrap items-center justify-between bg-[#0e1726] border border-[#1e293b] rounded-2xl p-4 gap-4">
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => {
                      if (selectedDraftIds.length === draftProducts.length) {
                        setSelectedDraftIds([]);
                      } else {
                        setSelectedDraftIds(draftProducts.map(p => p.id));
                      }
                    }}
                    className="flex items-center space-x-1.5 text-xs text-slate-400 hover:text-white transition-colors"
                  >
                    <div className="w-4 h-4 rounded border border-[#1e293b] flex items-center justify-center bg-[#151f32]">
                      {selectedDraftIds.length === draftProducts.length && draftProducts.length > 0 && (
                        <Check className="w-3 h-3 text-amber-500 font-bold" />
                      )}
                    </div>
                    <span>Tümünü Seç</span>
                  </button>
                  {selectedDraftIds.length > 0 && (
                    <span className="text-xs text-slate-500 font-semibold">({selectedDraftIds.length} seçildi)</span>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleGenerateAllSEO}
                    disabled={loading || isQueueActive || draftProducts.length === 0}
                    className="flex items-center space-x-1.5 bg-purple-600/10 hover:bg-purple-600/20 text-purple-400 border border-purple-600/20 py-2 px-4 rounded-xl text-xs font-semibold transition-colors"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>{selectedDraftIds.length > 0 ? 'Seçilenleri Sihirle' : 'Hepsini Sihirle'}</span>
                  </button>

                  <button
                    onClick={handleGenerateAllMockups}
                    disabled={loading || isQueueActive || draftProducts.length === 0}
                    className="flex items-center space-x-1.5 bg-[#151f32] hover:bg-[#151f32]/80 border border-[#1e293b] text-slate-300 hover:text-white py-2 px-4 rounded-xl text-xs font-semibold transition-colors"
                  >
                    <Layers className="w-4 h-4" />
                    <span>{selectedDraftIds.length > 0 ? 'Seçilenlere Mockup' : 'Hepsini Mockup Üret'}</span>
                  </button>

                  <button
                    onClick={handlePublishAllReady}
                    disabled={loading || isQueueActive || draftProducts.length === 0}
                    className="flex items-center space-x-1.5 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-600/20 py-2 px-4 rounded-xl text-xs font-semibold transition-colors"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    <span>{selectedDraftIds.length > 0 ? 'Seçilenleri Yayınla' : 'Tüm Hazırları Yayınla'}</span>
                  </button>

                  {selectedDraftIds.length > 0 && (
                    <button
                      onClick={handleBulkDelete}
                      disabled={loading || isQueueActive}
                      className="flex items-center space-x-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 py-2 px-4 rounded-xl text-xs font-semibold transition-colors"
                    >
                      <Trash className="w-4 h-4" />
                      <span>Sil</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Draft Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {draftProducts.map(p => {
                  const isReady = isProductReady(p);
                  const isSelected = selectedDraftIds.includes(p.id);
                  const profile = variationProfiles.find(vp => vp.id === p.variation_profile_id);
                  const section = shopSections.find(s => s.shop_section_id.toString() === String(p.shop_section_id));
                  const activeTask = queue.find(t => t.productId === p.id && (t.status === 'pending' || t.status === 'processing'));
                  const isProcessingThis = !!activeTask;

                  return (
                    <div 
                      key={p.id} 
                      className={`bg-[#0e1726] border rounded-3xl overflow-hidden transition-all duration-300 relative group flex flex-col justify-between ${
                        isSelected ? 'border-amber-500 ring-2 ring-amber-500/20' : 'border-[#1e293b] hover:border-slate-800'
                      } ${isProcessingThis ? 'pointer-events-none opacity-50' : ''}`}
                    >
                      {/* Loading overlay for active task */}
                      {isProcessingThis && (
                        <div className="absolute inset-0 bg-[#0b0f19]/70 backdrop-blur-[1px] flex flex-col items-center justify-center z-20 space-y-2">
                          <RefreshCw className="w-6 h-6 text-amber-500 animate-spin" />
                          <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">
                            {activeTask.type === 'seo' ? 'Sihirleniyor...' : activeTask.type === 'mockup' ? 'Mockup Üretiliyor...' : 'Yayınlanıyor...'}
                          </span>
                        </div>
                      )}
                      {/* Checkbox */}
                      <div className="absolute top-3 left-3 z-10">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDraftIds(prev => 
                              isSelected ? prev.filter(id => id !== p.id) : [...prev, p.id]
                            );
                          }}
                          className="w-5 h-5 rounded-lg border border-[#1e293b] bg-slate-900/80 hover:bg-slate-900 flex items-center justify-center transition-colors"
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 text-amber-500 font-bold" />}
                        </button>
                      </div>

                      {/* Status */}
                      <div className="absolute top-3 right-3 z-10">
                        {isReady ? (
                          <span className="bg-emerald-500/95 backdrop-blur-sm text-slate-950 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-emerald-400/20">Hazır</span>
                        ) : (
                          <span className="bg-amber-500/90 backdrop-blur-sm text-slate-950 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-amber-400/20">Hazırlanıyor</span>
                        )}
                      </div>

                      {/* Card Content (Click opens detail) */}
                      <div className="cursor-pointer flex-grow" onClick={() => handleOpenDetail(p)}>
                        <div className="aspect-[4/3] bg-slate-950 overflow-hidden relative">
                          <img 
                            src={`http://localhost:3001/${p.image_path}`} 
                            alt="" 
                            className="w-full h-full object-cover"
                          />
                        </div>

                        {/* Title / Info */}
                        <div className="p-5 space-y-4">
                          <h4 className="font-bold text-sm text-white line-clamp-2 min-h-[40px]">{p.title || 'İsimsiz Ürün'}</h4>

                          {/* Tags Preview */}
                          <div className="flex flex-wrap gap-1">
                            {p.tags.slice(0, 4).map(tag => (
                              <span key={tag} className="text-[9px] bg-[#151f32] text-slate-400 px-2 py-0.5 rounded-lg border border-[#1e293b]">{tag}</span>
                            ))}
                            {p.tags.length > 4 && (
                              <span className="text-[9px] text-slate-500 font-semibold">+{p.tags.length - 4} daha</span>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-4 border-t border-[#1e293b] pt-3 text-xs">
                            <div>
                              <span className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider">Profil</span>
                              <span className="font-semibold text-slate-300 truncate block">{profile ? profile.name : 'Seçilmedi'}</span>
                            </div>
                            <div>
                              <span className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider">Bölüm</span>
                              <div className="flex items-center space-x-1 mt-0.5">
                                <span className="font-semibold text-slate-300 truncate block flex-grow">{section ? section.title : 'Bölüm Yok'}</span>
                                {p.mockup_count > 0 && (
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        await axios.post(`${API_BASE}/products/${p.id}/open-folder`);
                                      } catch (err) {
                                        console.error(err);
                                        alert(err.response?.data?.error || 'Klasör açılamadı.');
                                      }
                                    }}
                                    className="p-1 hover:bg-slate-800 text-amber-500 hover:text-amber-400 rounded-lg transition-colors flex-shrink-0"
                                    title="Mockup Klasörünü Aç"
                                  >
                                    <Folder className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Actions footer */}
                      <div className="p-4 border-t border-[#1e293b] bg-slate-950/20 grid grid-cols-3 gap-2">
                        <button
                          onClick={() => handleSingleSEO(p.id)}
                          className="flex items-center justify-center space-x-1 bg-[#151f32] hover:bg-[#1c2942] border border-[#1e293b] hover:border-slate-800 text-slate-300 py-2 px-1 rounded-xl text-[11px] font-semibold transition-all"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Sihir</span>
                        </button>

                        {isReady ? (
                          <button
                            onClick={() => handlePublishSingle(p.id)}
                            className="flex items-center justify-center space-x-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 px-1 rounded-xl text-[11px] font-bold transition-all shadow-md shadow-emerald-600/10"
                          >
                            <ShoppingBag className="w-3.5 h-3.5" />
                            <span>Yayınla</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleSingleMockup(p)}
                            className="flex items-center justify-center space-x-1 bg-[#151f32] hover:bg-[#1c2942] border border-[#1e293b] hover:border-slate-800 text-slate-300 py-2 px-1 rounded-xl text-[11px] font-semibold transition-all"
                          >
                            <Layers className="w-3.5 h-3.5" />
                            <span>Mockup</span>
                          </button>
                        )}

                        <button
                          onClick={() => handleDeleteProduct(p.id)}
                          className="flex items-center justify-center space-x-1 bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/20 text-rose-400 py-2 px-1 rounded-xl text-[11px] font-semibold transition-all"
                        >
                          <Trash className="w-3.5 h-3.5" />
                          <span>Sil</span>
                        </button>
                      </div>
                    </div>
                  );
                })}

                {draftProducts.length === 0 && (
                  <div className="col-span-full bg-[#0e1726] border border-[#1e293b] border-dashed rounded-3xl p-16 text-center text-slate-500">
                    <AlertTriangle className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                    <h4 className="font-bold text-white text-base mb-1">Taslak Ürün Bulunmuyor</h4>
                    <p className="text-xs text-slate-400 mb-6">Henüz yüklenmiş ürün taslağı yok. Hemen yeni görseller yükleyip başlayın.</p>
                    <button 
                      onClick={() => setView('upload')}
                      className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-2.5 px-6 rounded-xl text-xs transition-colors shadow-lg shadow-amber-500/10"
                    >
                      Yeni Görsel Yükle
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* VIEW: ACTIVE PRODUCTS */}
          {view === 'active' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {activeProducts.map(p => {
                  const section = shopSections.find(s => s.shop_section_id.toString() === String(p.shop_section_id));
                  return (
                    <div key={p.id} className="bg-[#0e1726] border border-[#1e293b] rounded-3xl overflow-hidden flex flex-col justify-between hover:border-slate-800 transition-all">
                      <div>
                        <div className="aspect-[4/3] bg-slate-950 overflow-hidden relative">
                          <img 
                            src={`http://localhost:3001/${p.image_path}`} 
                            alt="" 
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="p-5 space-y-3">
                          <h4 className="font-bold text-sm text-white line-clamp-2 min-h-[40px]">{p.title}</h4>
                          <div className="flex items-center space-x-1.5 text-[10px] text-emerald-400 font-bold bg-emerald-500/5 px-2.5 py-1 rounded-lg border border-emerald-500/10 w-fit">
                            <Check className="w-3.5 h-3.5" />
                            <span>Yayında (ID: {p.etsy_listing_id})</span>
                          </div>
                          <p className="text-xs text-slate-400 font-medium">Bölüm: {section ? section.title : 'Bölüm Yok'}</p>
                        </div>
                      </div>
                      <div className="p-4 border-t border-[#1e293b] bg-slate-950/20 flex space-x-2">
                        <a
                          href={`https://www.etsy.com/listing/${p.etsy_listing_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 flex items-center justify-center space-x-1 bg-amber-500 hover:bg-amber-600 text-slate-950 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md shadow-amber-500/10"
                        >
                          <ShoppingBag className="w-3.5 h-3.5" />
                          <span>Etsy'de Gör</span>
                        </a>
                        <button
                          onClick={() => handleDeleteProduct(p.id)}
                          className="bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/20 text-rose-400 py-2 px-3.5 rounded-xl text-xs transition-colors"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {activeProducts.length === 0 && (
                  <div className="col-span-full bg-[#0e1726] border border-[#1e293b] border-dashed rounded-3xl p-16 text-center text-slate-500">
                    <ShoppingBag className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                    <h4 className="font-bold text-white text-base mb-1">Aktif Ürün Bulunmuyor</h4>
                    <p className="text-xs text-slate-400">Etsy'ye yüklenmiş ve yayınlanmış aktif ürününüz bulunmuyor. Taslak sekmesinden "Yayınla" bu tonu ile yükleyebilirsiniz.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* VIEW: UPLOAD */}
          {view === 'upload' && (() => {
            const isSetMode = uploadMode !== 'single';
            const readiness = isSetMode ? setProfileReadiness() : null;
            const expectedAspect = activePanelRatio * activePanelCount;
            const expectedLabel = activeSetProfile
              ? (sourceRatioLabel(activeSetProfile.panel_ratio || activeSetProfile.ratio, activePanelCount) || expectedAspect.toFixed(2))
              : expectedAspect.toFixed(2);

            return (
            <div className="space-y-6">
              {/* Yükleme modu seçici */}
              <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-5 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { id: 'single', label: 'Tekli Ürün', desc: 'Tek görsel = tek ürün' },
                    { id: 'set2', label: 'Set of 2', desc: '2 panelli set ürün' },
                    { id: 'set3', label: 'Set of 3', desc: 'Yakında', disabled: true }
                  ].map(mode => (
                    <button
                      key={mode.id}
                      type="button"
                      disabled={mode.disabled}
                      onClick={() => {
                        if (mode.disabled || uploadMode === mode.id) return;
                        // Kuyruktaki öğeler önceki modun profiline göre hazırlandı
                        setFilesQueue([]);
                        pairQueue.forEach(pr => pr.panels.forEach(panel => URL.revokeObjectURL(panel.url)));
                        setPairQueue([]);
                        setUploadMode(mode.id);
                      }}
                      title={mode.desc}
                      className={`px-5 py-3 rounded-xl text-xs font-bold border transition-all flex flex-col items-start ${
                        mode.disabled
                          ? 'bg-[#0b1220] border-[#1e293b] text-slate-600 cursor-not-allowed'
                          : uploadMode === mode.id
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                          : 'bg-[#151f32] border-[#1e293b] text-slate-400 hover:text-white hover:border-[#334155]'
                      }`}
                    >
                      <span>{mode.label}</span>
                      <span className="text-[9px] font-medium opacity-70 mt-0.5">{mode.desc}</span>
                    </button>
                  ))}
                </div>

                {isSetMode && (
                  <div className="space-y-4 border-t border-[#1e293b] pt-4">
                    {/* Yöntem seçimi */}
                    <div className="flex flex-wrap gap-2">
                      {[
                        { id: 'auto', label: 'Otomatik', desc: 'Tek görseli ortadan böl' },
                        { id: 'manual', label: 'Manuel', desc: 'İki görseli elle eşle' }
                      ].map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            if (setMethod === m.id) return;
                            setFilesQueue([]);
                            setSetMethod(m.id);
                          }}
                          className={`px-4 py-2 rounded-lg text-[11px] font-bold border transition-all ${
                            setMethod === m.id
                              ? 'bg-amber-500 text-slate-950 border-amber-500'
                              : 'bg-[#151f32] border-[#1e293b] text-slate-400 hover:text-white'
                          }`}
                        >
                          {m.label} — <span className="font-medium opacity-80">{m.desc}</span>
                        </button>
                      ))}
                    </div>

                    {/* Mockup / varyasyon profili */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Mockup & Varyasyon Profili
                        </label>
                        <select
                          value={activeSetProfile?.id || ''}
                          onChange={(e) => setSetProfileId(e.target.value)}
                          disabled={availableSetProfiles.length === 0}
                          className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 disabled:opacity-50"
                        >
                          {availableSetProfiles.length === 0 && <option value="">Tanımlı set profili yok</option>}
                          {availableSetProfiles.map(sp => (
                            <option key={sp.id} value={sp.id}>
                              {ratioKeyLabel(sp.ratio)} — {sp.name}
                            </option>
                          ))}
                        </select>
                        {activeSetProfile && (
                          <p className="text-[10px] text-slate-500">
                            Panel başına {activeSetProfile.panel_ratio || '1:2'} · {activePanelCount} panel
                            {setMethod === 'auto' && ` · beklenen kaynak oranı ${expectedLabel}`}
                          </p>
                        )}
                      </div>

                      {/* Profil hazırlık kontrolü */}
                      <div className={`rounded-xl border p-3 space-y-1.5 ${
                        readiness?.ok
                          ? 'bg-emerald-500/5 border-emerald-500/20'
                          : 'bg-rose-500/5 border-rose-500/20'
                      }`}>
                        <div className="flex items-center space-x-2">
                          {readiness?.ok
                            ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                            : <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />}
                          <span className={`text-[11px] font-bold ${readiness?.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                            {readiness?.ok ? 'Profil yüklemeye hazır' : 'Profil eksik yapılandırılmış'}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400">
                          {readiness?.templateCount || 0} mockup şablonu · {readiness?.staticCount || 0} statik görsel · {readiness?.priceCount || 0} fiyatlı varyasyon
                        </p>
                        {readiness?.issues?.map((iss, i) => (
                          <p key={i} className="text-[10px] text-rose-300 leading-snug">• {iss}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* MANUEL SET: eşleştirme arayüzü */}
              {isSetMode && setMethod === 'manual' ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-7 space-y-6">
                    <div className="bg-[#0e1726] border-2 border-dashed border-[#1e293b] hover:border-slate-800 rounded-3xl p-10 text-center transition-all">
                      <Layers className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                      <h3 className="text-base font-bold text-white mb-2">Set ürünü oluştur</h3>
                      <p className="text-xs text-slate-500 mb-6">
                        {activePanelCount} görsel seçin; hangisinin sol hangisinin sağ panel olacağını
                        açılacak pencerede belirleyin. Görsellerin oranı serbesttir.
                      </p>
                      <label className={`bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-3 px-8 rounded-xl shadow-lg shadow-amber-500/10 transition-colors text-xs ${
                        activeSetProfile ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
                      }`}>
                        Ürün Ekle ({activePanelCount} Görsel Seç)
                        <input
                          type="file"
                          multiple
                          accept="image/*"
                          onChange={handlePairFilesSelected}
                          disabled={!activeSetProfile}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {/* Varsayılan bölüm */}
                    <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 space-y-4">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Varsayılan Mağaza Bölümü</h4>
                      <select
                        value={defaultUploadSectionId}
                        onChange={(e) => {
                          const newSection = e.target.value;
                          setDefaultUploadSectionId(newSection);
                          setPairQueue(prev => prev.map(item => ({ ...item, sectionId: newSection })));
                        }}
                        className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-xs text-slate-200 focus:outline-none"
                      >
                        <option value="">Bölüm Yok (Bölümsüz)</option>
                        {shopSections.map(s => (
                          <option key={s.shop_section_id} value={s.shop_section_id.toString()}>
                            {s.title}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      onClick={handleUploadPairs}
                      disabled={loading || pairQueue.length === 0}
                      className="w-full bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 disabled:opacity-50 text-slate-950 font-bold py-3.5 px-6 rounded-xl transition-all shadow-lg shadow-amber-500/10 text-xs flex items-center justify-center space-x-2"
                    >
                      <Upload className="w-4 h-4 text-slate-950" />
                      <span>{pairQueue.length} set ürünü yükle</span>
                    </button>
                  </div>

                  {/* Eşleştirilmiş set listesi */}
                  <div className="lg:col-span-5">
                    <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 space-y-4">
                      <h4 className="text-sm font-bold text-white border-b border-[#1e293b] pb-3">
                        Hazırlanan Setler ({pairQueue.length})
                      </h4>

                      <div className="space-y-3 max-h-[450px] overflow-y-auto pr-1">
                        {pairQueue.map(pair => (
                          <div key={pair.id} className="bg-[#151f32] border border-[#1e293b] rounded-2xl p-4 space-y-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center space-x-2">
                                {pair.panels.map((panel, pi) => (
                                  <div key={pi} className="text-center">
                                    <div className="w-12 h-16 rounded-lg bg-slate-950 border border-[#1e293b] overflow-hidden">
                                      <img src={panel.url} alt="" className="w-full h-full object-cover" />
                                    </div>
                                    <span className="text-[9px] text-slate-500 block mt-1">
                                      {pi === 0 ? 'SOL' : 'SAĞ'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              <button
                                onClick={() => {
                                  pair.panels.forEach(panel => URL.revokeObjectURL(panel.url));
                                  setPairQueue(prev => prev.filter(x => x.id !== pair.id));
                                }}
                                className="text-slate-500 hover:text-rose-400 transition-colors"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>

                            <div className="space-y-1">
                              {pair.panels.map((panel, pi) => (
                                <p key={pi} className="text-[10px] text-slate-400 truncate">
                                  <span className="text-slate-500">{pi === 0 ? 'Sol:' : 'Sağ:'}</span> {panel.name}
                                  {panel.cropped && (
                                    <span className="text-amber-500 ml-1">· panel oranına kırpıldı</span>
                                  )}
                                </p>
                              ))}
                            </div>

                            <select
                              value={pair.sectionId}
                              onChange={(e) => {
                                const newSec = e.target.value;
                                setPairQueue(prev => prev.map(q => q.id === pair.id ? { ...q, sectionId: newSec } : q));
                              }}
                              className="w-full bg-[#0e1726] border border-[#1e293b] rounded-lg px-2 py-1.5 text-[10px] text-slate-400 focus:outline-none"
                            >
                              <option value="">Bölüm Yok</option>
                              {shopSections.map(s => (
                                <option key={s.shop_section_id} value={s.shop_section_id.toString()}>
                                  {s.title}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}

                        {pairQueue.length === 0 && (
                          <p className="text-xs text-slate-500 italic text-center py-10">
                            Henüz set oluşturulmadı. Soldaki "Ürün Ekle" ile başlayın.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
              /* TEKLI ve OTOMATIK SET: klasik dropzone akışı */
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Dropzone & default section */}
              <div className="lg:col-span-7 space-y-6">
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  className={`bg-[#0e1726] border-2 border-dashed rounded-3xl p-10 text-center transition-all ${
                    dragActive ? 'border-amber-500 bg-amber-500/5' : 'border-[#1e293b] hover:border-slate-800'
                  }`}
                >
                  <Upload className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                  <h3 className="text-base font-bold text-white mb-2">Görselleri buraya sürükleyip bırakın</h3>
                  <p className="text-xs text-slate-500 mb-6">
                    {isSetMode
                      ? `${expectedLabel} oranındaki görseller ortadan ${activePanelCount} panele bölünür`
                      : 'veya dosyaları seçmek için tıklayın'}
                  </p>
                  <span className="block text-[10px] text-slate-500 mb-6 uppercase tracking-wider">Desteklenen: JPEG, JPG, PNG, WEBP • Görseller orijinal kalitesinde yüklenecektir.</span>

                  <label className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-3 px-8 rounded-xl shadow-lg shadow-amber-500/10 transition-colors cursor-pointer text-xs">
                    Dosyaları Seç
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={handleQueueFiles}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* Default Section Selector */}
                <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 space-y-4">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Varsayılan Mağaza Bölümü</h4>
                  {shopSections.length > 0 ? (
                    <select
                      value={defaultUploadSectionId}
                      onChange={(e) => {
                        const newSection = e.target.value;
                        setDefaultUploadSectionId(newSection);
                        setFilesQueue(prev => prev.map(item => ({ ...item, sectionId: newSection })));
                      }}
                      className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-xs text-slate-200 focus:outline-none"
                    >
                      <option value="">Bölüm Yok (Bölümsüz)</option>
                      {shopSections.map(s => (
                        <option key={s.shop_section_id} value={s.shop_section_id.toString()}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={defaultUploadSectionId}
                      onChange={(e) => {
                        const newSection = e.target.value;
                        setDefaultUploadSectionId(newSection);
                        setFilesQueue(prev => prev.map(item => ({ ...item, sectionId: newSection })));
                      }}
                      placeholder="Bölüm ID girin"
                      className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-xs text-slate-200 focus:outline-none"
                    />
                  )}
                  <p className="text-[10px] text-slate-500">Bu bölümde yapacağınız seçim, kuyruktaki tüm görsellere varsayılan olarak atanacaktır.</p>
                </div>

                <button
                  onClick={handleUploadQueue}
                  disabled={loading || filesQueue.length === 0}
                  className="w-full bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 disabled:opacity-50 text-slate-950 font-bold py-3.5 px-6 rounded-xl transition-all shadow-lg shadow-amber-500/10 text-xs flex items-center justify-center space-x-2"
                >
                  <Upload className="w-4 h-4 text-slate-950" />
                  <span>{filesQueue.length} dosya yükle</span>
                </button>
              </div>

              {/* Right Column: Files Queue */}
              <div className="lg:col-span-5 space-y-6">
                <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 space-y-4">
                  <h4 className="text-sm font-bold text-white border-b border-[#1e293b] pb-3">Seçilen Dosyalar ({filesQueue.length})</h4>

                  <div className="space-y-3 max-h-[450px] overflow-y-auto pr-1">
                    {filesQueue.map((item, idx) => (
                      <div key={item.id} className="bg-[#151f32] border border-[#1e293b] rounded-2xl p-4 flex items-center justify-between relative group">
                        <div className="flex items-center space-x-4">
                          <div className="w-12 h-12 rounded-lg bg-slate-950 border border-[#1e293b] overflow-hidden flex-shrink-0">
                            <img src={URL.createObjectURL(item.file)} alt="" className="w-full h-full object-cover" />
                          </div>
                          <div className="min-w-0">
                            <span className="text-xs font-semibold text-white block truncate max-w-[150px] sm:max-w-[200px]">{item.name}</span>
                            <span className="text-[10px] text-slate-500 block">{item.size}</span>
                            <span className="inline-flex mt-1 text-[9px] font-bold text-amber-500 bg-amber-500/5 px-2 py-0.5 rounded border border-amber-500/10">Profil: {item.ratioName} ({item.profileName})</span>
                            {item.isSet && !item.aspectOk && (
                              <span className="flex items-center mt-1 text-[9px] font-bold text-rose-400">
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                Oran {item.ratioVal.toFixed(2)} · beklenen {item.expectedAspect.toFixed(2)} — panellerde kırpılır
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center space-x-3">
                          {/* Individual Section Selection */}
                          <div className="flex flex-col">
                            <select
                              value={item.sectionId}
                              onChange={(e) => {
                                const newSec = e.target.value;
                                setFilesQueue(prev => prev.map(q => q.id === item.id ? { ...q, sectionId: newSec } : q));
                              }}
                              className="bg-[#0e1726] border border-[#1e293b] rounded-lg px-2 py-1 text-[10px] text-slate-400 focus:outline-none"
                            >
                              <option value="">Bölüm Yok</option>
                              {shopSections.map(s => (
                                <option key={s.shop_section_id} value={s.shop_section_id.toString()}>
                                  {s.title}
                                </option>
                              ))}
                            </select>
                          </div>

                          <button
                            onClick={() => setFilesQueue(prev => prev.filter(f => f.id !== item.id))}
                            className="text-slate-500 hover:text-rose-400 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}

                    {filesQueue.length === 0 && (
                      <p className="text-xs text-slate-500 italic text-center py-10">Dosya seçilmedi. Soldaki yükleme alanını kullanın.</p>
                    )}
                  </div>
                </div>
              </div>
              </div>
              )}
            </div>
            );
          })()}
        </div>
      )}

      {/* Manuel set eşleştirme modalı */}
      {pairModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl w-full max-w-3xl p-8 space-y-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Panel Sırasını Belirleyin</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Görsellerin sette hangi tarafta duracağını seçin. Aşağıdaki önizleme,
                  mockup'ta çıkacak yerleşimin aynısıdır.
                </p>
              </div>
              <button
                onClick={closePairModal}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Panel önizlemeleri */}
            <div className="flex items-stretch justify-center gap-4">
              {pairModal.order.map((fileIdx, slotIdx) => (
                <React.Fragment key={slotIdx}>
                  <div className="flex-1 max-w-[220px] space-y-2">
                    <div className="flex items-center justify-center">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1">
                        {slotIdx === 0 ? 'Sol Panel' : slotIdx === 1 ? 'Sağ Panel' : `Panel ${slotIdx + 1}`}
                      </span>
                    </div>
                    <div
                      className="bg-slate-950 border-2 border-amber-500/40 rounded-xl overflow-hidden mx-auto"
                      style={{ aspectRatio: String(activePanelRatio), maxHeight: '320px' }}
                    >
                      <img
                        src={pairModal.urls[fileIdx]}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 text-center truncate px-2">
                      {pairModal.files[fileIdx].name}
                    </p>
                  </div>

                  {slotIdx < pairModal.order.length - 1 && (
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => swapPairOrder(slotIdx, slotIdx + 1)}
                        title="Panelleri yer değiştir"
                        className="bg-[#151f32] hover:bg-slate-700 border border-[#334155] text-slate-300 hover:text-white rounded-xl p-2.5 transition-colors"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>

            <div className="bg-[#151f32] border border-[#1e293b] rounded-2xl p-4 text-[11px] text-slate-400 space-y-1">
              <p>
                <span className="text-slate-300 font-semibold">Profil:</span>{' '}
                {activeSetProfile ? `${ratioKeyLabel(activeSetProfile.ratio)} — ${activeSetProfile.name}` : 'Seçilmedi'}
              </p>
              <p>
                Görseller panel oranına ({activeSetProfile?.panel_ratio || '1:2'}) göre merkezden
                kırpılıp tek kaynak görselde birleştirilir; mockup üretiminde tekrar sol/sağ olarak ayrılır.
              </p>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={closePairModal}
                disabled={pairBusy}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-3 px-6 rounded-xl border border-[#334155] text-xs transition-colors"
              >
                Vazgeç
              </button>
              <button
                onClick={confirmPair}
                disabled={pairBusy || !activeSetProfile}
                className="flex items-center space-x-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold py-3 px-6 rounded-xl text-xs shadow-lg shadow-amber-500/10 transition-colors"
              >
                {pairBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>{pairBusy ? 'Birleştiriliyor...' : 'Seti Kuyruğa Ekle'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast.show && (
        <div className={`fixed ${queue.length > 0 ? 'bottom-[180px]' : 'bottom-5'} right-5 z-50 flex items-center space-x-3 bg-slate-900/90 backdrop-blur-md border rounded-2xl px-5 py-4 shadow-2xl animate-fade-in-up transition-all duration-300 ${
          toast.type === 'error' 
            ? 'border-rose-500/30 text-rose-200' 
            : toast.type === 'info'
            ? 'border-blue-500/30 text-blue-200'
            : 'border-emerald-500/30 text-emerald-200'
        }`}>
          <div className={`w-2.5 h-2.5 rounded-full animate-pulse ${
            toast.type === 'error' 
              ? 'bg-rose-500' 
              : toast.type === 'info'
              ? 'bg-blue-500'
              : 'bg-emerald-500'
          }`} />
          <span className="text-xs font-semibold text-white tracking-wide">{toast.message}</span>
        </div>
      )}
      </div>

      {/* Queue Progress Modal */}
      {queue.length > 0 && (() => {
        const activeTasks = queue.filter(t => t.status === 'pending' || t.status === 'processing');
        const completedTasks = queue.filter(t => t.status === 'completed' || t.status === 'failed');
        const total = queue.length;
        const current = completedTasks.length;
        const isDone = activeTasks.length === 0;
        
        const sampleTask = activeTasks[0] || queue[queue.length - 1];
        const typeLabel = sampleTask.detail || (sampleTask.type === 'seo' ? 'İçerik Sihirleniyor' : sampleTask.type === 'mockup' ? 'Mockup Hazırlanıyor' : 'Etsy\'de Yayınlanıyor');
        const percent = Math.round((current / total) * 100);

        return (
          <div className="fixed bottom-6 right-6 z-[9999] bg-[#0e1726]/90 backdrop-blur-xl border border-[#1e293b] rounded-2xl p-5 shadow-2xl w-80 text-xs text-slate-100 flex flex-col space-y-3 animate-fade-in-up transition-all duration-300">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white flex items-center space-x-2">
                {isDone ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <RefreshCw className="w-4 h-4 text-amber-500 animate-spin" />
                )}
                <span>
                  {isDone ? 'İşlemler Tamamlandı' : `${current + 1}/${total} ${typeLabel}...`}
                </span>
              </span>
              <span className="text-[10px] text-slate-400 font-semibold">{percent}%</span>
            </div>

            {!isDone && activeTasks[0] && (
              <div className="text-[10px] text-slate-400 truncate">
                Aktif: <span className="text-slate-200 font-medium">{activeTasks[0].productTitle}</span>
              </div>
            )}
            {isDone && (
              <div className="text-[10px] text-slate-400">
                {total} ürün başarıyla güncellendi.
              </div>
            )}

            <div className="w-full bg-[#151f32] h-2 rounded-full overflow-hidden border border-[#1e293b]/50">
              <div 
                className={`h-full transition-all duration-500 ease-out ${isDone ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-500 to-rose-500'}`}
                style={{ width: `${percent}%` }}
              />
            </div>

            {isDone && (
              <button 
                onClick={() => setQueue([])} 
                className="w-full bg-[#151f32] hover:bg-[#1e293b] border border-[#1e293b] text-slate-300 py-1.5 rounded-lg text-[10px] font-bold transition-all"
              >
                Kapat
              </button>
            )}
          </div>
        );
      })()}
    </>
  );
}
