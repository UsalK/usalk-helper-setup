import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  Sparkles, RefreshCw, CheckCircle, UploadCloud, Trash, Play, Image as ImageIcon
} from 'lucide-react';
import { warpImage } from '../utils/homography';
import { filterAutoMatchProfiles } from '../utils/profileFlags';
import {
  parseRatio, getTemplateSlots, buildPanelSources,
  DEFAULT_PLACEMENT, DEFAULT_CORNERS
} from '../utils/panels';

const API_BASE = 'http://localhost:3001/api';

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

const findClosestProfileForRatio = (ratioVal, profiles) => {
  let closest = null;
  let minDiff = Infinity;
  for (const p of filterAutoMatchProfiles(profiles)) {
    const pRatio = parseRatio(p.ratio);
    const diff = Math.abs(ratioVal - pRatio);
    if (diff < minDiff) {
      minDiff = diff;
      closest = p;
    }
  }
  return closest;
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

const drawCoverImage = (ctx, img, x, y, w, h) => {
  const imgRatio = img.width / img.height;
  const targetRatio = w / h;
  let sx, sy, sw, sh;
  if (imgRatio > targetRatio) {
    sh = img.height;
    sw = sh * targetRatio;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / targetRatio;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
};

const drawRealisticFrame = (ctx, x, y, w, h, style, thickness) => {
  if (!style || style === 'stretched') return;
  const t = parseFloat(thickness) || 4;
  const itl = { x, y };
  const itr = { x: x + w, y };
  const ibr = { x: x + w, y: y + h };
  const ibl = { x, y: y + h };

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

  if (style === 'wood' || style === 'oak' || style === 'brown') {
    drawTrapezoid(otl, otr, itr, itl, '#d7a15c'); // Top
    drawTrapezoid(otr, obr, ibr, itr, '#b07e41'); // Right
    drawTrapezoid(obl, obr, ibr, ibl, '#8a5c29'); // Bottom
    drawTrapezoid(otl, obl, ibl, itl, '#b07e41'); // Left
  } else if (style === 'black') {
    drawTrapezoid(otl, otr, itr, itl, '#222222'); // Top
    drawTrapezoid(otr, obr, ibr, itr, '#111111'); // Right
    drawTrapezoid(obl, obr, ibr, ibl, '#050505'); // Bottom
    drawTrapezoid(otl, obl, ibl, itl, '#111111'); // Left
  } else if (style === 'white') {
    drawTrapezoid(otl, otr, itr, itl, '#f5f5f5'); // Top
    drawTrapezoid(otr, obr, ibr, itr, '#e0e0e0'); // Right
    drawTrapezoid(obl, obr, ibr, ibl, '#d5d5d5'); // Bottom
    drawTrapezoid(otl, obl, ibl, itl, '#e0e0e0'); // Left
  } else if (style === 'gold') {
    drawTrapezoid(otl, otr, itr, itl, '#ffd700'); // Top
    drawTrapezoid(otr, obr, ibr, itr, '#daa520'); // Right
    drawTrapezoid(obl, obr, ibr, ibl, '#b8860b'); // Bottom
    drawTrapezoid(otl, obl, ibl, itl, '#daa520'); // Left
  }
};

export default function ShopifyBulkUpload() {
  const fileInputRef = useRef(null);
  const renderCanvasRef = useRef(null);
  
  const [products, setProducts] = useState([]);
  const [collections, setCollections] = useState([]);
  const [variationProfiles, setVariationProfiles] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [discountRate, setDiscountRate] = useState(50);
  const [selectedProfileMap, setSelectedProfileMap] = useState({}); // { productId: profileId }
  
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [generatingAI, setGeneratingAI] = useState({}); // { productId: boolean }
  const [publishing, setPublishing] = useState({}); // { productId: boolean }
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    try {
      // 1. Fetch products
      const productsRes = await axios.get(`${API_BASE}/products?platform=shopify`);
      setProducts(productsRes.data);

      // 2. Fetch collections
      const collectionsRes = await axios.get(`${API_BASE}/shopify/collections`);
      setCollections(collectionsRes.data);

      // 3. Fetch variation profiles
      const profilesRes = await axios.get(`${API_BASE}/variations`);
      setVariationProfiles(profilesRes.data);

      // 4. Fetch templates for mockups
      const templatesRes = await axios.get(`${API_BASE}/templates`);
      setTemplates(templatesRes.data);

      // Set default profile for existing products if profile map is empty
      const initialMap = {};
      productsRes.data.forEach(p => {
        initialMap[p.id] = p.variation_profile_id || (profilesRes.data[0]?.id || '');
      });
      setSelectedProfileMap(initialMap);
    } catch (err) {
      console.error('Failed to load Shopify bulk upload data:', err);
    }
  };

  const fetchProductsOnly = async () => {
    try {
      const productsRes = await axios.get(`${API_BASE}/products?platform=shopify`);
      setProducts(productsRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleFileChange = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingFiles(true);
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('images', files[i]);
    }

    try {
      const res = await axios.post(`${API_BASE}/products/upload?platform=shopify`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      const newProducts = [];
      const updatedMap = { ...selectedProfileMap };

      for (let i = 0; i < res.data.length; i++) {
        const productRecord = res.data[i];
        const file = files[i];
        
        let ratioVal = 1.0;
        try {
          ratioVal = await getAspectOfFile(file);
        } catch (err) {
          console.error("Failed to parse image ratio:", err);
        }
        
        const closestProfile = findClosestProfileForRatio(ratioVal, variationProfiles);
        const profileId = closestProfile ? closestProfile.id : (variationProfiles[0]?.id || '');
        
        // Save to DB via PUT so it is persistent
        productRecord.variation_profile_id = profileId;
        await axios.put(`${API_BASE}/products/${productRecord.id}`, {
          ...productRecord,
          variation_profile_id: profileId
        });

        updatedMap[productRecord.id] = profileId;
        newProducts.push(productRecord);
      }

      setProducts(prev => [...newProducts, ...prev]);
      setSelectedProfileMap(updatedMap);
    } catch (err) {
      console.error('Failed to upload files:', err);
      alert('Görseller yüklenemedi.');
    } finally {
      setUploadingFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleGenerateAI = async (productId) => {
    setGeneratingAI(prev => ({ ...prev, [productId]: true }));
    try {
      const res = await axios.post(`${API_BASE}/ai/generate`, {
        productId,
        targetMarket: 'US',
        shopStyle: 'Modern Premium Gallery'
      });
      
      setProducts(prev => prev.map(p => {
        if (p.id === productId) {
          return {
            ...p,
            title: res.data.title,
            description: res.data.description,
            tags: res.data.tags,
            ai_attributes: res.data.ai_attributes
          };
        }
        return p;
      }));
    } catch (err) {
      console.error('AI Generation failed:', err);
      alert('Yapay zeka başlık ve açıklama üretemedi.');
    } finally {
      setGeneratingAI(prev => ({ ...prev, [productId]: false }));
    }
  };

  const handleUpdateProduct = async (product) => {
    try {
      await axios.put(`${API_BASE}/products/${product.id}`, product);
    } catch (err) {
      console.error('Failed to update product details:', err);
    }
  };

  const handlePublish = async (productId) => {
    const profileId = selectedProfileMap[productId];
    const product = products.find(p => p.id === productId);
    if (product) {
      product.variation_profile_id = profileId;
      await handleUpdateProduct(product);
    }

    setPublishing(prev => ({ ...prev, [productId]: true }));
    try {
      const res = await axios.post(`${API_BASE}/shopify/publish`, {
        productId,
        collectionId: selectedCollection,
        discountRate
      });
      if (res.data.success) {
        setProducts(prev => prev.map(p => {
          if (p.id === productId) {
            return {
              ...p,
              status: 'live',
              shopify_product_id: res.data.shopifyId
            };
          }
          return p;
        }));
      }
    } catch (err) {
      console.error('Failed to publish product to Shopify:', err);
      alert('Shopify yüklemesi başarısız oldu: ' + (err.response?.data?.error || err.message));
      setProducts(prev => prev.map(p => {
        if (p.id === productId) return { ...p, status: 'error' };
        return p;
      }));
    } finally {
      setPublishing(prev => ({ ...prev, [productId]: false }));
    }
  };

  const handleDeleteProduct = async (productId) => {
    if (!window.confirm('Bu ürünü silmek istediğinize emin misiniz?')) return;
    try {
      await axios.delete(`${API_BASE}/products/${productId}`);
      setProducts(prev => prev.filter(p => p.id !== productId));
    } catch (err) {
      console.error('Failed to delete product:', err);
    }
  };

  // Queue helper to load image
  const loadImage = (src) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  };

  // Add to queue
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

  // Generate Mockup handlers
  const handleSingleMockup = (p) => {
    const profileId = selectedProfileMap[p.id];
    if (!profileId) {
      alert('Lütfen önce varyasyon profili seçin.');
      return;
    }
    addToQueue([p.id], 'mockup');
  };

  const handleGenerateAllMockups = () => {
    const drafts = products.filter(p => p.status !== 'live');
    if (drafts.length === 0) {
      alert('Taslak ürün bulunmamaktadır.');
      return;
    }

    const noProfileDrafts = drafts.filter(t => !selectedProfileMap[t.id]);
    if (noProfileDrafts.length > 0) {
      alert(`${noProfileDrafts.length} adet ürünün varyasyon profili seçilmemiş.`);
      return;
    }

    addToQueue(drafts.map(t => t.id), 'mockup');
  };

  // Queue Worker useEffect
  useEffect(() => {
    const CONCURRENCY_LIMIT = 3;
    const activeTasks = queue.filter(t => t.status === 'processing');
    const pendingTasks = queue.filter(t => t.status === 'pending');

    if (activeTasks.length < CONCURRENCY_LIMIT && pendingTasks.length > 0) {
      const nextTask = pendingTasks[0];

      // Mark as processing
      setQueue(prev => prev.map(t => t.id === nextTask.id ? { ...t, status: 'processing' } : t));

      (async () => {
        try {
          const p = products.find(prod => prod.id === nextTask.productId);
          if (p) {
            await generateMockupsForProduct(p);
          }
          setQueue(prev => prev.map(t => t.id === nextTask.id ? { ...t, status: 'completed' } : t));
          await fetchProductsOnly();
        } catch (err) {
          console.error("Queue task execution failed:", err);
          setQueue(prev => prev.map(t => t.id === nextTask.id ? { ...t, status: 'failed' } : t));
        }
      })();
    }
  }, [queue, products]);

  const generateMockupsForProduct = async (p) => {
    const profileId = selectedProfileMap[p.id];
    if (!profileId) {
      throw new Error('Varyasyon profili seçilmemiş.');
    }
    const activeTpls = templates;
    const profile = variationProfiles.find(vp => vp.id === profileId);
    const productTpls = profile 
      ? activeTpls.filter(t => {
          if (profile.template_ids && profile.template_ids.includes(t.id)) return true;
          const tplRatios = (t.config.compatible_ratios && t.config.compatible_ratios.length > 0)
            ? t.config.compatible_ratios
            : ['2:3'];
          return tplRatios.includes(profile.ratio);
        })
      : activeTpls;

    const mockupTpls = productTpls.filter(t => t.type !== 'static');
    const staticTpls = productTpls.filter(t => t.type === 'static');

    if (mockupTpls.length === 0 && staticTpls.length === 0) {
      throw new Error('Uyumlu şablon veya statik görsel bulunamadı.');
    }

    if (mockupTpls.length > 0) {
      const productImg = await loadImage(`http://localhost:3001/${p.image_path}`);
      
      for (const tpl of mockupTpls) {
        const bgImg = await loadImage(`http://localhost:3001/${tpl.background_path}`);
        const ratios = (tpl.config.compatible_ratios && tpl.config.compatible_ratios.length > 0)
          ? tpl.config.compatible_ratios
          : ['2:3'];

        // Panel yerleşimleri ve her panele girecek görsel (Set of 2 vb.)
        const slots = getTemplateSlots(tpl.config);
        const setSource = tpl.config.set_source === 'duplicate' ? 'duplicate' : 'split';
        const panelSources = buildPanelSources(productImg, slots.length, setSource);

        for (const ratio of ratios) {
          if (profile && ratio !== profile.ratio) continue;

          const canvas = renderCanvasRef.current;
          const ctx = canvas.getContext('2d');
          const W = bgImg.width;
          const H = bgImg.height;
          canvas.width = W;
          canvas.height = H;

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
              warpImage(ctx, panelSources[slotIdx] || productImg, [tl, tr, br, bl], 24);
            });
          }

          const base64Data = canvas.toDataURL('image/jpeg', 0.9);
          await axios.post(`${API_BASE}/mockup/save`, {
            productId: p.id,
            templateId: tpl.id,
            ratio,
            image: base64Data
          });
        }
      }
    }

    // Process static templates
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
          canvas.width = staticImg.width;
          canvas.height = staticImg.height;
          ctx.drawImage(staticImg, 0, 0);
          
          const base64Data = canvas.toDataURL('image/jpeg', 0.95);
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

  return (
    <>
      <div className="p-8 max-w-7xl mx-auto animate-fade-in">
      {/* Hidden canvas for mockup generation */}
      <canvas ref={renderCanvasRef} className="hidden" />

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white mb-2 font-outfit">Toplu Shopify Ürün Yükleyici</h1>
        <p className="text-slate-400 text-sm">
          Tablo görsellerini toplu yükle, AI kullanarak SEO dostu açıklamalar ve başlıklar üret, indirim oranını belirle ve Shopify mağazana anında yükle.
        </p>
      </div>

      {/* Global Config Bar */}
      <div className="bg-[#0f172a] rounded-2xl border border-slate-800 p-6 mb-8 grid grid-cols-1 md:grid-cols-4 gap-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none"></div>

        <div>
          <label className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">Shopify Koleksiyonu</label>
          <select
            value={selectedCollection}
            onChange={(e) => setSelectedCollection(e.target.value)}
            className="w-full bg-[#0b0f19] border border-slate-800 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none focus:border-emerald-500 text-xs cursor-pointer"
          >
            <option value="">Koleksiyon Seçin (Varsayılan Katalog)</option>
            {collections.map(c => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">Görünür İndirim Oranı (%)</label>
          <div className="flex items-center space-x-3">
            <input
              type="number"
              min="0"
              max="99"
              value={discountRate}
              onChange={(e) => setDiscountRate(parseInt(e.target.value) || 0)}
              className="w-20 bg-[#0b0f19] border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
            />
            <span className="text-slate-500 text-xs leading-relaxed">
              Örn: 100$ fiyat, %{discountRate} indirimle mağazada 50$ olarak listelenir.
            </span>
          </div>
        </div>

        <div className="flex flex-col justify-end">
          <input
            type="file"
            multiple
            accept="image/*"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingFiles}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-semibold py-2.5 px-6 rounded-xl transition-all shadow-md flex items-center justify-center space-x-2 text-xs cursor-pointer"
          >
            {uploadingFiles ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Görseller Yükleniyor...</span>
              </>
            ) : (
              <span>📷 Toplu Görsel Yükle</span>
            )}
          </button>
        </div>

        <div className="flex flex-col justify-end">
          <button
            onClick={handleGenerateAllMockups}
            className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-2.5 px-6 rounded-xl transition-all shadow-md flex items-center justify-center space-x-2 text-xs cursor-pointer"
          >
            <span>🎨 Toplu Mockup Oluştur</span>
          </button>
        </div>
      </div>

      {/* Products Queue */}
      <div className="space-y-6">
        <h2 className="text-lg font-bold text-white font-outfit">Yükleme Kuyruğu ({products.length} Ürün)</h2>
        
        {products.length === 0 ? (
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 p-12 text-center text-slate-500 text-xs">
            Yükleme kuyruğunda ürün bulunmamaktadır. Başlamak için yukarıdan görselleri yükleyin.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {products.map(product => {
              const isAiGenerating = generatingAI[product.id];
              const isPublishing = publishing[product.id];
              const currentProfile = selectedProfileMap[product.id] || '';

              return (
                <div 
                  key={product.id} 
                  className={`bg-[#0f172a] rounded-2xl border p-5 shadow-lg flex flex-col md:flex-row gap-6 transition-all duration-300 ${
                    product.status === 'live' ? 'border-emerald-500/30' : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* Thumbnail */}
                  <div className="relative w-full md:w-48 h-48 bg-[#0b0f19] rounded-xl overflow-hidden flex items-center justify-center border border-slate-800/80">
                    <img 
                      src={`http://localhost:3001/${product.image_path}`} 
                      alt="Thumbnail" 
                      className="max-w-full max-h-full object-contain"
                    />
                    {/* Status Badge */}
                    <div className="absolute top-2 left-2">
                      {product.status === 'live' && (
                        <span className="bg-emerald-500/10 text-emerald-400 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-emerald-500/20">Aktif</span>
                      )}
                      {product.status === 'uploading' && (
                        <span className="bg-amber-500/10 text-amber-400 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-amber-500/20">Yükleniyor</span>
                      )}
                      {product.status === 'draft' && (
                        <span className="bg-slate-800 text-slate-400 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">Taslak</span>
                      )}
                      {product.status === 'error' && (
                        <span className="bg-rose-500/10 text-rose-400 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-rose-500/20">Hata</span>
                      )}
                    </div>

                    <div className="absolute bottom-2 right-2 bg-[#0f172a]/80 text-[10px] text-slate-300 px-2 py-0.5 rounded-md backdrop-blur-sm">
                      🖼️ {product.mockup_count || 0} Mockup
                    </div>
                  </div>

                  {/* Form fields */}
                  <div className="flex-1 space-y-4">
                    <div className="flex flex-col sm:flex-row gap-4">
                      <div className="flex-1">
                        <label className="block text-slate-500 text-[9px] font-bold uppercase tracking-wider mb-1">Ürün Başlığı</label>
                        <input
                          type="text"
                          value={product.title}
                          onChange={(e) => {
                            const val = e.target.value;
                            setProducts(prev => prev.map(p => p.id === product.id ? { ...p, title: val } : p));
                          }}
                          onBlur={() => handleUpdateProduct(product)}
                          className="w-full bg-[#0b0f19] border border-slate-800/80 rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div className="w-full sm:w-56">
                        <label className="block text-slate-500 text-[9px] font-bold uppercase tracking-wider mb-1">Varyasyon Profili (Fiyat & Boyut)</label>
                        <select
                          value={currentProfile}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSelectedProfileMap(prev => ({ ...prev, [product.id]: val }));
                          }}
                          className="w-full bg-[#0b0f19] border border-slate-800/80 rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-emerald-500 cursor-pointer"
                        >
                          {variationProfiles.map(v => (
                            <option key={v.id} value={v.id}>{v.name} ({v.ratio})</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-500 text-[9px] font-bold uppercase tracking-wider mb-1">Açıklama (Description)</label>
                      <textarea
                        value={product.description}
                        onChange={(e) => {
                          const val = e.target.value;
                          setProducts(prev => prev.map(p => p.id === product.id ? { ...p, description: val } : p));
                        }}
                        onBlur={() => handleUpdateProduct(product)}
                        rows={3}
                        className="w-full bg-[#0b0f19] border border-slate-800/80 rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  {/* Actions Column */}
                  <div className="flex flex-row md:flex-col justify-between md:justify-start md:space-y-3 w-full md:w-44 border-t md:border-t-0 md:border-l border-slate-800/60 pt-4 md:pt-0 md:pl-4">
                    <button
                      onClick={() => handleGenerateAI(product.id)}
                      disabled={isAiGenerating || product.status === 'live'}
                      className="w-full bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-700 text-white py-2 px-3 rounded-lg text-xs transition-all flex items-center justify-center space-x-1.5 cursor-pointer h-9"
                    >
                      {isAiGenerating ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          <span>AI Üretiyor...</span>
                        </>
                      ) : (
                        <span>✨ Sihirli İçerik</span>
                      )}
                    </button>

                    <button
                      onClick={() => handleSingleMockup(product)}
                      disabled={product.status === 'live'}
                      className="w-full bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-700 text-white py-2 px-3 rounded-lg text-xs transition-all flex items-center justify-center space-x-1.5 cursor-pointer h-9"
                    >
                      <span>🎨 Mockup Oluştur</span>
                    </button>

                    <button
                      onClick={() => handlePublish(product.id)}
                      disabled={isPublishing || product.status === 'live'}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-900 disabled:text-slate-700 text-white py-2 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center space-x-1.5 cursor-pointer h-9"
                    >
                      {isPublishing ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          <span>Yükleniyor...</span>
                        </>
                      ) : product.status === 'live' ? (
                        <span>✓ Shopify'da Canlı</span>
                      ) : (
                        <span>🚀 Shopify'a Yükle</span>
                      )}
                    </button>

                    <button
                      onClick={() => handleDeleteProduct(product.id)}
                      className="w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 py-2 px-3 rounded-lg text-xs transition-all flex items-center justify-center cursor-pointer h-9"
                    >
                      Kuyruktan Sil
                    </button>
                  </div>

                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>

      {/* Floating Queue Progress Modal */}
      {queue.length > 0 && (() => {
        const activeTasks = queue.filter(t => t.status === 'pending' || t.status === 'processing');
        const completedTasks = queue.filter(t => t.status === 'completed' || t.status === 'failed');
        const total = queue.length;
        const current = completedTasks.length;
        const isDone = activeTasks.length === 0;
        
        const percent = Math.round((current / total) * 100);

        return (
          <div className="fixed bottom-6 right-6 z-[9999] bg-[#0e1726]/90 backdrop-blur-xl border border-[#1e293b] rounded-2xl p-5 shadow-2xl w-80 text-xs text-slate-100 flex flex-col space-y-3 animate-fade-in-up transition-all duration-300">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white flex items-center space-x-2">
                {isDone ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <RefreshCw className="w-4 h-4 text-emerald-500 animate-spin" />
                )}
                <span>
                  {isDone ? 'İşlemler Tamamlandı' : `${current + 1}/${total} Mockuplar Üretiliyor...`}
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
                {total} ürün mockupları başarıyla hazırlandı.
              </div>
            )}

            <div className="w-full bg-[#151f32] h-2 rounded-full overflow-hidden border border-[#1e293b]/50">
              <div 
                className={`h-full transition-all duration-500 ease-out ${isDone ? 'bg-emerald-500' : 'bg-gradient-to-r from-emerald-500 to-teal-500'}`}
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
