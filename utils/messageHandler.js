/**
 * @file Handles all logic for the Shopify product bot using text commands.
 */

// --- IMPORTS ---
require("dotenv").config();
const { GROUP_ID, HOST_ID, ID_C1, ID_C2, ID_M3 } = process.env;
const logger = require("./logger"); // Import our new logger
const { uploadToShopify } = require("./shopify");

// ... (BRANCH_NAMES and TARGET_USERS remain the same) ...
const BRANCH_NAMES = {
  [ID_C1]: "Copacabana 1",
  [ID_C2]: "Copacabana 2",
  [ID_M3]: "Medellín 1",
};
const TARGET_USERS = [ID_C1, ID_C2, ID_M3];

const CATEGORY_DATA = {
  numeric: [
    "zapato",
    "botin",
    "bolichero",
    "mocasin",
    "teni",
    "sandalia",
    "sueco",
    "baleta",
    "forche",
    "plataforma",
    "bota",
    "forché",
    "mocasín",
    "botín",
  ],
  alpha: ["chaqueta", "gorra", "boina", "guantes"],
  unique: [
    "combo",
    "correa",
    "bolso",
    "bolsa",
    "morral",
    "manos libres",
    "mariconera",
    "pechera",
    "monedera",
    "billetera",
    "areta",
    "portadocumento",
    "llavero",
    "riñonera",
    "portacelular",
    "grasa",
    "champú",
    "shampoo",
  ],
};

// --- HELPER FUNCTIONS ---

/**
 * NEW: Helper function to remove accents and convert to lowercase for comparison.
 */
