/**
 * @file logger.js
 * A simple JSON logger to persist workflow sessions for fallback and debugging.
 */

const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, '../workflow_log.json');

// This holds the log data for the currently active product workflow.
let currentLogSession = null;

/**
 * Reads the entire log file from disk.
 * @returns {Array} An array of past log sessions.
 */
function readLogs() {
    try {
        if (fs.existsSync(logFilePath)) {
            const data = fs.readFileSync(logFilePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error("Error reading log file:", error);
    }
    return []; // Return empty array if file doesn't exist or is corrupt
}

/**
 * Writes the entire log array back to the JSON file.
 * @param {Array} logs The array of log sessions to save.
 */
function writeLogs(logs) {
    try {
        fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2), 'utf8');
    } catch (error) {
        console.error("Error writing to log file:", error);
    }
}

/**
 * Starts a new logging session for a new product workflow.
 * @param {object} initialData - The parsed data from the host's initial message.
 */
function startNewLog(initialData) {
    currentLogSession = {
        sessionId: `product_${Date.now()}`,
        startTime: new Date().toISOString(),
        endTime: null,
        hostMessage: initialData,
        chatHistory: [], // Will store all messages related to this session
        finalResponses: {},
        submit_success: false // Default to false
    };
    console.log(`[Logger] Started new log session: ${currentLogSession.sessionId}`);
}

/**
 * Appends a message to the current session's chat history.
 * @param {Message} message - The message object from whatsapp-web.js.
 * @param {string} authorName - The friendly name of the author (e.g., "Copacabana 1").
 */
function logMessage(message, authorName = 'Unknown') {
    if (currentLogSession) {
        currentLogSession.chatHistory.push({
            authorId: message.author || message.from,
            authorName: authorName,
            timestamp: new Date().toISOString(),
            body: message.body
        });
    }
}

/**
 * Finalizes and saves the current logging session to the file.
 * @param {boolean} successStatus - The result of the Shopify submission.
 * @param {object} finalResponses - The collected responses from the branches.
 */
function endLog(successStatus, finalResponses = {}) {
    if (currentLogSession) {
        currentLogSession.endTime = new Date().toISOString();
        currentLogSession.submit_success = successStatus;
        currentLogSession.finalResponses = finalResponses;

        const allLogs = readLogs();
        allLogs.push(currentLogSession);
        writeLogs(allLogs);
        
        console.log(`[Logger] Ended log session: ${currentLogSession.sessionId} with success: ${successStatus}`);
        currentLogSession = null; // Clear the session after saving
    }
}

module.exports = {
    startNewLog,
    logMessage,
    endLog
};