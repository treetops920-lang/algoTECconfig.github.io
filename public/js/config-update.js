/* =========================
   CONFIG PARSER / WRITER
========================= */

function parseConfig(text) {
    const map = {};

    text.split("\n").forEach(line => {
        const l = line.trim();
        if (!l || !l.includes("=")) return;

        const i = l.indexOf("=");
        map[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    });

    return map;
}

function serializeConfig(baseText, merged) {
    const seen = new Set();
    const out = [];

    baseText.split("\n").forEach(line => {
        const l = line.trim();

        if (!l || !l.includes("=")) {
            out.push(line);
            return;
        }

        const key = l.split("=")[0].trim();

        if (merged[key] !== undefined) {
            out.push(`${key} = ${merged[key]}`);
            seen.add(key);
        } else {
            out.push(line);
        }
    });

    Object.keys(merged).forEach(k => {
        if (!seen.has(k)) {
            out.push(`${k} = ${merged[k]}`);
        }
    });

    // CLEAN OUTPUT FOR ALGO
    return out.join("\n")
        .replace(/\r/g, "")
        .trim() + "\n";
}

/* =========================
   UI → CONFIG MAPPING
========================= */
function getValue(selector) {
    const el = document.querySelector(selector);
    return el ? el.value : undefined;
}

function getById(id) {
    const el = document.getElementById(id);
    return el ? el.value : undefined;
}

function collectOverrides() {
    const overrides = {};

    const startupTone = getValue('input[name="startupTone"]:checked');
    if (startupTone !== undefined) {
        overrides["admin.startuptone"] =
            startupTone === "1" ? "chime.wav" : "";
    }

    const ringVol = getValue('select[name="audio-level"]');
    if (ringVol !== undefined) {
        overrides["audio.ring.vol"] = ringVol + "dB";
    }

    const pageVol = getValue('select[name="Page-Speaker-volume"]');
    if (pageVol !== undefined) {
        overrides["audio.page.vol"] = pageVol + "dB";
    }

    const tz = getValue(".timezone + select");
    if (tz && tz !== "unselected") {
        overrides["admin.timezone"] = tz;
    }

    const ntp = getById("ntp-server-primary");
    if (ntp) {
        overrides["net.time1"] = ntp;
    }

    return overrides;
}

/* =========================
   BUILD CONFIG
========================= */

async function buildConfig() {
    const baseText = await fetch("/deploy-config/base.txt").then(r => r.text());

    const baseMap = parseConfig(baseText);
    const overrides = collectOverrides();

    const merged = { ...baseMap, ...overrides };

    return serializeConfig(baseText, merged);
}

/* =========================
   SEND TO SERVER (NO DOWNLOAD)
========================= */

async function applyConfig() {
    try {
        const finalCfg = await buildConfig();

        const res = await fetch("/apply-config", {
            method: "POST",
            headers: {
                "Content-Type": "text/plain"
            },
            body: finalCfg
        });

        if (!res.ok) throw new Error("Server error");

        alert("Config sent and applied!");
    } catch (e) {
        console.error(e);
        alert("Failed to apply config");
    }
}

/* =========================
   BUTTON
========================= */

document.getElementById("generateConfig")
    ?.addEventListener("click", applyConfig);