function normalizeString(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseHostMessage(body) {
  const regex = /^(.*)#(\S+)\s*-\s*([0-9.,$]+)$/;
  const match = body.match(regex);
  if (!match) return null;
  const description = match[1].trim();
  const reference = match[2].trim();
  const priceStr = match[3].trim();
  const price = parseInt(priceStr.replace(/[.,$]/g, ""));
  if (isNaN(price)) return null;
  return {
    description: description.charAt(0).toUpperCase() + description.slice(1),
    reference,
    price,
  };
}

/**
 * MODIFIED: Uses the normalizeString helper for accent-insensitive matching.
 */
function autoDetectCategory(description) {
  const normalizedDesc = normalizeString(description);
  for (const keyword of CATEGORY_DATA.numeric) {
    if (normalizedDesc.includes(normalizeString(keyword))) return keyword;
  }
  for (const keyword of CATEGORY_DATA.alpha) {
    if (normalizedDesc.includes(normalizeString(keyword))) return keyword;
  }
  for (const keyword of CATEGORY_DATA.unique) {
    if (normalizedDesc.includes(normalizeString(keyword))) return keyword;
  }
  return "accesorio";
}

function getValidVariantsForCategory(category) {
  const normalizedCategory = normalizeString(category);
  if (
    CATEGORY_DATA.numeric
      .map((c) => normalizeString(c))
      .includes(normalizedCategory)
  ) {
    return Array.from({ length: 16 }, (_, i) => String(33 + i));
  }
  if (
    CATEGORY_DATA.alpha
      .map((c) => normalizeString(c))
      .includes(normalizedCategory)
  ) {
    return ["XS", "S", "M", "L", "XL", "XXL"];
  }
  return ["U"];
}

/**
 * MODIFIED: Now formats variants with quantities and adds instructions for corrections.
 */
function generateSummaryMessage() {
  if (!activeProductWorkflow) return "";
  let summary = `*Resumen de Producto:*\n- Descripción: ${
    activeProductWorkflow.description
  }\n- Referencia: #${
    activeProductWorkflow.reference
  }\n- Precio: $${activeProductWorkflow.price.toLocaleString(
    "es-CO"
  )}\n- Categoría (detectada): ${
    activeProductWorkflow.category
  }\n\n*Variantes por Sede:*\n`;
  for (const userId of TARGET_USERS) {
    const branchName = BRANCH_NAMES[userId];
    let variantsText;
    if (
      Array.isArray(activeProductWorkflow.responses[userId]) &&
      typeof activeProductWorkflow.responses[userId][0] === "object"
    ) {
      variantsText =
        activeProductWorkflow.responses[userId]
          .map((v) => `${v.size}(${v.stock})`)
          .join(", ") || "(esperando respuesta)";
    } else {
      variantsText =
        activeProductWorkflow.responses[userId].join(", ") ||
        "(esperando respuesta)";
    }
    summary += `- ${branchName}: ${variantsText}\n`;
  }
  // FIX: Add that, in case something is wrong, they can send again the message with the correct variants.
  summary +=
    "\nSi algo es incorrecto, simplemente reenvíe las tallas corregidas para su sede.";
  summary += "\nSi todo es correcto, por favor envíen 👍🏻 para confirmar.";
  return summary;
}

let activeProductWorkflow = null;

// --- CORE WORKFLOW FUNCTIONS (No changes needed in resetWorkflow, startHostWaitLoop) ---
async function resetWorkflow(client, reason) {
  if (activeProductWorkflow) {
    console.log(`Workflow reset. Reason: ${reason}`);
    logger.endLog(false, activeProductWorkflow.responses);
    activeProductWorkflow = null;
    await client.sendMessage(GROUP_ID, `🔄 Proceso cancelado. ${reason}`);
  }
  await startHostWaitLoop(client);
}
async function startHostWaitLoop(client) {
  activeProductWorkflow = null;
  const message = `🤖 Esperando al anfitrión (@${
    HOST_ID.split("@")[0]
  }) para iniciar.\n\n*Instrucciones:*\nEnvía un mensaje que contenga:\n1.  La *imagen* del producto.\n2.  El texto en el formato: \`DESCRIPCIÓN #REFERENCIA - PRECIO\`\n\n*Ejemplo:*\n\`Botines de cuero para dama #678 - 150000\`\n\n_El bot detectará la categoría automáticamente desde la descripción._\n_El anfitrión puede cancelar el proceso en cualquier momento enviando ✖️_`;
  try {
    const hostContact = await client.getContactById(HOST_ID);
    await client.sendMessage(GROUP_ID, message, { mentions: [hostContact] });
  } catch (error) {
    console.error("Failed to send wait message:", error);
  }
}

/**
 * MODIFIED: Now correctly formats data with quantities for Shopify.
 */
async function validateAndFinalize(client) {
  console.log("Validating and finalizing...");
  const { description, reference, price, media, category, responses } =
    activeProductWorkflow;

  const shopifyVariants = [];
  for (const userId of TARGET_USERS) {
    const userAnswers = responses[userId];
    if (userAnswers.includes("Referencia Libre") || userAnswers.length === 0)
      continue;

    // The userAnswers are now objects { size, stock }
    for (const variant of userAnswers) {
      shopifyVariants.push({
        userId,
        size: variant.size,
        stock: variant.stock,
      });
    }
  }
  const productDataForShopify = {
    description,
    reference,
    price,
    media,
    category,
    variants: shopifyVariants,
  };
  const success = await uploadToShopify(productDataForShopify);
  logger.endLog(success, responses);

  if (success) {
    await client.sendMessage(
      GROUP_ID,
      `✅ ¡Todo confirmado! El producto "${description} #${reference}" ha sido creado en Shopify con inventario por sede.`
    );
  } else {
    await client.sendMessage(
      GROUP_ID,
      `❌ Ocurrió un error al subir el producto a Shopify. La sesión ha sido guardada en el log para revisión manual.`
    );
  }
  await startHostWaitLoop(client);
}

// --- MAIN MESSAGE HANDLER ---

/**
 * NEW: Helper function to generate a category-specific example for quantities.
 */
function getExampleForCategory(category) {
  const normalizedCategory = normalizeString(category);
  if (
    CATEGORY_DATA.numeric
      .map((c) => normalizeString(c))
      .includes(normalizedCategory)
  ) {
    return "`38 39:2 41` (una talla 38, dos 39, y una 41)";
  }
  if (
    CATEGORY_DATA.alpha
      .map((c) => normalizeString(c))
      .includes(normalizedCategory)
  ) {
    return "`S M:3 L` (una talla S, tres M, y una L)";
  }
  return "`U:5` (cinco unidades de talla única)";
}

async function handleMessage(message, client) {
  if (
    (message.fromMe && !message?._data?.id?.participant) ||
    ![message.from, message.to].includes(GROUP_ID) ||
    !["chat", "image"].includes(message.type)
  )
    return;
  try {
    await message.react("👍");
  } catch (e) {
    console.log("Could not react to message.");
  }
  const author = message.author || message.from;
  const authorName =
    BRANCH_NAMES[author] || (author === HOST_ID ? "Host" : "Unknown");
  const body = message.body.trim();
  if (activeProductWorkflow) {
    logger.logMessage(message, authorName);
  }

  if (author === HOST_ID) {
    if (body === "✖️" && activeProductWorkflow) {
      return resetWorkflow(client, "El anfitrión canceló el proceso.");
    }
    if (!activeProductWorkflow) {
      if (!message.hasMedia) return;
      const parsedData = parseHostMessage(body);
      if (!parsedData)
        return client.sendMessage(
          GROUP_ID,
          "⚠️ Formato de mensaje incorrecto. Use: `DESCRIPCIÓN #REFERENCIA - PRECIO`"
        );
      logger.startNewLog(parsedData);
      logger.logMessage(message, "Host");
      const category = autoDetectCategory(parsedData.description);
      activeProductWorkflow = {
        ...parsedData,
        category,
        media: await message.downloadMedia(),
        validVariants: getValidVariantsForCategory(category),
        responses: { [ID_C1]: [], [ID_C2]: [], [ID_M3]: [] },
        confirmations: { [ID_C1]: false, [ID_C2]: false, [ID_M3]: false },
        summaryMessageId: null,
      };

      // FIX: Provide a category-specific example for sending quantities.
      const example = getExampleForCategory(category);
      const instructions = `*Producto Recibido:*\n- 👞 *${
        parsedData.description
      }*\n- Referencia: *#${
        parsedData.reference
      }*\n- 💸 *Precio:* $${parsedData.price.toLocaleString(
        "es-CO"
      )}\n\nPor favor, cada sede envíe sus tallas y cantidades.\n\n*Formato:* \`TALLA:CANTIDAD\` (si no especifica cantidad, será 1).\n*Ejemplo:* ${example}\n\n_Si no hay existencias, responda con: *Referencia Libre*_`;
      return client.sendMessage(GROUP_ID, instructions);
    }
  }

  if (activeProductWorkflow && TARGET_USERS.includes(author)) {
    if (
      "👍👍🏻👍🏼👍🏽👍🏾👍🏿".includes(body) &&
      activeProductWorkflow.summaryMessageId
    ) {
      activeProductWorkflow.confirmations[author] = true;
      if (TARGET_USERS.every((id) => activeProductWorkflow.confirmations[id])) {
        return validateAndFinalize(client);
      }
      return;
    }

    let variantsSubmitted = false;
    if (body.toLowerCase() === "referencia libre") {
      activeProductWorkflow.responses[author] = ["Referencia Libre"];
      variantsSubmitted = true;
    } else {
      // FIX: Rewritten logic to parse 'SIZE:QUANTITY' format.
      const parts = body
        .split(" ")
        .map((p) => p.trim().toUpperCase())
        .filter((p) => p);
      const parsedVariants = [];
      const invalidParts = [];

      for (const part of parts) {
        const [size, quantityStr] = part.split(":");
        const stock = quantityStr ? parseInt(quantityStr, 10) : 1;

        if (
          activeProductWorkflow.validVariants.includes(size) &&
          !isNaN(stock) &&
          stock > 0
        ) {
          parsedVariants.push({ size, stock });
        } else {
          invalidParts.push(part);
        }
      }

      if (invalidParts.length > 0) {
        await message.react("😵");
        return await client.sendMessage(
          GROUP_ID,
          `Entrada inválida: *${invalidParts.join(
            ", "
          )}*. Revise las tallas y el formato (TALLA:CANTIDAD).`
        );
      }

      activeProductWorkflow.responses[author] = parsedVariants;
      variantsSubmitted = true;
    }

    if (variantsSubmitted) {
      const allResponsesReceived = TARGET_USERS.every(
        (id) => activeProductWorkflow.responses[id].length > 0
      );
      if (allResponsesReceived) {
        const summaryText = generateSummaryMessage();
        if (activeProductWorkflow.summaryMessageId && activeProductWorkflow.summaryMessageId != 'EMPTY') {
          try {
            await (
              await client.getMessageById(
                activeProductWorkflow.summaryMessageId
              )
            ).edit(summaryText);
          } catch (err) {
            const m = await client.sendMessage(GROUP_ID, summaryText);
            activeProductWorkflow.summaryMessageId = m?.id?._serialized || 'EMPTY';
          }
        } else {
          const m = await client.sendMessage(GROUP_ID, summaryText);
          activeProductWorkflow.summaryMessageId = m?.id?._serialized || 'EMPTY';
        }
      }
    }
  }
}

module.exports = { handleMessage, startHostWaitLoop };
