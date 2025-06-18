/**
 * @file shopify.js
 * Handles all communication with the Shopify Admin API, including multi-location inventory.
 */

const axios = require('axios');
require('dotenv').config();

const { 
    SHOPIFY_STORE_URL, 
    SHOPIFY_ADMIN_API_TOKEN,
    SHOPIFY_LOCATION_ID_C1,
    SHOPIFY_LOCATION_ID_C2,
    SHOPIFY_LOCATION_ID_M3
} = process.env;

// Map WhatsApp User IDs to Shopify Location IDs
const LOCATION_ID_MAP = {
    [process.env.ID_C1]: SHOPIFY_LOCATION_ID_C1,
    [process.env.ID_C2]: SHOPIFY_LOCATION_ID_C2,
    [process.env.ID_M3]: SHOPIFY_LOCATION_ID_M3
};

/**
 * Uploads a new product to Shopify, then sets inventory levels for each variant at specific locations.
 * @param {object} productData - The complete product data object.
 * @returns {boolean} - True if the entire process was successful.
 */
async function uploadToShopify(productData) {
    if (!SHOPIFY_STORE_URL || !SHOPIFY_ADMIN_API_TOKEN || !Object.values(LOCATION_ID_MAP).every(id => id)) {
        console.error("Shopify credentials or Location IDs are missing from the .env file.");
        return false;
    }

    const productEndpoint = `https://${SHOPIFY_STORE_URL}/admin/api/2023-10/products.json`;
    const headers = {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
        'Content-Type': 'application/json'
    };

    // --- NEW LOGIC: Step 1 - Determine the unique set of variants to create ---
    // This prevents the "variant already exists" error.
    const uniqueSizes = [...new Set(productData.variants.map(v => v.size))];

    const shopifyPayload = {
        product: {
            title: productData.description,
            body_html: `Referencia: ${productData.reference}`,
            vendor: "Your Brand Name",
            product_type: productData.category,
            status: "active",
            
            // MODIFIED PAYLOAD: Create variants based on the *unique* sizes.
            variants: uniqueSizes.map(size => ({
                option1: size,
                price: productData.price,
                sku: `${productData.reference}-${size}`,
                inventory_management: "shopify"
            })),

            images: [{
                attachment: productData.media.data,
                filename: `${productData.reference}.jpg`
            }]
        }
    };
    
    try {
        // --- API STEP 1: Create the product with unique variants (all at 0 stock) ---
        console.log("Step 1: Creating product with unique variants...");
        const productResponse = await axios.post(productEndpoint, shopifyPayload, { headers });
        const createdVariants = productResponse.data.product.variants;
        console.log(`✅ Product created. ID: ${productResponse.data.product.id}`);

        // --- API STEP 2: Set inventory levels for each original submission ---
        console.log("Step 2: Setting inventory levels per location...");
        const inventorySetEndpoint = `https://${SHOPIFY_STORE_URL}/admin/api/2023-10/inventory_levels/set.json`;

        // We loop through the original, non-unique list to get the user-to-size mapping
        for (const localVariant of productData.variants) {
            // Find the master variant created in Shopify that corresponds to this size
            const shopifyVariant = createdVariants.find(v => v.option1 === localVariant.size);
            if (!shopifyVariant) continue;

            const inventoryItemId = shopifyVariant.inventory_item_id;
            const locationId = LOCATION_ID_MAP[localVariant.userId];

            if (!inventoryItemId || !locationId) continue;
            
            const inventoryPayload = {
                inventory_item_id: inventoryItemId,
                location_id: locationId,
                available: localVariant.stock
            };

            await axios.post(inventorySetEndpoint, inventoryPayload, { headers });
            console.log(`   - Set stock for size ${localVariant.size} at location ${locationId.split('/').pop()} to ${localVariant.stock}`);
        }
        
        console.log("✅ Inventory set successfully for all locations.");
        return true;

    } catch (error) {
        console.error("❌ Error during Shopify upload process:");
        if (error.response) {
            // Provide more structured error logging
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error Message:', error.message);
        }
        return false;
    }
}

module.exports = { uploadToShopify };