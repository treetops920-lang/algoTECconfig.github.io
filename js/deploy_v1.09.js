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

const DRY_RUN = false;
const REBOOT_WAIT_TIME = 90;

const COLORS = {
    INFO: "\x1b[32m",
    WARN: "\x1b[33m",
    ERROR: "\x1b[31m",
    RESET: "\x1b[0m"
};

const secureAgent = new https.Agent({ rejectUnauthorized: false });

let successCount = 0;
let failureCount = 0;

// --- MODEL → FIRMWARE MAP ---
const FIRMWARE_MAP = {
    "Algo 8301 Paging Adapter": {
        version: "3.3.0",
        file: "8301_v3.3.0.bin"
    },
    "Algo 8186 SIP Horn Speaker": {
        version: "4.5.1",
        file: "8186_v4.5.1.bin"
    }
};

// --- LOGGING ---
function logRejection(host, status, message) {
    const ts = new Date().toISOString();
    fs.appendFileSync(
        path.resolve(__dirname, 'rejections.log'),
        `[${ts}] HOST: ${host} | STATUS: ${status} | MSG: ${message}\n`
    );
    return ts;
}

// --- HMAC API ---
async function apiRequest(host, endpoint, method, data = null, timeOffset = 0) {
    const now = new Date();
    const adjustedDate = new Date(now.getTime() + timeOffset * 1000);
    const dateHeader = adjustedDate.toUTCString();
    const timestamp = Math.floor(adjustedDate.getTime() / 1000);
    const nonce = Math.floor(Math.random() * 1000000).toString();
    const url = `https://${host}${endpoint}`;

    let bodyString = null;
    let contentMd5 = "";
    let hmacInput = "";

    if (data) {
        bodyString = JSON.stringify(data);
        contentMd5 = crypto.createHash("md5").update(bodyString).digest("hex");
        hmacInput = `${method}:${endpoint}:${contentMd5}:application/json:${timestamp}:${nonce}`;
    } else {
        hmacInput = `${method}:${endpoint}:${timestamp}:${nonce}`;
    }

    const signature = crypto
        .createHmac("sha256", API_PASSWORD.trim())
        .update(hmacInput)
        .digest("hex");

    return axios({
        method,
        url,
        data: bodyString,
        headers: {
            "Authorization": `hmac admin:${nonce}:${signature}`,
            "Date": dateHeader,
            ...(data && {
                "Content-Type": "application/json",
                "Content-Md5": contentMd5
            })
        },
        httpsAgent: secureAgent,
        timeout: 8000
    });
}

async function apiRequestWithRetry(host, endpoint, method, data = null) {
    try {
        return await apiRequest(host, endpoint, method, data, 0);
    } catch (err) {
        const status = err.response ? err.response.status : "NETWORK";
        const ts = logRejection(host, status, err.message);

        if (err.response?.status === 403 && err.response.headers.date) {
            const offset =
                Math.round(
                    (new Date(err.response.headers.date).getTime() -
                        Date.now()) / 1000
                );

            console.log(`${COLORS.WARN}[SYNC] ${ts} Time drift ${offset}s — retrying${COLORS.RESET}`);
            return apiRequest(host, endpoint, method, data, offset);
        }
        throw err;
    }
}

// --- HELPERS ---
async function waitForDevice(ip, timeout = 120000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            await getFirmware(ip);
            return;
        } catch {
            await new Promise(r => setTimeout(r, 3000));
        }
    }
    throw new Error(`Device ${ip} did not return online`);
}

async function getFirmware(host) {
    const res = await apiRequestWithRetry(host, "/api/info/about", "GET");
    return {
        model: res.data["Product Name"],
        version: res.data["Firmware Version"]
    };
}

function needsFirmwareUpdate(info) {
    const fw = FIRMWARE_MAP[info.model];
    if (!fw) return null;
    return fw.version !== info.version ? fw : null;
}

async function uploadFirmware(host, firmwareFile) {
    const firmwarePath = path.resolve(__dirname, "firmware", firmwareFile);
    if (!fs.existsSync(firmwarePath)) {
        throw new Error(`Missing firmware file ${firmwareFile}`);
    }

    return axios({
        method: "POST",
        url: `https://${host}/api/firmware`,
        data: fs.readFileSync(firmwarePath),
        headers: { "Content-Type": "application/octet-stream" },
        httpsAgent: secureAgent,
        timeout: 30000
    });
}

async function applyConfigFile(host) {
    const configPath = path.resolve(__dirname, CONFIG_FILE_NAME);
    if (!fs.existsSync(configPath)) return;
    const payload = { config: fs.readFileSync(configPath, "utf8") };
    await apiRequestWithRetry(host, "/api/settings", "PUT", payload);
}

// --- DEVICE PIPELINE ---
async function processDevice(currentIp, newIp) {
    console.log(`\n[${currentIp}] --- Starting Deployment ---`);

    try {
        const info = await getFirmware(currentIp);
        console.log(`${COLORS.INFO}[OK] ${info.model} (FW ${info.version})${COLORS.RESET}`);

        // 1️⃣ LOCK STATIC IP FIRST
        const netConfig = {
            "nm.ipv4.mode": "static",
            "nm.ipv4.address": newIp,
            "nm.ipv4.netmask": "255.255.255.0",
            "nm.ipv4.gateway": "10.4.172.1",
            "prov.server.url": PROV_URL,
            "admin.timezone": "America/New_York"
        };

        if (!DRY_RUN) {
            await apiRequestWithRetry(currentIp, "/api/settings", "PUT", netConfig);
            await apiRequestWithRetry(currentIp, "/api/controls/reboot", "POST");
            await waitForDevice(newIp);
        }

        // 2️⃣ FIRMWARE PHASE
        const stableInfo = await getFirmware(newIp);
        const fwUpdate = needsFirmwareUpdate(stableInfo);

        if (fwUpdate && !DRY_RUN) {
            console.log(`${COLORS.WARN}[FW] Updating ${stableInfo.model} → ${fwUpdate.version}${COLORS.RESET}`);
            await uploadFirmware(newIp, fwUpdate.file);
            await apiRequestWithRetry(newIp, "/api/controls/reboot", "POST");
            await waitForDevice(newIp);
        }

        // 3️⃣ FINAL CONFIG
        if (!DRY_RUN) {
            await applyConfigFile(newIp);
            await apiRequestWithRetry(newIp, "/api/controls/reboot", "POST");
        }

        successCount++;
        console.log(`${COLORS.INFO}[DONE] ${newIp} provisioned successfully${COLORS.RESET}`);

    } catch (err) {
        console.log(`${COLORS.ERROR}[FAIL] ${currentIp}: ${err.message}${COLORS.RESET}`);
        failureCount++;
    }
}

// --- MAIN ---
async function main() {
    if (!fs.existsSync(DEVICE_LIST_FILE)) {
        console.log("Missing ip_speakers.txt");
        return;
    }

    const lines = fs
        .readFileSync(DEVICE_LIST_FILE, "utf8")
        .split("\n")
        .filter(l => l.trim() && !l.startsWith("#"));

    for (const line of lines) {
        const [currentIp, newIp] = line.split(',').map(v => v.trim());
        await processDevice(currentIp, newIp);
    }

    console.log(`\nCompleted: ${successCount} success, ${failureCount} failed`);
}

main();
