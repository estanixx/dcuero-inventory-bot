
# Dcuero Inventory Bot 🤖📦

This project is a sophisticated WhatsApp bot built with `whatsapp-web.js` that tracks a conversation in a specific WhatsApp group to streamline the product creation workflow. It performs ETL (Extract, Transform, Load) techniques to parse unstructured messages, validates the data, and uses the Shopify Admin API to automatically create new products with variants, images, and multi-location inventory.

The system is designed to be resilient, with a file-system-based logger acting as a fallback for any connectivity or API failures, ensuring no data is lost.

## Demo
<div align="center">

  <img src='assets/img/app.gif'/>
</div>

## Features

  - **Group-Specific Monitoring**: The bot listens exclusively to a designated WhatsApp group.
  - **Role-Based Interaction**: Differentiates between a "Host" (who submits products) and "Branch" users (who provide stock info).
  - **Intelligent Message Parsing**: Accepts product submissions in a natural language format: `DESCRIPTION #REFERENCE - PRICE`.
  - **Automatic Category Detection**: Intelligently scans the product description for keywords (e.g., "botin", "chaqueta", "bolso") to assign the correct product category automatically.
  - **Dynamic Variant Validation**: Provides users with valid size/variant options based on the detected category.
  - **Size & Quantity Input**: Accepts complex inventory submissions from branches, including quantities for each size (e.g., `40:2 41 42:3`).
  - **Interactive Summary & Confirmation**: Generates and edits a single summary message in real-time as branches submit their data, then waits for a `👍🏻` confirmation from all parties before proceeding.
  - **Full Shopify Integration**:
      - Creates new products.
      - Uploads the product image sent via WhatsApp.
      - Creates product variants (e.g., sizes).
      - Assigns inventory quantities to specific store locations (multi-location inventory).
      - Adds the product to the correct collection automatically via `product_type`.
  - **Robust JSON Logging**: Every product submission workflow is saved to a `workflow_log.json` file with a `submit_success` flag, creating a fallback system for any failures.
  - **Helper Utilities**: Includes scripts to easily fetch necessary WhatsApp and Shopify IDs during setup.

## Tech Stack

  - [Node.js](https://nodejs.org/): JavaScript runtime environment.
  - [whatsapp-web.js](https://wwebjs.dev/): A powerful WhatsApp library for Node.js that connects through the WhatsApp Web browser app.
  - [Dotenv](https://www.npmjs.com/package/dotenv): For managing environment variables.
  - [Axios](https://axios-http.com/): For making HTTP requests to the Shopify API.

## Prerequisites

  - Node.js (v16 or higher recommended).
  - A dedicated WhatsApp account for the bot.
  - A Shopify store with Admin API access enabled for a custom app.

## Setup & Installation

**1. Clone the repository:**

```bash
git clone <your-repository-url>
cd dcuero-inventory-bot
```

**2. Install dependencies:**

```bash
npm install
```

**3. Create the configuration file:**
Copy the example environment file.

```bash
cp .env.example .env
```

**4. Get Required IDs & Credentials:**
You now need to run the included utility scripts to get the necessary IDs to fill in your `.env` file.

  - **Get WhatsApp IDs:** This script will launch a WhatsApp session and print the IDs of your groups and their participants.

    ```bash
    node get_ids.js
    ```

    Scan the QR code with the bot's WhatsApp account. Copy the `Group ID` and the User IDs for the `HOST`, `C1`, `C2`, and `M3`.

  - **Get Shopify Location IDs:** This script connects to your Shopify store and lists your configured locations. Make sure you have created a custom app in Shopify and have your Admin API Token.

    ```bash
    node utils/getLocations.js
    ```

    Copy the numeric `Location ID` for each branch.

**5. Configure your `.env` file:**
Open the `.env` file and fill in all the values you just collected.

```ini
# WhatsApp User & Group IDs
GROUP_ID="<the-group-id-from-get_ids>"
HOST_ID="<the-host-user-id-from-get_ids>"
ID_C1="<the-c1-user-id-from-get_ids>"
ID_C2="<the-c2-user-id-from-get_ids>"
ID_M3="<the-m3-user-id-from-get_ids>"

# Shopify Credentials
SHOPIFY_STORE_URL="your-store-name.myshopify.com"
SHOPIFY_ADMIN_API_TOKEN="shpat_..."

# Shopify Location IDs (use the numeric IDs from getLocations.js)
SHOPIFY_LOCATION_ID_C1="<location-id-for-c1>"
SHOPIFY_LOCATION_ID_C2="<location-id-for-c2>"
SHOPIFY_LOCATION_ID_M3="<location-id-for-m3>"
```

**6. Set up Shopify Smart Collections:**
For products to be automatically added to collections, you must set them up in your Shopify Admin. See the [documentation on creating automated collections](https://www.google.com/search?q=https://help.shopify.com/en/manual/products/collections/automated-collections/create-automated-collection).

  - **Example Rule:** Create a collection named "Botines". For the condition, select `Product type` `is equal to` `botin`. The bot will automatically set the product type, and Shopify will handle the rest.

## Running the Bot

Once everything is configured, start the bot with:

```bash
node app.js
```

You may need to scan a final QR code with the bot's WhatsApp account to establish the session. The bot will then send an online message to the group and be ready for use.

## Workflow

1.  **Bot Starts**: The bot sends a message in the group explaining the submission format to the host.
2.  **Host Submits**: The host sends a single message containing the product image and the caption in the format `DESCRIPTION #REFERENCE - PRICE`.
3.  **Bot Asks for Variants**: The bot confirms receipt, shows the detected data, and asks the three branches to provide their available sizes and quantities (e.g., `40:2 41`).
4.  **Branches Respond**: Each of the three users sends their stock information. The bot validates their input.
5.  **Bot Summarizes**: Once all three have responded, the bot creates or edits a summary message showing all collected data.
6.  **Branches Confirm**: The three users send a `👍🏻` emoji to confirm the summary is correct.
7.  **Shopify Upload**: After receiving all confirmations, the bot uploads the product, image, variants, and multi-location inventory to Shopify and adds it to the appropriate collection.
8.  **Loop**: The bot announces the successful creation and returns to the initial state, waiting for the next product from the host.

## Error Handling & Fallback

If any step of the Shopify upload fails (due to network issues, API errors, etc.), the bot will notify the group. More importantly, the entire transaction—including all messages and final data—is saved to **`workflow_log.json`** with the flag `"submit_success": false`. This creates a persistent record that allows for manual recovery, ensuring no product submission is ever lost.