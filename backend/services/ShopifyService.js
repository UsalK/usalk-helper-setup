import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to convert local file to base64 string
function fileToBase64(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const data = fs.readFileSync(filePath);
  return data.toString('base64');
}

/**
 * Test Shopify connection credentials
 */
export async function testConnection(shopUrl, accessToken) {
  try {
    const cleanUrl = shopUrl.replace(/https?:\/\//, '').replace(/\/$/, '');
    const res = await fetch(`https://${cleanUrl}/admin/api/2025-01/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (res.status === 200) {
      const data = await res.json();
      return { success: true, shopName: data.shop.name };
    }
    return { success: false, status: res.status, statusText: res.statusText };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get all product collections (Custom and Smart)
 */
export async function getCollections(shopUrl, accessToken) {
  const cleanUrl = shopUrl.replace(/https?:\/\//, '').replace(/\/$/, '');
  const headers = {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json'
  };

  try {
    // 1. Fetch custom collections
    const customRes = await fetch(`https://${cleanUrl}/admin/api/2025-01/custom_collections.json?limit=250`, { headers });
    const customData = customRes.ok ? await customRes.json() : { custom_collections: [] };

    // 2. Fetch smart collections
    const smartRes = await fetch(`https://${cleanUrl}/admin/api/2025-01/smart_collections.json?limit=250`, { headers });
    const smartData = smartRes.ok ? await smartRes.json() : { smart_collections: [] };

    const collections = [
      ...(customData.custom_collections || []),
      ...(smartData.smart_collections || [])
    ];

    return collections.map(c => ({
      id: c.id.toString(),
      title: c.title
    }));
  } catch (err) {
    console.error("Error fetching Shopify collections:", err);
    throw err;
  }
}

/**
 * Create a product in Shopify with variants and base64 images
 */
export async function createProduct(shopUrl, accessToken, productData) {
  const cleanUrl = shopUrl.replace(/https?:\/\//, '').replace(/\/$/, '');
  const headers = {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json'
  };

  const {
    title,
    description,
    vendor,
    productType,
    tags,
    combinations, // Variation combination details [{size, frame, price, compareAtPrice}]
    imagePaths, // Array of local paths to upload as base64
    collectionId, // Optional collection ID to associate product with
    inventoryQty = 100 // Default stock
  } = productData;

  // 1. Prepare base64 images
  const images = imagePaths
    .map((path, idx) => {
      const base64 = fileToBase64(path);
      if (!base64) return null;
      return {
        attachment: base64,
        filename: `image-${idx}-${Date.now()}.${path.split('.').pop()}`
      };
    })
    .filter(Boolean);

  // 2. Build options (Size and Frame)
  const options = [
    { name: "Size" },
    { name: "Frame" }
  ];

  // 3. Build variants
  const variants = combinations.map((c, idx) => {
    return {
      option1: c.size,
      option2: c.frame,
      price: c.price.toString(),
      compare_at_price: c.compareAtPrice ? c.compareAtPrice.toString() : null,
      inventory_management: "shopify",
      inventory_policy: "deny",
      sku: `ART-${Date.now().toString().slice(-6)}-${idx}`,
      fulfillment_service: "manual"
    };
  });

  // 4. Create product payload
  const payload = {
    product: {
      title,
      body_html: description,
      vendor: vendor || "Usalk Art House",
      product_type: productType || "Canvas Print",
      tags: Array.isArray(tags) ? tags.join(', ') : (tags || ''),
      options,
      variants,
      images
    }
  };

  try {
    // 5. Send POST to create product
    const res = await fetch(`https://${cleanUrl}/admin/api/2025-01/products.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Shopify Product Create Failed: ${res.status} ${res.statusText} - ${errText}`);
    }

    const resData = await res.json();
    const createdProduct = resData.product;

    // 6. Set inventory level for each variant if requested
    // Retrieve first inventory_item_id of each variant
    for (const variant of createdProduct.variants) {
      if (variant.inventory_item_id) {
        try {
          // Fetch location ID first (usually the primary shipping origin location is needed)
          const locationRes = await fetch(`https://${cleanUrl}/admin/api/2025-01/locations.json`, { headers });
          const locationData = locationRes.ok ? await locationRes.json() : { locations: [] };
          const primaryLocation = locationData.locations[0];

          if (primaryLocation) {
            await fetch(`https://${cleanUrl}/admin/api/2025-01/inventory_levels/set.json`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                location_id: primaryLocation.id,
                inventory_item_id: variant.inventory_item_id,
                available: inventoryQty
              })
            });
          }
        } catch (invErr) {
          console.warn("Failed to set inventory for variant:", variant.id, invErr.message);
        }
      }
    }

    // 7. Associate with collection if specified
    if (collectionId) {
      try {
        await fetch(`https://${cleanUrl}/admin/api/2025-01/collects.json`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            collect: {
              product_id: createdProduct.id,
              collection_id: parseInt(collectionId)
            }
          })
        });
        console.log(`Product ${createdProduct.id} associated with collection ${collectionId}`);
      } catch (collErr) {
        console.error("Failed to associate collection with product:", collErr.message);
      }
    }

    return createdProduct;
  } catch (err) {
    console.error("Error creating Shopify product:", err);
    throw err;
  }
}

/**
 * Create a new custom collection in Shopify
 */
export async function createCollection(shopUrl, accessToken, title) {
  const cleanUrl = shopUrl.replace(/https?:\/\//, '').replace(/\/$/, '');
  try {
    const res = await fetch(`https://${cleanUrl}/admin/api/2025-01/custom_collections.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        custom_collection: {
          title: title
        }
      })
    });

    if (res.ok) {
      const data = await res.json();
      return { success: true, collection: data.custom_collection };
    }
    const errData = await res.json().catch(() => ({}));
    return { success: false, error: errData.errors || res.statusText };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
