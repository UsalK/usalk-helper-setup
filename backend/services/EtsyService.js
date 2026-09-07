import db, { getActiveShop } from '../db/db.js';
import axios from 'axios';
import fs from 'fs';
import { basename } from 'path';

/**
 * Etsy hiz limiti: saniyede 10 istek (ve gunde 10.000).
 *
 * Tek bir urun yuklemesi bu limite tek basina dayaniyor: createListing + 5
 * taksonomi ozelligi + N mockup gorseli + envanter + aktiflestirme, hepsi
 * arka arkaya. Iki urun ayni anda yayinlaninca limit kesin asiliyor ve Etsy
 * 429 "Exceeded per second rate limit" donuyor. Listing OLUSMUS oluyor ama
 * sonraki adimlar dusuyor, yani yarim yuklenmis bir ilan kaliyor.
 *
 * Cozum iki katmanli:
 *   1) Her istek bir zaman slotu bekliyor, boylece istekler ARALIKLI baslatiliyor.
 *      Slot sayaci modul seviyesinde tutuluyor ki es zamanli yuklemeler de ayni
 *      butceyi paylassin.
 *   2) Buna ragmen 429 gelirse ustel geri cekilme ile tekrar deneniyor.
 */
const ETSY_MIN_INTERVAL_MS = 150;   // ~6.6 istek/sn — 10'luk limitin altinda guvenli pay
const ETSY_MAX_RETRIES = 4;

let nextSlotAt = 0;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Siradaki bos zaman slotunu ayirir ve o ana kadar bekler.
 * Istekleri birbirine zincirlemez (paralellik korunur), sadece BASLAMA
 * zamanlarini araliyor.
 */
async function takeRateLimitSlot() {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + ETSY_MIN_INTERVAL_MS;
  if (slot > now) await delay(slot - now);
}

const etsyHttp = axios.create();

etsyHttp.interceptors.request.use(async (config) => {
  await takeRateLimitSlot();
  return config;
});

etsyHttp.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    const status = error.response?.status;

    // Sadece 429'u tekrar deniyoruz. 4xx'in geri kalani (gecersiz tag, eksik
    // kargo sablonu vb.) tekrar denemekle duzelmez, kullaniciya donmeli.
    if (status !== 429 || !config) throw error;

    config._retryCount = (config._retryCount || 0) + 1;
    if (config._retryCount > ETSY_MAX_RETRIES) throw error;

    // Etsy Retry-After gonderirse ona uyuyoruz, yoksa 1s/2s/4s/8s.
    const retryAfter = Number(error.response?.headers?.['retry-after']);
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 1000 * Math.pow(2, config._retryCount - 1);

    console.warn(`[Etsy Rate Limit] 429 alindi, ${waitMs}ms bekleniyor (deneme ${config._retryCount}/${ETSY_MAX_RETRIES}): ${config.url}`);
    await delay(waitMs);

    // Geri cekilme suresince acilan slotlar eskimis olabilir; sayaci ileri al.
    nextSlotAt = Math.max(nextSlotAt, Date.now());
    return etsyHttp(config);
  }
);

// In-memory caching for metadata to avoid 429 rate limit
const cache = {
  sections: null,
  shippingProfiles: null,
  returnPolicies: null,
  readinessStates: null,
  timestamps: {
    sections: 0,
    shippingProfiles: 0,
    returnPolicies: 0,
    readinessStates: 0
  }
};

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

function getCachedData(key) {
  const now = Date.now();
  if (cache[key] && (now - cache.timestamps[key] < CACHE_DURATION)) {
    console.log(`[Cache] Returning cached data for: ${key}`);
    return cache[key];
  }
  return null;
}

function setCachedData(key, data) {
  cache[key] = data;
  cache.timestamps[key] = Date.now();
  console.log(`[Cache] Saved data for: ${key}`);
}

export function clearEtsyCache() {
  cache.sections = null;
  cache.shippingProfiles = null;
  cache.returnPolicies = null;
  cache.readinessStates = null;
  cache.timestamps = {
    sections: 0,
    shippingProfiles: 0,
    returnPolicies: 0,
    readinessStates: 0
  };
  console.log('[Cache] Etsy metadata cache cleared.');
}

export function getEtsyCredentials() {
  const client_id = process.env.ETSY_CLIENT_ID;
  const client_secret = process.env.ETSY_CLIENT_SECRET;
  
  if (!client_id || !client_secret) {
    throw new Error('Etsy API Key (ETSY_CLIENT_ID) or Shared Secret (ETSY_CLIENT_SECRET) is not configured in backend .env file.');
  }
  
  return {
    client_id,
    client_secret
  };
}

