let speakers = [];

async function loadSpeakers() {
    try {
        const response = await fetch("json/IP-arrays.json");
        speakers = await response.json();

        const dropdown = document.getElementById("speakerSelect");

        speakers.forEach(speaker => {
            const option = document.createElement("option");

            option.value = speaker.ip;

            // What the user sees
            option.textContent = `${speaker.ip} — ${speaker.location}`;

            dropdown.appendChild(option);
        });

    } catch (error) {
        console.error("Error loading speakers:", error);
    }
}

document.getElementById("speakerSelect").addEventListener("change", function () {

    const selectedIP = this.value;

    const speaker = speakers.find(s => s.ip === selectedIP);

    const display = document.getElementById("locationDisplay");

    if (speaker) {
        display.textContent = `Location: ${speaker.location}`;
    } else {
        display.textContent = "Location:";
    }
    console.log("script running")
});

window.onload = loadSpeakers;