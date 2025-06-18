/**
 * @file Handles all logic for the Shopify product bot using text commands.
 */

// --- IMPORTS ---
require('dotenv').config();
const { GROUP_ID, HOST_ID, ID_C1, ID_C2, ID_M3 } = process.env;
const logger = require('./logger'); // Import our new logger
const { uploadToShopify } = require('./shopify');

// ... (BRANCH_NAMES, TARGET_USERS, CATEGORY_DATA, and helper functions remain the same) ...
const BRANCH_NAMES = { [ID_C1]:"Copacabana 1", [ID_C2]:"Copacabana 2", [ID_M3]:"Medellín 1"};
const TARGET_USERS = [ID_C1, ID_C2, ID_M3];
const CATEGORY_DATA = { numeric: ['zapato', 'botin', 'bolichero', 'mocasin', 'teni', 'sandalia', 'sueco', 'baleta', 'forche'], alpha: ['chaqueta', 'gorra', 'boina', 'guantes'], unique: ['correa', 'bolso', 'bolsas', 'morrales', 'manoslibres', 'pecheras', 'monederas', 'billeteras', 'aretes', 'portadocumentos', 'llaveros', 'riñoneras', 'portacelulares', 'cuidado']};
function parseHostMessage(body) { const regex = /^(.*)#(\S+)\s*-\s*([0-9.,$]+)$/; const match = body.match(regex); if (!match) return null; const description = match[1].trim(); const reference = match[2].trim(); const priceStr = match[3].trim(); const price = parseInt(priceStr.replace(/[.,$]/g, '')); if (isNaN(price)) return null; return { description: description.charAt(0).toUpperCase() + description.slice(1), reference, price }; }
function autoDetectCategory(description) { const lowerCaseDesc = description.toLowerCase(); for (const keyword of CATEGORY_DATA.numeric) { if (lowerCaseDesc.includes(keyword)) return keyword; } for (const keyword of CATEGORY_DATA.alpha) { if (lowerCaseDesc.includes(keyword)) return keyword; } for (const keyword of CATEGORY_DATA.unique) { if (lowerCaseDesc.includes(keyword)) return keyword; } return 'accesorio'; }
function getValidVariantsForCategory(category) { if (CATEGORY_DATA.numeric.includes(category)) { return Array.from({ length: 16 }, (_, i) => String(33 + i)); } if (CATEGORY_DATA.alpha.includes(category)) { return ['XS', 'S', 'M', 'L', 'XL', 'XXL']; } return ['U']; }
function generateSummaryMessage() { if (!activeProductWorkflow) return ""; let summary = `*Resumen de Producto:*\n- Descripción: ${activeProductWorkflow.description}\n- Referencia: #${activeProductWorkflow.reference}\n- Precio: $${activeProductWorkflow.price.toLocaleString('es-CO')}\n- Categoría (detectada): ${activeProductWorkflow.category}\n\n*Variantes por Sede:*\n`; for (const userId of TARGET_USERS) { const branchName = BRANCH_NAMES[userId]; const variants = activeProductWorkflow.responses[userId].join(', ') || '(esperando respuesta)'; summary += `- ${branchName}: ${variants}\n`; } summary += "\nSi todo es correcto, por favor envíen 👍🏻 para confirmar."; return summary; }

let activeProductWorkflow = null;

// --- MODIFIED CORE WORKFLOW FUNCTIONS ---

async function resetWorkflow(client, reason) {
    if (activeProductWorkflow) {
        console.log(`Workflow reset. Reason: ${reason}`);
        // Log the cancelled session before resetting
        logger.endLog(false, activeProductWorkflow.responses);
        activeProductWorkflow = null;
        await client.sendMessage(GROUP_ID, `🔄 Proceso cancelado. ${reason}`);
    }
    await startHostWaitLoop(client);
}

async function startHostWaitLoop(client) {
    activeProductWorkflow = null;
    const message = `🤖 Esperando al anfitrión (@${HOST_ID.split('@')[0]}) para iniciar.

*Instrucciones:*
Envía un mensaje que contenga:
1.  La *imagen* del producto.
2.  El texto en el formato: \`DESCRIPCIÓN #REFERENCIA - PRECIO\`

*Ejemplo:*
\`Botines de cuero para dama #B-78-N - 150000\`

_El bot detectará la categoría automáticamente desde la descripción._
_El anfitrión puede cancelar el proceso en cualquier momento enviando ✖️_`;
    try {
        const hostContact = await client.getContactById(HOST_ID);
        await client.sendMessage(GROUP_ID, message, { mentions: [hostContact] });
    } catch (error) {
        console.error("Failed to send wait message:", error);
    }
}

async function validateAndFinalize(client) {
    console.log("Validating and finalizing...");
    const { description, reference, price, media, category, responses } = activeProductWorkflow;

    const shopifyVariants = [];
    for (const userId of TARGET_USERS) {
        const userAnswers = responses[userId];
        if (userAnswers.includes('Referencia Libre') || userAnswers.length === 0) continue;
        for (const size of userAnswers) {
            shopifyVariants.push({ userId, size, stock: 1 });
        }
    }
    
    const productDataForShopify = {
        description, reference, price, media, category,
        variants: shopifyVariants
    };
    
    const success = await uploadToShopify(productDataForShopify);

    // Log the final result of the session
    logger.endLog(success, responses);

    if (success) {
        await client.sendMessage(GROUP_ID, `✅ ¡Todo confirmado! El producto "${description} #${reference}" ha sido creado en Shopify con inventario por sede.`);
    } else {
        await client.sendMessage(GROUP_ID, `❌ Ocurrió un error al subir el producto a Shopify. La sesión ha sido guardada en el log para revisión manual.`);
    }
    
    await startHostWaitLoop(client);
}


// --- MAIN MESSAGE HANDLER ---

async function handleMessage(message, client) {
    if (message.fromMe || message.from !== GROUP_ID || !['chat', 'image'].includes(message.type)) return;

    try {
        await message.react('👍');
    } catch (e) { console.log("Could not react to message."); }
    
    const author = message.author || message.from;
    const authorName = BRANCH_NAMES[author] || (author === HOST_ID ? 'Host' : 'Unknown');
    const body = message.body.trim();
    
    // Log every message within an active workflow
    if (activeProductWorkflow) {
        logger.logMessage(message, authorName);
    }

    if (author === HOST_ID) {
        if (body === '✖️' && activeProductWorkflow) {
            return resetWorkflow(client, "El anfitrión canceló el proceso.");
        }
        
        if (!activeProductWorkflow) {
            if (!message.hasMedia) return;
            const parsedData = parseHostMessage(body);
            if (!parsedData) return client.sendMessage(GROUP_ID, "⚠️ Formato de mensaje incorrecto. Use: `DESCRIPCIÓN #REFERENCIA - PRECIO`");
            
            // Start a new log session as soon as the workflow begins
            logger.startNewLog(parsedData);
            // Also log the host's initial message
            logger.logMessage(message, 'Host');

            const category = autoDetectCategory(parsedData.description);
            activeProductWorkflow = {
                ...parsedData, category, media: await message.downloadMedia(),
                validVariants: getValidVariantsForCategory(category),
                responses: { [ID_C1]: [], [ID_C2]: [], [ID_M3]: [] },
                confirmations: { [ID_C1]: false, [ID_C2]: false, [ID_M3]: false },
                summaryMessageId: null,
            };
            
            const instructions = `...`; // Instructions message remains the same
            return client.sendMessage(GROUP_ID, `*Producto Recibido:*\n- 👞 *${parsedData.description}*\n- Referencia: *#${parsedData.reference}*\n- 💸 *Precio:* $${parsedData.price.toLocaleString('es-CO')}\n\nPor favor, cada sede envíe sus tallas disponibles separadas por espacios.\n\n*Opciones válidas para (${category}):* ${getValidVariantsForCategory(category).join(', ')}\n\n_Si no hay existencias, responda con: *Referencia Libre*_`);
        }
    }

    if (activeProductWorkflow && TARGET_USERS.includes(author)) {
        // ... (The rest of the logic for handling branch responses and confirmations remains unchanged)
        if ("👍👍🏻👍🏼👍🏽👍🏾👍🏿".includes(body) && activeProductWorkflow.summaryMessageId) {
            activeProductWorkflow.confirmations[author] = true;
            if (TARGET_USERS.every(id => activeProductWorkflow.confirmations[id])) {
                return validateAndFinalize(client);
            }
            return;
        }

        let variantsSubmitted = false;
        if (body.toLowerCase() === 'referencia libre') {
            activeProductWorkflow.responses[author] = ['Referencia Libre'];
            variantsSubmitted = true;
        } else {
            const submittedVariants = body.split(' ').map(v => v.trim().toUpperCase()).filter(v => v);
            const invalidVariants = submittedVariants.filter(v => !activeProductWorkflow.validVariants.includes(v));
            if (invalidVariants.length > 0) {
                await message.react('😵');
                return client.sendMessage(message.from, `Opción inválida: *${invalidVariants.join(', ')}*. Las opciones válidas son: ${getValidVariantsForCategory(activeProductWorkflow.category).join(', ')}. Por favor, envía tus tallas de nuevo.`);
            }
            activeProductWorkflow.responses[author] = submittedVariants;
            variantsSubmitted = true;
        }
        
        if (variantsSubmitted) {
            const allResponsesReceived = TARGET_USERS.every(id => activeProductWorkflow.responses[id].length > 0);
            if (allResponsesReceived) {
                const summaryText = generateSummaryMessage();
                if (activeProductWorkflow.summaryMessageId) {
                    try {
                        const messageToEdit = await client.getMessageById(activeProductWorkflow.summaryMessageId);
                        await messageToEdit.edit(summaryText);
                    } catch (err) {
                        const summaryMessage = await client.sendMessage(GROUP_ID, summaryText);
                        activeProductWorkflow.summaryMessageId = summaryMessage.id._serialized;
                    }
                } else {
                    const summaryMessage = await client.sendMessage(GROUP_ID, summaryText);
                    activeProductWorkflow.summaryMessageId = summaryMessage.id._serialized;
                }
            }
        }
    }
}

module.exports = { handleMessage, startHostWaitLoop };