// Mağaza bazlı yenileme kilidi. Global tek promise kullanıldığında iki farklı
// mağaza aynı anda yenileme isterse ikincisi birincinin token'ını alıyordu.
const activeRefreshPromises = new Map();

// Helper to get stored auth details and refresh them if expired
export async function getValidToken() {
  const auth = getActiveShop();
  
  if (!auth || !auth.access_token || auth.shop_id === 'default_shop') {
    throw new Error('Etsy hesabı bağlı değil. Lütfen Etsy panelinden mağazayı bağlayın.');
  }
  
  const { client_id, client_secret } = getEtsyCredentials();
  
  const expiresAt = new Date(auth.expires_at);
  const now = new Date();
  
  // If expired or expiring in 5 minutes, refresh
  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    const pending = activeRefreshPromises.get(auth.shop_id);
    if (pending) {
      console.log(`A token refresh is already in progress for shop ${auth.shop_id}, waiting for it...`);
      return pending;
    }

    const refreshPromise = (async () => {
      console.log(`Etsy token expired or expiring soon for shop ${auth.shop_id}, refreshing...`);
      try {
        const response = await etsyHttp.post('https://api.etsy.com/v3/public/oauth/token', 
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: client_id,
            refresh_token: auth.refresh_token
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );
        
        const { access_token, refresh_token, expires_in } = response.data;
        const newExpiresAt = new Date(Date.now() + expires_in * 1000).toISOString();
        
        // Update tokens in DB for this specific shop
        const updateStmt = db.prepare(
          'UPDATE etsy_auth SET access_token = ?, refresh_token = ?, expires_at = ? WHERE shop_id = ?'
        );
        updateStmt.run(access_token, refresh_token, newExpiresAt, auth.shop_id);
        
        console.log(`Etsy token refreshed successfully for shop ${auth.shop_id}! New expiry:`, newExpiresAt);

        return {
          access_token,
          client_id,
          client_secret,
          shop_id: auth.shop_id
        };
      } catch (err) {
        console.error("Failed to refresh Etsy token:", err.response?.data || err.message);
        throw new Error("Etsy bağlantısı sona erdi. Lütfen Etsy hesabınızı yeniden bağlayın.");
      } finally {
        activeRefreshPromises.delete(auth.shop_id);
      }
    })();

    activeRefreshPromises.set(auth.shop_id, refreshPromise);
    return refreshPromise;
  }
  
  return {
    access_token: auth.access_token,
    client_id,
    client_secret,
    shop_id: auth.shop_id
  };
}

export async function getShopSections(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = getCachedData('sections');
    if (cached) return cached;
  }
  const { access_token, client_id, client_secret, shop_id } = await getValidToken();
  const url = `https://openapi.etsy.com/v3/application/shops/${shop_id}/sections`;
  const res = await etsyHttp.get(url, {
    headers: {
      'x-api-key': `${client_id}:${client_secret}`,
      'Authorization': `Bearer ${access_token}`
    }
  });
  setCachedData('sections', res.data.results);
  return res.data.results;
}

export async function getShippingProfiles(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = getCachedData('shippingProfiles');
    if (cached) return cached;
  }
  const { access_token, client_id, client_secret, shop_id } = await getValidToken();
  const url = `https://openapi.etsy.com/v3/application/shops/${shop_id}/shipping-profiles`;
  const res = await etsyHttp.get(url, {
    headers: {
      'x-api-key': `${client_id}:${client_secret}`,
      'Authorization': `Bearer ${access_token}`
    }
  });
  setCachedData('shippingProfiles', res.data.results);
  return res.data.results;
}

export async function getReturnPolicies(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = getCachedData('returnPolicies');
    if (cached) return cached;
  }
  const { access_token, client_id, client_secret, shop_id } = await getValidToken();
  const url = `https://openapi.etsy.com/v3/application/shops/${shop_id}/policies/return`;
  const res = await etsyHttp.get(url, {
    headers: {
      'x-api-key': `${client_id}:${client_secret}`,
      'Authorization': `Bearer ${access_token}`
    }
  });
  setCachedData('returnPolicies', res.data.results);
  return res.data.results;
}

/**
 * Kurulum sihirbazinin kullandigi ortak POST yardimcisi.
 * Etsy bu uc ucu da form-encoded bekliyor; boolean'lar 'true'/'false' string'i
 * olarak gitmeli, aksi halde API 400 doner.
 */
