const express = require("express");
const fs = require("fs");
const { exec } = require("child_process");
const path = require("path");

const app = express();

app.use(express.text());

// Receive config and trigger deployment
app.post("/apply-config", (req, res) => {
    const configPath = path.resolve(__dirname, "config.txt");

    // Save config
    fs.writeFileSync(configPath, req.body);
    console.log("config.txt updated");

    // 🔥 Run your deployment script
    exec("node deploy.js", (err, stdout, stderr) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Deployment failed");
        }

        console.log(stdout);
        res.send("Deployment complete");
    });
});

app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});