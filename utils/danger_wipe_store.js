require('dotenv').config();
const axios = require('axios');
const readline = require('readline'); // Built-in Node.js module for user input

const { 
    SHOPIFY_STORE_URL, 
    SHOPIFY_ADMIN_API_TOKEN,
} = process.env;

const GRAPHQL_ENDPOINT = `https://${SHOPIFY_STORE_URL}/admin/api/2024-04/graphql.json`;
const headers = {
    'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
    'Content-Type': 'application/json'
};

// --- GraphQL Queries and Mutations ---

const GET_PRODUCT_IDS_QUERY = `
    query getProductIds($first: Int!, $after: String) {
        products(first: $first, after: $after) {
            pageInfo { hasNextPage, endCursor }
            edges { node { id } }
        }
    }
`;

const PRODUCT_DELETE_MUTATION = `
    mutation productDelete($id: ID!) {
        productDelete(input: {id: $id}) {
            deletedProductId
            userErrors { field, message }
        }
    }
`;

const GET_FILE_IDS_QUERY = `
    query getFiles($first: Int!, $after: String) {
        files(first: $first, after: $after) {
            pageInfo { hasNextPage, endCursor }
            edges { node { id } }
        }
    }
`;

const FILE_DELETE_MUTATION = `
    mutation fileDelete($fileIds: [ID!]!) {
        fileDelete(fileIds: $fileIds) {
            deletedFileIds
            userErrors { field, message }
        }
    }
`;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

/**
 * Fetches all product IDs and deletes them one by one.
 */
async function deleteAllProducts() {
    console.log('\n--- Starting Product Deletion ---');
    let hasNextPage = true;
    let cursor = null;
    let totalProductsDeleted = 0;

    while (hasNextPage) {
        console.log('Fetching a batch of product IDs...');
        const response = await axios.post(GRAPHQL_ENDPOINT, {
            query: GET_PRODUCT_IDS_QUERY,
            variables: { first: 50, after: cursor }
        }, { headers });

        const productsData = response.data.data.products;
        if (!productsData.edges || productsData.edges.length === 0) {
            console.log('No more products to delete.');
            break;
        }

        for (const edge of productsData.edges) {
            const productId = edge.node.id;
            try {
                console.log(`  Deleting product ID: ${productId}`);
                await axios.post(GRAPHQL_ENDPOINT, {
                    query: PRODUCT_DELETE_MUTATION,
                    variables: { id: productId }
                }, { headers });
                totalProductsDeleted++;
            } catch (e) {
                console.error(`  Failed to delete product ID: ${productId}`, e.message);
            }
        }

        hasNextPage = productsData.pageInfo.hasNextPage;
        cursor = productsData.pageInfo.endCursor;
    }
    console.log(`✅ Product Deletion Complete. Total deleted: ${totalProductsDeleted}`);
}

/**
 * Fetches all file IDs and deletes them in batches.
 */
async function deleteAllFiles() {
    console.log('\n--- Starting File Deletion ---');
    let hasNextPage = true;
    let cursor = null;
    let totalFilesDeleted = 0;

    while (hasNextPage) {
        console.log('Fetching a batch of file IDs...');
        const response = await axios.post(GRAPHQL_ENDPOINT, {
            query: GET_FILE_IDS_QUERY,
            variables: { first: 100, after: cursor }
        }, { headers });

        const filesData = response.data.data.files;
        if (!filesData.edges || filesData.edges.length === 0) {
            console.log('No more files to delete.');
            break;
        }

        const fileIdsToDelete = filesData.edges.map(edge => edge.node.id);

        if (fileIdsToDelete.length > 0) {
            try {
                console.log(`  Deleting batch of ${fileIdsToDelete.length} files...`);
                const deleteResponse = await axios.post(GRAPHQL_ENDPOINT, {
                    query: FILE_DELETE_MUTATION,
                    variables: { fileIds: fileIdsToDelete }
                }, { headers });

                const deletedCount = deleteResponse.data.data.fileDelete.deletedFileIds?.length || 0;
                totalFilesDeleted += deletedCount;
                console.log(`  Successfully deleted ${deletedCount} files.`);
            } catch (e) {
                console.error(`  Failed to delete a batch of files:`, e.message);
            }
        }

        hasNextPage = filesData.pageInfo.hasNextPage;
        cursor = filesData.pageInfo.endCursor;
    }
    console.log(`✅ File Deletion Complete. Total deleted: ${totalFilesDeleted}`);
}


/**
 * Main function with confirmation prompt.
 */
async function runWipe() {
    console.log('================================================================');
    console.log('⚠️ DANGER: This script will permanently delete ALL products and ALL files from your Shopify store.');
    console.log('This action is IRREVERSIBLE.');
    console.log('Please ensure you have a complete backup of your store data.');
    console.log('================================================================');
    
    rl.question('To confirm, please type "permanently delete" and press Enter: ', async (answer) => {
        if (answer === 'permanently delete') {
            console.log('\nConfirmation received. Starting the wipe process in 3 seconds...');
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            try {
                await deleteAllProducts();
                await deleteAllFiles();
                console.log('\n\n--- ✅ STORE WIPE COMPLETE ---');
            } catch (error) {
                console.error('\n❌ A fatal error occurred during the wipe process:', error.message);
            }
        } else {
            console.log('\nConfirmation failed. Aborting script. No changes were made.');
        }
        rl.close();
    });
}

runWipe();