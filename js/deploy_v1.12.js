const fs = require("fs");
const path = require("path");
const axios = require("axios");
const https = require("https");
const crypto = require("crypto");

/* ================= COLORS ================= */

const C = {
    RESET: "\x1b[0m",
    RED: "\x1b[31m",
    GREEN: "\x1b[32m",
    YELLOW: "\x1b[33m",
    BLUE: "\x1b[34m",
    MAGENTA: "\x1b[35m",
    CYAN: "\x1b[36m",
    GRAY: "\x1b[90m",
    BOLD: "\x1b[1m"
};

function info(msg) { console.log(`${C.CYAN}[INFO]${C.RESET} ${msg}`); }
function warn(msg) { console.log(`${C.YELLOW}[WARN]${C.RESET} ${msg}`); }
function ok(msg) { console.log(`${C.GREEN}[OK]${C.RESET} ${msg}`); }
function err(msg) { console.error(`${C.RED}[ERROR]${C.RESET} ${msg}`); }
function action(msg) { console.log(`${C.MAGENTA}[ACTION]${C.RESET} ${msg}`); }
function step(msg) { console.log(`${C.BLUE}[STEP]${C.RESET} ${msg}`); }

/* ================= CONFIG ================= */

const API_PASSWORD = "algo";
const DEVICE_LIST_FILE = path.resolve(__dirname, "ip_speakers.txt");
const CONFIG_FILE_NAME = "config.txt";
const PROV_URL = "http://10.4.170.10:8080/";

const DRY_RUN = false;

const GRACE_SECONDS = 90;           // Standard reboot
const FW_GRACE_SECONDS = 180;      // Firmware write + reboot
const RETRY_DELAY_MS = 3000;
const ONLINE_TIMEOUT_SECONDS = 240; // Total time to wait

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
    return new Promise(r => setTimeout(r, ms));
}

/**
 * Checks if current version is older than target version
 */
function isVersionOlder(current, target) {
    const c = current.split('.').map(Number);
    const t = target.split('.').map(Number);
    for (let i = 0; i < Math.max(c.length, t.length); i++) {
        const cP = c[i] || 0;
        const tP = t[i] || 0;
        if (tP > cP) return true;
        if (cP > tP) return false;
    }
    return false;
}

/* ================= HMAC API ================= */

async function apiRequest(host, endpoint, method, data = null, timeOffset = 0) {
    const now = new Date(Date.now() + timeOffset * 1000);
    const timestamp = Math.floor(now.getTime() / 1000);
    const nonce = Math.floor(Math.random() * 1e6).toString();
    const dateHeader = now.toUTCString();

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
    } catch (e) {
        if (e.response?.status === 403 && e.response.headers?.date) {
            const offset = Math.round(
                (new Date(e.response.headers.date).getTime() - Date.now()) / 1000
            );
            return apiRequest(host, endpoint, method, data, offset);
        }
        throw e;
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
    // Uses the version comparison helper
    return isVersionOlder(info.version, fw.version) ? fw : null;
}

async function uploadFirmware(host, firmwareFile) {
    const fwPath = path.resolve(__dirname, "firmware", firmwareFile);
    if (!fs.existsSync(fwPath)) {
        throw new Error(`Firmware file missing: ${firmwareFile}`);
    }

    action(`Uploading firmware ${firmwareFile} → ${host}`);

    return axios({
        method: "POST",
        url: `https://${host}/api/firmware`,
        data: fs.readFileSync(fwPath),
        headers: { "Content-Type": "application/octet-stream" },
        httpsAgent: secureAgent,
        timeout: 60000 // Increased timeout for file upload
    });
}

async function applyConfigFile(host) {
    const cfgPath = path.resolve(__dirname, CONFIG_FILE_NAME);
    if (!fs.existsSync(cfgPath)) {
        warn("Config file missing — skipping");
        return;
    }

    step(`Applying config file to ${host}`);
    await apiRequestWithRetry(host, "/api/settings", "PUT", {
        config: fs.readFileSync(cfgPath, "utf8")
    });
}

/* ================= WAIT LOGIC ================= */

async function waitForDevice(ip, customGrace) {
    const grace = customGrace || GRACE_SECONDS;
    action(`Waiting ${grace}s for device to initialize (${ip})`);
    await sleep(grace * 1000);

    const start = Date.now();
    const timeoutMs = ONLINE_TIMEOUT_SECONDS * 1000;

    while (Date.now() - start < timeoutMs) {
        try {
            await getFirmware(ip);
            console.log(""); // Clear dots
            ok(`${ip} is online`);
            return;
        } catch (e) {
            // Visual indicators for debugging reconnection
            if (e.response?.status === 403) {
                process.stdout.write(`${C.YELLOW}?${C.RESET}`); // Auth/Time issue
            } else {
                process.stdout.write(`${C.GRAY}.${C.RESET}`);   // Offline/Refused
            }
            await sleep(RETRY_DELAY_MS);
        }
    }
    console.log("");
    throw new Error(`Device ${ip} did not return online`);
}

/* ================= MAIN PIPELINE ================= */

async function processDevice(oldIp, newIp) {
    console.log(`\n${C.BOLD}===== ${oldIp} → ${newIp} =====${C.RESET}`);

    try {
        const info = await getFirmware(oldIp);
        ok(`${info.model} detected (FW ${info.version})`);

        // STATIC IP
        step("Applying static IP");
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

        // FIRMWARE
        const stableInfo = await getFirmware(newIp);
        const fwUpdate = needsFirmwareUpdate(stableInfo);

        if (fwUpdate && !DRY_RUN) {
            warn(`Firmware update required: ${stableInfo.version} → ${fwUpdate.version}`);
            await uploadFirmware(newIp, fwUpdate.file);
            // Device typically auto-reboots after firmware upload. 
            // We use a longer grace period for flashing.
            await waitForDevice(newIp, FW_GRACE_SECONDS);
        } else {
            ok(`Firmware up to date (${stableInfo.version})`);
        }

        // FINAL CONFIG
        if (!DRY_RUN) {
            await applyConfigFile(newIp);
            await apiRequestWithRetry(newIp, "/api/controls/reboot", "POST");
            await waitForDevice(newIp); // Ensure config applied and back up
        }

        ok(`${newIp} fully provisioned`);

    } catch (e) {
        err(`${oldIp} failed: ${e.message}`);
    }
}

/* ================= ENTRY ================= */

async function main() {
    if (!fs.existsSync(DEVICE_LIST_FILE)) {
        err(`Input file not found: ${DEVICE_LIST_FILE}`);
        return;
    }

    const lines = fs
        .readFileSync(DEVICE_LIST_FILE, "utf8")
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

    info(`Starting deployment for ${lines.length} devices`);

    for (const line of lines) {
        const [oldIp, newIp] = line.split(",").map(v => v.trim());
        if (!oldIp || !newIp) continue;
        await processDevice(oldIp, newIp);
    }

    ok("All devices processed");
}

main().catch(e => {
    err(`Fatal error: ${e.message}`);
});