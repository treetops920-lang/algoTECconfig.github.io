
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

    // append new keys
    Object.keys(merged).forEach(k => {
        if (!seen.has(k)) out.push(`${k} = ${merged[k]}`);
    });

    return out.join("\n");
}

/* =========================
   UI → CONFIG MAPPING
========================= */

function collectOverrides() {
    const overrides = {};

    /* Startup tone */
    const startupTone = document.querySelector(
        'input[name="startupTone"]:checked'
    )?.value;
    if (startupTone !== undefined) {
        overrides["admin.startuptone"] = startupTone === "1" ? "chime.wav" : "";
    }

    /* Ring / alert volume */
    const ringVol = document.querySelector(
        'select[name="audio-level"]'
    )?.value;
    if (ringVol !== undefined) {
        overrides["audio.ring.vol"] = `${ringVol}dB`;
    }

    /* Page speaker volume */
    const pageVol = document.querySelector(
        'select[name="Page-Speaker-volume"]'
    )?.value;
    if (pageVol !== undefined) {
        overrides["audio.page.vol"] = `${pageVol}dB`;
    }

    /* Timezone */
    const tz = document.querySelector(".timezone + select")?.value;
    if (tz && tz !== "unselected") {
        overrides["admin.timezone"] = tz;
    }

    /* NTP primary */
    const ntp = document.getElementById("ntp-server-primary")?.value;
    if (ntp) {
        overrides["net.time1"] = ntp;
    }

    return overrides;
}

/* =========================
   SAVE BUTTON
========================= */

document.querySelector(".actions button")?.addEventListener("click", async () => {
    // Load base config (could also be fetched)
    const baseText = await fetch("base.cfg").then(r => r.text());

    const baseMap = parseConfig(baseText);
    const overrides = collectOverrides();
    const merged = { ...baseMap, ...overrides };

    const finalCfg = serializeConfig(baseText, merged);

    const blob = new Blob([finalCfg], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "algo-final.cfg";
    a.click();
});

document.getElementById("generateConfig")
    .addEventListener("click", generateConfig);

function generateConfig() {
    console.log("Generate button clicked");

    // 1. Collect overrides from the form
    const overrides = collectOverrides();

    // 2. Load base config
    fetch("base.cfg")
        .then(r => r.text())
        .then(baseText => {
            const baseMap = parseConfig(baseText);
            const merged = { ...baseMap, ...overrides };
            const finalCfg = serializeConfig(baseText, merged);

            downloadFile(finalCfg, "algo-final.cfg");
        });
}
