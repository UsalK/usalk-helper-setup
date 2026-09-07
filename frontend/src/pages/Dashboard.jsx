import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Sparkles, Trash2, Edit3, ShoppingBag, Eye, UploadCloud, 
  X, Check, AlertCircle, RefreshCw, PlusCircle, ExternalLink,
  ChevronLeft, ChevronRight, CheckSquare, Square, Layers, Save, Tag, Grid
} from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

export default function Dashboard({ etsyConnected, appMode }) {
  const [activeTab, setActiveTab] = useState('local'); // local, active, draft, inactive, sold_out, expired
  const [products, setProducts] = useState([]);
  const [etsyListings, setEtsyListings] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedListingIds, setSelectedListingIds] = useState([]);
  const [selectedLocalIds, setSelectedLocalIds] = useState([]);
  const [filterSectionId, setFilterSectionId] = useState('');
  const [showVariationModal, setShowVariationModal] = useState(false);
  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [batchVariationProfileId, setBatchVariationProfileId] = useState('');
  const [batchMaterials, setBatchMaterials] = useState(['Canvas', 'Paper', 'Cotton', 'Wood', 'Fabric']);
  const [newBatchMaterial, setNewBatchMaterial] = useState('');
  
  const [variationProfiles, setVariationProfiles] = useState([]);
  const [templates, setTemplates] = useState([]);
  
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  
  const [newTag, setNewTag] = useState('');
  const [newMaterial, setNewMaterial] = useState('');

  // Editing form states (syncs with selectedProduct)
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState([]);
  const [description, setDescription] = useState('');
  const [materials, setMaterials] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedTemplateIds, setSelectedTemplateIds] = useState([]);
  const [shopSections, setShopSections] = useState([]);
  const [selectedSectionId, setSelectedSectionId] = useState('');

  const [localMockups, setLocalMockups] = useState([]);
  const [localProductId, setLocalProductId] = useState(null);

  // Shop configurations for AI prompting
  const [shopStyle, setShopStyle] = useState('vintage poster, art deco');
  const [targetMarket, setTargetMarket] = useState('US/UK');

  // Pagination states
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  useEffect(() => {
    fetchProfiles();
    fetchTemplates();
    fetchAiConfig();
    fetchShopSections();
  }, [etsyConnected]);

  useEffect(() => {
    setSelectedProduct(null);
    setSelectedListingIds([]);
    setSelectedLocalIds([]);
    setEtsyListings([]);
    setProducts([]);
    setOffset(0);
    
    if (activeTab === 'local') {
      fetchProducts(filterSectionId);
    } else {
      fetchEtsyListings(activeTab, 0, filterSectionId);
    }
  }, [activeTab, etsyConnected, filterSectionId]);

  const fetchShopSections = async () => {
    if (!etsyConnected) return;
    try {
      const res = await axios.get(`${API_BASE}/etsy/shop-sections`);
      setShopSections(res.data || []);
    } catch (err) {
      console.error('Bölümler çekilemedi:', err);
    }
  };

  const fetchProducts = async (secId = filterSectionId) => {
    setLoading(true);
    try {
      const params = { platform: appMode || 'etsy' };
      if (secId) params.shop_section_id = secId;
      const res = await axios.get(`${API_BASE}/products`, { params });
      // Filter out products that are already live on Etsy (they will be managed in Etsy tabs)
      setProducts(res.data.filter(p => p.status !== 'live'));
    } catch (err) {
      console.error('Yerel ürünler çekilemedi:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchEtsyListings = async (tabState, currentOffset = 0, secId = filterSectionId) => {
    if (!etsyConnected) return;
    setLoading(true);
    try {
      const params = {
        state: tabState,
        limit: LIMIT,
        offset: currentOffset
      };
      if (secId) {
        params.shop_section_ids = secId;
      }
      const res = await axios.get(`${API_BASE}/etsy/listings`, { params });
      if (res.data && res.data.results) {
        setEtsyListings(res.data.results);
        setTotalCount(res.data.count || 0);
        setOffset(currentOffset);
      }
    } catch (err) {
      console.error('Etsy listesi çekilemedi:', err);
    } finally {
      setLoading(false);
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

  const fetchTemplates = async () => {
    try {
      const res = await axios.get(`${API_BASE}/templates`);
      setTemplates(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAiConfig = async () => {
    try {
      const res = await axios.get(`${API_BASE}/settings`);
      if (res.data) {
        if (res.data.shop_style) setShopStyle(res.data.shop_style);
        if (res.data.target_market) setTargetMarket(res.data.target_market);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectProduct = (product) => {
    setSelectedProduct(product);
    setTitle(product.title || '');
    setTags(product.tags ? (typeof product.tags === 'string' ? JSON.parse(product.tags) : product.tags) : []);
    setDescription(product.description || '');
    setMaterials([]); // Local products don't store materials directly
    setSelectedProfileId(product.variation_profile_id || '');
    setSelectedTemplateIds(product.template_ids ? (typeof product.template_ids === 'string' ? JSON.parse(product.template_ids) : product.template_ids) : []);
    setSelectedSectionId(product.shop_section_id || '');
    setLocalMockups([]);
    setLocalProductId(product.id);
  };

  const handleSelectEtsyListing = async (listing) => {
    const listingIdStr = listing.listing_id.toString();
    setSelectedProduct({
      id: listingIdStr,
      etsy_listing_id: listingIdStr,
      title: listing.title,
      description: listing.description,
      tags: listing.tags || [],
      materials: listing.materials || [],
      status: 'live',
      price: listing.price ? (listing.price.amount / (listing.price.divisor || 100)) : 0,
      quantity: listing.quantity,
      shop_section_id: listing.shop_section_id || ''
    });

    setTitle(listing.title || '');
    setTags(listing.tags || []);
    setDescription(listing.description || '');
    setMaterials(listing.materials || []);
    setSelectedSectionId(listing.shop_section_id ? listing.shop_section_id.toString() : '');
    
    // Clear variation options until loaded from linked local product
    setSelectedProfileId('');
    setSelectedTemplateIds([]);
    setLocalMockups([]);
    setLocalProductId(null);

    // Fetch local details and mockups from backend
    try {
      const res = await axios.get(`${API_BASE}/etsy/listings/${listing.listing_id}/details`);
      setLocalMockups(res.data.mockups || []);
      setLocalProductId(res.data.productId);
      if (res.data.localProduct) {
        setSelectedProfileId(res.data.localProduct.variation_profile_id || '');
        setSelectedTemplateIds(res.data.localProduct.template_ids ? JSON.parse(res.data.localProduct.template_ids) : []);
      }
    } catch (err) {
      console.error('Yerel detaylar yüklenirken hata oluştu:', err);
    }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setUploading(true);
    const formData = new FormData();
    files.forEach(file => {
      formData.append('images', file);
    });

    try {
      const res = await axios.post(`${API_BASE}/products/upload?platform=${appMode || 'etsy'}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      // Filter out live ones
      const newLocal = res.data.filter(p => p.status !== 'live');
      setProducts(prev => [...newLocal, ...prev]);
      if (newLocal.length > 0) {
        handleSelectProduct(newLocal[0]);
      }
    } catch (err) {
      console.error('Yükleme hatası:', err);
      alert('Görseller yüklenirken hata oluştu.');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveProductInfo = async () => {
    if (!selectedProduct) return;
    setActionLoading(true);
    try {
      if (activeTab === 'local') {
        // Update local database product
        const payload = {
          title,
          tags,
          description,
          variation_profile_id: selectedProfileId || null,
          template_ids: selectedTemplateIds,
          shop_section_id: selectedSectionId || null,
          status: selectedProduct.status
        };
        await axios.put(`${API_BASE}/products/${selectedProduct.id}`, payload);
        
        setProducts(prev => prev.map(p => {
          if (p.id === selectedProduct.id) {
            return { ...p, ...payload };
          }
          return p;
        }));
        alert('Ürün bilgileri başarıyla güncellendi.');
      } else {
        // Update Etsy listing directly
        const payload = {
          title,
          description,
          tags,
          materials,
          shop_section_id: selectedSectionId || null
        };
        await axios.post(`${API_BASE}/etsy/listings/${selectedProduct.id}/update`, payload);
        
        // Update state list
        setEtsyListings(prev => prev.map(l => {
          if (l.listing_id.toString() === selectedProduct.id) {
            return {
              ...l,
              title,
              description,
              tags,
              materials,
              shop_section_id: selectedSectionId || null
            };
          }
          return l;
        }));
        
        alert('Etsy dükkanınızdaki ürün başarıyla güncellendi.');
      }
    } catch (err) {
      console.error(err);
      alert('Güncelleme başarısız. Hata detayları için konsolu kontrol edin.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteProduct = async (id) => {
    if (!confirm('Bu ürünü yerel taslaklar listesinden silmek istediğinize emin misiniz?')) return;
    try {
      await axios.delete(`${API_BASE}/products/${id}`);
      setProducts(prev => prev.filter(p => p.id !== id));
      if (selectedProduct && selectedProduct.id === id) {
        setSelectedProduct(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleGenerateAiSeo = async (id) => {
    setActionLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/ai/generate`, {
        productId: id,
        targetMarket,
        shopStyle
      });
      
      const { title: aiTitle, tags: aiTags, description: aiDesc } = res.data;
      
      if (selectedProduct && selectedProduct.id === id) {
        setTitle(aiTitle);
        setTags(aiTags);
        setDescription(aiDesc);
      }

      setProducts(prev => prev.map(p => {
        if (p.id === id) {
          return {
            ...p,
            title: aiTitle,
            tags: aiTags,
            description: aiDesc
          };
        }
        return p;
      }));
      
    } catch (err) {
      console.error(err);
      alert('AI SEO üretimi başarısız. API ayarlarınızı kontrol edin.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUploadToEtsy = async (id) => {
    if (!etsyConnected) {
      alert('Etsy bağlantınız bulunmamaktadır. Lütfen önce mağazanızı bağlayın.');
      return;
    }
    
    await handleSaveProductInfo();
    setActionLoading(true);
    
    // Set status to uploading locally
    setProducts(prev => prev.map(p => p.id === id ? { ...p, status: 'uploading' } : p));
    
    try {
      const res = await axios.post(`${API_BASE}/etsy/upload-listing`, { productId: id });
      const { listing_id } = res.data;
      
      // Since it is now live, it will disappear from "Yerel Taslaklar" list
      setProducts(prev => prev.filter(p => p.id !== id));
      setSelectedProduct(null);
      alert('Tebrikler! Ürününüz başarıyla Etsy mağazanıza yüklenmiştir.');
    } catch (err) {
      console.error(err);
      alert('Etsy yükleme hatası.');
      setProducts(prev => prev.map(p => p.id === id ? { ...p, status: 'error' } : p));
    } finally {
      setActionLoading(false);
    }
  };

  // Tag helper functions
  const handleAddTag = (e) => {
    e.preventDefault();
    const cleanTag = newTag.trim();
    if (!cleanTag) return;
    if (cleanTag.length > 20) {
      alert('Tag en fazla 20 karakter olmalıdır.');
      return;
    }
    if (tags.length >= 13) {
      alert('Etsy en fazla 13 adet tag kabul eder.');
      return;
    }
    if (tags.includes(cleanTag)) {
      setNewTag('');
      return;
    }
    setTags([...tags, cleanTag]);
    setNewTag('');
  };

  const handleRemoveTag = (tag) => {
    setTags(tags.filter(t => t !== tag));
  };

  // Materials helper functions
  const handleMaterialToggle = (material) => {
    if (materials.includes(material)) {
      setMaterials(materials.filter(m => m !== material));
    } else {
      if (materials.length >= 13) {
        alert('En fazla 13 materyal ekleyebilirsiniz.');
        return;
      }
      setMaterials([...materials, material]);
    }
  };

  const handleAddMaterial = (e) => {
    e.preventDefault();
    const val = newMaterial.trim();
    if (!val) return;
    if (materials.includes(val)) {
      setNewMaterial('');
      return;
    }
    if (materials.length >= 13) {
      alert('En fazla 13 materyal ekleyebilirsiniz.');
      return;
    }
    setMaterials([...materials, val]);
    setNewMaterial('');
  };

  // Bulk actions checkbox management
  const handleSelectListingToggle = (listingId) => {
    setSelectedListingIds(prev => 
      prev.includes(listingId) 
        ? prev.filter(id => id !== listingId) 
        : [...prev, listingId]
    );
  };

  const handleSelectLocalToggle = (id) => {
    setSelectedLocalIds(prev => 
      prev.includes(id) 
        ? prev.filter(i => i !== id) 
        : [...prev, id]
    );
  };

  const handleSelectAllListings = () => {
    const listIds = filteredListings.map(l => l.listing_id.toString());
    const allSelected = listIds.length > 0 && listIds.every(id => selectedListingIds.includes(id));
    if (allSelected) {
      setSelectedListingIds(prev => prev.filter(id => !listIds.includes(id)));
    } else {
      setSelectedListingIds(prev => Array.from(new Set([...prev, ...listIds])));
    }
  };

  const handleSelectAllLocal = () => {
    const allIds = filteredProducts.map(p => p.id);
    const allSelected = allIds.length > 0 && allIds.every(id => selectedLocalIds.includes(id));
    if (allSelected) {
      setSelectedLocalIds(prev => prev.filter(id => !allIds.includes(id)));
    } else {
      setSelectedLocalIds(prev => Array.from(new Set([...prev, ...allIds])));
    }
  };

  const handleBatchUpdateVariationProfile = async () => {
    const activeIds = activeTab === 'local' ? selectedLocalIds : selectedListingIds;
    if (activeIds.length === 0) return;
    if (!batchVariationProfileId) {
      alert('Lütfen güncellenecek varyasyon profilini seçin.');
      return;
    }

    const targetProfile = variationProfiles.find(p => p.id === batchVariationProfileId);
    const profileName = targetProfile ? targetProfile.name : batchVariationProfileId;

    if (!confirm(`${activeIds.length} adet ürünün varyasyon profilini [ ${profileName} ] olarak ${activeTab === 'local' ? 'yerelde' : 'Etsy mağazanızda'} güncellemek istediğinize emin misiniz?`)) return;

    setBatchLoading(true);
    try {
      if (activeTab === 'local') {
        const res = await axios.post(`${API_BASE}/products/batch-variation-profile`, {
          productIds: activeIds,
          variation_profile_id: batchVariationProfileId
        });
        alert(`Tebrikler! ${res.data.updatedCount || activeIds.length} adet yerel ürünün varyasyon profili [${profileName}] olarak başarıyla güncellendi.`);
        fetchProducts();
        setSelectedLocalIds([]);
      } else {
        const res = await axios.post(`${API_BASE}/etsy/listings/batch-variation-profile`, {
          listingIds: activeIds,
          variation_profile_id: batchVariationProfileId
        });
        
        const failed = res.data.results ? res.data.results.filter(r => !r.success) : [];
        if (failed.length > 0) {
          alert(`${res.data.results.length} Etsy ürününden ${failed.length} adedinin varyasyonu güncellenemedi. Detaylar konsolda.`);
          console.error('Etsy batch variation failures:', failed);
        } else {
          alert(`Tebrikler! ${res.data.results?.length || activeIds.length} adet Etsy ürününün varyasyon profili [${profileName}] olarak Etsy üzerinde başarıyla güncellendi!`);
        }
        
        fetchEtsyListings(activeTab, offset);
        setSelectedListingIds([]);
      }
      
      setShowVariationModal(false);

      if (selectedProduct && activeIds.includes(selectedProduct.id)) {
        setSelectedProfileId(batchVariationProfileId);
      }
    } catch (err) {
      console.error('Batch variation update error:', err.response?.data || err.message);
      alert('Toplu varyasyon güncelleme hatası: ' + (err.response?.data?.error || err.message));
    } finally {
      setBatchLoading(false);
    }
  };

  const handleBatchMaterialToggle = (material) => {
    setBatchMaterials(prev => 
      prev.includes(material) 
        ? prev.filter(m => m !== material) 
        : [...prev, material]
    );
  };

  const handleAddBatchMaterial = (e) => {
    e.preventDefault();
    const val = newBatchMaterial.trim();
    if (!val) return;
    if (batchMaterials.includes(val)) {
      setNewBatchMaterial('');
      return;
    }
    setBatchMaterials([...batchMaterials, val]);
    setNewBatchMaterial('');
  };

  const handleBatchUpdateMaterials = async () => {
    if (selectedListingIds.length === 0) return;
    if (batchMaterials.length === 0) {
      alert('Lütfen en az bir materyal seçin veya ekleyin.');
      return;
    }
    if (!confirm(`${selectedListingIds.length} adet ürünün malzemelerini [ ${batchMaterials.join(', ')} ] olarak toplu güncellemek istediğinize emin misiniz?`)) return;

    setBatchLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/etsy/listings/batch-materials`, {
        listingIds: selectedListingIds,
        materials: batchMaterials
      });
      
      const failed = res.data.results.filter(r => !r.success);
      if (failed.length > 0) {
        alert(`${res.data.results.length} üründen ${failed.length} adedi güncellenemedi. Hatalar konsolda.`);
        console.error('Batch materials update failures:', failed);
      } else {
        alert(`Tebrikler! ${res.data.results.length} adet ürünün malzemesi başarıyla güncellendi.`);
      }
      
      // Refresh current listings
      fetchEtsyListings(activeTab, offset);
      setSelectedListingIds([]);
      setShowMaterialModal(false);
      
      // Refresh selected product if it was updated
      if (selectedProduct && selectedListingIds.includes(selectedProduct.id)) {
        setMaterials(batchMaterials);
        setSelectedProduct(prev => ({ ...prev, materials: batchMaterials }));
      }
    } catch (err) {
      console.error(err);
      alert('Toplu güncelleme hatası.');
    } finally {
      setBatchLoading(false);
    }
  };

  const handlePageChange = (direction) => {
    let newOffset = offset;
    if (direction === 'prev') {
      newOffset = Math.max(0, offset - LIMIT);
    } else if (direction === 'next') {
      newOffset = Math.min(totalCount - 1, offset + LIMIT);
    }
    fetchEtsyListings(activeTab, newOffset);
  };

  const isAllPageSelected = etsyListings.length > 0 && etsyListings.every(l => selectedListingIds.includes(l.listing_id.toString()));

  const filteredProducts = products;
  const filteredListings = etsyListings;

  const isAllFilteredPageSelected = filteredListings.length > 0 && filteredListings.every(l => selectedListingIds.includes(l.listing_id.toString()));
  const isAllFilteredLocalSelected = filteredProducts.length > 0 && filteredProducts.every(p => selectedLocalIds.includes(p.id));

  return (
    <>
      <div className="py-6 px-4 max-w-7xl mx-auto animate-fade-in">
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            {appMode === 'shopify' ? 'Shopify Ürün Yönetim Paneli' : 'Etsy Ürün Yönetim Paneli'}
          </h2>
          <p className="text-slate-400 text-sm">
            {appMode === 'shopify' 
              ? 'Shopify yerel taslaklarınızı inceleyin, düzenleyin ve varyasyonları yönetin.' 
              : 'Etsy envanterinizi inceleyin, kategorize edin ve malzemeleri toplu olarak güncelleyin.'}
          </p>
        </div>

        {/* Local upload shown only on local tab */}
        {activeTab === 'local' && (
          <label className={`flex items-center justify-center space-x-2 bg-gradient-to-r ${
            appMode === 'shopify' ? 'from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white' : 'from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 text-slate-950'
          } font-bold py-3 px-6 rounded-xl shadow-lg transition-all cursor-pointer text-sm`}>
            <UploadCloud className="w-5 h-5" />
            <span>{uploading ? 'Yükleniyor...' : 'Yeni Sanat Eseri Yükle'}</span>
            <input 
              type="file" 
              multiple 
              accept="image/*" 
              onChange={handleFileUpload} 
              disabled={uploading}
              className="hidden" 
            />
          </label>
        )}
      </div>

      {/* Tabs Menu */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#1e293b] pb-4 mb-6">
        <button
          onClick={() => setActiveTab('local')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
            activeTab === 'local' 
              ? `bg-[#1e293b] text-white ${appMode === 'shopify' ? 'border-emerald-500/50 shadow-emerald-500/5' : 'border-amber-500/50 shadow-amber-500/5'} shadow-md` 
              : 'text-slate-400 border-transparent hover:text-white hover:bg-[#151f32]'
          }`}
        >
          Yerel Taslaklar (Yerel)
        </button>
        {appMode !== 'shopify' && ['active', 'draft', 'inactive', 'sold_out', 'expired'].map(state => {
          const tabLabel = state === 'active' ? 'Aktif (Etsy)' :
                           state === 'draft' ? 'Taslak (Etsy)' :
                           state === 'inactive' ? 'Pasif (Etsy)' :
                           state === 'sold_out' ? 'Tükenen (Etsy)' : 'Süresi Dolan (Etsy)';
          return (
            <button
              key={state}
              onClick={() => setActiveTab(state)}
              disabled={!etsyConnected}
              className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                activeTab === state 
                  ? 'bg-[#1e293b] text-white border-amber-500/50 shadow-md' 
                  : 'text-slate-400 border-transparent hover:text-white hover:bg-[#151f32]'
              }`}
            >
              {tabLabel}
            </button>
          );
        })}
      </div>

      {/* Shop Section Filter Bar */}
      <div className="flex flex-wrap items-center justify-between bg-[#0e1726] border border-[#1e293b] rounded-2xl p-4 mb-6 gap-4">
        <div className="flex items-center space-x-3">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
            <Layers className="w-4 h-4 text-amber-500" />
            <span>Mağaza Bölümü Filtresi:</span>
          </span>
          <select
            value={filterSectionId}
            onChange={(e) => setFilterSectionId(e.target.value)}
            className="bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 min-w-[220px]"
          >
            <option value="">Tüm Bölümler ({activeTab === 'local' ? products.length : totalCount})</option>
            {shopSections.map(sec => (
              <option key={sec.shop_section_id} value={sec.shop_section_id.toString()}>
                {sec.title} ({sec.active_listing_count || 0} ürün)
              </option>
            ))}
          </select>
        </div>

        {filterSectionId && (
          <button
            onClick={() => setFilterSectionId('')}
            className="text-xs text-amber-500 hover:text-amber-400 font-semibold transition-colors flex items-center space-x-1"
          >
            <X className="w-3.5 h-3.5" />
            <span>Filtreyi Temizle</span>
          </button>
        )}
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Listings Grid */}
        <div className="lg:col-span-2 space-y-4">
          
          {/* Select All Bar */}
          {((activeTab !== 'local' && filteredListings.length > 0) || (activeTab === 'local' && filteredProducts.length > 0)) && (
            <div className="flex items-center justify-between bg-[#0e1726]/60 border border-[#1e293b] rounded-2xl p-4">
              <button 
                onClick={activeTab === 'local' ? handleSelectAllLocal : handleSelectAllListings}
                className="flex items-center space-x-2 text-xs text-slate-300 hover:text-white transition-colors"
              >
                {(activeTab === 'local' ? isAllFilteredLocalSelected : isAllFilteredPageSelected) ? (
                  <CheckSquare className="w-4 h-4 text-amber-500" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                <span>Bu Sayfadaki Tümünü Seç</span>
              </button>

              <div className="flex items-center space-x-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {(activeTab === 'local' ? selectedLocalIds.length : selectedListingIds.length)} Seçili Ürün
                </span>
                {(activeTab === 'local' ? selectedLocalIds.length > 0 : selectedListingIds.length > 0) && (
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => {
                        setBatchVariationProfileId(selectedProfileId || (variationProfiles[0]?.id || ''));
                        setShowVariationModal(true);
                      }}
                      className="flex items-center space-x-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-bold px-3 py-1.5 rounded-xl transition-colors"
                    >
                      <Grid className="w-3.5 h-3.5" />
                      <span>Varyasyon Güncelle</span>
                    </button>
                    
                    <button
                      onClick={() => setShowMaterialModal(true)}
                      className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-[#334155] text-xs font-bold px-3 py-1.5 rounded-xl transition-colors"
                    >
                      <Tag className="w-3.5 h-3.5 text-amber-500" />
                      <span>Malzeme Güncelle</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-32 space-y-3">
              <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
              <span className="text-xs text-slate-400">Ürün listesi yükleniyor...</span>
            </div>
          ) : activeTab === 'local' ? (
            // Local Draft Grid
            filteredProducts.length === 0 ? (
              <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-16 text-center text-slate-500">
                <ShoppingBag className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                <p className="font-medium mb-1 text-white">Yerel taslak ürün bulunmamaktadır</p>
                <p className="text-xs text-slate-500 mb-6">"Yeni Sanat Eseri Yükle" butonuna basarak bilgisayarınızdan ilk resmi ekleyin.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredProducts.map(product => {
                  const isSelected = selectedProduct && selectedProduct.id === product.id;
                  const isChecked = selectedLocalIds.includes(product.id);
                  return (
                    <div 
                      key={product.id}
                      onClick={() => handleSelectProduct(product)}
                      className={`bg-[#0e1726] border rounded-3xl p-4 flex flex-col justify-between cursor-pointer transition-all relative group hover:border-amber-500/20 ${
                        isSelected ? 'border-amber-500 ring-2 ring-amber-500/20' : 'border-[#1e293b]'
                      }`}
                    >
                      {/* Checkbox Overlay */}
                      <div 
                        className="absolute top-3 left-3 z-10"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectLocalToggle(product.id);
                        }}
                      >
                        <button className="w-5 h-5 rounded-lg border border-[#1e293b] bg-slate-900/80 hover:bg-slate-900 flex items-center justify-center transition-colors">
                          {isChecked && <Check className="w-3.5 h-3.5 text-amber-500 font-bold" />}
                        </button>
                      </div>

                      <div>
                        <div className="aspect-[4/3] w-full bg-slate-950 rounded-2xl overflow-hidden mb-3 relative">
                          <img 
                            src={`http://localhost:3001/${product.image_path}`} 
                            alt={product.title || 'Yerel Taslak'} 
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute top-2.5 right-2.5">
                            {product.status === 'uploading' && (
                              <span className="bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-lg flex items-center space-x-1">
                                <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                                <span>Yükleniyor...</span>
                              </span>
                            )}
                            {product.status === 'error' && (
                              <span className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-lg flex items-center space-x-1">
                                <AlertCircle className="w-2.5 h-2.5" />
                                <span>Hata</span>
                              </span>
                            )}
                          </div>
                        </div>
                        <h3 className="font-bold text-white text-sm line-clamp-1 mb-1">{product.title || 'İsimsiz Yerel Taslak'}</h3>
                        <p className="text-slate-500 text-[10px] truncate">{product.id}</p>
                      </div>

                      <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#1e293b]">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGenerateAiSeo(product.id);
                          }}
                          className="flex items-center space-x-1 text-xs text-amber-500 hover:text-amber-400 font-semibold transition-colors"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>AI SEO</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteProduct(product.id);
                          }}
                          className="text-slate-500 hover:text-rose-400 transition-colors p-1"
                          title="Ürünü Sil"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            // Etsy Listings Grid (fetched from Etsy API)
            filteredListings.length === 0 ? (
              <div className="bg-[#0e1726] border border-[#1e293b] rounded-2xl p-16 text-center text-slate-500">
                <ShoppingBag className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                <p className="font-medium mb-1 text-white">Bu kategoride Etsy ürünü bulunamadı</p>
                <p className="text-xs text-slate-500">Etsy mağazanızda bu statüde herhangi bir listeleme yer almıyor.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredListings.map(listing => {
                    const listingIdStr = listing.listing_id.toString();
                    const isSelected = selectedProduct && selectedProduct.id === listingIdStr;
                    const isChecked = selectedListingIds.includes(listingIdStr);
                    
                    const imagesArr = listing.images || listing.Images || [];
                    const firstImg = imagesArr[0];
                    const thumbnail = firstImg ? (firstImg.url_170x135 || firstImg.url_75x75 || firstImg.url_570xN || firstImg.url_fullxfull) : null;

                    return (
                      <div 
                        key={listing.listing_id}
                        onClick={() => handleSelectEtsyListing(listing)}
                        className={`bg-[#0e1726] border rounded-3xl p-4 flex flex-col justify-between cursor-pointer transition-all relative group hover:border-amber-500/20 ${
                          isSelected ? 'border-amber-500 ring-2 ring-amber-500/20' : 'border-[#1e293b]'
                        }`}
                      >
                        {/* Checkbox Overlay */}
                        <div 
                          className="absolute top-3 left-3 z-10"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectListingToggle(listingIdStr);
                          }}
                        >
                          <button className="w-5 h-5 rounded-lg border border-[#1e293b] bg-slate-900/80 hover:bg-slate-900 flex items-center justify-center transition-colors">
                            {isChecked && <Check className="w-3.5 h-3.5 text-amber-500 font-bold" />}
                          </button>
                        </div>

                        <div>
                          <div className="aspect-[4/3] w-full bg-slate-950 rounded-2xl overflow-hidden mb-3 relative">
                            {thumbnail ? (
                              <img 
                                src={thumbnail} 
                                alt={listing.title} 
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-700 bg-slate-900/60">
                                <ShoppingBag className="w-8 h-8" />
                              </div>
                            )}
                          </div>

                          <h3 className="font-bold text-white text-sm line-clamp-1 mb-1">{listing.title || 'Untitled Listing'}</h3>
                          <p className="text-slate-500 text-[10px] mb-2">Etsy ID: {listing.listing_id}</p>

                          {/* Quick Materials View (Helpful for spotting empty materials) */}
                          <div className="flex flex-wrap gap-1 min-h-[22px]">
                            {listing.materials && listing.materials.length > 0 ? (
                              listing.materials.slice(0, 4).map(mat => (
                                <span key={mat} className="text-[8px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/10">
                                  {mat}
                                </span>
                              ))
                            ) : (
                              <span className="text-[8px] bg-rose-500/10 text-rose-400 px-2 py-0.5 rounded border border-rose-500/20 font-semibold flex items-center space-x-0.5">
                                <AlertCircle className="w-2 h-2" />
                                <span>Malzeme Belirtilmemiş</span>
                              </span>
                            )}
                            {listing.materials && listing.materials.length > 4 && (
                              <span className="text-[8px] text-slate-500 font-medium">+{listing.materials.length - 4}</span>
                            )}
                          </div>
                        </div>

                        {/* Card footer */}
                        <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#1e293b] text-[10px]">
                          <span className="font-bold text-slate-400">${(listing.price.amount / (listing.price.divisor || 100)).toFixed(2)}</span>
                          <span className="text-slate-500">Adet: {listing.quantity}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination bar */}
                {totalCount > LIMIT && (
                  <div className="flex items-center justify-between bg-[#0e1726]/60 border border-[#1e293b] rounded-2xl p-4">
                    <button
                      onClick={() => handlePageChange('prev')}
                      disabled={offset === 0}
                      className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-20 rounded-xl transition-all"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-slate-400">
                      {offset + 1} - {Math.min(offset + LIMIT, totalCount)} / {totalCount}
                    </span>
                    <button
                      onClick={() => handlePageChange('next')}
                      disabled={offset + LIMIT >= totalCount}
                      className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-20 rounded-xl transition-all"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )
          )}
        </div>

        {/* Right Column: Edit Drawer / Details Panel */}
        <div className="lg:col-span-1">
          {selectedProduct ? (
            <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 sticky top-6 space-y-6">
              <div className="flex items-center justify-between border-b border-[#1e293b] pb-4">
                <h3 className="text-md font-bold text-white flex items-center space-x-2">
                  <Edit3 className="w-4 h-4 text-amber-500" />
                  <span>{activeTab === 'local' ? 'Ürün Düzenleyici (Yerel)' : 'Etsy Ürün Düzenleyici'}</span>
                </h3>
                
                {selectedProduct.etsy_listing_id && (
                  <a
                    href={`https://www.etsy.com/listing/${selectedProduct.etsy_listing_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-slate-400 hover:text-white flex items-center space-x-1"
                  >
                    <span>Etsy'de Gör</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {/* Form elements */}
              <div className="space-y-4">
                {/* Title */}
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Etsy Ürün Başlığı (Title)
                    </label>
                    <span className={`text-[10px] ${title.length > 140 ? 'text-rose-500 font-bold' : 'text-slate-500'}`}>
                      {title.length}/140
                    </span>
                  </div>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    maxLength={200}
                  />
                </div>

                {/* Assigned Variation Profile (Local Draft Tab Only) */}
                {activeTab === 'local' && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Varyasyon & Fiyat Profili
                    </label>
                    <select
                      value={selectedProfileId}
                      onChange={(e) => setSelectedProfileId(e.target.value)}
                      className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    >
                      <option value="">Profil Seçiniz...</option>
                      {variationProfiles.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Shop Section */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Etsy Mağaza Bölümü (Shop Section)
                  </label>
                  {etsyConnected ? (
                    <select
                      value={selectedSectionId}
                      onChange={(e) => setSelectedSectionId(e.target.value)}
                      className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    >
                      <option value="">Bölüm Seçilmesin (Bölümsüz)</option>
                      {shopSections.map(s => (
                        <option key={s.shop_section_id} value={s.shop_section_id.toString()}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-[10px] text-slate-500 italic bg-[#151f32]/40 border border-[#1e293b]/50 p-2.5 rounded-xl">
                      Etsy mağazanız bağlı değil.
                    </div>
                  )}
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Açıklama Taslağı (Description)
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={6}
                    className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 resize-y"
                  />
                </div>

                {/* Materials Editor (Directly in panel for single item) */}
                {activeTab !== 'local' && (
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Malzemeler (Materials - Max 13)
                      </label>
                      <span className="text-[10px] text-slate-500 font-semibold">{materials.length}/13</span>
                    </div>

                    {/* Predefined toggle chips */}
                    <div className="flex flex-wrap gap-1">
                      {['Canvas', 'Paper', 'Cotton', 'Wood', 'Fabric'].map(m => {
                        const active = materials.includes(m);
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => handleMaterialToggle(m)}
                            className={`text-[9px] px-2 py-0.5 rounded border transition-all ${
                              active 
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : 'bg-[#151f32] text-slate-500 border-[#1e293b]'
                            }`}
                          >
                            {m}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap gap-1 bg-[#151f32] border border-[#1e293b] p-3 rounded-xl min-h-[50px]">
                      {materials.map((mat, i) => (
                        <span 
                          key={i} 
                          className="inline-flex items-center space-x-1 text-[10px] bg-slate-800 text-slate-200 px-2 py-1 rounded border border-[#334155]"
                        >
                          <span>{mat}</span>
                          <button 
                            type="button" 
                            onClick={() => handleMaterialToggle(mat)}
                            className="hover:text-rose-400"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      {materials.length === 0 && (
                        <span className="text-[10px] text-slate-500 italic">Hiç malzeme eklenmemiş.</span>
                      )}
                    </div>

                    <form onSubmit={handleAddMaterial} className="flex space-x-2">
                      <input
                        type="text"
                        value={newMaterial}
                        onChange={(e) => setNewMaterial(e.target.value)}
                        placeholder="Özel malzeme yazın..."
                        className="flex-1 bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="submit"
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-[#334155] px-4 rounded-xl text-xs font-semibold"
                      >
                        Ekle
                      </button>
                    </form>
                  </div>
                )}

                {/* Tags (chips) */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      SEO Arama Kelimeleri (Tags - Max 13)
                    </label>
                    <span className="text-[10px] text-slate-500 font-semibold">{tags.length}/13</span>
                  </div>
                  
                  <div className="flex flex-wrap gap-1 bg-[#151f32] border border-[#1e293b] p-3 rounded-xl min-h-[70px]">
                    {tags.map((tag, i) => (
                      <span 
                        key={i} 
                        className="inline-flex items-center space-x-1 text-[10px] bg-slate-800 text-slate-200 px-2 py-1 rounded border border-[#334155]"
                      >
                        <span>{tag}</span>
                        <button 
                          type="button" 
                          onClick={() => handleRemoveTag(tag)}
                          className="hover:text-rose-400"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    {tags.length === 0 && (
                      <span className="text-[10px] text-slate-500 italic">Hiç tag eklenmemiş.</span>
                    )}
                  </div>

                  <form onSubmit={handleAddTag} className="flex space-x-2">
                    <input
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      placeholder="Yeni tag ekle (Max 20 kr.)"
                      className="flex-1 bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    />
                    <button
                      type="submit"
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-[#334155] px-4 rounded-xl text-xs font-semibold"
                    >
                      Ekle
                    </button>
                  </form>
                </div>

                {/* Mockups section (Loads mockups dynamically on card click) */}
                {activeTab !== 'local' && (
                  <div className="space-y-2 pt-2 border-t border-[#1e293b]/60">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
                      <Layers className="w-3.5 h-3.5 text-amber-500" />
                      <span>Yerel Mockuplar</span>
                    </label>
                    {localMockups.length > 0 ? (
                      <div className="grid grid-cols-3 gap-2 bg-[#151f32] border border-[#1e293b] p-3 rounded-xl">
                        {localMockups.map((mockup, idx) => (
                          <div key={idx} className="aspect-square bg-slate-950 rounded-lg overflow-hidden relative group border border-[#1e293b]">
                            <img 
                              src={mockup.url}
                              alt="" 
                              className="w-full h-full object-cover"
                            />
                            <a 
                              href={mockup.url} 
                              target="_blank" 
                              rel="noreferrer"
                              className="absolute inset-0 bg-slate-950/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-white"
                            >
                              Büyüt
                            </a>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-500 italic bg-[#151f32]/40 border border-[#1e293b]/50 p-3 rounded-xl">
                        Bu ürün için yerel mockup bulunamadı (Etsy üzerinden veya el ile yüklenmiş).
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Actions panel */}
              <div className="pt-6 border-t border-[#1e293b]">
                {activeTab === 'local' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={handleSaveProductInfo}
                      disabled={actionLoading}
                      className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-[#334155] font-bold py-3.5 rounded-xl text-xs transition-colors"
                    >
                      Bilgileri Kaydet
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUploadToEtsy(selectedProduct.id)}
                      disabled={actionLoading || selectedProduct.status === 'uploading'}
                      className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold py-3.5 rounded-xl text-xs shadow-lg shadow-amber-500/10 transition-colors flex items-center justify-center space-x-1.5"
                    >
                      <ShoppingBag className="w-4 h-4" />
                      <span>Etsy'ye Yükle</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleSaveProductInfo}
                    disabled={actionLoading}
                    className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold py-3.5 rounded-xl text-xs shadow-lg shadow-amber-500/10 transition-colors flex items-center justify-center space-x-2"
                  >
                    {actionLoading ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    <span>Etsy Listelemesini Güncelle</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-[#0e1726]/40 border border-dashed border-[#1e293b] rounded-3xl p-12 text-center text-slate-600 sticky top-6">
              <Eye className="w-10 h-10 mx-auto mb-3 text-slate-700" />
              <p className="text-xs">
                Önizleme ve düzenleme yapmak için sol listeden bir ürün seçin veya yeni bir ürün yükleyin.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>

      {/* Bulk Variation Update Modal */}
      {showVariationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 w-full max-w-md shadow-2xl relative space-y-6">
            <div className="flex items-center justify-between border-b border-[#1e293b] pb-4">
              <div className="flex items-center space-x-2.5">
                <Grid className="w-5 h-5 text-amber-500" />
                <h3 className="text-sm font-bold text-white">Toplu Varyasyon Profili Güncelleme</h3>
              </div>
              <button 
                onClick={() => setShowVariationModal(false)}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-slate-400">
                Seçilen <span className="font-bold text-amber-400">{activeTab === 'local' ? selectedLocalIds.length : selectedListingIds.length}</span> adet ürünün boyut ve çerçeve varyasyon profili değiştirilecektir.
              </p>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                  Yeni Varyasyon Profilini Seçin
                </label>
                <select
                  value={batchVariationProfileId}
                  onChange={(e) => setBatchVariationProfileId(e.target.value)}
                  className="w-full bg-[#151f32] border border-[#1e293b] rounded-xl px-4 py-3 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-medium"
                >
                  {variationProfiles.map(prof => (
                    <option key={prof.id} value={prof.id}>
                      {prof.name} ({prof.ratio}) - {prof.sizes?.length || 0} Boyut
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowVariationModal(false)}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-3 rounded-xl text-xs transition-colors"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={handleBatchUpdateVariationProfile}
                disabled={batchLoading}
                className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold py-3 rounded-xl text-xs shadow-lg shadow-amber-500/10 transition-colors flex items-center justify-center space-x-2"
              >
                {batchLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>Varyasyonu Uygula</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Material Update Modal */}
      {showMaterialModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-[#0e1726] border border-[#1e293b] rounded-3xl p-6 w-full max-w-md shadow-2xl relative space-y-6">
            <div className="flex items-center justify-between border-b border-[#1e293b] pb-4">
              <div className="flex items-center space-x-2.5">
                <Tag className="w-5 h-5 text-amber-500" />
                <h3 className="text-sm font-bold text-white">Toplu Malzeme Güncelleme</h3>
              </div>
              <button 
                onClick={() => setShowMaterialModal(false)}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-slate-400">
                Seçilen <span className="font-bold text-amber-400">{selectedListingIds.length}</span> adet Etsy ürününün malzemeleri güncellenecektir.
              </p>

              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Malzemeleri Seçin</span>
                <div className="flex flex-wrap gap-2 mb-3">
                  {['Canvas', 'Paper', 'Cotton', 'Wood', 'Fabric'].map(mat => {
                    const isSel = batchMaterials.includes(mat);
                    return (
                      <button
                        key={mat}
                        type="button"
                        onClick={() => handleBatchMaterialToggle(mat)}
                        className={`text-xs px-3.5 py-1.5 rounded-full border transition-all ${
                          isSel 
                            ? 'bg-amber-500 text-slate-950 border-amber-500 font-bold shadow-md shadow-amber-500/10'
                            : 'bg-slate-900 text-slate-400 border-[#1e293b] hover:text-white'
                        }`}
                      >
                        {mat}
                      </button>
                    );
                  })}
                </div>

                <form onSubmit={handleAddBatchMaterial} className="flex space-x-2 mb-3">
                  <input
                    type="text"
                    value={newBatchMaterial}
                    onChange={(e) => setNewBatchMaterial(e.target.value)}
                    placeholder="Özel malzeme ekle (Örn: Metal, Glass)"
                    className="flex-1 bg-slate-900 border border-[#1e293b] rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="submit"
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-[#334155] px-4 rounded-xl text-xs font-semibold"
                  >
                    Ekle
                  </button>
                </form>

                {batchMaterials.filter(m => !['Canvas', 'Paper', 'Cotton', 'Wood', 'Fabric'].includes(m)).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {batchMaterials.filter(m => !['Canvas', 'Paper', 'Cotton', 'Wood', 'Fabric'].includes(m)).map(mat => (
                      <span 
                        key={mat}
                        className="inline-flex items-center space-x-1 text-[10px] bg-slate-800 text-slate-300 px-2.5 py-1 rounded-full border border-[#334155]"
                      >
                        <span>{mat}</span>
                        <button type="button" onClick={() => handleBatchMaterialToggle(mat)} className="text-slate-500 hover:text-rose-400">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowMaterialModal(false)}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-3 rounded-xl text-xs transition-colors"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={handleBatchUpdateMaterials}
                disabled={batchLoading}
                className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold py-3 rounded-xl text-xs shadow-lg shadow-amber-500/10 transition-colors flex items-center justify-center space-x-2"
              >
                {batchLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>Malzemeleri Uygula</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
