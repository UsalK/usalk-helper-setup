import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import {
  Plus, Save, Layers, Frame, Compass, Sliders, CheckCircle,
  Trash2, Crop, Move, HelpCircle, RefreshCw, CheckSquare, Square,
  GripVertical, ArrowUp, ArrowDown, X, Shuffle, Lock, Unlock, Pin, Eye, ListOrdered,
  ScanLine, Wand2, Ruler, ChevronLeft, ChevronRight, AlertTriangle, ZoomIn
} from 'lucide-react';

import {
  parseRatio, parseRatioKey, isSetRatioKey, ratioKeyLabel,
  layoutPanels, placementToCorners, buildPanelSources,
  DEFAULT_PLACEMENT, DEFAULT_CORNERS
} from '../utils/panels';
import { detectMockupQuads } from '../utils/mockupDetect';
import {
  measureQuad, nearestRatioKey, suggestTemplateName, cornersToPlacement
} from '../utils/quadGeometry';
import { warpImage } from '../utils/homography';
import { pickPanelRow } from '../utils/panelRow';

const API_BASE = 'http://localhost:3001/api';

// Bir oranın mockup dizilim ayarının varsayılanı (backend/services/MockupOrder.js ile aynı)
const DEFAULT_ORDER = {
  enabled: false,
  thumbnailFirst: true,
  mode: 'custom',
  pinned: [],
  restMode: 'random',
  staticLast: true
};

/* ------------------------------------------------------------------ */
/* Editör tercihleri — tarayıcıda kalıcı                               */
/* ------------------------------------------------------------------ */

const PREFS_KEY = 'usalkHelper.templateStudio.prefs';

const readPrefs = () => {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

/** Tercihi kalıcı yazar; depolama kapalıysa yalnızca bu oturumda geçerli olur. */
const writePref = (key, value) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), [key]: value }));
  } catch {
    /* yoksay */
  }
};

const boolPref = (key, fallback) => {
  const value = readPrefs()[key];
  return typeof value === 'boolean' ? value : fallback;
};

/** Önizleme yakınlaştırma kademeleri: tıkladıkça sırayla dolaşılır. */
const ZOOM_STEPS = [1, 1.5, 2];

const templateKey = (t) => (t.type === 'static' ? `static_${t.id}` : t.id);
const isThumbTemplate = (t) => {
  if (!t) return false;
  const cfgThumb = t.config?.is_thumbnail === true || t.config?.is_thumbnail === 'true';
  const nameThumb = (t.name || '').toLowerCase().startsWith('thumb');
  return cfgThumb || nameThumb;
};

const FRAME_OPTIONS = [
  { id: 'stretched', name: 'Stretched Wood (Çerçevesiz)' },
  { id: 'black_frame', name: 'Black Frame (Siyah)' },
  { id: 'white_frame', name: 'White Frame (Beyaz)' },
  { id: 'gold_frame', name: 'Gold Frame (Altın)' },
  { id: 'silver_frame', name: 'Silver Frame (Gümüş)' },
  { id: 'natural_wood', name: 'Natural Wood (Doğal Ahşap)' },
  { id: 'walnut', name: 'Walnut (Ceviz)' }
];

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
}

/**
 * Önizleme için sentetik bir deneme eseri üretir. Gerçek bir ürün görseli
 * yüklemeye gerek kalmadan köşelerin doğru oturup oturmadığı görülür:
 * ızgara çizgileri perspektif bozulmasını, kenar şeridi ise taşmayı gösterir.
 */
