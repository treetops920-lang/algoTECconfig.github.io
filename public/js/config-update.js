/* =========================
   CONFIG PARSER / WRITER
========================= */

function parseConfig(text) {
    const map = {};

    text.split("\n").forEach(line => {
        const l = line.trim();
        if (!l || !l.includes("=")) return;

        const i = l.indexOf("=");
        const key = l.slice(0, i).trim();
        const value = l.slice(i + 1).trim();

        map[key] = value;
    });

    return map;
}

function serializeConfig(baseText, merged) {
    const seen = new Set();
    const out = [];

    baseText.split("\n").forEach(line => {
        const l = line.trim();

        // Preserve comments / blank lines
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

    // Append new keys not in base
    Object.keys(merged).forEach(k => {
        if (!seen.has(k)) {
            out.push(`${k} = ${merged[k]}`);
        }
    });

    // 🔥 CLEAN OUTPUT (important for Algo)
    return out.join("\n")
        .replace(/\r/g, "")   // remove Windows CR
        .trim() + "\n";       // clean ending
}

/* =========================
   UI → CONFIG MAPPING
========================= */

function collectOverrides() {
    const overrides = {};

    const startupTone = document.querySelector(
        'input[name="startupTone"]:checked'
    )?.value;

    if (startupTone !== undefined) {
        overrides["admin.startuptone"] =
            startupTone === "1" ? "chime.wav" : "";
    }

    const ringVol = document.querySelector(
        'select[name="audio-level"]'
    )?.value;

    if (ringVol !== undefined) {
        overrides["audio.ring.vol"] = `${ringVol}dB`;
    }

    const pageVol = document.querySelector(
        'select[name="Page-Speaker-volume"]'
    )?.value;

    if (pageVol !== undefined) {
        overrides["audio.page.vol"] = `${pageVol}dB`;
    }

    const tz = document.querySelector(".timezone + select")?.value;

    if (tz && tz !== "unselected") {
        overrides["admin.timezone"] = tz;
    }

    const ntp = document.getElementById("ntp-server-primary")?.value;

    if (ntp) {
        overrides["net.time1"] = ntp;
    }

    return overrides;
}

/* =========================
   MAIN GENERATE FUNCTION
========================= */

async function buildConfig() {
    const baseText = await fetch("base.cfg").then(r => r.text());

    const baseMap = parseConfig(baseText);
    const overrides = collectOverrides();

    const merged = { ...baseMap, ...overrides };

    return serializeConfig(baseText, merged);
}

/* =========================
   DOWNLOAD CONFIG
========================= */

async function downloadConfig() {
    const finalCfg = await buildConfig();

    const blob = new Blob([finalCfg], {
        type: "text/plain;charset=utf-8"
    });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "algo-final.cfg";
    a.click();
}

/* =========================
   SEND TO SERVER (API FLOW)
========================= */

async function sendConfigToServer() {
    const finalCfg = await buildConfig();

    const res = await fetch("/save-config", {
        method: "POST",
        headers: {
            "Content-Type": "text/plain"
        },
        body: finalCfg
    });

    if (res.ok) {
        alert("Config sent to server!");
    } else {
        alert("Failed to send config");
    }
}

/* =========================
   BUTTON HANDLERS
========================= */

// Download button
document.getElementById("downloadConfig")
    ?.addEventListener("click", downloadConfig);

// Send-to-server button
document.getElementById("applyConfig")
    ?.addEventListener("click", sendConfigToServer);