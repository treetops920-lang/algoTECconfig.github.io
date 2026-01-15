const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');

// --- CONFIGURATION ---
const API_PASSWORD = 'algo';           // Updated from your config file
const DEVICE_LIST_FILE = path.resolve(__dirname, 'ip_speakers.txt');
const CONFIG_FILE_NAME = 'config.txt';    // Your config blob file
const PROV_URL = 'http://10.4.170.10:8080/';

const DRY_RUN = true;
const REBOOT_WAIT_TIME = 90;
const COLORS = {
    INFO: "\x1b[32m", WARN: "\x1b[33m", ERROR: "\x1b[31m", RESET: "\x1b[0m"
};

let successCount = 0;
let failureCount = 0;
const secureAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Algo HMAC API Request - Fixed for Node v16 Header Strictness
 */
async function apiRequest(host, endpoint, method, data = null, timeOffset = 0) {
    const now = new Date();
    const adjustedDate = new Date(now.getTime() + (timeOffset * 1000));
    const dateHeader = adjustedDate.toUTCString();
    const timestamp = Math.floor(adjustedDate.getTime() / 1000);
    const nonce = Math.floor(Math.random() * 1000000).toString();
    const url = `https://${host}${endpoint}`;

    let hmacInput = "";
    let contentMd5 = "";
    let bodyString = null;

    if (data) {
        bodyString = JSON.stringify(data);
        contentMd5 = crypto.createHash("md5").update(bodyString).digest("hex");
        hmacInput = `${method}:${endpoint}:${contentMd5}:application/json:${timestamp}:${nonce}`;
    } else {
        hmacInput = `${method}:${endpoint}:${timestamp}:${nonce}`;
    }

    const signature = crypto.createHmac("sha256", API_PASSWORD.trim()).update(hmacInput).digest("hex");

    // CRITICAL: Clean all headers of hidden newlines/spaces for Node v16
    const authHeader = `hmac admin:${nonce}:${signature}`.replace(/[\n\r]/g, '').trim();
    const cleanDate = dateHeader.replace(/[\n\r]/g, '').trim();

    const headers = {
        "Authorization": authHeader,
        "Date": cleanDate,
    };

    if (data) {
        headers["Content-Type"] = "application/json";
        headers["Content-Md5"] = contentMd5;
    }

    return axios({
        method: method,
        url: url,
        data: bodyString,
        headers: headers,
        httpsAgent: secureAgent,
        timeout: 8000
    });
}

/**
 * Handles Clock Drift Retry
 */
async function apiRequestWithRetry(host, endpoint, method, data = null) {
    const offsets = [0, 30, -30, 60, -60];
    for (let offset of offsets) {
        try {
            return await apiRequest(host, endpoint, method, data, offset);
        } catch (err) {
            if (!err.response || err.response.status !== 403) throw err;
            if (offset === offsets[offsets.length - 1]) throw err;
        }
    }
}

/**
 * Pushes the local config file blob to the device
 */
async function applyConfigFile(host, filePath) {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const payload = { "config": fileContent };
        // This stages the file content into the settings API
        return await apiRequestWithRetry(host, "/api/settings", "PUT", payload);
    } catch (err) {
        throw new Error(`Config upload failed: ${err.message}`);
    }
}

/**
 * Retrieves specific device metadata
 */
async function getFirmware(host) {
    try {
        const response = await apiRequestWithRetry(host, "/api/info/about", "GET");
        return {
            version: response.data["Firmware Version"],
            model: response.data["Product Name"]
        };
    } catch (err) {
        throw new Error(`Firmware check failed: ${err.message}`);
    }
}

/**
 * Main Logic for each speaker
 */
async function processDevice(currentIp, newIp) {
    console.log(`\n[${currentIp}] --- Initiating API Deployment ---`);
    try {
        // 1. FIRMWARE & MODEL CHECK
        const info = await getFirmware(currentIp);
        console.log(`${COLORS.INFO}[OK] Detected ${info.model} (FW: ${info.version})${COLORS.RESET}`);

        if (DRY_RUN) {
            console.log(`${COLORS.WARN}[DRY RUN] Connection verified. Skipping changes.${COLORS.RESET}`);
            successCount++;
            return;
        }

        // 2. STAGE NETWORK SETTINGS
        const config = {
            "nm.ipv4.mode": "static",
            "nm.ipv4.address": newIp,
            "nm.ipv4.netmask": "255.255.255.0",
            "nm.ipv4.gateway": "10.4.172.1", // Matches your manual config text
            "prov.server.url": PROV_URL
        };
        await apiRequestWithRetry(currentIp, "/api/settings", "PUT", config);
        console.log(`${COLORS.INFO}[OK] Network settings staged.${COLORS.RESET}`);

        // 3. APPLY CONFIGURATION FILE
        const configPath = path.resolve(__dirname, CONFIG_FILE_NAME);
        if (fs.existsSync(configPath)) {
            await applyConfigFile(currentIp, configPath);
            console.log(`${COLORS.INFO}[OK] Configuration blob applied from ${CONFIG_FILE_NAME}.${COLORS.RESET}`);
        } else {
            console.log(`${COLORS.WARN}[NOTICE] ${CONFIG_FILE_NAME} not found, skipping blob upload.${COLORS.RESET}`);
        }

        // 4. REBOOT
        await new Promise(r => setTimeout(r, 1000));
        await apiRequestWithRetry(currentIp, "/api/controls/reboot", "POST");
        console.log(`${COLORS.INFO}[OK] Rebooting... Current connection will drop.${COLORS.RESET}`);

        // 5. VERIFICATION
        console.log(`${COLORS.WARN}Waiting ${REBOOT_WAIT_TIME}s for IP change...${COLORS.RESET}`);
        await new Promise(r => setTimeout(r, REBOOT_WAIT_TIME * 1000));

        try {
            await apiRequest(newIp, "/api/info/about", "GET");
            console.log(`${COLORS.INFO}[SUCCESS] Verified online at NEW IP: ${newIp}${COLORS.RESET}`);
            successCount++;
        } catch (e) {
            console.log(`${COLORS.WARN}[NOTICE] Reboot sent, but device not reachable at ${newIp} yet.${COLORS.RESET}`);
            successCount++;
        }

    } catch (error) {
        const msg = error.response ? `Status ${error.response.status}` : error.message;
        console.log(`${COLORS.ERROR}[FAIL] ${currentIp}: ${msg}${COLORS.RESET}`);
        failureCount++;
    }
}

async function main() {
    if (!fs.existsSync(DEVICE_LIST_FILE)) {
        return console.log(`${COLORS.ERROR}Missing ${DEVICE_LIST_FILE}${COLORS.RESET}`);
    }

    const lines = fs.readFileSync(DEVICE_LIST_FILE, "utf8").split("\n").filter(l => l.trim() && !l.startsWith("#"));

    for (const line of lines) {
        const parts = line.split(',').map(p => p.trim());
        const currentIp = parts[0];
        const newIp = parts[1] || currentIp;
        await processDevice(currentIp, newIp);
    }

    console.log(`\n=========================================`);
    console.log(`${COLORS.INFO}Summary: ${successCount} Done | ${COLORS.ERROR}${failureCount} Failed${COLORS.RESET}`);
    console.log(`=========================================\n`);
}

main();
