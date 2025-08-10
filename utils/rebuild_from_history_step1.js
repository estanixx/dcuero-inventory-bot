require('dotenv').config();
const fs = require('fs');
const { initializeClient } = require('./client');
const { uploadFileToShopify } = require('./shopify-files');

const { GROUP_ID, HOST_ID, ID_C1, ID_C2, ID_M3 } = process.env;
const TARGET_USERS = [ID_C1, ID_C2, ID_M3];
const CSV_OUTPUT_PATH = './full_product_rebuild_final.csv';

const BATCH_SIZE = 500;
const MAX_MESSAGES_TO_SCAN = 500_000;

function parseHostMessage(body) {
    const regex = /^(.*)#(\S+)\s*-\s*([0-9.,$]+)$/;
    const match = body.match(regex);
    if (!match) return null;
    const name = match[1].trim();
    const reference = match[2].trim();
    const price = parseInt(match[3].trim().replace(/[.,$]/g, ""), 10);
    if (!name || !reference || isNaN(price)) return null;
    return { name, reference, price };
}

async function runFullRebuild() {
    console.log('Initializing WhatsApp client...');
    const client = initializeClient();

    client.on('qr', qr => console.log('QR CODE RECEIVED. Please scan with your phone.'));

    client.on('ready', async () => {
        console.log('✅ Client is ready. Starting definitive rebuild with confirmation logic...');
        
        try {
            const chat = await client.getChatById(GROUP_ID);
            
            let allMessages = [];
            let lastMessageId = null;
            let keepFetching = true;
            console.warn('--- ⚠️  FETCHING ALL MESSAGES. THIS WILL BE SLOW. ---');
            while (keepFetching && allMessages.length < MAX_MESSAGES_TO_SCAN) {
                const messages = await chat.fetchMessages({ limit: BATCH_SIZE, before: lastMessageId });
                if (messages.length === 0) {
                    keepFetching = false;
                } else {
                    allMessages.push(...messages);
                    lastMessageId = messages[messages.length - 1].id._serialized;
                    console.log(`...fetched ${allMessages.length} messages so far...`);
                }
            }
            
            allMessages.reverse();
            console.log(`\n✅ Total messages fetched: ${allMessages.length}. Analyzing chronological history...`);

            // --- Definitive State Machine Logic ---
            let completedWorkflows = [];
            let pendingStock = {};
            let pendingProduct = null; // Will hold a product post that is awaiting confirmation

            for (const msg of allMessages) {
                const author = msg.author || msg.from;
                const body = msg.body.trim();

                // Check for a product post from the host
                const parsedData = parseHostMessage(body);
                if (author === HOST_ID && msg.hasMedia && msg.type === 'image' && parsedData) {
                    if (pendingProduct) {
                        console.log(`  -> Discarding unconfirmed product #${pendingProduct.reference} because a new one was started.`);
                    }
                    pendingProduct = {
                        ...parsedData,
                        message: msg,
                        stocks: { ...pendingStock } // Pair with stock collected BEFORE the post
                    };
                    pendingStock = {}; // Reset stock buffer for the next cycle
                    continue;
                }

                // Check for the FINAL confirmation message
                if (body.startsWith('✅ ¡Todo confirmado!')) {
                    if (pendingProduct) {
                        console.log(`  -> Confirmation found for product #${pendingProduct.reference}. Workflow is valid.`);
                        completedWorkflows.push(pendingProduct);
                        pendingProduct = null; // Reset pending product
                    }
                    continue;
                }
                
                // Check for a cancellation from the host
                if (author === HOST_ID && body === '✖️') {
                    if (pendingProduct) {
                        console.log(`  -> Discarding unconfirmed product #${pendingProduct.reference} due to cancellation.`);
                        pendingProduct = null;
                    }
                    pendingStock = {}; // Always clear pending stock on cancellation
                    continue;
                }

                // If no product is pending confirmation, collect stock messages
                if (!pendingProduct && TARGET_USERS.includes(author)) {
                    if (author === ID_C1) pendingStock.C1 = body;
                    if (author === ID_C2) pendingStock.C2 = body;
                    if (author === ID_M3) pendingStock.M3 = body;
                }
            }
            console.log(`Analysis complete. Found ${completedWorkflows.length} fully confirmed products to process.`);

            // --- Process Valid Workflows: Handle Duplicates, Upload Images, and Prepare CSV Data ---
            console.log('\n--- Starting Shopify uploads and CSV generation ---');
            const referenceCounter = {};
            const csvRows = [];

            for (let i = 0; i < completedWorkflows.length; i++) {
                const wf = completedWorkflows[i];
                console.log(`\n[Processing Product ${i + 1}/${completedWorkflows.length}]: #${wf.reference}`);
                
                const originalRef = wf.reference;
                referenceCounter[originalRef] = (referenceCounter[originalRef] || 0) + 1;
                let finalRef = originalRef;
                if (referenceCounter[originalRef] > 1) {
                    finalRef = `${originalRef}v${referenceCounter[originalRef]}`;
                    console.log(`  -> Duplicate found. Versioning reference to: ${finalRef}`);
                }

                let imageUrl = "UPLOAD_FAILED";
                try {
                    const media = await wf.message.downloadMedia();
                    const filename = `${finalRef}.jpg`;
                    const uploadedUrl = await uploadFileToShopify(media, filename);
                    if (uploadedUrl) {
                        imageUrl = uploadedUrl;
                        console.log(`  -> Image upload successful.`);
                    }
                } catch (e) {
                    console.error(`  -> Image upload failed: ${e.message}`);
                }

                csvRows.push({
                    REF: finalRef,
                    NAME: wf.name,
                    PRICE: wf.price,
                    C1: wf.stocks.C1 || "N/A",
                    C2: wf.stocks.C2 || "N/A",
                    M3: wf.stocks.M3 || "N/A",
                    IMG: imageUrl
                });
            }

            console.log('\n--- Writing final CSV file ---');
            const csvHeader = "REF,NAME,PRICE,C1,C2,M3,IMG\n";
            const csvBody = csvRows.map(row => 
                `"${row.REF}","${row.NAME.replace(/"/g, '""')}",${row.PRICE},"${row.C1}","${row.C2}","${row.M3}","${row.IMG}"`
            ).join('\n');
            
            fs.writeFileSync(CSV_OUTPUT_PATH, csvHeader + csvBody);
            console.log(`✅ Success! Data saved to ${CSV_OUTPUT_PATH}`);

        } catch (error) {
            console.error('A major error occurred during the rebuild process:', error);
        } finally {
            console.log('Shutting down client...');
            await client.destroy();
            process.exit(0);
        }
    });

    await client.initialize();
}

runFullRebuild().catch(error => console.error("A fatal error occurred at the top level:", error));