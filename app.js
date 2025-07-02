/**
 * @file Main application file for the WhatsApp Bot.
 */

require('dotenv').config({ path: './.env' }); // Load environment variables from .env.local

const { initializeClient } = require('./utils/client');
const { handleMessage, startHostWaitLoop } = require('./utils/messageHandler');

// --- Environment Variable Validation ---
const { GROUP_ID, HOST_ID, ID_C1, ID_C2, ID_M3 } = process.env;
if (!GROUP_ID || !HOST_ID || !ID_C1 || !ID_C2 || !ID_M3) {
    console.error("FATAL: One or more required IDs are not defined in the .env file.");
    process.exit(1);
}

const client = initializeClient();

async function startBot() {
    client.on('ready', async () => {
        console.log('✅ Client is ready! Bot is ON.');
        try {
            // Start the main loop on connection
            await client.sendMessage(GROUP_ID, "🤖 Bot escuchando.");
            await startHostWaitLoop(client);
        } catch (error) {
            console.error('An error occurred during startup:', error);
        }
    });

    // All logic is now handled by the unified handleMessage function
    client.on('message_create', (message) => {
        handleMessage(message, client);
    });

    await client.initialize();
}

async function shutdown(event) {
    console.log(`\n🚨 ${event} detected. Shutting down...`);
    try {
        if (client) {
            await client.sendMessage(GROUP_ID, "🤖 Bot apagándose.");
            console.log("Shutdown message sent.");
            await client.destroy();
            console.log("Client destroyed.");
        }
    } catch (error) {
        console.error("Error during shutdown:", error);
    } finally {
        process.exit(0);
    }
}

process.on('SIGINT', () => shutdown('Ctrl+C'));
process.on('SIGTERM', () => shutdown('Termination'));

startBot().catch(error => {
    console.error("An unexpected error occurred at the top level:", error);
    shutdown("Error");
});