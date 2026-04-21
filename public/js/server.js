const express = require('express');
const app = express();

// IMPORTANT: import your existing script functions
const { processDevice } = require('./your-script-file'); // adjust name

app.use(express.text()); // because you're sending text/plain

app.post('/apply-config', async (req, res) => {
    try {
        const configText = req.body;

        if (!configText) {
            return res.status(400).send("No config received");
        }

        // 🔥 Save incoming config to file your script already uses
        const fs = require('fs');
        const path = require('path');

        const configPath = path.resolve(__dirname, './config.txt');
        fs.writeFileSync(configPath, configText);

        console.log("Received config from browser");

        // 🔥 Load your IP list
        const DEVICE_LIST_FILE = path.resolve(__dirname, "../ip_speakers.txt");

        const lines = fs.readFileSync(DEVICE_LIST_FILE, "utf8")
            .split("\n")
            .map(l => l.trim())
            .filter(Boolean);

        const results = [];

        for (const line of lines) {
            const [oldIp, newIp] = line.split(",");
            if (!oldIp || !newIp) continue;

            try {
                await processDevice(oldIp.trim(), newIp.trim());
                results.push({ ip: newIp, status: "ok" });
            } catch (e) {
                results.push({ ip: newIp, error: e.message });
            }
        }

        res.json(results);

    } catch (e) {
        console.error(e);
        res.status(500).send("Server error");
    }
});

app.listen(3000, () => {
    console.log("API running on port 3000");
});