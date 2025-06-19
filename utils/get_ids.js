const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

console.log("Starting ID retriever...");

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

client.on('qr', (qr) => {
    console.log('Scan this QR code with your phone:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('Client is ready!\n');
    try {
        const chats = await client.getChats();
        const groups = chats.filter(chat => chat.isGroup);

        if (groups.length === 0) {
            console.log("You are not in any groups.");
            return;
        }

        console.log("-------------------- GROUPS --------------------");
        for (const group of groups) {
            console.log(`\nGroup Name: ${group.name}`);
            console.log(`Group ID: ${group.id._serialized}`);
            console.log("--- Participants ---");
            for (const participant of group.participants) {
                const contact = await client.getContactById(participant.id._serialized);
                const name = contact.name || participant.id.user;
                console.log(`  Name: ${name}, ID: ${participant.id._serialized}`);
            }
            console.log("----------------------------------------");
        }
    } catch (error) {
        console.error('Failed to retrieve groups:', error);
    } finally {
        console.log("\nIDs have been listed. You can stop this script with Ctrl + C.");
    }
});

client.on('auth_failure', msg => {
    console.error('Authentication failure:', msg);
});

client.initialize();