async function postForm(path, payload) {
  const { access_token, client_id, client_secret, shop_id } = await getValidToken();
  const url = `https://openapi.etsy.com/v3/application/shops/${shop_id}${path}`;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined || value === '') continue;
    params.append(key, typeof value === 'boolean' ? String(value) : String(value));
  }

  const res = await etsyHttp.post(url, params, {
    headers: {
      'x-api-key': `${client_id}:${client_secret}`,
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  return res.data;
}

/**
 * Kargo sablonu olusturur (createShopShippingProfile).
 * Zorunlu: title, origin_country_iso, primary_cost, secondary_cost.
 * primary_cost = ilk urunun kargosu, secondary_cost = ayni siparisteki her ek urun.
 */
export async function createShippingProfile(input) {
  const data = await postForm('/shipping-profiles', {
    title: input.title,
    origin_country_iso: input.origin_country_iso,
    primary_cost: input.primary_cost,
    secondary_cost: input.secondary_cost,
    min_processing_time: input.min_processing_time,
    max_processing_time: input.max_processing_time,
    processing_time_unit: input.processing_time_unit || 'business_days',
    destination_country_iso: input.destination_country_iso,
    destination_region: input.destination_region || 'none',
    origin_postal_code: input.origin_postal_code,
    min_delivery_days: input.min_delivery_days,
    max_delivery_days: input.max_delivery_days
  });
  cache.shippingProfiles = null;
  cache.timestamps.shippingProfiles = 0;
  return data;
}

/**
 * Iade politikasi olusturur (createShopReturnPolicy).
 * return_deadline yalnizca iade veya degisim kabul ediliyorsa anlamli; Etsy
 * 14/21/30/45/60/90 gun degerlerini kabul ediyor.
 */
export async function createReturnPolicy(input) {
  const accepts_returns = Boolean(input.accepts_returns);
  const accepts_exchanges = Boolean(input.accepts_exchanges);
  const data = await postForm('/policies/return', {
    accepts_returns,
    accepts_exchanges,
    return_deadline: (accepts_returns || accepts_exchanges) ? input.return_deadline : null
  });
  cache.returnPolicies = null;
  cache.timestamps.returnPolicies = 0;
  return data;
}

/**
 * Isleme suresi tanimi olusturur (createShopReadinessStateDefinition).
 * readiness_state: 'made_to_order' (siparise ozel uretim) | 'ready_to_ship'.
 * Baski-siparis modelinde dogru deger made_to_order'dir.
 */
export async function createReadinessStateDefinition(input) {
  const data = await postForm('/readiness-state-definitions', {
    readiness_state: input.readiness_state || 'made_to_order',
    min_processing_time: input.min_processing_time,
    max_processing_time: input.max_processing_time,
    processing_time_unit: input.processing_time_unit || 'days'
  });
  cache.readinessStates = null;
  cache.timestamps.readinessStates = 0;
  return data;
}

// Etsy tags/materials alanlarini virgulle ayrilmis TEK bir string olarak aliyor.
// Bu yuzden bir tag'in icindeki virgul ayirici sayilir ve tag ikiye bolunur:
// 13 tag 14 gorunur, istek "tags_too_many" ile 400 doner. Birlestirmeden once
// her ogenin icindeki virgulu bosluga ceviriyoruz.
function joinCsvField(value) {
  const items = Array.isArray(value) ? value : [value];
  return items
    .map(v => String(v).replace(/,/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(',');
}

export async function createListing(listingData) {
  const { access_token, client_id, client_secret, shop_id } = await getValidToken();
  const url = `https://openapi.etsy.com/v3/application/shops/${shop_id}/listings`;
  
  // Format body as url-encoded form data
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(listingData)) {
    if (key === 'tags' || key === 'materials') {
      if (value !== null && value !== undefined) {
        params.append(key, joinCsvField(value));
      }
    } else if (Array.isArray(value)) {
      value.forEach(v => params.append(key, v));
    } else if (value !== null && value !== undefined) {
      params.append(key, value.toString());
    }
  }

  const res = await etsyHttp.post(url, params, {
    headers: {
      'x-api-key': `${client_id}:${client_secret}`,
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  return res.data;
}

export async function uploadListingImage(listing_id, imagePath, rank = 1, altText = '') {
  const { access_token, client_id, client_secret, shop_id } = await getValidToken();
  const url = `https://openapi.etsy.com/v3/application/shops/${shop_id}/listings/${listing_id}/images`;
  
  const fileBuffer = fs.readFileSync(imagePath);
  const isPng = imagePath.toLowerCase().endsWith('.png');
  const mimeType = isPng ? 'image/png' : 'image/jpeg';
  const fileName = basename(imagePath) || 'image.jpg';
  
  const blob = new Blob([fileBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append('image', blob, fileName);
  formData.append('rank', rank.toString());
  if (altText) {
    formData.append('alt_text', altText);
  }

  const res = await etsyHttp.post(url, formData, {
    headers: {
      'x-api-key': `${client_id}:${client_secret}`,
      'Authorization': `Bearer ${access_token}`
    }
  });
  return res.data;
}

export async function getListingImages(listing_id) {
  const { access_token, client_id, client_secret } = await getValidToken();
  const url = `https://openapi.etsy.com/v3/application/listings/${listing_id}/images`;
  const res = await etsyHttp.get(url, {
    headers: {
      'x-api-key': `${client_id}:${client_secret}`,
      'Authorization': `Bearer ${access_token}`
    }
  });
  return res.data.results || [];
}

export async function deleteListingImage(listing_id, listing_image_id) {
  const { access_token, client_id, client_secret, shop_id } = await getValidToken();
  const url = `https://openapi.etsy.com/v3/application/shops/${shop_id}/listings/${listing_id}/images/${listing_image_id}`;
  await etsyHttp.delete(url, {
    headers: {
      'x-api-key': `${client_id}:${client_secret}`,
      'Authorization': `Bearer ${access_token}`
    }
  });
}

export async function updateListingInventory(listing_id, inventoryData) {
  const { access_token, client_id, client_secret } = await getValidToken();
  const url = `https://openapi.etsy.com/v3/application/listings/${listing_id}/inventory`;

  const res = await etsyHttp.put(url, inventoryData, {
    headers: {
      'x-api-key': `${client_id}:${client_secret}`,
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/json'
    }
  });
  return res.data;
}

export async function updateListingProperty(listing_id, property_id, propertyData) {
  const { access_token, client_id, client_secret, shop_id } = await getValidToken();
  const url = `https://openapi.etsy.com/v3/application/shops/${shop_id}/listings/${listing_id}/properties/${property_id}`;

  const res = await etsyHttp.put(url, propertyData, {
    headers: {
      'x-api-key': `${client_id}:${client_secret}`,
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/json'
    }
  });
  return res.data;
}

export async function getReadinessStates(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = getCachedData('readinessStates');
    if (cached) return cached;
  }
  const { access_token, client_id, client_secret, shop_id } = await getValidToken();
  const url = `https://openapi.etsy.com/v3/application/shops/${shop_id}/readiness-state-definitions`;
  const res = await etsyHttp.get(url, {
    headers: {
      'x-api-key': `${client_id}:${client_secret}`,
      'Authorization': `Bearer ${access_token}`
    }
  });
  setCachedData('readinessStates', res.data.results);
  return res.data.results;
}

export async function uploadListingFile(listing_id, filePath, name = '') {
  const { access_token, client_id, client_secret, shop_id } = await getValidToken();
  const url = `https://openapi.etsy.com/v3/application/shops/${shop_id}/listings/${listing_id}/files`;
  
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = name || basename(filePath) || 'file.zip';
  
  const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });
  const formData = new FormData();
  formData.append('file', blob, fileName);
  formData.append('name', fileName);
  
  const res = await etsyHttp.post(url, formData, {
    headers: {
      'x-api-key': `${client_id}:${client_secret}`,
      'Authorization': `Bearer ${access_token}`
    }
  });
  return res.data;
}

export async function createShopSection(title) {
  const { access_token, client_id, client_secret, shop_id } = await getValidToken();
  const url = `https://openapi.etsy.com/v3/application/shops/${shop_id}/sections`;
  
  const params = new URLSearchParams();
  params.append('title', title);
  
  const res = await etsyHttp.post(url, params, {
    headers: {
      'x-api-key': `${client_id}:${client_secret}`,
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  
  // Clear sections cache
  cache.sections = null;
  cache.timestamps.sections = 0;
  
  return res.data;
}

/**
 * Listing'i günceller.
 *
 * Değer olarak `null` verilen alanlar Etsy'ye BOŞ olarak gönderilir, yani
 * alan temizlenir (item_width, item_height gibi nullable alanlar için).
 * Alanı hiç değiştirmemek için değeri `undefined` bırakın ya da göndermeyin.
 */
export async function updateListing(listing_id, listingData) {
  const { access_token, client_id, client_secret, shop_id } = await getValidToken();
  const url = `https://openapi.etsy.com/v3/application/shops/${shop_id}/listings/${listing_id}`;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(listingData)) {
    if (value === undefined) continue;

    // null -> alanı temizle (boş değer gönder)
    if (value === null) {
      params.append(key, '');
      continue;
    }

    if (key === 'tags' || key === 'materials') {
      params.append(key, joinCsvField(value));
    } else if (Array.isArray(value)) {
      value.forEach(v => params.append(key, v));
    } else {
      params.append(key, value.toString());
    }
  }

  const res = await etsyHttp.patch(url, params, {
    headers: {
      'x-api-key': `${client_id}:${client_secret}`,
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  return res.data;
}
