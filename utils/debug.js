const { Poll } = require("whatsapp-web.js");
const { GROUP_ID, HOST_ID } = process.env;
/**
 * [DEBUG] Sends a very simple poll to test if the feature works at all.
 */
async function sendSizePoll_Debug(client) {
    console.log("Attempting to send a simplified debug poll...");
    try {
        const poll = new Poll(
            'Test Poll', // Simple title
            ['Option A', 'Option B'], // Simple options
            { allowMultipleAnswers: false }
        );
        await client.sendMessage(GROUP_ID, poll);
        console.log("Debug poll 'sent' successfully.");
    } catch (error) {
        console.error("Failed to send DEBUG poll:", error);
    }
}
module.exports = {
  sendSizePoll_Debug
}