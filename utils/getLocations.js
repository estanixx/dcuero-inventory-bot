/**
 * @file getLocations.js
 * A utility script to fetch and list all locations and their IDs from a Shopify store.
 */

const axios = require('axios');
require('dotenv').config();

const { SHOPIFY_STORE_URL, SHOPIFY_ADMIN_API_TOKEN } = process.env;

async function fetchShopifyLocations() {
    if (!SHOPIFY_STORE_URL || !SHOPIFY_ADMIN_API_TOKEN) {
        console.error("❌ Shopify URL or Admin API Token is missing from .env file.");
        console.error("Please ensure SHOPIFY_STORE_URL and SHOPIFY_ADMIN_API_TOKEN are set correctly.");
        return;
    }

    const endpoint = `https://${SHOPIFY_STORE_URL}/admin/api/2023-10/locations.json`;
    const headers = {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
        'Content-Type': 'application/json'
    };

    console.log("Fetching locations from Shopify...");

    try {
        const response = await axios.get(endpoint, { headers });
        if (response.data.locations && response.data.locations.length > 0) {
            console.log("\n✅ Found the following locations in your Shopify store:\n");
            console.log("--------------------------------------------------");
            response.data.locations.forEach(location => {
                console.log(`📍 Location Name: ${location.name}`);
                console.log(`   Location ID:   ${location.id}`); // This is the ID you need
                console.log("--------------------------------------------------");
            });
            console.log("\nCopy these Location IDs into your .env file.");
        } else {
            console.log("No locations found in your store.");
        }
    } catch (error) {
        console.error("❌ Error fetching Shopify locations:", error.response ? error.response.data : error.message);
    }
}

fetchShopifyLocations();