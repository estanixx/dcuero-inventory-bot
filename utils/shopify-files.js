const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const { 
    SHOPIFY_STORE_URL, 
    SHOPIFY_ADMIN_API_TOKEN,
} = process.env;

const GRAPHQL_ENDPOINT = `https://${SHOPIFY_STORE_URL}/admin/api/2024-04/graphql.json`;
const headers = {
    'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
    'Content-Type': 'application/json'
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * NEW: A robust, reusable function for making GraphQL requests with retries.
 * @param {string} query - The GraphQL query string.
 * @param {object} variables - The variables for the query.
 * @param {number} retries - The number of times to retry on failure.
 * @returns {object} The 'data' portion of the GraphQL response.
 */
async function makeGraphQLRequest(query, variables, retries = 5) { // Increased retries to 5
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios.post(GRAPHQL_ENDPOINT, { query, variables }, { headers });
            
            // --- NEW DEFENSIVE CHECK ---
            // Check if the response or its data is empty/malformed before using it.
            if (!response || !response.data) {
                throw new Error("Received an invalid or empty response from Shopify API.");
            }

            if (response.data.errors) {
                // This is a permanent error from Shopify (e.g., bad query), so don't retry.
                throw new Error(`GraphQL Error: ${JSON.stringify(response.data.errors)}`);
            }

            if (!response.data.data) {
                // The API returned a success code, but no data payload. Treat as a temporary failure.
                throw new Error("API response is missing the 'data' payload.");
            }

            return response.data.data; // Success!

        } catch (error) {
            // This is a transient error (e.g., network issue or rate limit)
            if (i === retries - 1) { // This was the last attempt
                console.error("  ❌ API request failed after all retries.", error.message);
                throw error; // Give up
            }
            
            const delay = Math.pow(2, i) * 1500; // Exponential backoff: 1.5s, 3s, 6s...
            console.warn(`  ⚠️ API request failed. Retrying in ${delay / 1000}s... (Attempt ${i + 1}/${retries-1})`);
            await sleep(delay);
        }
    }
}


// --- GraphQL Queries and Mutations ---
const CHECK_PRODUCT_IMAGE_QUERY = `query productBySKU($query: String!) { products(first: 1, query: $query) { edges { node { id images(first: 1) { edges { node { id } } } } } } }`;
const STAGED_UPLOADS_CREATE_MUTATION = `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url, resourceUrl, parameters { name, value } } userErrors { field, message } } }`;
const FILE_CREATE_MUTATION = `mutation fileCreate($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id ... on MediaImage { image { url } } } userErrors { field, message } } }`;
const CHECK_FILE_STATUS_QUERY = `query fileStatus($id: ID!) { node(id: $id) { ... on MediaImage { status, image { url } } } }`;

/**
 * Checks if a product with a given reference exists and has an image.
 */
async function checkIfImageExistsForReference(reference) {
    try {
        const data = await makeGraphQLRequest(CHECK_PRODUCT_IMAGE_QUERY, { query: `sku:${reference}` });
        const products = data.products.edges;
        return products.length > 0 && products[0].node.images.edges.length > 0;
    } catch (error) {
        return false;
    }
}

/**
 * Uploads a file to Shopify using the staged upload workflow with polling and retries.
 */
async function uploadFileToShopify(media, filename) {
    try {
        // STEP 1: Get Staged Upload Target
        console.log(`[Upload] 1/5: Preparing upload for ${filename}...`);
        const fileBuffer = Buffer.from(media.data, 'base64');
        const stagedUploadsData = await makeGraphQLRequest(STAGED_UPLOADS_CREATE_MUTATION, {
            input: {
                resource: 'FILE',
                filename,
                mimeType: media.mimetype,
                fileSize: fileBuffer.length.toString(),
                httpMethod: 'POST',
            },
        });
        
        const stagedUploadsResult = stagedUploadsData.stagedUploadsCreate;
        if (stagedUploadsResult.userErrors.length > 0) throw new Error(`Shopify Staged Upload Error: ${JSON.stringify(stagedUploadsResult.userErrors)}`);
        if (!stagedUploadsResult.stagedTargets || stagedUploadsResult.stagedTargets.length === 0) throw new Error("Shopify did not return a valid upload target.");
        
        const { url, resourceUrl, parameters } = stagedUploadsResult.stagedTargets[0];

        // STEP 2: Upload File to Temporary URL
        console.log(`[Upload] 2/5: Uploading file to temporary storage...`);
        const formData = new FormData();
        parameters.forEach(({ name, value }) => formData.append(name, value));
        formData.append('file', fileBuffer, { filename, contentType: media.mimetype });
        await axios.post(url, formData, { headers: formData.getHeaders() });

        // STEP 3: Create File Record in Shopify
        console.log(`[Upload] 3/5: Finalizing file record in Shopify...`);
        const fileCreateData = await makeGraphQLRequest(FILE_CREATE_MUTATION, {
            files: { alt: filename, contentType: 'IMAGE', originalSource: resourceUrl },
        });
        
        const fileId = fileCreateData.fileCreate.files[0].id;
        if (!fileId) throw new Error("Could not get new file ID from Shopify.");

        // STEP 4: Poll for File Processing Status
        console.log(`[Upload] 4/5: Waiting for Shopify to process the image (ID: ${fileId})...`);
        for (let i = 0; i < 10; i++) {
            await sleep(3000);
            console.log(`       ...checking status (attempt ${i + 1})`);
            const statusData = await makeGraphQLRequest(CHECK_FILE_STATUS_QUERY, { id: fileId });
            
            const node = statusData.node;
            if (node && node.status === 'READY' && node.image && node.image.url) {
                const finalUrl = node.image.url;
                console.log(`[Upload] 5/5: ✅ Success! Image is ready. URL: ${finalUrl}`);
                return finalUrl;
            }
            if (node && node.status === 'FAILED') throw new Error("Shopify reported that file processing failed.");
        }
        
        throw new Error("File was uploaded but timed out waiting for Shopify to process it.");

    } catch (error) {
        console.error(`❌ Top-level error during upload for ${filename}:`, error.message);
        return null;
    }
}

module.exports = { uploadFileToShopify, checkIfImageExistsForReference };