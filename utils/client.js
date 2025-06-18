/**
 * @file Manages the WhatsApp client initialization and authentication.
 */
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

/**
 * Initializes and configures the WhatsApp client.
 * @returns {Client} The configured WhatsApp client instance.
 */
function initializeClient() {
  console.log("Initializing WhatsApp client...");
  const client = new Client({
    authStrategy: new LocalAuth(),
    webVersionCache: {
      type: "remote",
      remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html`,
    },
    puppeteer: {
      headless: true, // Run in the background
      executablePath: "/usr/bin/google-chrome",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-extensions",
      ],
    },
  });

  // Event listener for QR code generation
  client.on("qr", (qr) => {
    console.log("A new QR code is needed. Please scan:");
    qrcode.generate(qr, { small: true });
  });

  // Event listener for authentication failure
  client.on("auth_failure", (msg) => {
    console.error("AUTHENTICATION FAILURE:", msg);
  });

  return client;
}

module.exports = { initializeClient };
