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

const GRACE_SECONDS = 90;
const FW_GRACE_SECONDS = 180;
const RETRY_DELAY_MS = 3000;
const ONLINE_TIMEOUT_SECONDS = 240;

const secureAgent = new https.Agent({ rejectUnauthorized: false });

/* ================= FIRMWARE MAP ================= */

const FIRMWARE_MAP = {
    "Algo 8301 Paging Adapter": { version: "3.3.0", file: "8301_v3.3.0.bin" },
    "Algo 8186 SIP Horn Speaker": { version: "4.5.1", file: "8186_v4.5.1.bin" }
};

/* ================= UTILS ================= */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isVersionOlder(current, target) {
    const c = String(current).split('.').map(Number);
    const t = String(target).split('.').map(Number);
    for (let i = 0; i < Math.max(c.length, t.length); i++) {
        const cP = c[i] || 0;
        const tP = t[i] || 0;
        if (tP > cP) return true;
        if (cP > tP) return false;
    }
    return false;
}

/* ================= HMAC API WITH AUTO-TIME SYNC ================= */

async function apiRequest(host, endpoint, method, data = null, timeOffset = 0) {
    const now = new Date(Date.now() + (timeOffset * 1000));
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

    const signature = crypto.createHmac("sha256", API_PASSWORD).update(hmacInput).digest("hex");

    try {
        return await axios({
            method,
            url: `https://${host}${endpoint}`,
            data: body,
            headers: {
                "Authorization": `hmac admin:${nonce}:${signature}`,
                "Date": dateHeader,
                ...(data && { "Content-Type": "application/json", "Content-Md5": contentMd5 })
            },
            httpsAgent: secureAgent,
            timeout: 10000
        });
    } catch (e) {
        if (e.response?.status === 403 && e.response.headers?.date && timeOffset === 0) {
            const deviceTime = new Date(e.response.headers.date).getTime();
            const newOffset = Math.round((deviceTime - Date.now()) / 1000);
            return apiRequest(host, endpoint, method, data, newOffset);
        }
        throw e;
    }
}

/* ================= HELPERS ================= */

async function getFirmware(host) {
    const res = await apiRequest(host, "/api/info/about", "GET");
    return { model: res.data["Product Name"], version: res.data["Firmware Version"] };
}

async function uploadFirmware(host, firmwareFile) {
    const fwPath = path.resolve(__dirname, "firmware", firmwareFile);
    if (!fs.existsSync(fwPath)) throw new Error(`File missing: ${fwPath}`);
    action(`Uploading FW ${firmwareFile} → ${host}`);
    return axios({
        method: "POST",
        url: `https://${host}/api/firmware`,
        data: fs.readFileSync(fwPath),
        headers: { "Content-Type": "application/octet-stream" },
        httpsAgent: secureAgent,
        timeout: 120000
    });
}

async function waitForDevice(ip, customGrace) {
    const grace = customGrace || GRACE_SECONDS;
    action(`Waiting ${grace}s for ${ip}...`);
    await sleep(grace * 1000);
    const start = Date.now();
    while (Date.now() - start < (ONLINE_TIMEOUT_SECONDS * 1000)) {
        try {
            await getFirmware(ip);
            console.log("");
            ok(`${ip} is back online`);
            return;
        } catch (e) {
            process.stdout.write(e.response?.status === 403 ? `${C.YELLOW}?${C.RESET}` : `${C.GRAY}.${C.RESET}`);
            await sleep(RETRY_DELAY_MS);
        }
    }
    throw new Error(`Device ${ip} timed out.`);
}

/* ================= MAIN ================= */

async function processDevice(oldIp, newIp) {
    console.log(`\n${C.BOLD}===== ${oldIp} → ${newIp} =====${C.RESET}`);
    try {
        const info = await getFirmware(oldIp);
        ok(`${info.model} (v${info.version})`);

        step("Setting Static IP");
        const netConfig = {
            "nm.ipv4.mode": "static",
            "nm.ipv4.address": newIp,
            "nm.ipv4.netmask": "255.255.255.0",
            "nm.ipv4.gateway": "10.4.172.1",
            "prov.server.url": PROV_URL
        };

        if (!DRY_RUN) {
            await apiRequest(oldIp, "/api/settings", "PUT", netConfig);
            await apiRequest(oldIp, "/api/controls/reboot", "POST");
            await waitForDevice(newIp);
        }

        const stableInfo = await getFirmware(newIp);
        const fw = FIRMWARE_MAP[stableInfo.model];
        if (fw && isVersionOlder(stableInfo.version, fw.version) && !DRY_RUN) {
            warn(`Updating FW: ${stableInfo.version} → ${fw.version}`);
            await uploadFirmware(newIp, fw.file);
            await waitForDevice(newIp, FW_GRACE_SECONDS);
        } else {
            ok(`Firmware v${stableInfo.version} is okay. Skipping update.`);
        }

        if (!DRY_RUN) {
            const cfgPath = path.resolve(__dirname, CONFIG_FILE_NAME);
            if (fs.existsSync(cfgPath)) {
                step("Applying config.txt");
                await apiRequest(newIp, "/api/settings", "PUT", { config: fs.readFileSync(cfgPath, "utf8") });
                await apiRequest(newIp, "/api/controls/reboot", "POST");
                await waitForDevice(newIp);
            }
        }
        ok(`${newIp} Success`);
    } catch (e) {
        err(`${oldIp} failed: ${e.message}`);
    }
}

async function main() {
    info(`Looking for list at: ${DEVICE_LIST_FILE}`);

    if (!fs.existsSync(DEVICE_LIST_FILE)) {
        err("ERROR: 'ip_speakers.txt' NOT FOUND! Create it in the same folder as this script.");
        return;
    }

    const content = fs.readFileSync(DEVICE_LIST_FILE, "utf8");
    const lines = content.split("\n").map(l => l.trim()).filter(Boolean);

    if (lines.length === 0) {
        warn("The 'ip_speakers.txt' file is empty. Add 'oldip,newip' lines to it.");
        return;
    }

    info(`Found ${lines.length} devices to process.`);

    for (const line of lines) {
        const parts = line.split(",");
        if (parts.length < 2) {
            warn(`Skipping invalid line: ${line}`);
            continue;
        }
        await processDevice(parts[0].trim(), parts[1].trim());
    }
    ok("Finished all processing.");
}

main().catch(e => err(`Fatal: ${e.message}`));