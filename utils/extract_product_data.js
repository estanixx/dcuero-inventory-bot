require('dotenv').config();
const fs = require('fs');
const { initializeClient } = require('./client');

const { GROUP_ID, HOST_ID, ID_C1, ID_C2, ID_M3 } = process.env;
const TARGET_USERS = [ID_C1, ID_C2, ID_M3];
const CSV_OUTPUT_PATH = './product_data_to_process.csv';

const BATCH_SIZE = 5000;
const MAX_MESSAGES_TO_SCAN = 100_000_000;

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

async function extractData() {
    console.log('Initializing WhatsApp client...');
    const client = initializeClient();

    client.on('qr', qr => console.log('QR CODE RECEIVED. Please scan with your phone.'));

    client.on('ready', async () => {
        console.log('✅ Client is ready. Starting Step 1: Memory-Efficient Data Extraction...');
        
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

            // --- NEW: Open a write stream to the CSV file ---
            const fileStream = fs.createWriteStream(CSV_OUTPUT_PATH);
            fileStream.write("REF,NAME,PRICE,C1,C2,M3,MSG_ID\n"); // Write header

            let pendingStock = {};
            let pendingProduct = null;
            const referenceCounter = {};
            let productsFound = 0;

            for (const msg of allMessages) {
                const author = msg.author || msg.from;
                const body = msg.body.trim();

                const parsedData = parseHostMessage(body);
                if (author === HOST_ID && msg.hasMedia && msg.type === 'image' && parsedData) {
                    if (pendingProduct) console.log(`  -> Discarding unconfirmed product #${pendingProduct.reference}`);
                    pendingProduct = {
                        ...parsedData,
                        msg_id: msg.id._serialized,
                        stocks: { ...pendingStock }
                    };
                    pendingStock = {};
                    continue;
                }

                if (body.startsWith('✅ ¡Todo confirmado!')) {
                    if (pendingProduct) {
                        productsFound++;
                        const originalRef = pendingProduct.reference;
                        referenceCounter[originalRef] = (referenceCounter[originalRef] || 0) + 1;
                        if (referenceCounter[originalRef] > 1) {
                            pendingProduct.reference = `${originalRef}v${referenceCounter[originalRef]}`;
                        }
                        
                        console.log(`  -> [${productsFound}] Confirmed Product: #${pendingProduct.reference}. Writing to CSV...`);
                        
                        // --- NEW: Write directly to the file instead of an array ---
                        const row = pendingProduct;
                        const csvLine = `"${row.reference}","${row.name.replace(/"/g, '""')}",${row.price},"${row.stocks.C1 || 'N/A'}","${row.stocks.C2 || 'N/A'}","${row.stocks.M3 || 'N/A'}","${row.msg_id}"\n`;
                        fileStream.write(csvLine);

                        pendingProduct = null;
                    }
                    continue;
                }
                
                if (author === HOST_ID && body === '✖️') {
                    if (pendingProduct) console.log(`  -> Discarding unconfirmed product #${pendingProduct.reference} due to cancellation.`);
                    pendingProduct = null;
                    pendingStock = {};
                    continue;
                }

                if (!pendingProduct && TARGET_USERS.includes(author)) {
                    if (author === ID_C1) pendingStock.C1 = body;
                    if (author === ID_C2) pendingStock.C2 = body;
                    if (author === ID_M3) pendingStock.M3 = body;
                }
            }

            fileStream.end(); // Close the file stream
            console.log(`\nAnalysis complete. Found and saved ${productsFound} fully confirmed products.`);
            console.log(`✅ Success! Data saved to ${CSV_OUTPUT_PATH}`);

        } catch (error) {
            console.error('A major error occurred during the data extraction process:', error);
        } finally {
            console.log('Shutting down client...');
            await client.destroy();
            process.exit(0);
        }
    });

    await client.initialize();
}

extractData().catch(error => console.error("A fatal error occurred at the top level:", error));