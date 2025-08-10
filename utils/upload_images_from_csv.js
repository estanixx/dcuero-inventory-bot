require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const { initializeClient } = require('./client');
// We import the robust uploader we perfected earlier
const { uploadFileToShopify } = require('./shopify-files'); 

const INPUT_CSV_PATH = './product_data_to_process.csv';
const FINAL_CSV_PATH = './final_products_with_urls.csv';

/**
 * Main function to process the CSV and upload images.
 */
async function processCsvAndUpload() {
    console.log('Initializing WhatsApp client to fetch media...');
    const client = initializeClient();

    client.on('qr', qr => console.log('QR CODE RECEIVED. Please scan with your phone.'));

    client.on('ready', async () => {
        console.log('✅ Client is ready. Starting Step 2: Image-Only Upload Process...');
        
        const results = [];
        const rowsToProcess = [];

        // First, read the entire CSV into memory
        fs.createReadStream(INPUT_CSV_PATH)
            .pipe(csv())
            .on('data', (data) => rowsToProcess.push(data))
            .on('end', async () => {
                console.log(`Found ${rowsToProcess.length} products to process from CSV.`);

                for (let i = 0; i < rowsToProcess.length; i++) {
                    const row = rowsToProcess[i];
                    console.log(`\n[Processing ${i + 1}/${rowsToProcess.length}]: REF #${row.REF}`);
                    
                    let imageUrl = "UPLOAD_FAILED";
                    try {
                        // 1. Fetch the WhatsApp message by its ID
                        console.log(`  -> Fetching message ID: ${row.MSG_ID}`);
                        const message = await client.getMessageById(row.MSG_ID);
                        if (!message || !message.hasMedia) {
                            throw new Error("Message not found or has no media.");
                        }

                        // 2. Download the image media
                        const media = await message.downloadMedia();
                        const filename = `${row.REF}.jpg`;
                        
                        // 3. Upload JUST the image using our robust GraphQL uploader
                        const uploadedUrl = await uploadFileToShopify(media, filename);

                        if (uploadedUrl) {
                            imageUrl = uploadedUrl;
                        } else {
                            throw new Error("The uploadFileToShopify function returned null.");
                        }

                    } catch (error) {
                        console.error(`  -> ❌ FAILED to process #${row.REF}:`, error.message);
                    }
                    
                    // Add the final image URL to our results
                    row.IMG_URL = imageUrl;
                    results.push(row);
                }

                // --- Write the final CSV file ---
                console.log('\n--- Writing final CSV file with image URLs ---');
                const csvHeader = "REF,NAME,PRICE,C1,C2,M3,MSG_ID,IMG_URL\n";
                const csvBody = results.map(r => 
                    `"${r.REF}","${r.NAME.replace(/"/g, '""')}",${r.PRICE},"${r.C1}","${r.C2}","${r.M3}","${r.MSG_ID}","${r.IMG_URL}"`
                ).join('\n');
                
                fs.writeFileSync(FINAL_CSV_PATH, csvHeader + csvBody);
                console.log(`✅ Process complete! Final data saved to ${FINAL_CSV_PATH}`);

                await client.destroy();
                process.exit(0);
            });
    });

    await client.initialize();
}

processCsvAndUpload().catch(error => {
    console.error("A fatal error occurred at the top level:", error);
});