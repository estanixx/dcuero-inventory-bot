require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { uploadFileToShopify } = require('../utils/shopify-files'); // We are testing this exact function

// --- Configuration ---
const TEST_IMAGE_PATH = path.join(__dirname, 'test_image.jpg');
const TEST_FILENAME = `test_${Date.now()}.jpg`;

/**
 * A simple function to run a single upload test.
 */
async function runUploadTest() {
    console.log('--- Starting Shopify Upload Test Script ---');

    // 1. Check if the test image exists
    if (!fs.existsSync(TEST_IMAGE_PATH)) {
        console.error(`\n❌ FATAL ERROR: Test image not found.`);
        console.error(`Please create a file named 'test_image.jpg' in this folder.`);
        return;
    }

    console.log(`Found test image at: ${TEST_IMAGE_PATH}`);

    // 2. Prepare the 'media' object, mimicking whatsapp-web.js
    const mediaObject = {
        mimetype: 'image/jpeg',
        data: fs.readFileSync(TEST_IMAGE_PATH, { encoding: 'base64' }),
    };

    // 3. Call the uploader function and log the result
    console.log(`\nAttempting to upload '${TEST_FILENAME}'...`);
    const finalUrl = await uploadFileToShopify(mediaObject, TEST_FILENAME);

    console.log('\n--- TEST COMPLETE ---');
    if (finalUrl) {
        console.log(`✅ SUCCESS! The file was uploaded.`);
        console.log(`   Final URL: ${finalUrl}`);
    } else {
        console.log(`❌ FAILED. The upload process did not return a URL.`);
        console.log(`   Please review the detailed error logs above.`);
    }
}

runUploadTest().catch(error => {
    console.error("\nA fatal, unhandled error occurred:", error);
});