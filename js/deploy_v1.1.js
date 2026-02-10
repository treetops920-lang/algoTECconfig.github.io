const fs = require("fs");
const path = require("path");
const axios = require("axios");
const https = require("https");
const crypto = require("crypto");

/* ================= CONFIG ================= */

const API_PASSWORD = "algo";
const DEVICE_LIST_FILE = path.resolve(__dirname, "ip_speakers.txt");
const CONFIG_FILE_NAME = "config.txt";
const PROV_URL = "http://10.4.170.10:8080/";

const DRY_RUN = false;

// timing
const GRACE_SECONDS = 90;      // 1.5 minutes hard wait after reboot
const RETRY_DELAY_MS = 3000;   // retry probe interval
const ONLINE_TIMEOUT_SECONDS = 180;

const secureAgent = new https.Agent({ rejectUnauthorized: false });

/* ================= FIRMWARE MAP ================= */

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

/* ================= UTILS ================= */

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg) {
    console.log(msg);
}

/* ================= HMAC API ================= */

async function apiRequest(host, endpoint, method, data = null, timeOffset = 0) {
    const now = new Date(Date.now() + timeOffset * 1000);
    const dateHeader = now.toUTCString();
    const timestamp = Math.floor(now.getTime() / 1000);
    const nonce = Math.floor(Math.random() * 1e6).toString();

    let body = null;
    let contentMd5 = "";
    let hmacInput = "";

    if (data) {
        body = JSON.stringify(data);
        contentMd5 = crypto.createHash("md5").update(body).digest("hex");
        hmacInput = `${method}:${endpoint}:${contentMd5}:application/json:${timestamp}:${nonce}`;
    } else {
        hmacInput = `${method}:${endpoint}:${timestamp}:${nonce}`;
    }

    const signature = crypto
        .createHmac("sha256", API_PASSWORD)
        .update(hmacInput)
        .digest("hex");

    return axios({
        method,
        url: `https://${host}${endpoint}`,
        data: body,
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
        return await apiRequest(host, endpoint, method, data);
    } catch (err) {
        if (err.response?.status === 403 && err.response.headers?.date) {
            const offset = Math.round(
                (new Date(err.response.headers.date).getTime() - Date.now()) / 1000
            );
            return apiRequest(host, endpoint, method, data, offset);
        }
        throw err;
    }
}

/* ================= DEVICE HELPERS ================= */

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
    const fwPath = path.resolve(__dirname, "firmware", firmwareFile);
    if (!fs.existsSync(fwPath)) {
        throw new Error(`Firmware file missing: ${firmwareFile}`);
    }

    return axios({
        method: "POST",
        url: `https://${host}/api/firmware`,
        data: fs.readFileSync(fwPath),
        headers: { "Content-Type": "application/octet-stream" },
        httpsAgent: secureAgent,
        timeout: 30000
    });
}

async function applyConfigFile(host) {
    const cfgPath = path.resolve(__dirname, CONFIG_FILE_NAME);
    if (!fs.existsSync(cfgPath)) return;

    await apiRequestWithRetry(host, "/api/settings", "PUT", {
        config: fs.readFileSync(cfgPath, "utf8")
    });
}

/* ================= WAIT LOGIC ================= */

async function waitForDevice(ip) {
    log(`[WAIT] Grace period ${GRACE_SECONDS}s for ${ip}`);
    await sleep(GRACE_SECONDS * 1000);

    const start = Date.now();
    const timeoutMs = ONLINE_TIMEOUT_SECONDS * 1000;

    while (Date.now() - start < timeoutMs) {
        try {
            await getFirmware(ip);
            log(`[ONLINE] ${ip} is responding`);
            return;
        } catch {
            await sleep(RETRY_DELAY_MS);
        }
    }

    throw new Error(`Device ${ip} did not return online`);
}

/* ================= MAIN PIPELINE ================= */

async function processDevice(oldIp, newIp) {
    log(`\n[START] ${oldIp} → ${newIp}`);

    // identify
    const info = await getFirmware(oldIp);
    log(`[ID] ${info.model} (FW ${info.version})`);

    // 1️⃣ STATIC IP FIRST
    const netConfig = {
        "nm.ipv4.mode": "static",
        "nm.ipv4.address": newIp,
        "nm.ipv4.netmask": "255.255.255.0",
        "nm.ipv4.gateway": "10.4.172.1",
        "prov.server.url": PROV_URL
    };

    if (!DRY_RUN) {
        await apiRequestWithRetry(oldIp, "/api/settings", "PUT", netConfig);
        await apiRequestWithRetry(oldIp, "/api/controls/reboot", "POST");
        await waitForDevice(newIp);
    }

    // 2️⃣ FIRMWARE
    const stableInfo = await getFirmware(newIp);
    const fwUpdate = needsFirmwareUpdate(stableInfo);

    if (fwUpdate && !DRY_RUN) {
        log(`[FW] Updating ${stableInfo.model} → ${fwUpdate.version}`);
        await uploadFirmware(newIp, fwUpdate.file);
        await apiRequestWithRetry(newIp, "/api/controls/reboot", "POST");
        await waitForDevice(newIp);
    }

    // 3️⃣ FINAL CONFIG
    if (!DRY_RUN) {
        await applyConfigFile(newIp);
        await apiRequestWithRetry(newIp, "/api/controls/reboot", "POST");
    }

    log(`[DONE] ${newIp} provisioned`);
}

/* ================= ENTRY ================= */

async function main() {
    const lines = fs
        .readFileSync(DEVICE_LIST_FILE, "utf8")
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

    for (const line of lines) {
        const [oldIp, newIp] = line.split(",").map(v => v.trim());
        await processDevice(oldIp, newIp);
    }

    log("\nAll devices processed");
}

main().catch(err => {
    console.error("[FATAL]", err.message);
});
