let speakerData = {};
let speakers = [];

async function loadSpeakers() {

    try {

        const response = await fetch("json/IP-arrays.json");
        speakerData = await response.json();

        // Get stored values
        const district = sessionStorage.getItem("district");
        const school = sessionStorage.getItem("school");

        // Put them into the inputs
        document.getElementById("currentDistrict").value = district || "";
        document.getElementById("currentSchool").value = school || "";

        if (!district || !school) {
            console.warn("District or school missing from sessionStorage");
            return;
        }

        speakers = speakerData[district]?.[school] || [];

        const dropdown = document.getElementById("speakerSelect");
        dropdown.innerHTML = '<option value="">Select a Speaker</option>';

        speakers.forEach(speaker => {

            const option = document.createElement("option");

            option.value = speaker.ip;
            option.textContent = `${speaker.location} — ${speaker.ip}`;

            dropdown.appendChild(option);

        });

    } catch (error) {

        console.error("Error loading speakers:", error);

    }

}


document.getElementById("speakerSelect").addEventListener("change", function () {

    const selectedIP = this.value;

    const speaker = speakers.find(s => s.ip === selectedIP);

    if (!speaker) return;

    document.getElementById("locationDisplay").textContent = speaker.location;
    document.getElementById("ipDisplay").textContent = speaker.ip;
    document.getElementById("macDisplay").textContent = speaker.mac || "Not set";

});


window.onload = loadSpeakers;