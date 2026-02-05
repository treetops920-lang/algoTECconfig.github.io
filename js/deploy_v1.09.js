const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');

// --- CONFIGURATION ---
const API_PASSWORD = 'algo';
const DEVICE_LIST_FILE = path.resolve(__dirname, 'ip_speakers.txt');
const CONFIG_FILE_NAME = 'config.txt';
const PROV_URL = 'http://10.4.170.10:8080/';

const DRY_RUN = false; // Set to true to test without making changes
const REBOOT_WAIT_TIME = 90;
const COLORS = {
    INFO: "\x1b[32m", WARN: "\x1b[33m", ERROR: "\x1b[31m", RESET: "\x1b[0m"
};

let successCount = 0;
let failureCount = 0;
const secureAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Logs rejection details to a local file
 */
function logRejection(host, status, message) {
    const ts = new Date().toISOString();
    const logEntry = `[${ts}] HOST: ${host} | STATUS: ${status} | MSG: ${message}\n`;
    try {
        fs.appendFileSync(path.resolve(__dirname, 'rejections.log'), logEntry);
    } catch (e) {
        console.error("Failed to write to log file:", e.message);
    }
    return ts;
}

/**
 * Algo HMAC API Request
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
 * Smart-Sync Retry Logic
 */
async function apiRequestWithRetry(host, endpoint, method, data = null) {
    try {
        // Attempt 1: Normal system time
        return await apiRequest(host, endpoint, method, data, 0);
    } catch (err) {
        const status = err.response ? err.response.status : 'NETWORK_ERROR';
        const timestamp = logRejection(host, status, err.message);

        if (err.response && err.response.status === 403) {
            const speakerDateStr = err.response.headers.date;
            if (speakerDateStr) {
                const speakerTime = new Date(speakerDateStr).getTime();
                const myTime = new Date().getTime();
                const exactOffset = Math.round((speakerTime - myTime) / 1000);

                console.log(`${COLORS.WARN}[SYNC] ${timestamp} - Timezone drift: ${exactOffset}s. Retrying...${COLORS.RESET}`);

                try {
                    return await apiRequest(host, endpoint, method, data, exactOffset);
                } catch (retryErr) {
                    logRejection(host, retryErr.response ? retryErr.response.status : 'RETRY_FAIL', retryErr.message);
                    throw retryErr;
                }
            }
        }
        throw err;
    }
}

async function applyConfigFile(host, filePath) {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const payload = { "config": fileContent };

}

async function getFirmware(host) {
    console.log(`${COLORS.WARN}[UPGRADE] Starting firmware update for ${host}...${COLORS.RESET}`);
    const response = await apiRequestWithRetry(host, "/api/info/about", "GET");
    return {
        version: response.data["Firmware Version"],
        model: response.data["Product Name"]
    };

}

async function pushLocalFirmware(host, firmwareUrl) {
    const payload = { "url": firmwareUrl };
    return await apiRequestWithRetry(host, "/api/controls/upgrade/start", "POST", payload);
}

async function processDevice(currentIp, newIp) {
    console.log(`\n[${currentIp}] --- Starting Deployment ---`);
    try {
        const info = await getFirmware(currentIp);
        console.log(`${COLORS.INFO}[OK] ${info.model} (FW: ${info.version})${COLORS.RESET}`);

        if (DRY_RUN) {
            console.log(`${COLORS.WARN}[DRY RUN] Connection verified. Skipping changes.${COLORS.RESET}`);
            successCount++;
            return;
        }

        const config = {
            "nm.ipv4.mode": "static",
            "nm.ipv4.address": newIp,
            "nm.ipv4.netmask": "255.255.255.0",
            "nm.ipv4.gateway": "10.4.172.1",
            "prov.server.url": PROV_URL,
            "admin.timezone": "America/New_York"
        };
        await apiRequestWithRetry(currentIp, "/api/settings", "PUT", config);

        const configPath = path.resolve(__dirname, CONFIG_FILE_NAME);
        if (fs.existsSync(configPath)) {
            await applyConfigFile(currentIp, configPath);
        }

        await apiRequestWithRetry(currentIp, "/api/controls/reboot", "POST");
        console.log(`${COLORS.INFO}[OK] Configuration pushed and Rebooting...${COLORS.RESET}`);
        successCount++;
    } catch (error) {
        console.log(`${COLORS.ERROR}[FAIL] ${currentIp}: ${error.message}${COLORS.RESET}`);
        failureCount++;
    }
}

async function main() {
    if (!fs.existsSync(DEVICE_LIST_FILE)) return console.log("Missing ip_speakers.txt");
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