const buildPreviewArtwork = (ratio) => {
  const H = 900;
  const W = Math.max(120, Math.round(H * (ratio || 1)));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(0.45, '#b45309');
  grad.addColorStop(1, '#fde68a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Ölçüm ızgarası
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.30)';
  ctx.lineWidth = Math.max(1, H / 500);
  for (let i = 1; i < 8; i++) {
    const y = (H * i) / 8;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  const cols = Math.max(2, Math.round(8 * (W / H)));
  for (let i = 1; i < cols; i++) {
    const x = (W * i) / cols;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  // Köşe taşmasını yakalamak için kenar şeridi
  const inset = Math.round(H * 0.035);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = Math.max(2, H / 130);
  ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);

  ctx.beginPath();
  ctx.moveTo(inset, inset);
  ctx.lineTo(W - inset, H - inset);
  ctx.moveTo(W - inset, inset);
  ctx.lineTo(inset, H - inset);
  ctx.stroke();

  return canvas;
};

export default function TemplateStudio() {
  const [templates, setTemplates] = useState([]);
  const [variationProfiles, setVariationProfiles] = useState([]);
  const [view, setView] = useState('list'); // 'list' | 'editor'
  
  // Library sharing states
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [libraryTemplates, setLibraryTemplates] = useState([]);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState([]);
  const [selectedLibraryShopId, setSelectedLibraryShopId] = useState(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  
  // Static templates tab state
  const [activeSubTab, setActiveSubTab] = useState('mockup'); // 'mockup' | 'static' | 'order'

  // Mockup sıralama (dizilim) state'i
  const [orderConfig, setOrderConfig] = useState({}); // { '2:3': {...}, ... }
  const [orderRatio, setOrderRatio] = useState('2:3');
  const [orderPreview, setOrderPreview] = useState([]);
  const [orderPreviewLoading, setOrderPreviewLoading] = useState(false);
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderDirty, setOrderDirty] = useState(false);
  const [dragKey, setDragKey] = useState(null);
  const [staticName, setStaticName] = useState('');
  const [staticFile, setStaticFile] = useState(null);
  const [staticRatios, setStaticRatios] = useState(['2:3']);
  const [showStaticUpload, setShowStaticUpload] = useState(false);

  const handleSaveStaticImage = async (e) => {
    e.preventDefault();
    if (!staticName.trim()) {
      alert('Lütfen bir isim girin.');
      return;
    }
    if (!staticFile) {
      alert('Lütfen bir görsel seçin.');
      return;
    }
    if (staticRatios.length === 0) {
      alert('Lütfen en az bir uyumlu oran seçin.');
      return;
    }

    const config = {
      compatible_ratios: staticRatios,
      is_thumbnail: isStaticThumbnail
    };

    const formData = new FormData();
    formData.append('name', staticName);
    formData.append('type', 'static');
    formData.append('config', JSON.stringify(config));
    formData.append('background', staticFile);

    setLoading(true);
    try {
      await axios.post(`${API_BASE}/templates`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setShowStaticUpload(false);
      setStaticName('');
      setStaticFile(null);
      setStaticRatios(['2:3']);
      setIsStaticThumbnail(false);
      fetchTemplates();
    } catch (err) {
      console.error(err);
      alert('Görsel kaydedilirken hata oluştu.');
    } finally {
      setLoading(false);
    }
  };
  const [loading, setLoading] = useState(false);
  const [filterRatio, setFilterRatio] = useState('All');
  const [bgImage, setBgImage] = useState(null); // Image object
  const [bgFile, setBgFile] = useState(null); // File object
  const [bgUrl, setBgUrl] = useState('');

  // Template Form Config State
  const [name, setName] = useState('');
  const [type, setType] = useState('flat'); // 'flat' | 'perspective'
  const [compatibleRatios, setCompatibleRatios] = useState(['2:3']);
  const [activeRatio, setActiveRatio] = useState('2:3');
  const [isThumbnail, setIsThumbnail] = useState(false);
  const [isStaticThumbnail, setIsStaticThumbnail] = useState(false);
  
  // Panel yerleşimleri (normalize 0-1).
  // Tek panelli klasik şablonlarda dizi tek elemanlıdır; Set of 2 gibi çok
  // panelli şablonlarda her panel ayrı bir slot olur (0 = sol, 1 = sağ).
  const [slots, setSlots] = useState([
    { placement: DEFAULT_PLACEMENT, corners: DEFAULT_CORNERS }
  ]);
  const [activeSlot, setActiveSlot] = useState(0);

  // Set şablonlarında panellere görselin nasıl dağıtılacağı
  const [setSource, setSetSource] = useState('split'); // 'split' | 'duplicate'
  const [panelGap, setPanelGap] = useState(0.03);      // panel arası boşluk (0-1)

  // Aktif panelin yerleşimi. Aşağıdaki setter'lar sayesinde tüm mevcut
  // sürükleme/klavye mantığı tek panelliymiş gibi çalışmaya devam eder.
  const flatPlacement = slots[activeSlot]?.placement || DEFAULT_PLACEMENT;
  const corners = slots[activeSlot]?.corners || DEFAULT_CORNERS;

  // Panel kilitleri (yalnızca çok panelli düz/flat şablonlarda).
  // Referans her zaman sol paneldir; kilitli özellik diğer panellere ondan
  // yansır ve diğer panellerde tek başına değiştirilemez.
  const [panelLocks, setPanelLocks] = useState({ x: true, y: true, size: true });
  const REF_SLOT = 0;

  const placementOf = (slot) => slot?.placement || DEFAULT_PLACEMENT;

  /** Panelleri, aralarındaki mevcut boşlukları koruyarak yan yana yeniden dizer. */
  const respaceKeepingGaps = (source, target) => {
    for (let i = 1; i < target.length; i++) {
      const gap = placementOf(source[i]).x
        - (placementOf(source[i - 1]).x + placementOf(source[i - 1]).width);
      target[i].placement.x = target[i - 1].placement.x + target[i - 1].placement.width + gap;
    }
  };

  /** Kilitli özellikleri referans panelden diğerlerine yansıtır. */
  const alignSlotsToReference = (list, locks) => {
    if (list.length < 2) return list;
    const ref = placementOf(list[REF_SLOT]);
    const out = list.map(s => ({ ...s, placement: { ...placementOf(s) } }));

    out.forEach((slot, idx) => {
      if (idx === REF_SLOT) return;
      if (locks.y) slot.placement.y = ref.y;
      if (locks.size) {
        slot.placement.width = ref.width;
        slot.placement.height = ref.height;
      }
    });

    if (locks.size) respaceKeepingGaps(list, out);
    return out;
  };

  /**
   * Bir panel değiştikten sonra kilit kurallarını uygular.
   *  - X kilidi  : sol panelin yatay hareketi diğerlerine aynen taşınır
   *                (aradaki boşluk sabit kalır), diğer paneller yatayda kilitli
   *  - Y kilidi  : diğer paneller sol panelin Y'sine hizalanır
   *  - Boyut kilidi: diğer paneller sol panelin ölçüsünü alır, boşluklar korunur
   */
  const applyPanelLocks = (prevSlots, nextSlots, changedIdx) => {
    if (type !== 'flat' || nextSlots.length < 2) return nextSlots;
    if (!panelLocks.x && !panelLocks.y && !panelLocks.size) return nextSlots;

    const out = nextSlots.map(s => ({ ...s, placement: { ...placementOf(s) } }));
    const refNext = placementOf(nextSlots[REF_SLOT]);
    const refPrev = placementOf(prevSlots[REF_SLOT]);

    if (changedIdx === REF_SLOT) {
      const dx = refNext.x - refPrev.x;
      const sizeChanged = refNext.width !== refPrev.width || refNext.height !== refPrev.height;

      out.forEach((slot, idx) => {
        if (idx === REF_SLOT) return;
        if (panelLocks.x) slot.placement.x = placementOf(prevSlots[idx]).x + dx;
        if (panelLocks.y) slot.placement.y = refNext.y;
        if (panelLocks.size) {
          slot.placement.width = refNext.width;
          slot.placement.height = refNext.height;
        }
      });

      // Ölçü değiştiyse paneller boşluk korunacak şekilde yeniden dizilir
      if (panelLocks.size && sizeChanged) respaceKeepingGaps(prevSlots, out);
    } else {
      // Referans olmayan panelde kilitli özellikler değiştirilemez
      const slot = out[changedIdx];
      if (panelLocks.x) slot.placement.x = placementOf(prevSlots[changedIdx]).x;
      if (panelLocks.y) slot.placement.y = refNext.y;
      if (panelLocks.size) {
        slot.placement.width = refNext.width;
        slot.placement.height = refNext.height;
      }
    }

    return out;
  };

  const updateActiveSlot = (field, fallback, updater) => {
    setSlots(prev => {
      const next = prev.map((slot, idx) => {
        if (idx !== activeSlot) return slot;
        const current = slot[field] || fallback;
        return { ...slot, [field]: typeof updater === 'function' ? updater(current) : updater };
      });
      return field === 'placement' ? applyPanelLocks(prev, next, activeSlot) : next;
    });
  };

  /** Kilidi açıp kapatır; açarken panelleri hemen referansa hizalar. */
  const togglePanelLock = (key) => {
    const nextLocks = { ...panelLocks, [key]: !panelLocks[key] };
    setPanelLocks(nextLocks);
    if (nextLocks[key] && type === 'flat') {
      setSlots(prev => alignSlotsToReference(prev, nextLocks));
    }
  };

  const setFlatPlacement = (updater) => updateActiveSlot('placement', DEFAULT_PLACEMENT, updater);
  const setCorners = (updater) => updateActiveSlot('corners', DEFAULT_CORNERS, updater);

  // Flat styling
  const [frameStyle, setFrameStyle] = useState('black_frame');
  const [frameThickness, setFrameThickness] = useState(3.0);
  const [shadowEnabled, setShadowEnabled] = useState(true);
  const [shadowSides, setShadowSides] = useState('bottom');
  const [shadowOpacity, setShadowOpacity] = useState(3.0);
  const [shadowDistance, setShadowDistance] = useState(5.0);
  const [shadowBlur, setShadowBlur] = useState(6.0);


  // Editor Interaction State
  const [activeHandle, setActiveHandle] = useState(null); // null | 'tl' | 'tr' | 'br' | 'bl' | 'center' (flat) | 'corner-tl' | 'corner-tr' | 'corner-br' | 'corner-bl' (perspective)
  const [selectedHandle, setSelectedHandle] = useState(null); // persists after mouseup for keyboard fine-tuning
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [zoomPoint, setZoomPoint] = useState(null); // null | {x, y} for magnifying glass

  // Otomatik şablon tanıma
  const [scanState, setScanState] = useState('idle'); // idle | scanning | done | empty
  const [scanPhase, setScanPhase] = useState('');
  const [detections, setDetections] = useState([]);
  const [detectionIndex, setDetectionIndex] = useState(0);
  // Otomatik davranış anahtarları kullanıcı tercihidir; tarayıcıda saklanır.
  const [autoRatioOn, setAutoRatioOn] = useState(() => boolPref('autoRatioOn', true));
  const [autoNameOn, setAutoNameOn] = useState(() => boolPref('autoNameOn', true));
  // Set şablonunda paneller otomatik yerleşti mi? null = tek panelli şablon
  const [panelRowFound, setPanelRowFound] = useState(null);
  const scanTokenRef = useRef(0);

  // Önizleme (köşelere yerleşmiş deneme eseri)
  const [previewOn, setPreviewOn] = useState(() => boolPref('previewOn', true));
  const [previewArt, setPreviewArt] = useState(null);
  const [previewCustom, setPreviewCustom] = useState(null);

  // Önizleme incelemesi: yakınlaştırma, gezinme ve editör katmanının solması
  const [zoomLevel, setZoomLevel] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [overlayOpaque, setOverlayOpaque] = useState(false);
  const [hoverHandle, setHoverHandle] = useState(null);
  const panDragRef = useRef(null);     // sağ tık ile gezinme başlangıcı
  const clickStartRef = useRef(null);  // basit tıklama mı sürükleme mi
  const overlayFadeRef = useRef(null); // 1 sn sonra %20'ye dönüş

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const zoomTimeoutRef = useRef(null);

  // Tuvalin sığdırılacağı sahne alanının ölçüsü. containerRef tuvali saran
  // kutu olduğu için genişliği tuvalden türer (döngüsel); ölçüm bu yüzden bir
  // üstteki sabit yükseklikli sahneden alınır.
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    fetchTemplates();
    fetchVariationProfiles();
    fetchOrderConfig();
  }, []);

  // Keyboard navigation for selected handle (fine-tuning)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (view !== 'editor' || !selectedHandle || !bgImage) return;

      const w = canvasRef.current?.width || 100;
      const h = canvasRef.current?.height || 100;

      let dx = 0;
      let dy = 0;

      if (e.key === 'ArrowLeft') dx = -1;
      else if (e.key === 'ArrowRight') dx = 1;
      else if (e.key === 'ArrowUp') dy = -1;
      else if (e.key === 'ArrowDown') dy = 1;

      if (dx === 0 && dy === 0) return;

      // Klavyeyle ince ayar da bir düzenlemedir: editör katmanı tam görünür olur
      boostOverlay();

      // Prevent window scrolling
      e.preventDefault();

      // Clear any pending zoom fade out timers when key is held down or pressed
      if (zoomTimeoutRef.current) {
        clearTimeout(zoomTimeoutRef.current);
        zoomTimeoutRef.current = null;
      }

      const speed = e.shiftKey ? 10 : 1;

      // Calculate step relative to original high-res image dimensions to allow 1px edits
      const stepX = 1 / bgImage.width;
      const stepY = 1 / bgImage.height;

      if (type === 'perspective' && selectedHandle.startsWith('corner-')) {
        const cornerKey = selectedHandle.replace('corner-', '');
        setCorners(prev => {
          const current = prev[cornerKey];
          const newX = Math.max(0, Math.min(1, current.x + dx * speed * stepX));
          const newY = Math.max(0, Math.min(1, current.y + dy * speed * stepY));
          
          // Show magnifying glass at new position
          setZoomPoint({ x: newX * w, y: newY * h });
          
          return {
            ...prev,
            [cornerKey]: { x: newX, y: newY }
          };
        });
      } else if (type === 'flat' && selectedHandle === 'center') {
        setFlatPlacement(prev => {
          const newX = Math.max(0, Math.min(1 - prev.width, prev.x + dx * speed * stepX));
          const newY = Math.max(0, Math.min(1 - prev.height, prev.y + dy * speed * stepY));
          return {
            ...prev,
            x: newX,
            y: newY
          };
        });
      }
    };

    const handleKeyUp = (e) => {
      if (e.key.startsWith('Arrow')) {
        if (zoomTimeoutRef.current) {
          clearTimeout(zoomTimeoutRef.current);
        }
        zoomTimeoutRef.current = setTimeout(() => {
          setZoomPoint(null);
          zoomTimeoutRef.current = null;
        }, 1500); // Keep magnifier visible for 1.5 seconds after releasing arrow key
        if (previewActive) scheduleOverlayFade();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (zoomTimeoutRef.current) {
        clearTimeout(zoomTimeoutRef.current);
      }
    };
  }, [view, selectedHandle, type, bgImage]);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/templates`);
      setTemplates(res.data);
    } catch (err) {
      console.error('Şablonlar yüklenemedi:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchVariationProfiles = async () => {
    try {
      const res = await axios.get(`${API_BASE}/variations`);
      setVariationProfiles(res.data || []);
    } catch (err) {
      console.error('Varyasyon profilleri yüklenemedi:', err);
    }
  };

  const fetchOrderConfig = async () => {
    try {
      const res = await axios.get(`${API_BASE}/templates/mockup-order`);
      setOrderConfig(res.data?.config || {});
      setOrderDirty(false);
    } catch (err) {
      console.error('Mockup dizilim ayarı yüklenemedi:', err);
    }
  };

  const ratioPresets = variationProfiles.length > 0
    ? Array.from(new Set(variationProfiles.map(p => p.ratio)))
    : ['2:3', '3:2', '1:1', '12:7', '7:12', '12:5'];

  // Seçili oran, mevcut oran listesinde yoksa ilk orana düş
  useEffect(() => {
    if (ratioPresets.length > 0 && !ratioPresets.includes(orderRatio)) {
      setOrderRatio(ratioPresets[0]);
    }
  }, [variationProfiles]);

  /* ---------------- Panel (Set of 2 vb.) yardımcıları ---------------- */

  // Çizim oranı anahtarı panel sayısını da taşır: '1:2x2' → 1:2 oranında 2 panel
  const { ratio: activePanelRatio, panelCount: activePanelCount } = parseRatioKey(activeRatio);
  const isSetTemplate = activePanelCount > 1;

  // Aktif panelin ölçümleri: kenar uzunlukları, perspektif sapması ve
  // perspektif düzeltmesi yapılmış gerçek en/boy oranı.
  const measurement = bgImage
    ? measureQuad(
        type === 'perspective' ? corners : placementToCorners(flatPlacement),
        bgImage.naturalWidth || bgImage.width,
        bgImage.naturalHeight || bgImage.height
      )
    : null;

  // Köşeler, aktif panel veya mod değiştiğinde öneriyi canlı ölçümden türet.
  // Hedef oran yalnızca kullanıcı seçtiğinde / yeni tarama uygulandığında değişir.
  const autoRatio = measurement
    ? nearestRatioKey(measurement.aspect, ratioPresets)
    : null;

  /* ------------------------------------------------------------------ */
  /* Önizleme incelemesi                                                 */
  /* ------------------------------------------------------------------ */

  /** Tuvalde bir eser görünüyor mu: yakınlaştırma ve solma buna bağlı. */
  const previewActive = !!(previewOn && previewArt && bgImage);
  const zoomed = zoomLevel > 1;

  // Editör katmanı (dörtgen, tutamaçlar, etiketler) saydamlığı.
  // Yakınlaştırıldığında tamamen gizlenir; eser görünürken sönük durur ve
  // yalnızca kullanıcı bir noktayı tutunca tam görünür olur.
  const overlayAlpha = !previewActive ? 1 : (zoomed ? 0 : (overlayOpaque ? 1 : 0.2));

  /** Noktayı tutar tutmaz katman tam görünür olur. */
  const boostOverlay = () => {
    if (overlayFadeRef.current) {
      clearTimeout(overlayFadeRef.current);
      overlayFadeRef.current = null;
    }
    setOverlayOpaque(true);
  };

  /** Bırakıldıktan 1 sn sonra sönük seviyeye geri döner. */
  const scheduleOverlayFade = () => {
    if (overlayFadeRef.current) clearTimeout(overlayFadeRef.current);
    overlayFadeRef.current = setTimeout(() => {
      overlayFadeRef.current = null;
      setOverlayOpaque(false);
    }, 1000);
  };

  useEffect(() => () => {
    if (overlayFadeRef.current) clearTimeout(overlayFadeRef.current);
  }, []);

  /** Yakınlaştırma kaydırmasını görsel tuvali doldurmaya devam edecek şekilde sınırlar. */
  const clampPan = (p, z, w, h) => ({
    x: Math.min(0, Math.max(w - w * z, p.x)),
    y: Math.min(0, Math.max(h - h * z, p.y))
  });

  const resetZoom = () => {
    setZoomLevel(1);
    setPan({ x: 0, y: 0 });
  };

  // Yeni arka plan yüklenince ya da önizleme kapanınca yakınlaştırma sıfırlanır
  useEffect(() => { resetZoom(); }, [bgImage]);
  useEffect(() => { if (!previewActive) resetZoom(); }, [previewActive]);

  // Önizleme eseri: kullanıcı kendi görselini yüklemediyse çizim oranında
  // sentetik bir deneme eseri üretilir.
  useEffect(() => {
    if (previewCustom) {
      setPreviewArt(previewCustom);
      return;
    }
    // 'split' modunda kaynak görsel panellere bölündüğü için setin tamamının
    // oranında üretilir; bölündüğünde her dilim panel oranına oturur.
    const sourceRatio = (activePanelCount > 1 && setSource === 'split')
      ? activePanelRatio * activePanelCount
      : activePanelRatio;
    setPreviewArt(buildPreviewArtwork(sourceRatio));
  }, [activePanelRatio, activePanelCount, setSource, previewCustom]);

  /**
   * Panel başına önizleme kaynağı. Render motoruyla aynı mantık:
   * 'split' → tek görsel panel sayısı kadar dikey dilime bölünür,
   * 'duplicate' → aynı görsel her panelde tekrar eder.
   *
   * Sürükleme sırasında her karede yeniden dilimlememek için önbelleklenir.
   */
  const previewSources = useMemo(() => {
    if (!previewArt) return null;
    return buildPanelSources(previewArt, slots.length, setSource);
  }, [previewArt, slots.length, setSource]);

  // Oran değişince otomatik ad da güncellenir (kullanıcı adı elle yazdıysa
  // autoNameOn kapanır ve buraya girilmez).
  useEffect(() => {
    if (!autoNameOn || !bgImage) return;
    setName(suggestTemplateName(activeRatio, measurement?.aspect, templates.map(t => t.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRatio, autoNameOn, bgImage]);

  const handlePreviewUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      // Önizleme her yeniden çizimde üçgen üçgen warp edildiği için büyük
      // görseller editörü yavaşlatır; küçültülmüş bir kopya yeterli.
      const maxDim = 1000;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      if (scale === 1) {
        setPreviewCustom(img);
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setPreviewCustom(canvas);
      }
      setPreviewOn(true);
    };
    img.src = URL.createObjectURL(file);
  };

  const panelLabel = (idx, total) => {
    if (total <= 1) return 'Sanat Eseri Yerleşim Alanı';
    if (total === 2) return idx === 0 ? 'Sol Panel' : 'Sağ Panel';
    return `Panel ${idx + 1}`;
  };

  /** Panelleri arka plan üzerinde simetrik, eşit aralıklı dizer. */
  const buildAutoLayout = (count = activePanelCount, gap = panelGap) => {
    const bgRatio = bgImage ? bgImage.width / bgImage.height : 1;

    // Paneller tuvale sığmıyorsa yüksekliği küçültüp orana sadık kal
    let height = 0.5;
    const widthAt = (hh) => (hh * activePanelRatio) / bgRatio;
    const totalAt = (hh) => count * widthAt(hh) + (count - 1) * gap;
    if (totalAt(height) > 0.9) height *= 0.9 / totalAt(height);

    return layoutPanels(activePanelRatio, count, gap, height, 0.5, bgRatio)
      .map(item => ({
        placement: item.placement,
        corners: placementToCorners(item.placement)
      }));
  };

  const applyAutoLayout = () => {
    if (!bgImage) return;
    setSlots(buildAutoLayout());
    setActiveSlot(0);
  };

  // Çizim oranı değişince panel sayısını eşitle
  useEffect(() => {
    setSlots(prev => {
      if (prev.length === activePanelCount) return prev;
      if (!bgImage) {
        const next = [...prev];
        while (next.length < activePanelCount) {
          next.push({ placement: DEFAULT_PLACEMENT, corners: DEFAULT_CORNERS });
        }
        return next.slice(0, activePanelCount);
      }
      return buildAutoLayout();
    });
    setActiveSlot(0);
  }, [activeRatio, bgImage]);

  // Set oranına geçildiğinde paneller simetrik yerine tanınan çerçevelere
  // oturur. Yukarıdaki efektten sonra çalışır ve onun kurduğu simetrik
  // yerleşimi ezer. Tek panelli oranlarda çalışmaz.
  useEffect(() => {
    if (activePanelCount < 2 || !bgImage || detections.length === 0) return;
    applyDetection(detections, detectionIndex, bgImage, { panelCount: activePanelCount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePanelCount, detections]);

  /* ---------------- Mockup dizilim yardımcıları ---------------- */

  const currentOrder = { ...DEFAULT_ORDER, ...(orderConfig[orderRatio] || {}) };

  // Bu orana ait şablonlar (mockup + statik)
  const orderTemplates = templates.filter(t => {
    const ratios = (t.config?.compatible_ratios && t.config.compatible_ratios.length > 0)
      ? t.config.compatible_ratios
      : ['2:3'];
    return ratios.includes(orderRatio);
  });
  const orderTemplateByKey = new Map(orderTemplates.map(t => [templateKey(t), t]));

  // Sabitlenmiş sıra: sadece bu oranda gerçekten var olan şablonlar
  const pinnedKeys = currentOrder.pinned.filter(k => orderTemplateByKey.has(k));
  // Thumbnail kuralı açıkken sabitlenen ilk thumbnail kapak (1. sıra) olur
  const coverKey = currentOrder.thumbnailFirst
    ? pinnedKeys.find(k => isThumbTemplate(orderTemplateByKey.get(k))) || null
    : null;
  const pinnedRows = pinnedKeys.filter(k => k !== coverKey);
  const poolTemplates = orderTemplates.filter(t => !pinnedKeys.includes(templateKey(t)));
  const thumbCount = orderTemplates.filter(isThumbTemplate).length;

  const patchOrder = (patch) => {
    setOrderConfig(prev => ({
      ...prev,
      [orderRatio]: { ...DEFAULT_ORDER, ...(prev[orderRatio] || {}), ...patch }
    }));
    setOrderDirty(true);
  };

  // Kapak her zaman dizinin başında tutulur; backend de ilk thumbnail'ı kapak sayar
  const setPinnedRows = (rows) => patchOrder({ pinned: coverKey ? [coverKey, ...rows] : rows });

  const addPinned = (key) => patchOrder({ enabled: true, pinned: [...pinnedKeys, key] });
  const removePinned = (key) => patchOrder({ pinned: pinnedKeys.filter(k => k !== key) });

  const movePinned = (key, direction) => {
    const idx = pinnedRows.indexOf(key);
    const target = idx + direction;
    if (idx === -1 || target < 0 || target >= pinnedRows.length) return;
    const rows = [...pinnedRows];
    [rows[idx], rows[target]] = [rows[target], rows[idx]];
    setPinnedRows(rows);
  };

  const handleDropOnRow = (targetKey) => {
    if (!dragKey || dragKey === targetKey) return;
    const rows = pinnedRows.filter(k => k !== dragKey);
    const targetIdx = rows.indexOf(targetKey);
    rows.splice(targetIdx === -1 ? rows.length : targetIdx, 0, dragKey);
    if (!pinnedKeys.includes(dragKey)) patchOrder({ enabled: true });
    setPinnedRows(rows);
    setDragKey(null);
  };

  const handleDropOnList = () => {
    if (!dragKey || pinnedKeys.includes(dragKey)) return;
    addPinned(dragKey);
    setDragKey(null);
  };

  const handleDropOnPool = () => {
    if (!dragKey || !pinnedKeys.includes(dragKey)) return;
    removePinned(dragKey);
    setDragKey(null);
  };

  const runOrderPreview = async () => {
    setOrderPreviewLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/templates/mockup-order/preview`, {
        ratio: orderRatio,
        order: currentOrder
      });
      setOrderPreview(res.data?.items || []);
    } catch (err) {
      console.error('Dizilim önizlemesi alınamadı:', err);
      alert('Dizilim önizlemesi alınamadı.');
    } finally {
      setOrderPreviewLoading(false);
    }
  };

  const saveOrderConfig = async () => {
    setOrderSaving(true);
    try {
      // Tüm oranlar tek seferde kaydedilir; oran değiştirince veri kaybolmaz
      await axios.put(`${API_BASE}/templates/mockup-order`, { config: orderConfig });
      setOrderDirty(false);
    } catch (err) {
      console.error('Dizilim kaydedilemedi:', err);
      alert('Dizilim kaydedilirken hata oluştu.');
    } finally {
      setOrderSaving(false);
    }
  };

  const fetchLibraryTemplates = async () => {
    setLibraryLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/templates/other-shops`);
      setLibraryTemplates(res.data);
      if (res.data.length > 0) {
        const uniqueShopIds = Array.from(new Set(res.data.map(t => t.shop_id)));
        if (uniqueShopIds.length > 0) {
          setSelectedLibraryShopId(uniqueShopIds[0]);
        }
      } else {
        setSelectedLibraryShopId(null);
      }
    } catch (err) {
      console.error('Kütüphane şablonları yüklenemedi:', err);
    } finally {
      setLibraryLoading(false);
    }
  };

  const handleCopyTemplates = async (ids) => {
    if (!ids || ids.length === 0) return;
    try {
      await axios.post(`${API_BASE}/templates/copy`, { templateIds: ids });
      alert('Şablon(lar) başarıyla kütüphaneden dükkanınıza kopyalandı!');
      setSelectedLibraryIds([]);
      setShowLibraryModal(false);
      fetchTemplates();
    } catch (err) {
      console.error('Şablonlar kopyalanamadı:', err);
      alert('Kopyalama işlemi başarısız oldu.');
    }
  };

  useEffect(() => {
    if (showLibraryModal) {
      setSelectedLibraryIds([]);
      setSelectedLibraryShopId(null);
      fetchLibraryTemplates();
    }
  }, [showLibraryModal]);

  // Redraw Canvas when configuration changes
  useEffect(() => {
    if (view === 'editor' && bgImage) {
      drawEditor();
    }
  }, [view, bgImage, type, slots, activeSlot, panelLocks, frameStyle, frameThickness, shadowEnabled, shadowSides, shadowOpacity, shadowDistance, shadowBlur, activeHandle, previewOn, previewArt, previewSources, stageSize, zoomLevel, pan, overlayAlpha]);

  // Sahne alanı büyüdükçe/küçüldükçe tuval yeniden sığdırılır.
  useEffect(() => {
    const el = stageRef.current;
    if (view !== 'editor' || !bgImage || !el || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setStageSize(prev => (
        Math.abs(prev.w - rect.width) < 1 && Math.abs(prev.h - rect.height) < 1
          ? prev
          : { w: rect.width, h: rect.height }
      ));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [view, bgImage]);

  const handleCreateNew = () => {
    setBgImage(null);
    setBgFile(null);
    setBgUrl('');
    setName('');
    setType('flat');
    setCompatibleRatios(['2:3']);
    setActiveRatio('2:3');
    setSlots([{ placement: DEFAULT_PLACEMENT, corners: DEFAULT_CORNERS }]);
    setActiveSlot(0);
    setSetSource('split');
    setPanelGap(0.03);
    setPanelLocks({ x: true, y: true, size: true });
    setFrameStyle('black_frame');
    setFrameThickness(3.0);
    setShadowEnabled(true);
    setShadowSides('bottom');
    setShadowOpacity(3.0);
    setShadowDistance(5.0);
    setShadowBlur(6.0);
    setIsThumbnail(false);
    scanTokenRef.current++;
    setScanState('idle');
    setScanPhase('');
    setDetections([]);
    setDetectionIndex(0);
    // Anahtarlar kullanıcı tercihine döner, sabit varsayılana değil
    setAutoRatioOn(boolPref('autoRatioOn', true));
    setAutoNameOn(boolPref('autoNameOn', true));
    setPreviewOn(boolPref('previewOn', true));
    setPreviewCustom(null);
    resetZoom();
    setOverlayOpaque(false);
    setHoverHandle(null);
    setView('editor');
  };

  const handleBgUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setBgFile(file);
    const img = new Image();
    // onload, src atamasindan once baglanir: onbellekten gelen gorseller
    // aninda yuklenip olayi kacirmasin.
    img.onload = () => {
      setBgImage(img);
      runAutoScan(img);
    };
    img.src = URL.createObjectURL(file);
  };

  /* ------------------------------------------------------------------ */
  /* Otomatik şablon tanıma                                              */
  /* ------------------------------------------------------------------ */

  /** Aday bulunamazsa: çizim oranında, ortalanmış bir başlangıç dörtgeni. */
  const fallbackCorners = (image) => {
    const bgRatio = (image.naturalWidth || image.width) / (image.naturalHeight || image.height);
    const { ratio } = parseRatioKey(activeRatio);
    const [{ placement }] = layoutPanels(ratio, 1, 0, 0.55, 0.5, bgRatio);
    return placementToCorners(placement);
  };

  /**
   * Bulunan adaylardan birini editöre uygular: köşeler yerleşir, ölçülen
   * gerçek orana en yakın varyasyon oranı seçilir ve şablon adı üretilir.
   */
  /** Bir dörtgeni panele yazar (perspektif köşeleri + düz mod yerleşimi). */
  const slotFromCorners = (slot, corners) => ({
    ...slot,
    corners,
    placement: cornersToPlacement(corners)
  });

  /**
   * @param {object} opts
   *   panelCount — kaç panele dağıtılacağı (varsayılan: mevcut çizim oranı)
   *   ratioKey   — tarama sonucu seçilen oran; state henüz güncellenmediği için
   *                ölçülen tek panel oranıyla çakışmasın diye açıkça verilir
   */
  const applyDetection = (list, index, image, opts = {}) => {
    const panelCount = opts.panelCount ?? activePanelCount;
    const forcedRatio = opts.ratioKey || null;

    const cand = list[index];
    const target = image || bgImage;
    if (!cand || !target) return;

    setDetectionIndex(index);

    const imgW = target.naturalWidth || target.width;
    const imgH = target.naturalHeight || target.height;

    // Çok panelli sette adaylardan yan yana duran bir seri aranır; bulunursa
    // paneller soldan sağa kendi çerçevelerine oturur. Bulunamazsa (ör. sahnede
    // tek çerçeve var) yalnızca aktif panel yerleştirilir.
    const row = panelCount > 1 ? pickPanelRow(list, panelCount) : null;
    setPanelRowFound(panelCount > 1 ? !!row : null);

    const primary = row ? row.panels[0] : cand;
    const m = measureQuad(primary.corners, imgW, imgH);

    // Perspektif köşeleri ile düz mod yerleşimi birlikte güncellenir; kullanıcı
    // mod değiştirdiğinde yeniden çizim yapmak zorunda kalmaz.
    setSlots(prev => {
      if (row) {
        // Panel sayısı kadar slot garanti edilir
        const next = Array.from({ length: panelCount }, (_, i) =>
          prev[i] || { placement: DEFAULT_PLACEMENT, corners: DEFAULT_CORNERS });
        return next.map((slot, idx) =>
          row.panels[idx] ? slotFromCorners(slot, row.panels[idx].corners) : slot);
      }
      return prev.map((slot, idx) =>
        idx === activeSlot ? slotFromCorners(slot, cand.corners) : slot);
    });
    setType('perspective');

    const nearest = nearestRatioKey(m.aspect, ratioPresets);

    // Set şablonunda çizim oranını kullanıcı bilerek seçer; ölçülen tek panel
    // oranı buna karışmaz.
    const isSet = forcedRatio ? isSetRatioKey(forcedRatio) : isSetTemplate;
    const ratioApplied = !forcedRatio && !!nearest && autoRatioOn && !isSet;

    if (forcedRatio) {
      setActiveRatio(forcedRatio);
      setCompatibleRatios([forcedRatio]);
    } else if (ratioApplied) {
      setActiveRatio(nearest.key);
      setCompatibleRatios([nearest.key]);
    }
    if (autoNameOn) {
      // Ad, gerçekten kullanılan orandan üretilir. Aksi halde set şablonunda
      // oran "2:3 × 2 panel" iken ad "7:12 Dikey" olabiliyordu.
      const key = forcedRatio || (ratioApplied ? nearest.key : activeRatio);
      setName(suggestTemplateName(key, m.aspect, templates.map(t => t.name)));
    }
  };

  /**
   * Sahnede yan yana N panel varsa ve o panel oranının N'li set karşılığı
   * tanımlıysa, çizim oranı olarak seti önerir.
   *
   * Tek panelli bir şablonu yanlışlıkla sete çevirmemek için iki koşul birden
   * aranır: adaylar gerçekten bir seri oluşturmalı (pickPanelRow) ve ölçülen
   * panel oranı tanımlı bir set anahtarına yeterince yakın olmalı.
   */
  const suggestSetRatio = (candidates, image) => {
    if (!image || candidates.length < 2) return null;
    const imgW = image.naturalWidth || image.width;
    const imgH = image.naturalHeight || image.height;

    for (const count of [3, 2]) {
      const row = pickPanelRow(candidates, count);
      if (!row) continue;

      // Ölçülen panel oranı, TANIMLI set oranlarıyla karşılaştırılır. Tek panel
      // oranlarının en yakınını alıp sonuna "xN" eklemek işe yaramıyor: gerçek
      // çerçeveler 7:12'ye yakın ölçülebiliyor ama tanımlı set 2:3x2 oluyor.
      const options = ratioPresets.filter(
        key => isSetRatioKey(key) && parseRatioKey(key).panelCount === count
      );
      if (options.length === 0) continue;

      const m = measureQuad(row.panels[0].corners, imgW, imgH);
      const best = nearestRatioKey(m.aspect, options, { allowSets: true });
      if (best && best.error <= 0.20) return { setKey: best.key, count };
    }
    return null;
  };

  /**
   * Yüklenen sahne görselini tarar. Tarama animasyonu göz kırpıp kaybolmasın
   * diye en az ~1.1 sn ekranda tutulur.
   */
  const runAutoScan = async (image) => {
    const target = image || bgImage;
    if (!target) return;

    const token = ++scanTokenRef.current;
    setScanState('scanning');
    setScanPhase('Görsel hazırlanıyor');
    setDetections([]);
    setDetectionIndex(0);

    const startedAt = Date.now();
    let found = [];
    try {
      found = await detectMockupQuads(target, {
        // Set şablonlarında panelleri eşleştirmek için daha geniş bir havuz gerekir
        maxCandidates: 8,
        onPhase: (phase) => {
          if (scanTokenRef.current === token) setScanPhase(phase);
        }
      });
    } catch (err) {
      console.error('Otomatik şablon tanıma başarısız:', err);
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed < 1100) await new Promise(resolve => setTimeout(resolve, 1100 - elapsed));
    if (scanTokenRef.current !== token) return;

    setDetections(found);
    if (found.length === 0) {
      setScanState('empty');
      const corners = fallbackCorners(target);
      setSlots(prev => prev.map((slot, idx) => (
        idx === activeSlot ? { ...slot, corners, placement: cornersToPlacement(corners) } : slot
      )));
      return;
    }

    // Sahnede yan yana panel serisi varsa çizim oranı doğrudan sete alınır;
    // kullanıcı "2:3" görüp "×2"yi elle aramak zorunda kalmaz.
    const setSuggestion = autoRatioOn ? suggestSetRatio(found, target) : null;
    applyDetection(found, 0, target, setSuggestion
      ? { panelCount: setSuggestion.count, ratioKey: setSuggestion.setKey }
      : {});
    setScanState('done');
  };

  const cycleDetection = (delta) => {
    if (detections.length < 2) return;
    const next = (detectionIndex + delta + detections.length) % detections.length;
    applyDetection(detections, next, bgImage, { panelCount: activePanelCount });
  };

  const drawEditor = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Tuvali sahne alanına sığdır (contain): görsel alanı tamamen kaplar,
    // oranı korunur. Ölçü sahneden alınır; tuvali saran kutudan alınırsa
    // genişlik tuvalin kendisinden türeyeceği için her çizimde büyür.
    const stage = stageRef.current;
    if (!stage) return;

    const maxWidth = stageSize.w || stage.clientWidth;
    const maxHeight = stageSize.h || stage.clientHeight;
    if (maxWidth < 2 || maxHeight < 2) return;

    // Küçük görseller de alanı doldurur; aşırı bulanıklaşmasın diye 3 katla sınırlı.
    const scale = Math.min(maxWidth / bgImage.width, maxHeight / bgImage.height, 3);
    const w = Math.max(1, Math.round(bgImage.width * scale));
    const h = Math.max(1, Math.round(bgImage.height * scale));

    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    // Yakınlaştırma/gezinme yalnızca çizime uygulanır: tuval ölçüsü sabit
    // kalır, sahne içine büyütülmüş bir kesit çizilir.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    if (zoomLevel !== 1 || pan.x !== 0 || pan.y !== 0) {
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoomLevel, zoomLevel);
    }

    // Draw background image
    ctx.drawImage(bgImage, 0, 0, w, h);

    // Önizleme: deneme eseri köşelere/dikdörtgene gerçek render mantığıyla
    // yerleştirilir, böylece kaydetmeden önce sonuç görülür.
    // Perspektif modda eser doğrudan köşelere warp edilir. Düz modda ise
    // drawFlatOverlay içinde, gölge çizildikten SONRA yerleştirilir; aksi
    // halde gölgeyi oluşturan beyaz dikdörtgen eserin üstünü kapatır.
    const art = (previewOn && previewArt) ? previewArt : null;
    if (art && type === 'perspective') {
      slots.forEach((slot, idx) => {
        const source = previewSources?.[idx] || art;
        const c = slot.corners || DEFAULT_CORNERS;
        warpImage(ctx, source, [
          { x: c.tl.x * w, y: c.tl.y * h },
          { x: c.tr.x * w, y: c.tr.y * h },
          { x: c.br.x * w, y: c.br.y * h },
          { x: c.bl.x * w, y: c.bl.y * h }
        ], 12);
      });
    }

    // Draw overlays based on type
    if (type === 'flat') {
      // Düz modda gölge ve çerçeve çıktının parçasıdır; solma yalnızca
      // editör öğelerine uygulanır, bu yüzden saydamlık içeride yönetilir.
      drawFlatOverlay(ctx, w, h, !!art, overlayAlpha);
    } else if (overlayAlpha > 0) {
      ctx.globalAlpha = overlayAlpha;
      drawPerspectiveOverlay(ctx, w, h, !!art);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  };

  const drawFlatOverlay = (ctx, w, h, hasPreview = false, chromeAlpha = 1) => {
    // Gölge, eser ve çerçeve mockup çıktısının parçasıdır ve her zaman tam
    // görünür çizilir. Karartma, dörtgen çizgisi, tutamaçlar ve etiketler ise
    // editör öğesidir; önizleme incelenirken sönükleşir.
    const chrome = (draw) => {
      if (chromeAlpha <= 0) return;
      ctx.globalAlpha = chromeAlpha;
      draw();
      ctx.globalAlpha = 1;
    };

    const rects = slots.map(slot => {
      const p = slot.placement || DEFAULT_PLACEMENT;
      return { x: p.x * w, y: p.y * h, w: p.width * w, h: p.height * h };
    });

    // Panellerin dışında kalan alanı karart, panel içlerinde arka planı geri
    // getir. Önizleme açıkken paneller zaten eserle dolu olduğu için sadece
    // dışarısı karartılır.
    chrome(() => {
      ctx.fillStyle = `rgba(0, 0, 0, ${hasPreview ? 0.28 : 0.4})`;
      ctx.fillRect(0, 0, w, h);
    });
    rects.forEach(r => {
      // Önizlemede panelin içi zaten eserle doldurulacağı için arka planı
      // geri getirmeye gerek yok.
      if (hasPreview) return;
      ctx.drawImage(
        bgImage,
        (r.x / w) * bgImage.width, (r.y / h) * bgImage.height,
        (r.w / w) * bgImage.width, (r.h / h) * bgImage.height,
        r.x, r.y, r.w, r.h
      );
    });

    rects.forEach((r, idx) => {
      const isActive = idx === activeSlot;

      // Draw shadow if enabled
      if (shadowEnabled) {
        ctx.save();
        ctx.shadowColor = `rgba(0, 0, 0, ${shadowOpacity / 10})`;
        ctx.shadowBlur = shadowBlur;

        if (shadowSides === 'all' || shadowSides === 'bottom') {
          ctx.shadowOffsetY = shadowDistance;
        }
        if (shadowSides === 'all' || shadowSides === 'right') {
          ctx.shadowOffsetX = shadowDistance;
        }
        if (shadowSides === 'left') {
          ctx.shadowOffsetX = -shadowDistance;
        }
        if (shadowSides === 'top') {
          ctx.shadowOffsetY = -shadowDistance;
        }

        const t = (frameStyle !== 'stretched') ? parseFloat(frameThickness) || 0 : 0;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(r.x - t, r.y - t, r.w + 2 * t, r.h + 2 * t);
        ctx.restore();
      }

      // Eser (önizleme) gölgenin üstüne, çerçevenin altına gelir
      if (hasPreview) {
        ctx.drawImage(previewSources?.[idx] || previewArt, r.x, r.y, r.w, r.h);
      } else {
        chrome(() => {
          ctx.fillStyle = 'rgba(245, 158, 11, 0.1)';
          ctx.fillRect(r.x, r.y, r.w, r.h);
        });
      }

      // Draw borders & frame thickness
      if (frameStyle !== 'stretched') {
        drawRealisticFrame(ctx, r.x, r.y, r.w, r.h, frameStyle, frameThickness);
      }

      chrome(() => {
        // Outer bounding border — pasif paneller kesikli çizilir
        ctx.strokeStyle = isActive ? '#f59e0b' : 'rgba(245, 158, 11, 0.45)';
        ctx.lineWidth = isActive ? 1.5 : 1;
        ctx.setLineDash(isActive ? [] : [5, 4]);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.setLineDash([]);

        if (isActive) {
          // Draw center indicator
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(r.x + r.w / 2, r.y + r.h / 2, 4, 0, Math.PI * 2);
          ctx.fill();

          // Draw resize handles (TL, TR, BR, BL)
          drawHandle(ctx, r.x, r.y);
          drawHandle(ctx, r.x + r.w, r.y);
          drawHandle(ctx, r.x + r.w, r.y + r.h);
          drawHandle(ctx, r.x, r.y + r.h);
        }

        // Bounding dimensions text
        ctx.fillStyle = isActive ? '#ffffff' : 'rgba(255, 255, 255, 0.65)';
        ctx.font = '10px Inter';
        // Kilit aktifken referans panel ve kilitli paneller ayırt edilsin
        const anyLock = panelLocks.x || panelLocks.y || panelLocks.size;
        const suffix = (rects.length > 1 && anyLock)
          ? (idx === REF_SLOT ? ' · referans' : ' · kilitli')
          : '';
        ctx.fillText(panelLabel(idx, rects.length) + suffix, r.x + 6, r.y + 16);
      });
    });
  };

  const drawPerspectiveOverlay = (ctx, w, h, hasPreview = false) => {
    slots.forEach((slot, idx) => {
      const c = slot.corners || DEFAULT_CORNERS;
      const isActive = idx === activeSlot;

      const tl = { x: c.tl.x * w, y: c.tl.y * h };
      const tr = { x: c.tr.x * w, y: c.tr.y * h };
      const br = { x: c.br.x * w, y: c.br.y * h };
      const bl = { x: c.bl.x * w, y: c.bl.y * h };

      // Draw quad polygon
      ctx.beginPath();
      ctx.moveTo(tl.x, tl.y);
      ctx.lineTo(tr.x, tr.y);
      ctx.lineTo(br.x, br.y);
      ctx.lineTo(bl.x, bl.y);
      ctx.closePath();
      ctx.strokeStyle = isActive ? '#f59e0b' : 'rgba(245, 158, 11, 0.45)';
      ctx.lineWidth = isActive ? 2 : 1;
      ctx.setLineDash(isActive ? [] : [5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      if (!hasPreview) {
        ctx.fillStyle = isActive ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.07)';
        ctx.fill();
      }

      if (slots.length > 1) {
        ctx.fillStyle = isActive ? '#ffffff' : 'rgba(255, 255, 255, 0.65)';
        ctx.font = '10px Inter';
        ctx.fillText(panelLabel(idx, slots.length), tl.x + 6, tl.y + 16);
      }

      // Draw corners as glowing circles — sadece aktif panelde
      if (isActive) {
        drawPerspectiveHandle(ctx, tl.x, tl.y, 'Sol Üst (TL)', selectedHandle === 'corner-tl');
        drawPerspectiveHandle(ctx, tr.x, tr.y, 'Sağ Üst (TR)', selectedHandle === 'corner-tr');
        drawPerspectiveHandle(ctx, br.x, br.y, 'Sağ Alt (BR)', selectedHandle === 'corner-br');
        drawPerspectiveHandle(ctx, bl.x, bl.y, 'Sol Alt (BL)', selectedHandle === 'corner-bl');
      }
    });
  };

  const drawHandle = (ctx, x, y) => {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5;
    ctx.fillRect(x - 5, y - 5, 10, 10);
    ctx.strokeRect(x - 5, y - 5, 10, 10);
  };

  const drawPerspectiveHandle = (ctx, x, y, label, isSelected) => {
    ctx.save();
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = isSelected ? 8 : 4;
    
    ctx.fillStyle = isSelected ? '#ffffff' : '#f59e0b';
    ctx.strokeStyle = '#0e1726';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Draw label
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(x + 10, y - 10, 60, 18);
    ctx.fillStyle = '#ffffff';
    ctx.font = '9px Inter';
    ctx.fillText(label, x + 14, y + 2);
  };

  const getFrameColor = (style) => {
    switch (style) {
      case 'black_frame': return '#111827';
      case 'white_frame': return '#f8fafc';
      case 'gold_frame': return '#eab308';
      case 'silver_frame': return '#cbd5e1';
      case 'natural_wood': return '#d97706';
      case 'walnut': return '#451a03';
      default: return '#111827';
    }
  };

  const handleRatioToggle = (ratio) => {
    setCompatibleRatios(prev => 
      prev.includes(ratio) ? prev.filter(r => r !== ratio) : [...prev, ratio]
    );
  };

  // Canvas Mouse interaction handlers
  /** Bir noktanın dörtgenin içinde olup olmadığı (panel seçimi için). */
  const pointInQuad = (x, y, quad, w, h) => {
    const pts = [quad.tl, quad.tr, quad.br, quad.bl].map(pt => ({ x: pt.x * w, y: pt.y * h }));
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const intersects = (pts[i].y > y) !== (pts[j].y > y) &&
        x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x;
      if (intersects) inside = !inside;
    }
    return inside;
  };

  /** Panelleri aktif olan önce gelecek şekilde sırala (üstte duran önce yakalanır). */
  const hitTestOrder = () => [
    activeSlot,
    ...slots.map((_, i) => i).filter(i => i !== activeSlot)
  ].filter(i => slots[i]);

  /**
   * Verilen tuval noktasında bir düzenleme hedefi var mı?
   * Hem tıklama hem de imleç biçimi için kullanılır.
   */
  const findHandleAt = (x, y, w, h) => {
    if (type === 'flat') {
      const hitRadius = 10;
      for (const idx of hitTestOrder()) {
        const placement = slots[idx].placement || DEFAULT_PLACEMENT;
        const px = placement.x * w;
        const py = placement.y * h;
        const pw = placement.width * w;
        const ph = placement.height * h;

        const nearCorner = (cx, cy) => Math.abs(x - cx) < hitRadius && Math.abs(y - cy) < hitRadius;
        let handle = null;
        if (nearCorner(px, py)) handle = 'tl';
        else if (nearCorner(px + pw, py)) handle = 'tr';
        else if (nearCorner(px + pw, py + ph)) handle = 'br';
        else if (nearCorner(px, py + ph)) handle = 'bl';
        if (handle) return { idx, handle, offset: null };

        if (x > px && x < px + pw && y > py && y < py + ph) {
          return { idx, handle: 'center', offset: { x: x - px, y: y - py } };
        }
      }
      return null;
    }

    const hitRadius = 15;
    for (const idx of hitTestOrder()) {
      const c = slots[idx].corners || DEFAULT_CORNERS;
      const cornersCoords = {
        'corner-tl': { x: c.tl.x * w, y: c.tl.y * h },
        'corner-tr': { x: c.tr.x * w, y: c.tr.y * h },
        'corner-br': { x: c.br.x * w, y: c.br.y * h },
        'corner-bl': { x: c.bl.x * w, y: c.bl.y * h }
      };
      for (const [key, coord] of Object.entries(cornersCoords)) {
        if (Math.hypot(x - coord.x, y - coord.y) < hitRadius) {
          return { idx, handle: key, coord };
        }
      }
    }

    // Köşeye denk gelmediyse pasif bir dörtgenin içi paneli seçer
    for (const idx of hitTestOrder()) {
      if (idx !== activeSlot && pointInQuad(x, y, slots[idx].corners || DEFAULT_CORNERS, w, h)) {
        return { idx, handle: 'select' };
      }
    }
    return null;
  };

  /** Tıklanan noktayı sabit tutarak bir sonraki yakınlaştırma kademesine geçer. */
  const cycleZoom = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const next = ZOOM_STEPS[(ZOOM_STEPS.indexOf(zoomLevel) + 1) % ZOOM_STEPS.length];
    if (next === 1) {
      resetZoom();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const k = next / zoomLevel;

    setZoomLevel(next);
    setPan(clampPan(
      { x: px - (px - pan.x) * k, y: py - (py - pan.y) * k },
      next, canvas.width, canvas.height
    ));
  };

  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Sağ tık: yakınlaştırılmış görselde tutup gezinme
    if (e.button === 2) {
      if (previewActive && zoomed) {
        e.preventDefault();
        panDragRef.current = { x: e.clientX, y: e.clientY, pan: { ...pan } };
        setPanning(true);
      }
      return;
    }
    if (e.button !== 0) return;

    // Yakınlaştırma açıkken editör katmanı gizlidir; tutamaçlar da devre dışı
    // kalır, sol tık yalnızca yakınlaştırma kademesini ilerletir.
    if (previewActive) clickStartRef.current = { x: e.clientX, y: e.clientY, moved: false };
    if (zoomed) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hit = findHandleAt(x, y, canvas.width, canvas.height);
    if (hit) {
      // Düzenleme başladı: bu bir yakınlaştırma tıklaması değil
      clickStartRef.current = null;
      setActiveSlot(hit.idx);

      if (hit.handle === 'select') {
        setSelectedHandle(null);
        return;
      }

      boostOverlay();
      setActiveHandle(hit.handle);
      setSelectedHandle(hit.handle);
      if (hit.offset) setDragOffset(hit.offset);
      if (hit.coord) setZoomPoint({ x: hit.coord.x, y: hit.coord.y });
      return;
    }

    // Clicked elsewhere on canvas - clear selection
    setSelectedHandle(null);
  };

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Sağ tıkla gezinme
    if (panDragRef.current) {
      const start = panDragRef.current;
      setPan(clampPan(
        { x: start.pan.x + (e.clientX - start.x), y: start.pan.y + (e.clientY - start.y) },
        zoomLevel, canvas.width, canvas.height
      ));
      return;
    }

    // Sürükleme mi basit tıklama mı: 4px'ten fazla oynadıysa yakınlaştırma yok
    const started = clickStartRef.current;
    if (started && !started.moved &&
        Math.hypot(e.clientX - started.x, e.clientY - started.y) > 4) {
      started.moved = true;
    }

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (!activeHandle) {
      // İmleç biçimi için tutamaç üzerinde mi bakılır (yakınlaştırmada gerekmez)
      if (previewActive && !zoomed) {
        const hit = findHandleAt(x, y, canvas.width, canvas.height);
        const next = hit && hit.handle !== 'select' ? hit.handle : null;
        setHoverHandle(prev => (prev === next ? prev : next));
      } else if (hoverHandle !== null) {
        setHoverHandle(null);
      }
      return;
    }

    const w = canvas.width;
    const h = canvas.height;

    // Constrain inside canvas
    const cx = Math.max(0, Math.min(w, x));
    const cy = Math.max(0, Math.min(h, y));

    const nx = cx / w;
    const ny = cy / h;

    if (type === 'flat') {
      const px = flatPlacement.x * w;
      const py = flatPlacement.y * h;
      const pw = flatPlacement.width * w;
      const ph = flatPlacement.height * h;
      const ratioValue = parseRatio(activeRatio);

      if (activeHandle === 'center') {
        const targetX = x - dragOffset.x;
        const targetY = y - dragOffset.y;
        setFlatPlacement(prev => ({
          ...prev,
          x: Math.max(0, Math.min(w - pw, targetX)) / w,
          y: Math.max(0, Math.min(h - ph, targetY)) / h
        }));
      } else if (activeHandle === 'br') {
        let newW = cx - px;
        let newH = newW / ratioValue;
        if (py + newH > h) {
          newH = h - py;
          newW = newH * ratioValue;
        }
        if (px + newW > w) {
          newW = w - px;
          newH = newW / ratioValue;
        }
        setFlatPlacement(prev => ({
          ...prev,
          width: Math.max(0.05, newW) / w,
          height: Math.max(0.05, newH) / h
        }));
      } else if (activeHandle === 'tr') {
        let newW = cx - px;
        let newH = newW / ratioValue;
        if (py + ph - newH < 0) {
          newH = py + ph;
          newW = newH * ratioValue;
        }
        if (px + newW > w) {
          newW = w - px;
          newH = newW / ratioValue;
        }
        setFlatPlacement(prev => ({
          ...prev,
          y: (py + ph - newH) / h,
          width: Math.max(0.05, newW) / w,
          height: Math.max(0.05, newH) / h
        }));
      } else if (activeHandle === 'bl') {
        let newW = px + pw - cx;
        let newH = newW / ratioValue;
        if (py + newH > h) {
          newH = h - py;
          newW = newH * ratioValue;
        }
        if (px + pw - newW < 0) {
          newW = px + pw;
          newH = newW / ratioValue;
        }
        setFlatPlacement(prev => ({
          ...prev,
          x: (px + pw - newW) / w,
          width: Math.max(0.05, newW) / w,
          height: Math.max(0.05, newH) / h
        }));
      } else if (activeHandle === 'tl') {
        let newW = px + pw - cx;
        let newH = newW / ratioValue;
        if (py + ph - newH < 0) {
          newH = py + ph;
          newW = newH * ratioValue;
        }
        if (px + pw - newW < 0) {
          newW = px + pw;
          newH = newW / ratioValue;
        }
        setFlatPlacement({
          x: (px + pw - newW) / w,
          y: (py + ph - newH) / h,
          width: Math.max(0.05, newW) / w,
          height: Math.max(0.05, newH) / h
        });
      }
    } else {
      // Perspective mode - update individual corner
      const cornerKey = activeHandle.replace('corner-', '');
      setCorners(prev => ({
        ...prev,
        [cornerKey]: { x: nx, y: ny }
      }));
      setZoomPoint({ x: cx, y: cy });
    }
  };

  const endInteraction = () => {
    const wasDragging = !!activeHandle;
    setActiveHandle(null);
    setZoomPoint(null);
    if (zoomTimeoutRef.current) {
      clearTimeout(zoomTimeoutRef.current);
      zoomTimeoutRef.current = null;
    }
    // Nokta bırakıldıktan 1 sn sonra editör katmanı sönük seviyeye döner
    if (wasDragging && previewActive) scheduleOverlayFade();
    return wasDragging;
  };

  const handleMouseUp = (e) => {
    if (panDragRef.current) {
      panDragRef.current = null;
      setPanning(false);
      return;
    }

    const wasDragging = endInteraction();
    const started = clickStartRef.current;
    clickStartRef.current = null;

    // Tutamaca denk gelmeyen, yerinde duran sol tık yakınlaştırmayı ilerletir
    if (!wasDragging && started && !started.moved && previewActive && e && e.button === 0) {
      cycleZoom(e.clientX, e.clientY);
    }
  };

  /** İmleç tuvalden çıkarsa sürükleme biter ama yakınlaştırma tetiklenmez. */
  const handleMouseLeave = () => {
    if (panDragRef.current) {
      panDragRef.current = null;
      setPanning(false);
    }
    clickStartRef.current = null;
    setHoverHandle(null);
    endInteraction();
  };

  /** Tuval imleci: düzenleme mi inceleme mi olduğunu anlatır. */
  const canvasCursor = () => {
    if (panning) return 'grabbing';
    if (!previewActive) return 'crosshair';
    if (zoomed) return zoomLevel === ZOOM_STEPS[ZOOM_STEPS.length - 1] ? 'zoom-out' : 'zoom-in';
    if (hoverHandle === 'center') return 'move';
    if (hoverHandle) return 'crosshair';
    return 'zoom-in';
  };

  const handleSaveTemplate = async () => {
    if (!name.trim()) {
      alert('Lütfen şablon adını girin.');
      return;
    }
    if (!bgImage) {
      alert('Lütfen bir arka plan görseli yükleyin.');
      return;
    }

    // Çok panelli şablonun uyumlu oranları da çok panelli olmalı; aksi halde
    // şablon tek panelli bir profile bağlanır ve ikinci panel boşa gider.
    if (slots.length > 1 && !compatibleRatios.some(isSetRatioKey)) {
      alert(`Bu şablon ${slots.length} panelli. "Uyumlu Oranlar" listesinden çok panelli bir oran (ör. ${ratioKeyLabel(activeRatio)}) seçmelisiniz.`);
      return;
    }
    if (slots.length === 1 && compatibleRatios.some(isSetRatioKey)) {
      alert('Seçtiğiniz uyumlu oranlardan biri çok panelli bir set. Çizim oranını o sete ayarlayıp panelleri yerleştirin.');
      return;
    }

    const config = {
      compatible_ratios: compatibleRatios,
      editorWidth: canvasRef.current?.width || 800,
      is_thumbnail: isThumbnail,
      panel_count: slots.length
    };

    if (slots.length > 1) {
      config.set_source = setSource;
      config.panel_gap = panelGap;
    }

    if (type === 'flat') {
      config.slots = slots.map(slot => ({ placement: slot.placement || DEFAULT_PLACEMENT }));
      // Tek panelli şablonları eski sürümlerle uyumlu tutmak için ilk panel
      // ayrıca config.placement olarak da yazılır.
      config.placement = slots[0]?.placement || DEFAULT_PLACEMENT;
      config.frame = {
        style: frameStyle,
        thickness: frameThickness
      };
      config.shadow = {
        enabled: shadowEnabled,
        sides: shadowSides,
        opacity: shadowOpacity,
        distance: shadowDistance,
        blur: shadowBlur
      };
    } else {
      config.slots = slots.map(slot => ({ corners: slot.corners || DEFAULT_CORNERS }));
      config.corners = slots[0]?.corners || DEFAULT_CORNERS;
    }

    const formData = new FormData();
    formData.append('name', name);
    formData.append('type', type);
    formData.append('config', JSON.stringify(config));
    
    if (bgFile) {
      formData.append('background', bgFile);
    }

    setLoading(true);
    try {
      await axios.post(`${API_BASE}/templates`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setIsThumbnail(false);
      setView('list');
      fetchTemplates();
    } catch (err) {
      console.error(err);
      alert('Şablon kaydedilirken hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTemplate = async (id) => {
    if (!confirm('Bu şablonu silmek istediğinize emin misiniz?')) return;
    try {
      await axios.delete(`${API_BASE}/templates/${id}`);
      fetchTemplates();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleThumbnail = async (id, currentConfig) => {
    try {
      const updatedConfig = {
        ...currentConfig,
        is_thumbnail: !currentConfig?.is_thumbnail
      };
      await axios.patch(`${API_BASE}/templates/${id}`, { config: updatedConfig });
      fetchTemplates();
    } catch (err) {
      console.error(err);
      alert('Thumbnail durumu güncellenirken hata oluştu.');
    }
  };

  /**
   * Çerçeve & gölge ayarları. Yalnızca düz (flat) modda anlamlı olduğu için
   * Şablon Tipi kartının altında, mod seçiminin hemen ardından gösterilir.
   */
  const renderFrameShadowPanel = () => (
        <div className="space-y-6 pt-5 border-t border-[#1e293b]">
          <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
            <Frame className="w-4 h-4 text-amber-500" />
            <span>Çerçeve & Gölge Efektleri</span>
          </h3>

          {/* Frame selection */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Çerçeve Türü
            </label>
            <select
              value={frameStyle}
              onChange={(e) => setFrameStyle(e.target.value)}
              className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
            >
              {FRAME_OPTIONS.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.name}</option>
              ))}
            </select>
          </div>

          {frameStyle !== 'stretched' && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Çerçeve Kalınlığı</span>
                <span>{frameThickness}px</span>
              </div>
              <input
                type="range"
                min="1"
                max="15"
                step="0.5"
                value={frameThickness}
                onChange={(e) => setFrameThickness(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>
          )}

          {/* Shadow settings */}
          <div className="border-t border-[#1e293b] pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-300 font-semibold uppercase tracking-wider">Derinlik Gölgesi</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={shadowEnabled} 
                  onChange={(e) => setShadowEnabled(e.target.checked)} 
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500 peer-checked:after:bg-slate-950 peer-checked:after:border-slate-950"></div>
              </label>
            </div>

            {shadowEnabled && (
              <div className="space-y-3 pt-2">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Gölge Kenarı (Direction)
                  </label>
                  <select
                    value={shadowSides}
                    onChange={(e) => setShadowSides(e.target.value)}
                    className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none"
                  >
                    <option value="all">Her Yöne (All)</option>
                    <option value="bottom">Alt Kenara (Bottom)</option>
                    <option value="right">Sağ Kenara (Right)</option>
                    <option value="left">Sol Kenara (Left)</option>
                    <option value="top">Üst Kenara (Top)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Yoğunluk (Opacity)</span>
                    <span>{shadowOpacity / 10}</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="9"
                    step="0.5"
                    value={shadowOpacity}
                    onChange={(e) => setShadowOpacity(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Mesafe (Offset)</span>
                    <span>{shadowDistance}px</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="25"
                    value={shadowDistance}
                    onChange={(e) => setShadowDistance(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Yayılma & Bulanıklık</span>
                    <span>{shadowBlur}px</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="25"
                    value={shadowBlur}
                    onChange={(e) => setShadowBlur(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
  );

  /**
   * Otomatik tanıma paneli: tarama durumu, bulunan adaylar arasında gezinme,
   * köşeler arası ölçümler ve perspektif düzeltmeli oran önerisi.
   */
  const renderAutoDetectPanel = () => {
    const px = (v) => (Number.isFinite(v) ? `${Math.round(v)} px` : '—');
    const pct = (v) => (Number.isFinite(v) ? `%${(v * 100).toFixed(1)}` : '—');

    const skewTone = (v) => (v < 0.02 ? 'text-slate-300' : v < 0.12 ? 'text-amber-400' : 'text-rose-400');
    const signedRatioDelta = measurement && activePanelRatio > 0
      ? measurement.aspect / activePanelRatio - 1
      : null;
    const ratioDelta = signedRatioDelta === null ? null : Math.abs(signedRatioDelta);

    return (
      <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
            <Wand2 className="w-4 h-4 text-amber-500" />
            <span>Otomatik Tanıma</span>
          </h3>
          <div className="flex items-center space-x-3">
            <label className="flex items-center space-x-1.5 text-[11px] font-semibold text-slate-400 hover:text-amber-500 cursor-pointer transition-colors">
              <Crop className="w-3.5 h-3.5" />
              <span>Görseli Değiştir</span>
              <input type="file" accept="image/*" onChange={handleBgUpload} className="hidden" />
            </label>
            <button
              type="button"
              onClick={() => runAutoScan()}
              disabled={scanState === 'scanning'}
              className="flex items-center space-x-1.5 text-[11px] font-semibold text-slate-300 hover:text-amber-500 disabled:opacity-40 disabled:hover:text-slate-300 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scanState === 'scanning' ? 'animate-spin' : ''}`} />
              <span>Yeniden Tara</span>
            </button>
          </div>
        </div>

        {/* Durum + adaylar arasında gezinme */}
        {scanState === 'scanning' && (
          <div className="flex items-center space-x-2 text-xs text-amber-400 font-medium">
            <ScanLine className="w-4 h-4 animate-pulse" />
            <span>{scanPhase || 'Taranıyor'}…</span>
          </div>
        )}

        {scanState === 'empty' && (
          <div className="flex items-start space-x-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-rose-200 leading-relaxed">
              Bu görselde çerçeve/tuval alanı bulunamadı (ör. boş duvar fotoğrafı).
              Çizim oranında ortalanmış bir dörtgen yerleştirildi; köşeleri sürükleyerek konumlandırın.
            </p>
          </div>
        )}

        {/* Set şablonunda panel eşleştirme durumu */}
        {scanState === 'done' && panelRowFound !== null && (
          <div className={`flex items-start space-x-2 p-2.5 rounded-xl border ${
            panelRowFound
              ? 'bg-emerald-500/10 border-emerald-500/25'
              : 'bg-amber-500/10 border-amber-500/25'
          }`}>
            <Layers className={`w-4 h-4 shrink-0 mt-0.5 ${panelRowFound ? 'text-emerald-400' : 'text-amber-500'}`} />
            <p className="text-[11px] leading-relaxed text-slate-300">
              {panelRowFound
                ? `${activePanelCount} panel yan yana bulundu ve soldan sağa yerleştirildi.`
                : `Sahnede yan yana ${activePanelCount} çerçeve bulunamadı; paneller simetrik yerleştirildi, elle ayarlayın.`}
            </p>
          </div>
        )}

        {scanState === 'done' && detections.length > 0 && (
          <div className="flex items-center justify-between p-2.5 bg-[#151f32] border border-[#1e293b] rounded-xl">
            <div className="flex items-center space-x-2 min-w-0">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-[11px] text-slate-300 truncate">
                {detections.length} alan bulundu ·{' '}
                <span className="text-white font-semibold">
                  {detections[detectionIndex]?.kind === 'blank' ? 'Boş tuval'
                    : detections[detectionIndex]?.kind === 'framed' ? 'Çerçeve içi'
                    : 'Eser alanı'}
                </span>
              </span>
            </div>
            {detections.length > 1 && (
              <div className="flex items-center space-x-1 shrink-0">
                <button
                  type="button"
                  onClick={() => cycleDetection(-1)}
                  className="p-1 rounded-lg bg-[#0e1726] border border-[#1e293b] text-slate-400 hover:text-amber-500"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] text-slate-400 tabular-nums w-8 text-center">
                  {detectionIndex + 1}/{detections.length}
                </span>
                <button
                  type="button"
                  onClick={() => cycleDetection(1)}
                  className="p-1 rounded-lg bg-[#0e1726] border border-[#1e293b] text-slate-400 hover:text-amber-500"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Köşeler arası ölçümler */}
        {measurement && (
          <div className="space-y-3">
            <div className="flex items-center space-x-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              <Ruler className="w-3.5 h-3.5 text-amber-500" />
              <span>Köşe Ölçümleri</span>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
              <div className="flex justify-between"><span className="text-slate-500">Üst</span><span className="text-slate-200 tabular-nums">{px(measurement.top)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Alt</span><span className="text-slate-200 tabular-nums">{px(measurement.bottom)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Sol</span><span className="text-slate-200 tabular-nums">{px(measurement.left)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Sağ</span><span className="text-slate-200 tabular-nums">{px(measurement.right)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Yatay sapma</span><span className={`tabular-nums ${skewTone(measurement.hSkew)}`}>{pct(measurement.hSkew)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Dikey sapma</span><span className={`tabular-nums ${skewTone(measurement.vSkew)}`}>{pct(measurement.vSkew)}</span></div>
              <div className="flex justify-between col-span-2"><span className="text-slate-500">Kenar eğimi</span><span className="text-slate-200 tabular-nums">{measurement.maxTilt.toFixed(1)}°</span></div>
            </div>

            {measurement.isNearRectangle && type === 'perspective' && (
              <button
                type="button"
                onClick={() => setType('flat')}
                className="w-full py-2 rounded-lg bg-[#151f32] border border-[#1e293b] text-[11px] text-slate-300 hover:border-amber-500/40 hover:text-amber-500 transition-colors"
              >
                Neredeyse tam dikdörtgen — Düz (Flat) moda geç
              </button>
            )}

            <div className="p-3 bg-[#151f32] border border-[#1e293b] rounded-xl space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Ekrandaki ham oran</span>
                <span className="text-slate-300 tabular-nums">{measurement.rawAspect.toFixed(3)}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-amber-500 font-semibold">Perspektif düzeltmeli oran</span>
                <span className="text-white font-bold tabular-nums">{measurement.aspect.toFixed(3)}</span>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed pt-0.5">
                {measurement.aspectMethod === 'perspective'
                  ? 'Her iki yönde de kaçış noktası bulundu; gerçek oran doğrudan çözüldü.'
                  : measurement.aspectMethod === 'assumed'
                  ? 'Çerçeve tek eksende açılı; perspektif sapması tipik bir oda odak uzaklığı varsayılarak düzeltildi.'
                  : 'Kenarlar paralel; perspektif sapması yok, oran doğrudan kenar uzunluklarından alındı.'}
              </p>
            </div>
          </div>
        )}

        {/* Oran önerisi */}
        {autoRatio && (
          <div className="p-3 bg-[#151f32] border border-[#1e293b] rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">En yakın varyasyon</span>
              <span className="text-xs font-bold text-amber-500">{ratioKeyLabel(autoRatio.key)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">Seçili hedef oran</span>
              <span className="text-xs font-semibold text-slate-200">{ratioKeyLabel(activeRatio)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500">Hedef orandan fark</span>
              <span className={`text-[11px] tabular-nums ${ratioDelta < 0.04 ? 'text-emerald-400' : ratioDelta < 0.12 ? 'text-amber-400' : 'text-rose-400'}`}>
                {pct(ratioDelta)}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              {ratioDelta < 0.0005
                ? 'Hedef oranla eşleşiyor.'
                : signedRatioDelta > 0
                ? 'Alan hedef orana göre daha geniş.'
                : 'Alan hedef orana göre daha dar.'}
              {' '}Noktaları oynattıkça güncellenir; %0 hedef oranla eşleşir.
            </p>
            {activeRatio !== autoRatio.key && (
              <button
                type="button"
                onClick={() => {
                  setActiveRatio(autoRatio.key);
                  setCompatibleRatios([autoRatio.key]);
                }}
                className="w-full mt-1 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 text-[11px] font-semibold hover:bg-amber-500/20 transition-colors"
              >
                {ratioKeyLabel(autoRatio.key)} oranını uygula
              </button>
            )}
          </div>
        )}

        {/* Otomatik davranış anahtarları */}
        <div className="space-y-2 pt-1">
          {[
            { key: 'autoRatioOn', label: 'Oranı otomatik seç', value: autoRatioOn, set: setAutoRatioOn },
            { key: 'autoNameOn', label: 'Adı otomatik oluştur', value: autoNameOn, set: setAutoNameOn },
            { key: 'previewOn', label: 'Önizlemeyi göster', value: previewOn, set: setPreviewOn }
          ].map(item => (
            <label key={item.key} className="flex items-center justify-between cursor-pointer">
              <span className="text-[11px] text-slate-300">{item.label}</span>
              <div className="relative inline-flex items-center">
                <input
                  type="checkbox"
                  checked={item.value}
                  onChange={(e) => {
                    // Anahtar konumu kullanıcı tercihidir; sonraki şablonlarda korunur
                    item.set(e.target.checked);
                    writePref(item.key, e.target.checked);
                  }}
                  className="sr-only peer"
                />
                <div className="w-8 h-[18px] bg-slate-800 rounded-full peer peer-checked:bg-amber-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:after:translate-x-[14px] peer-checked:after:bg-slate-950"></div>
              </div>
            </label>
          ))}

          {previewOn && (
            <div className="block pt-1">
              <span className="text-[10px] text-slate-500 block leading-relaxed">
                {previewCustom ? 'Kendi deneme görseliniz kullanılıyor.' : 'Sentetik deneme eseri kullanılıyor.'}
                {previewActive && ' Tuvalde: sol tık %150 → %200 → %100 yakınlaştırır, yakınlaştırınca sağ tıkla gezinilir. Köşe noktaları sönük durur, tutunca netleşir.'}
              </span>
              <div className="flex items-center space-x-2 mt-1.5">
                <label className="flex-1 flex items-center justify-center gap-2 text-xs font-bold text-center px-3 py-2.5 rounded-lg bg-amber-500 border border-amber-400 text-slate-950 shadow-md shadow-amber-500/20 cursor-pointer hover:bg-amber-400 focus-within:ring-2 focus-within:ring-amber-300 focus-within:ring-offset-2 focus-within:ring-offset-slate-900 transition-colors">
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>Deneme görseli yükle</span>
                  <input type="file" accept="image/*" aria-label="Deneme görseli yükle" onChange={handlePreviewUpload} className="sr-only" />
                </label>
                {previewCustom && (
                  <button
                    type="button"
                    onClick={() => setPreviewCustom(null)}
                    className="px-2 py-1.5 rounded-lg bg-[#151f32] border border-[#1e293b] text-slate-400 hover:text-rose-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderStaticSection = () => {
    const staticTemplates = templates.filter(t => t.type === 'static');

    return (
      <div className="space-y-8 animate-fade-in text-slate-100">
        {/* Header toolbar */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white">Profil Bazlı Statik Görseller</h3>
            <p className="text-xs text-slate-400 mt-1">Her ürünün sonuna otomatik olarak eklenecek bilgilendirme görsellerini oran bazında gruplayın.</p>
          </div>
          {!showStaticUpload && (
            <button
              onClick={() => setShowStaticUpload(true)}
              className="flex items-center space-x-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs shadow-lg shadow-amber-500/10 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Statik Görsel Ekle</span>
            </button>
          )}
        </div>

        {/* Upload Form Modal */}
        {showStaticUpload && (
          <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 space-y-4 animate-fade-in-up">
            <h4 className="text-sm font-bold text-white">Yeni Statik Görsel Ekle</h4>
            <form onSubmit={handleSaveStaticImage} className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Görsel Adı</label>
                  <input
                    type="text"
                    value={staticName}
                    onChange={(e) => setStaticName(e.target.value)}
                    placeholder="Örn: Size Chart (Boyut Tablosu)"
                    className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Uyumlu Oranlar</label>
                  <div className="flex flex-wrap gap-1.5">
                    {ratioPresets.map(ratio => {
                      const isSelected = staticRatios.includes(ratio);
                      return (
                        <button
                          key={ratio}
                          type="button"
                          onClick={() => {
                            setStaticRatios(prev => 
                              isSelected ? prev.filter(r => r !== ratio) : [...prev, ratio]
                            );
                          }}
                          className={`text-[10px] px-3 py-1.5 border rounded-lg transition-colors font-bold ${
                            isSelected
                              ? 'bg-amber-500/15 border-amber-500/30 text-amber-500'
                              : 'bg-[#151f32] border-[#1e293b] text-slate-400'
                          }`}
                        >
                          {ratio} Oranı
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Thumbnail Seçeneği */}
                <div className="flex items-center justify-between p-3 bg-[#151f32] border border-[#1e293b] rounded-2xl">
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-semibold text-white">Thumbnail Olarak Seç</span>
                    <p className="text-[9px] text-slate-500">Ürünün merkezde olduğu 1:1 mockup seçmeniz önerilir.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isStaticThumbnail}
                      onChange={(e) => setIsStaticThumbnail(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-4 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500 peer-checked:after:bg-slate-950 peer-checked:after:border-slate-950"></div>
                  </label>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Görsel Seç</label>
                  <div className="border border-dashed border-[#1e293b] rounded-2xl p-6 text-center hover:border-slate-700 transition-colors relative cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setStaticFile(e.target.files[0])}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      required
                    />
                    <Crop className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                    <span className="text-[10px] text-slate-400 block">
                      {staticFile ? staticFile.name : 'Dosya seçmek için tıklayın veya sürükleyin'}
                    </span>
                  </div>
                </div>

                <div className="flex space-x-2 pt-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowStaticUpload(false)}
                    className="bg-[#151f32] hover:bg-[#1c2942] border border-[#1e293b] text-slate-300 px-4 py-2 rounded-xl text-xs transition-colors"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-5 py-2 rounded-xl text-xs transition-colors"
                  >
                    Kaydet
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}

        {/* Profiles Sections list */}
        <div className="space-y-6">
          {ratioPresets.map(ratio => {
            const matchedImages = staticTemplates.filter(t => t.type === 'static');
            const filteredMatched = matchedImages.filter(t => t.config?.compatible_ratios?.includes(ratio));

            return (
              <div key={ratio} className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-[#1e293b] pb-2">
                  <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span>{ratio} Oranı Görselleri</span>
                  </h4>
                  <span className="text-[10px] font-bold text-slate-500">{filteredMatched.length} Görsel</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {filteredMatched.map(img => (
                    <div key={img.id} className="bg-[#151f32] border border-[#1e293b] rounded-2xl p-3 flex flex-col justify-between group hover:border-slate-800 transition-colors">
                      <div className="aspect-[4/3] rounded-xl bg-slate-950 border border-[#1e293b] overflow-hidden mb-3 relative">
                        <img
                          src={`http://localhost:3001/${img.background_path}`}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                        {img.config?.is_thumbnail && (
                          <div className="absolute top-2 right-2">
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border shadow-lg bg-emerald-500/80 border-emerald-500/30 text-white">
                              Thumbnail
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <span className="text-xs font-semibold text-white block truncate">{img.name}</span>
                        <div className="flex items-center justify-between pt-1">
                          <button
                            type="button"
                            onClick={() => handleToggleThumbnail(img.id, img.config)}
                            className={`text-[10px] font-bold transition-colors ${
                              img.config?.is_thumbnail 
                                ? 'text-emerald-500 hover:text-emerald-400' 
                                : 'text-slate-500 hover:text-slate-400'
                            }`}
                          >
                            {img.config?.is_thumbnail ? '✓ Thumbnail' : 'Thumbnail Yap'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTemplate(img.id)}
                            className="text-[10px] font-bold text-rose-500 hover:text-rose-400 flex items-center space-x-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Sil</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {filteredMatched.length === 0 && (
                    <div className="col-span-full py-6 text-center text-[11px] text-slate-500 italic">
                      Bu oran için eklenmiş statik görsel bulunmuyor.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderOrderSection = () => {
    const rowCard = (key, index, opts = {}) => {
      const tpl = orderTemplateByKey.get(key);
      if (!tpl) return null;
      const isThumb = isThumbTemplate(tpl);

      return (
        <div
          key={key}
          draggable
          onDragStart={() => setDragKey(key)}
          onDragEnd={() => setDragKey(null)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.stopPropagation(); handleDropOnRow(key); }}
          className={`flex items-center space-x-3 bg-[#151f32] border rounded-2xl p-2.5 transition-colors cursor-grab active:cursor-grabbing ${
            dragKey === key ? 'border-amber-500/60 opacity-60' : 'border-[#1e293b] hover:border-slate-700'
          }`}
        >
          <GripVertical className="w-4 h-4 text-slate-600 shrink-0" />
          <span className="w-6 h-6 shrink-0 rounded-lg bg-amber-500/15 text-amber-500 text-[10px] font-bold flex items-center justify-center">
            {index}
          </span>
          <div className="w-12 h-9 shrink-0 rounded-lg overflow-hidden bg-slate-950 border border-[#1e293b]">
            <img src={`http://localhost:3001/${tpl.background_path}`} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="block text-[11px] font-semibold text-white truncate">{tpl.name}</span>
            <div className="flex items-center space-x-1.5 mt-0.5">
              {tpl.type === 'static' && (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400">Statik</span>
              )}
              {isThumb && (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">Thumbnail</span>
              )}
            </div>
          </div>
          {!opts.locked && (
            <div className="flex items-center space-x-0.5 shrink-0">
              <button type="button" onClick={() => movePinned(key, -1)} className="p-1 text-slate-500 hover:text-white transition-colors">
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => movePinned(key, 1)} className="p-1 text-slate-500 hover:text-white transition-colors">
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => removePinned(key)} className="p-1 text-rose-500 hover:text-rose-400 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {opts.locked && <Lock className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
        </div>
      );
    };

    const toggle = (label, hint, checked, onChange) => (
      <div className="flex items-center justify-between p-3 bg-[#151f32] border border-[#1e293b] rounded-2xl">
        <div className="space-y-0.5 pr-3">
          <span className="text-[11px] font-semibold text-white">{label}</span>
          <p className="text-[9px] text-slate-500 leading-relaxed">{hint}</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0">
          <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
          <div className="w-8 h-4 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500 peer-checked:after:bg-slate-950 peer-checked:after:border-slate-950"></div>
        </label>
      </div>
    );

    return (
      <div className="space-y-6 animate-fade-in text-slate-100">
        {/* Başlık */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white">Mockup Sıralaması</h3>
            <p className="text-xs text-slate-400 mt-1">
              Her oran için görsellerin Etsy/Shopify'a hangi sırayla yükleneceğini belirleyin. Ürün yüklemenize gerek yok.
            </p>
          </div>
          <div className="flex items-center space-x-3">
            {orderDirty && (
              <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full">
                Kaydedilmemiş değişiklik
              </span>
            )}
            <button
              onClick={saveOrderConfig}
              disabled={orderSaving}
              className="flex items-center space-x-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs shadow-lg shadow-amber-500/10 transition-colors"
            >
              <Save className="w-4 h-4" />
              <span>{orderSaving ? 'Kaydediliyor...' : 'Dizilimi Kaydet'}</span>
            </button>
          </div>
        </div>

        {/* Oran seçimi */}
        <div className="flex flex-wrap gap-1 bg-[#0e1726] border border-[#1e293b] p-1 rounded-xl w-fit">
          {ratioPresets.map(ratio => {
            const cfg = orderConfig[ratio];
            return (
              <button
                key={ratio}
                onClick={() => setOrderRatio(ratio)}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 ${
                  orderRatio === ratio
                    ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>{ratioKeyLabel(ratio)}</span>
                {cfg?.enabled && (
                  <span className={`w-1.5 h-1.5 rounded-full ${orderRatio === ratio ? 'bg-slate-950' : 'bg-emerald-500'}`} />
                )}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Ayarlar */}
          <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-5 space-y-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-2">
              <Sliders className="w-4 h-4 text-amber-500" />
              <span>Kurallar</span>
            </h4>

            {toggle(
              'Özel dizilimi kullan',
              'Kapalıyken eski davranış geçerlidir: rastgele bir thumbnail kapak olur, kalanlar klasör sırasıyla yüklenir.',
              currentOrder.enabled,
              (v) => patchOrder({ enabled: v })
            )}

            {toggle(
              'İlk görsel her zaman thumbnail',
              `Açıkken 1. sıra kilitlidir ve thumbnail işaretli şablonlardan gelir (${thumbCount} aday). Kapatırsanız ilk görseli de kendiniz seçersiniz.`,
              currentOrder.thumbnailFirst,
              (v) => patchOrder({ thumbnailFirst: v })
            )}

            {toggle(
              'Statik görseller en sonda',
              'Ölçü tablosu gibi bilgilendirme görselleri sabitlemediğiniz sürece galerinin sonuna alınır.',
              currentOrder.staticLast,
              (v) => patchOrder({ staticLast: v })
            )}

            <div className="p-3 bg-[#151f32] border border-[#1e293b] rounded-2xl space-y-2">
              <span className="text-[11px] font-semibold text-white block">Dizilim modu</span>
              {[
                { id: 'custom', label: 'Sabit sıra + kalanlar', hint: 'Belirlediğiniz şablonlar sırayla, gerisi aşağıdaki kurala göre.' },
                { id: 'random', label: 'Tamamen rastgele', hint: 'Sabit sıra yok sayılır, tüm mockuplar her üründe karışır.' }
              ].map(opt => (
                <label key={opt.id} className="flex items-start space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="order-mode"
                    checked={currentOrder.mode === opt.id}
                    onChange={() => patchOrder({ mode: opt.id })}
                    className="mt-0.5 accent-amber-500"
                  />
                  <span className="space-y-0.5">
                    <span className="text-[10px] font-semibold text-slate-200 block">{opt.label}</span>
                    <span className="text-[9px] text-slate-500 block leading-relaxed">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className={`p-3 bg-[#151f32] border border-[#1e293b] rounded-2xl space-y-2 ${currentOrder.mode === 'random' ? 'opacity-40 pointer-events-none' : ''}`}>
              <span className="text-[11px] font-semibold text-white block">Sabit sıradan sonrası</span>
              {[
                { id: 'random', label: 'Rastgele karışsın', hint: 'Her üründe farklı sıra — listelerin tekdüze görünmesini engeller.' },
                { id: 'sequential', label: 'Klasör sırasıyla', hint: 'Her üründe aynı sabit sıra.' }
              ].map(opt => (
                <label key={opt.id} className="flex items-start space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="order-rest"
                    checked={currentOrder.restMode === opt.id}
                    onChange={() => patchOrder({ restMode: opt.id })}
                    className="mt-0.5 accent-amber-500"
                  />
                  <span className="space-y-0.5">
                    <span className="text-[10px] font-semibold text-slate-200 block">{opt.label}</span>
                    <span className="text-[9px] text-slate-500 block leading-relaxed">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="flex items-start space-x-2 p-3 bg-slate-950/50 border border-[#1e293b] rounded-2xl">
              <HelpCircle className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
              <p className="text-[9px] text-slate-500 leading-relaxed">
                Bu oran için {orderTemplates.length} şablon üretiliyor. Sabit sıradaki {pinnedRows.length + (coverKey ? 1 : 0)} görsel
                her üründe aynı konumda, kalan {Math.max(0, orderTemplates.length - pinnedRows.length - (coverKey ? 1 : 0))} görsel
                {currentOrder.mode === 'random' || currentOrder.restMode === 'random' ? ' rastgele' : ' sabit'} sırayla yüklenir.
              </p>
            </div>
          </div>

          {/* Sabit sıra */}
          <div
            className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-5 space-y-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDropOnList}
          >
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center space-x-2">
                <ListOrdered className="w-4 h-4 text-amber-500" />
                <span>Sabit Sıra</span>
              </span>
              {pinnedKeys.length > 0 && (
                <button
                  type="button"
                  onClick={() => patchOrder({ pinned: [] })}
                  className="text-[9px] font-bold text-slate-500 hover:text-rose-400 normal-case tracking-normal"
                >
                  Temizle
                </button>
              )}
            </h4>

            <div className={`space-y-2 ${currentOrder.mode === 'random' ? 'opacity-40 pointer-events-none' : ''}`}>
              {/* 1. sıra: thumbnail kuralı */}
              {currentOrder.thumbnailFirst && (
                coverKey ? (
                  <div className="relative">
                    {rowCard(coverKey, 1, { locked: true })}
                    <button
                      type="button"
                      onClick={() => removePinned(coverKey)}
                      className="absolute -top-1.5 -right-1.5 bg-slate-800 border border-[#1e293b] rounded-full p-0.5 text-slate-400 hover:text-rose-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center space-x-3 bg-emerald-500/5 border border-dashed border-emerald-500/30 rounded-2xl p-2.5">
                    <Lock className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span className="w-6 h-6 shrink-0 rounded-lg bg-emerald-500/15 text-emerald-400 text-[10px] font-bold flex items-center justify-center">1</span>
                    <div className="flex-1 min-w-0">
                      <span className="block text-[11px] font-semibold text-emerald-400">Kapak: Thumbnail (otomatik)</span>
                      <span className="block text-[9px] text-slate-500">
                        {thumbCount > 0
                          ? `${thumbCount} thumbnail şablonundan rastgele biri. Belirli birini istiyorsanız havuzdan sabitleyin.`
                          : 'Bu oranda thumbnail işaretli şablon yok — 1. sıra sabit sıranın ilk görseli olur.'}
                      </span>
                    </div>
                  </div>
                )
              )}

              {pinnedRows.map((key, idx) => rowCard(key, idx + 1 + (currentOrder.thumbnailFirst ? 1 : 0)))}

              {pinnedRows.length === 0 && (
                <div className="border border-dashed border-[#1e293b] rounded-2xl py-8 text-center">
                  <Pin className="w-5 h-5 text-slate-600 mx-auto mb-2" />
                  <p className="text-[10px] text-slate-500 px-4">
                    Havuzdan şablon sürükleyin veya "+" ile ekleyin. Buraya koyduklarınız her üründe aynı konumda kalır.
                  </p>
                </div>
              )}
            </div>

            {currentOrder.mode === 'random' && (
              <p className="text-[9px] text-amber-500/80 text-center">Tamamen rastgele modda sabit sıra kullanılmaz.</p>
            )}
          </div>

          {/* Havuz */}
          <div
            className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-5 space-y-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDropOnPool}
          >
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center space-x-2">
                <Layers className="w-4 h-4 text-amber-500" />
                <span>Havuz</span>
              </span>
              <span className="text-[9px] font-bold text-slate-500 normal-case tracking-normal">{poolTemplates.length} şablon</span>
            </h4>

            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {poolTemplates.map(tpl => {
                const key = templateKey(tpl);
                const isThumb = isThumbTemplate(tpl);
                return (
                  <div
                    key={key}
                    draggable
                    onDragStart={() => setDragKey(key)}
                    onDragEnd={() => setDragKey(null)}
                    className={`flex items-center space-x-3 bg-[#151f32] border rounded-2xl p-2.5 transition-colors cursor-grab active:cursor-grabbing ${
                      dragKey === key ? 'border-amber-500/60 opacity-60' : 'border-[#1e293b] hover:border-slate-700'
                    }`}
                  >
                    <div className="w-12 h-9 shrink-0 rounded-lg overflow-hidden bg-slate-950 border border-[#1e293b]">
                      <img src={`http://localhost:3001/${tpl.background_path}`} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="block text-[11px] font-semibold text-white truncate">{tpl.name}</span>
                      <div className="flex items-center space-x-1.5 mt-0.5">
                        {tpl.type === 'static' && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400">Statik</span>
                        )}
                        {isThumb && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">Thumbnail</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => addPinned(key)}
                      title={isThumb && currentOrder.thumbnailFirst ? 'Kapak olarak sabitle' : 'Sabit sıraya ekle'}
                      className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-colors shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}

              {poolTemplates.length === 0 && (
                <div className="border border-dashed border-[#1e293b] rounded-2xl py-8 text-center text-[10px] text-slate-500 px-4">
                  {orderTemplates.length === 0
                    ? 'Bu oran için uyumlu şablon bulunmuyor.'
                    : 'Tüm şablonlar sabit sırada. Kaldırmak için buraya sürükleyin.'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Simülasyon */}
        <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                <Eye className="w-4 h-4 text-amber-500" />
                <span>Simülasyon</span>
              </h4>
              <p className="text-[10px] text-slate-500 mt-1">
                Yükleme sırasını gerçek algoritmayla hesaplar. Rastgelelik varsa her denemede farklı çıkar.
              </p>
            </div>
            <button
              onClick={runOrderPreview}
              disabled={orderPreviewLoading || orderTemplates.length === 0}
              className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 font-bold py-2.5 px-4 rounded-xl border border-[#334155] text-xs transition-colors"
            >
              <Shuffle className={`w-4 h-4 text-amber-500 ${orderPreviewLoading ? 'animate-spin' : ''}`} />
              <span>{orderPreview.length > 0 ? 'Yeniden Hesapla' : 'Sırayı Göster'}</span>
            </button>
          </div>

          {orderPreview.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-3">
              {orderPreview.map((item, idx) => (
                <div key={`${item.key}-${idx}`} className="space-y-1.5">
                  <div className={`relative aspect-square rounded-xl overflow-hidden bg-slate-950 border ${
                    idx === 0 ? 'border-emerald-500/60' : 'border-[#1e293b]'
                  }`}>
                    <img src={`http://localhost:3001/${item.background_path}`} alt="" className="w-full h-full object-cover" />
                    <span className={`absolute top-1 left-1 w-5 h-5 rounded-md text-[9px] font-bold flex items-center justify-center ${
                      idx === 0 ? 'bg-emerald-500 text-slate-950' : 'bg-slate-950/80 text-slate-200'
                    }`}>
                      {idx + 1}
                    </span>
                    {item.is_thumbnail && (
                      <span className="absolute bottom-1 right-1 text-[7px] font-bold px-1 py-0.5 rounded bg-emerald-500/80 text-white">TH</span>
                    )}
                  </div>
                  <span className="block text-[9px] text-slate-400 truncate">{item.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-[#1e293b] rounded-2xl py-8 text-center text-[10px] text-slate-500">
              Henüz hesaplanmadı.
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Editör tüm genişliği kullanır: tuval alanı büyür, ayar panelleri yanına sığar */}
      <div className={`mx-auto py-8 px-4 animate-fade-in ${view === 'editor' ? 'max-w-[1900px]' : 'max-w-6xl'}`}>
      {view === 'list' ? (
        <>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Şablon Stüdyosu</h2>
              <p className="text-slate-400 text-sm mt-0.5">Etsy mockup şablonlarını ve statik bilgilendirme görsellerini yönetin.</p>
            </div>
            
            {activeSubTab === 'mockup' && (
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setShowLibraryModal(true)}
                  className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 px-5 rounded-xl border border-[#334155] transition-colors text-sm"
                >
                  <Compass className="w-5 h-5 text-amber-500" />
                  <span>Kütüphaneden Ekle</span>
                </button>
                <button
                  onClick={handleCreateNew}
                  className="flex items-center space-x-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-3 px-5 rounded-xl shadow-lg shadow-amber-500/10 transition-colors text-sm"
                >
                  <Plus className="w-5 h-5" />
                  <span>Yeni Şablon Oluştur</span>
                </button>
              </div>
            )}
          </div>

          {/* Sub Tab Navigation */}
          <div className="flex space-x-4 border-b border-[#1e293b] pb-3 mb-6">
            <button
              onClick={() => setActiveSubTab('mockup')}
              className={`pb-1 text-sm font-bold border-b-2 transition-all ${
                activeSubTab === 'mockup'
                  ? 'border-amber-500 text-amber-500'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              Mockup Şablonları
            </button>
            <button
              onClick={() => setActiveSubTab('static')}
              className={`pb-1 text-sm font-bold border-b-2 transition-all ${
                activeSubTab === 'static'
                  ? 'border-amber-500 text-amber-500'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              Statik Görseller (Eklentiler)
            </button>
            <button
              onClick={() => setActiveSubTab('order')}
              className={`pb-1 text-sm font-bold border-b-2 transition-all ${
                activeSubTab === 'order'
                  ? 'border-amber-500 text-amber-500'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              Mockup Sıralaması
            </button>
          </div>

          {activeSubTab === 'order' ? (
            renderOrderSection()
          ) : activeSubTab === 'static' ? (
            renderStaticSection()
          ) : (
            <>
              {templates.filter(t => t.type !== 'static').length > 0 && (
                <div className="flex flex-wrap gap-1 bg-[#0e1726] border border-[#1e293b] p-1 rounded-xl w-fit mb-6">
                  {['All', ...ratioPresets].map(ratio => (
                    <button
                      key={ratio}
                      onClick={() => setFilterRatio(ratio)}
                      className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                        filterRatio === ratio
                          ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {ratio === 'All' ? 'Tüm Oranlar' : (isSetRatioKey(ratio) ? `${ratioKeyLabel(ratio)} (Set)` : `${ratio} Oranı`)}
                    </button>
                  ))}
                </div>
              )}

              {loading ? (
                <div className="text-center py-12 text-slate-400">Yükleniyor...</div>
              ) : templates.filter(t => t.type !== 'static').length === 0 ? (
                <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-12 text-center text-slate-500">
                  <Layers className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                  <p className="font-medium mb-1">Henüz mockup şablonu eklenmemiş</p>
                  <p className="text-xs text-slate-500 mb-6 font-normal">Kendi oda resimlerinizi yükleyip çerçeve yerleşim alanlarını belirleyin.</p>
                  <button
                    onClick={handleCreateNew}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2 px-4 rounded-xl text-sm transition-colors border border-[#334155]"
                  >
                    İlk Şablonu Oluştur
                  </button>
                </div>
              ) : (() => {
                const filteredTemplates = templates.filter(t => t.type !== 'static' && (filterRatio === 'All' || (t.config && t.config.compatible_ratios && t.config.compatible_ratios.includes(filterRatio))));
                
                if (filteredTemplates.length === 0) {
                  return (
                    <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-12 text-center text-slate-500">
                      <Layers className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                      <p className="font-medium mb-1">Şablon bulunamadı</p>
                      <p className="text-xs text-slate-500 mb-6 font-normal">Bu orana uygun herhangi bir mockup şablonu bulunmuyor.</p>
                      <button
                        onClick={handleCreateNew}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2 px-4 rounded-xl text-sm transition-colors border border-[#334155]"
                      >
                        Yeni Şablon Oluştur
                      </button>
                    </div>
                  );
                }

                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {filteredTemplates.map(tpl => (
                    <div key={tpl.id} className="bg-[#0e1726] border border-[#1e293b] rounded-2xl overflow-hidden group hover:border-amber-500/30 transition-all flex flex-col justify-between">
                      <div className="relative aspect-[4/3] bg-slate-950 overflow-hidden">
                        <img 
                          src={`http://localhost:3001/${tpl.background_path}`} 
                          alt={tpl.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute top-3 right-3 flex flex-col items-end space-y-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shadow-lg ${
                            tpl.type === 'flat' 
                              ? 'bg-amber-500/15 border-amber-500/20 text-amber-500' 
                              : 'bg-indigo-500/15 border-indigo-500/20 text-indigo-400'
                          }`}>
                            {tpl.type === 'flat' ? 'Düz (Flat)' : 'Perspektif'}
                          </span>
                          {tpl.config?.is_thumbnail && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border shadow-lg bg-emerald-500/15 border-emerald-500/20 text-emerald-400">
                              Thumbnail
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <div className="p-5 flex-1 flex flex-col justify-between">
                        <div>
                          <h3 className="font-bold text-white group-hover:text-amber-500 transition-colors mb-1">{tpl.name}</h3>
                          <p className="text-xs text-slate-500">
                            Uyumlu Oranlar: {tpl.config.compatible_ratios.join(', ')}
                          </p>
                        </div>

                        <div className="flex justify-between items-center mt-4 pt-4 border-t border-[#1e293b]">
                          <button
                            type="button"
                            onClick={() => handleToggleThumbnail(tpl.id, tpl.config)}
                            className={`flex items-center space-x-1.5 text-xs font-semibold transition-colors ${
                              tpl.config?.is_thumbnail 
                                ? 'text-emerald-500 hover:text-emerald-400' 
                                : 'text-slate-400 hover:text-slate-300'
                            }`}
                          >
                            {tpl.config?.is_thumbnail ? (
                              <>
                                <CheckSquare className="w-4 h-4" />
                                <span>Thumbnail (Aktif)</span>
                              </>
                            ) : (
                              <>
                                <Square className="w-4 h-4" />
                                <span>Thumbnail Yap</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteTemplate(tpl.id)}
                            className="flex items-center space-x-1.5 text-xs text-rose-500 hover:text-rose-400 font-semibold transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Şablonu Sil</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </>
        )}
      </>
      ) : (
        // Editor view
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Şablon Stüdyo Editörü</h2>
              <p className="text-slate-400 text-sm mt-0.5">Arka plan görseli üzerinde ürün çerçeve yerleşimi çizin.</p>
            </div>
            
            <div className="flex space-x-3">
              <button
                onClick={() => setView('list')}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-3 px-6 rounded-xl border border-[#334155]"
              >
                Geri Dön
              </button>
              <button
                onClick={handleSaveTemplate}
                className="flex items-center space-x-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-3 px-6 rounded-xl shadow-lg shadow-amber-500/10 transition-colors"
              >
                <Save className="w-5 h-5" />
                <span>Şablonu Kaydet</span>
              </button>
            </div>
          </div>

          {/* Görsel alanı solda geniş, ayar panelleri sağda yan yana iki sütun */}
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4 gap-6 items-start">
            {/* Canvas workspace column */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-4 sm:p-5 relative overflow-hidden">
                {!bgImage ? (
                  <div className="flex flex-col items-center justify-center text-center h-[62vh] min-h-[420px] max-h-[780px]">
                    <Crop className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                    <p className="text-slate-400 font-medium mb-4">Bir arka plan görseli yükleyerek başlayın</p>
                    <label className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-3 px-6 rounded-xl shadow-lg shadow-amber-500/10 transition-colors cursor-pointer text-sm">
                      Görsel Yükle (Oda Fotoğrafı)
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleBgUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                ) : (
                  <div
                    ref={stageRef}
                    className="h-[62vh] min-h-[420px] max-h-[780px] flex items-center justify-center"
                  >
                  <div className="relative" ref={containerRef}>
                    <canvas
                      ref={canvasRef}
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                      onMouseLeave={handleMouseLeave}
                      onContextMenu={(e) => { if (previewActive) e.preventDefault(); }}
                      style={{ cursor: canvasCursor() }}
                      className="border border-[#1e293b] rounded-xl bg-slate-950 shadow-2xl"
                    />

                    {/* Otomatik tarama katmanı */}
                    {scanState === 'scanning' && (
                      <div className="mockup-scan">
                        <div className="mockup-scan__grid" />
                        <div className="mockup-scan__sweep" />
                        <div className="mockup-scan__label">
                          <ScanLine className="w-7 h-7 text-amber-500 mx-auto mb-2" />
                          <p className="text-sm font-bold text-white tracking-wide">Şablon otomatik taranıyor</p>
                          <p className="text-[11px] text-amber-400/90 mt-1 font-medium">{scanPhase || 'Hazırlanıyor'}…</p>
                        </div>
                      </div>
                    )}

                    {/* Magnifying Glass widget */}
                    {/* Yakınlaştırma göstergesi */}
                    {previewActive && zoomed && (
                      <div className="absolute top-3 left-3 flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-950/80 border border-amber-500/30 backdrop-blur-sm pointer-events-none">
                        <ZoomIn className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-[11px] font-bold text-white tabular-nums">%{Math.round(zoomLevel * 100)}</span>
                        <span className="text-[10px] text-slate-400">sağ tıkla gezin · sol tıkla devam</span>
                      </div>
                    )}

                    {zoomPoint && !zoomed && (() => {
                      const canvasW = canvasRef.current?.width || 500;
                      // If pin is near the top of the canvas, render magnifier below the pin (at y + 30px)
                      // otherwise above it (at y - 120px) to prevent going off-screen
                      const showBelow = zoomPoint.y < 130;
                      const topPos = showBelow ? (zoomPoint.y + 30) : (zoomPoint.y - 120);
                      // Constrain left position to keep it inside canvas bounds
                      const leftPos = Math.max(10, Math.min(canvasW - 106, zoomPoint.x - 48));

                      return (
                        <div 
                          className="absolute w-24 h-24 rounded-full border-2 border-amber-500 bg-slate-900 pointer-events-none overflow-hidden shadow-2xl z-50 flex items-center justify-center transition-all duration-150 ease-out"
                          style={{
                            left: `${leftPos}px`,
                            top: `${topPos}px`,
                          }}
                        >
                          {/* We render a scaled copy of the background around the point */}
                          <canvas
                            ref={(el) => {
                              if (!el || !bgImage || !canvasRef.current) return;
                              const zctx = el.getContext('2d');
                              const scale = 3.0; // Zoom factor
                              
                              // Map pixel coordinate in canvas to original image coordinates
                              const scaleX = bgImage.width / canvasRef.current.width;
                              const scaleY = bgImage.height / canvasRef.current.height;
                              
                              const imgX = (zoomPoint.x) * scaleX;
                              const imgY = (zoomPoint.y) * scaleY;
                              
                              zctx.clearRect(0, 0, 96, 96);
                              zctx.drawImage(
                                bgImage,
                                imgX - 16, imgY - 16, 32, 32, // Source crop
                                0, 0, 96, 96 // Draw size
                              );
                              
                              // Draw crosshair in center
                              zctx.strokeStyle = '#f59e0b';
                              zctx.lineWidth = 1;
                              zctx.beginPath();
                              zctx.moveTo(48, 0); zctx.lineTo(48, 96);
                              zctx.moveTo(0, 48); zctx.lineTo(96, 48);
                              zctx.stroke();
                            }}
                            width={96}
                            height={96}
                          />
                        </div>
                      );
                    })()}
                  </div>
                  </div>
                )}
              </div>

              {bgImage && (
                <div className="flex items-center space-x-3 bg-slate-800/20 border border-slate-800/30 rounded-xl p-4 text-xs text-slate-400">
                  <HelpCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <span>
                    {type === 'flat' 
                      ? 'Düz modda: Çerçevenin kenarlarını sürükleyerek boyutlandırabilir, merkezinden tutarak konumlandırabilirsiniz.'
                      : 'Perspektif modda: Çerçevenin eğik duracağı 4 köşeyi sırasıyla işaretleyin. Sürüklerken büyüteç yardımıyla hassas ayar yapın.'}
                    {isSetTemplate && ` ${activePanelCount} panelli set: düzenlemek istediğiniz panele tıklayın, tutamaçlar o panele geçer.`}
                  </span>
                </div>
              )}
              {/* Yerleşim ve stil kartları — sağ paneli şişirmemek için tuvalin altında */}
              {isSetTemplate && (
                <div className="grid grid-cols-1 gap-4 items-start">
                  {isSetTemplate && (
                    <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-6 space-y-4">
                      <h3 className="text-sm font-semibold text-white flex items-center space-x-2 border-b border-[#1e293b] pb-3">
                        <Layers className="w-4 h-4 text-amber-500" />
                        <span>Panel Düzeni ({activePanelCount} Panel)</span>
                      </h3>

                      <div className="space-y-2">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Düzenlenen Panel
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {slots.map((_, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setActiveSlot(idx)}
                              className={`py-2.5 px-3 border rounded-xl font-semibold text-[11px] transition-all ${
                                activeSlot === idx
                                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                                  : 'bg-[#151f32] border-[#1e293b] text-slate-400'
                              }`}
                            >
                              {panelLabel(idx, slots.length)}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Panel kilitleri — yalnızca düz (flat) şablonlarda */}
                      {type === 'flat' && (
                        <div className="space-y-2">
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Panel Kilitleri (Referans: Sol Panel)
                          </label>
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { key: 'x', label: 'X Kilidi' },
                              { key: 'y', label: 'Y Kilidi' },
                              { key: 'size', label: 'Boyut' }
                            ].map(lock => (
                              <button
                                key={lock.key}
                                type="button"
                                onClick={() => togglePanelLock(lock.key)}
                                className={`flex items-center justify-center space-x-1.5 py-2.5 px-2 border rounded-xl font-semibold text-[11px] transition-all ${
                                  panelLocks[lock.key]
                                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                                    : 'bg-[#151f32] border-[#1e293b] text-slate-500'
                                }`}
                              >
                                {panelLocks[lock.key] ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                                <span>{lock.label}</span>
                              </button>
                            ))}
                          </div>
                          <p className="text-[10px] text-slate-500">
                            {panelLocks.x || panelLocks.y || panelLocks.size
                              ? 'Kilitli özellik sol panelden yansır; diğer panelde tek başına değişmez.'
                              : 'Tüm kilitler kapalı — paneller bağımsız hareket eder.'}
                          </p>
                        </div>
                      )}

                      <div className="space-y-2">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Görselin Panellere Dağılımı
                        </label>
                        <select
                          value={setSource}
                          onChange={(e) => setSetSource(e.target.value)}
                          className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                        >
                          <option value="split">Böl — tek görsel panellere paylaştırılır</option>
                          <option value="duplicate">Tekrarla — aynı görsel her panelde</option>
                        </select>
                        <p className="text-[10px] text-slate-500">
                          {setSource === 'split'
                            ? `Görsel soldan sağa ${activePanelCount} dilime bölünür; kaynak, setin tamamının oranında olmalı.`
                            : 'Aynı görsel her panelde tekrar eder.'}
                        </p>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-slate-400">
                          <span>Paneller Arası Boşluk</span>
                          <span>{Math.round(panelGap * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="0.2"
                          step="0.005"
                          value={panelGap}
                          onChange={(e) => setPanelGap(Number(e.target.value))}
                          className="w-full accent-amber-500"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={applyAutoLayout}
                        disabled={!bgImage}
                        className="w-full flex items-center justify-center space-x-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 font-semibold py-2.5 px-4 rounded-xl border border-[#334155] text-xs transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Panelleri Simetrik Yerleştir</span>
                      </button>
                    </div>
                  )}
                                </div>
              )}
            </div>

            {/* Otomatik tanıma sütunu */}
            {bgImage && (
              <div className="space-y-6">
                {renderAutoDetectPanel()}
              </div>
            )}

            {/* Şablon özellikleri sütunu */}
            <div className="space-y-6">
              <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-6 space-y-5">
                <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                  <Compass className="w-4 h-4 text-amber-500" />
                  <span>Şablon Tipi</span>
                </h3>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Şablon Adı
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                      // Elle düzenlenen ad otomatik üretimle ezilmesin
                      setAutoNameOn(false);
                      setName(e.target.value);
                    }}
                    placeholder="Örn: 3:2 Yatay 1"
                    className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                    required
                  />
                  {autoNameOn && bgImage && (
                    <p className="text-[10px] text-amber-500/80 flex items-center space-x-1">
                      <Wand2 className="w-3 h-3" />
                      <span>Ad orana göre otomatik üretiliyor; yazmaya başlarsanız devre dışı kalır.</span>
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setType('flat')}
                    className={`py-3 px-4 border rounded-xl font-semibold text-xs flex items-center justify-center space-x-2 transition-all ${
                      type === 'flat'
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                        : 'bg-[#151f32] border-[#1e293b] text-slate-400'
                    }`}
                  >
                    <Layers className="w-4 h-4" />
                    <span>Düz (Flat)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setType('perspective')}
                    className={`py-3 px-4 border rounded-xl font-semibold text-xs flex items-center justify-center space-x-2 transition-all ${
                      type === 'perspective'
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                        : 'bg-[#151f32] border-[#1e293b] text-slate-400'
                    }`}
                  >
                    <Compass className="w-4 h-4" />
                    <span>Perspektif</span>
                  </button>
                </div>

                <div className="space-y-2 pt-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Uyumlu Oranlar
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {ratioPresets.map(ratio => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => handleRatioToggle(ratio)}
                        className={`text-xs px-3 py-1.5 border rounded-lg transition-colors ${
                          compatibleRatios.includes(ratio)
                            ? 'bg-amber-500/15 border-amber-500/30 text-amber-500'
                            : 'bg-[#151f32] border-[#1e293b] text-slate-400'
                        }`}
                      >
                        {ratioKeyLabel(ratio)}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Çok panelli set oranları "× N panel" olarak gösterilir ve yalnızca
                    aynı panel sayısına çizilmiş şablonlarla eşleşir.
                  </p>
                </div>

                {/* Thumbnail Seçeneği */}
                <div className="flex items-center justify-between p-3 bg-[#151f32] border border-[#1e293b] rounded-xl pt-2">
                  <div className="space-y-0.5">
                    <span className="text-xs font-semibold text-white">Thumbnail Olarak Seç</span>
                    <p className="text-[10px] text-slate-500">Ürünün merkezde olduğu 1:1 mockup seçmeniz önerilir.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isThumbnail}
                      onChange={(e) => setIsThumbnail(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500 peer-checked:after:bg-slate-950 peer-checked:after:border-slate-950"></div>
                  </label>
                </div>

                <div className="space-y-2 pt-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Çizim Oranı (Oran Kilidi)
                  </label>
                  <select
                    value={activeRatio}
                    onChange={(e) => {
                      const newRatio = e.target.value;
                      const nextCount = parseRatioKey(newRatio).panelCount;
                      setActiveRatio(newRatio);

                      // Çok panelli bir şablon yalnızca aynı set oranına hizmet
                      // edebilir; uyumlu oranları buna göre otomatik düzelt ki
                      // kullanıcı kaydederken çıkmaza girmesin.
                      if (nextCount > 1) {
                        setCompatibleRatios([newRatio]);
                      } else {
                        setCompatibleRatios(prev => {
                          const singles = prev.filter(r => !isSetRatioKey(r));
                          return singles.length > 0 ? singles : [newRatio];
                        });
                      }

                      // Çok panelli bir orana geçişte paneller otomatik dizilir
                      // (useEffect halleder). Tek panelde mevcut yerleşimin
                      // yalnızca yüksekliği yeni orana göre düzeltilir.
                      if (bgImage && nextCount === 1 && slots.length === 1 && type === 'flat') {
                        const canvas = canvasRef.current;
                        const w = canvas.width;
                        const h = canvas.height;
                        const pw = flatPlacement.width * w;
                        const rVal = parseRatio(newRatio);
                        const ph = pw / rVal;
                        setFlatPlacement(prev => ({
                          ...prev,
                          height: ph / h
                        }));
                      }
                    }}
                    className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    {ratioPresets.map(r => (
                      <option key={r} value={r}>
                        {isSetRatioKey(r) ? `${ratioKeyLabel(r)} (Set)` : `${r} Oranı`}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-500">
                    {isSetTemplate
                      ? `Set şablonu: her paneli ${String(activeRatio).split('x')[0]} oranında ${activePanelCount} panel çizilir.`
                      : 'Tek panelli şablon. Çok panelli set için listeden bir "Set" oranı seçin.'}
                  </p>
                </div>

                {/* Çerçeve ve gölge yalnızca düz modda uygulanır */}
                {type === 'flat' && bgImage && renderFrameShadowPanel()}

              </div>

            </div>
          </div>
        </div>
      )}
      </div>

      {/* Library Modal */}
      {showLibraryModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-[#1e293b]">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <Compass className="w-5 h-5 text-amber-500" />
                  <span>Mockup Kütüphanesi (Mağazalar Arası Transfer)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Diğer mağazalarınızda tanımlanmış veya global olan mockup şablonlarını aktif mağazanıza kopyalayın.
                </p>
              </div>
              <button 
                onClick={() => setShowLibraryModal(false)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                <Plus className="w-5 h-5 rotate-45" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto flex-1">
              {libraryLoading ? (
                <div className="text-center py-12 text-slate-400 flex flex-col items-center justify-center space-y-2">
                  <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
                  <span>Şablonlar yükleniyor...</span>
                </div>
              ) : libraryTemplates.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <Layers className="w-12 h-12 mx-auto mb-3 text-slate-700" />
                  <p className="font-medium text-slate-400">Kütüphanede kopyalanabilir şablon bulunamadı.</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Diğer mağazalarınızda şablon oluşturduğunuzda burada listelenecektir.
                  </p>
                </div>
              ) : (() => {
                const uniqueShops = Array.from(new Set(libraryTemplates.map(t => t.shop_id)))
                  .map(id => {
                    const match = libraryTemplates.find(t => t.shop_id === id);
                    return {
                      shop_id: id,
                      shop_name: match ? match.shop_name : 'Bilinmeyen Mağaza'
                    };
                  });
                const filteredTemplates = libraryTemplates.filter(t => t.shop_id === selectedLibraryShopId);
                const isAllSelected = filteredTemplates.length > 0 && selectedLibraryIds.length === filteredTemplates.length;

                return (
                  <>
                    {/* Shop Tabs Selector */}
                    {uniqueShops.length > 0 && (
                      <div className="flex items-center space-x-2 pb-4 border-b border-[#1e293b] mb-6 overflow-x-auto">
                        {uniqueShops.map(shop => (
                          <button
                            key={shop.shop_id}
                            onClick={() => {
                              setSelectedLibraryShopId(shop.shop_id);
                              setSelectedLibraryIds([]); // Clear selection when switching shops
                            }}
                            className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-all whitespace-nowrap ${
                              selectedLibraryShopId === shop.shop_id
                                ? 'bg-amber-500 text-slate-950 border-amber-500 font-bold shadow-lg shadow-amber-500/10'
                                : 'bg-[#151f32]/40 text-slate-400 border-[#1e293b] hover:text-white hover:border-slate-700'
                            }`}
                          >
                            {shop.shop_name}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Selection Action Bar */}
                    <div className="flex items-center justify-between pb-4 border-b border-[#1e293b] mb-6">
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={() => {
                            if (isAllSelected) {
                              setSelectedLibraryIds([]);
                            } else {
                              setSelectedLibraryIds(filteredTemplates.map(t => t.id));
                            }
                          }}
                          className="text-xs bg-[#1e293b] hover:bg-[#2e3b4e] text-slate-300 px-3 py-1.5 rounded-lg border border-[#334155] transition-colors font-medium"
                        >
                          {isAllSelected ? 'Seçimi Kaldır' : 'Tümünü Seç'}
                        </button>
                        {selectedLibraryIds.length > 0 && (
                          <span className="text-xs text-amber-500 font-semibold animate-pulse">
                            {selectedLibraryIds.length} şablon seçildi
                          </span>
                        )}
                      </div>
                      {selectedLibraryIds.length > 0 && (
                        <button
                          onClick={() => handleCopyTemplates(selectedLibraryIds)}
                          className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs px-4 py-2 rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center space-x-1.5 transform hover:scale-[1.02]"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Seçilenleri Dükkanıma Ekle ({selectedLibraryIds.length})</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {filteredTemplates.map(tpl => {
                        const isSelected = selectedLibraryIds.includes(tpl.id);
                        return (
                          <div 
                            key={tpl.id} 
                            onClick={() => {
                              if (isSelected) {
                                setSelectedLibraryIds(selectedLibraryIds.filter(id => id !== tpl.id));
                              } else {
                                setSelectedLibraryIds([...selectedLibraryIds, tpl.id]);
                              }
                            }}
                            className={`group relative rounded-2xl overflow-hidden p-4 flex space-x-4 cursor-pointer transition-all border ${
                              isSelected 
                                ? 'border-amber-500 bg-amber-500/5' 
                                : 'bg-[#151f32]/60 border-[#1e293b] hover:border-slate-700'
                            }`}
                          >
                            <div className="w-24 h-24 bg-slate-950 rounded-xl overflow-hidden flex-shrink-0 relative border border-[#1e293b]">
                              <img 
                                src={`http://localhost:3001/${tpl.background_path}`} 
                                alt={tpl.name}
                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                              />
                              {/* Checkbox overlay indicator */}
                              <div className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                                isSelected 
                                  ? 'bg-amber-500 border-amber-500 text-slate-950' 
                                  : 'bg-black/40 border-slate-500 text-transparent'
                              }`}>
                                <svg className="w-3.5 h-3.5 stroke-current" viewBox="0 0 24 24" fill="none" strokeWidth="3">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              </div>
                            </div>
                            <div className="flex-1 flex flex-col justify-between min-w-0">
                              <div>
                                <div className="flex items-center justify-between mb-1">
                                  <h4 className="font-bold text-white text-sm truncate pr-2">{tpl.name}</h4>
                                  <span className="text-[9px] bg-slate-800 text-slate-400 border border-[#1e293b] px-2 py-0.5 rounded-full flex-shrink-0">
                                    {tpl.shop_name}
                                  </span>
                                </div>
                                <p className="text-[10px] text-slate-400">Tip: {tpl.type === 'flat' ? 'Düz' : 'Perspektif'}</p>
                                <p className="text-[10px] text-slate-500 truncate">
                                  Uyumlu Oranlar: {tpl.config.compatible_ratios ? tpl.config.compatible_ratios.join(', ') : ''}
                                </p>
                              </div>
                              <div className="flex justify-end pt-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyTemplates([tpl.id]);
                                  }}
                                  className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center space-x-1"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Dükkanıma Ekle</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
