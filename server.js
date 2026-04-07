const express = require("express");
const fs = require("fs");
const { exec } = require("child_process");
const path = require("path");

const app = express();

app.use(express.text());

app.use(express.static(path.join(__dirname, "public")));

// Receive config and trigger deployment
app.post("/apply-config", (req, res) => {
    const configPath = path.resolve(__dirname, "config.txt");

    // Save config
    fs.writeFileSync(configPath, req.body);
    console.log("config.txt updated");

    // 🔥 Run your deployment script
    exec("node /home/tec/config-site/web-app-algo/public/js/deploy.js", (err, stdout, stderr) => {
        console.log("=== DEPLOY STDOUT ===");
        console.log(stdout);
        console.log("=== DEPLOY STDERR ===");
        console.log(stderr);

        if (err) {
            console.error(err);
            return res.status(500).send("Deployment failed: " + err.message);
        }

        res.send("Deployment complete");
    });
});

app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});