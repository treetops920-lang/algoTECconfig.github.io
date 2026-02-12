document.addEventListener("DOMContentLoaded", function () {

    // 1️⃣ Load locked district + school
    const district = localStorage.getItem("district");
    const school = localStorage.getItem("school");

    document.getElementById("currentDistrict").value = district || "Not Set";
    document.getElementById("currentSchool").value = school || "Not Set";

    // 2️⃣ Example speaker data (replace later with fetch from backend)
    const speakers = [
        { ip: "10.1.1.15", location: "Room 201 - Ceiling", model: "8186" },
        { ip: "10.1.1.16", location: "Gym - Wall", model: "8188" },
        { ip: "10.1.1.17", location: "Office Front Desk", model: "8186" }
    ];

    const select = document.getElementById("speakerSelect");

    speakers.forEach(speaker => {
        const option = document.createElement("option");
        option.value = speaker.ip;
        option.textContent = `${speaker.ip} | ${speaker.location}`;
        select.appendChild(option);
    });

    // 3️⃣ Show details when selected
    select.addEventListener("change", function () {
        const selectedIP = this.value;
        const speaker = speakers.find(s => s.ip === selectedIP);

        const detailsDiv = document.getElementById("speakerDetails");

        if (!speaker) {
            detailsDiv.innerHTML = "";
            return;
        }

        detailsDiv.innerHTML = `
            <table class="ip-table">
                <tr><td><strong>IP Address:</strong></td><td>${speaker.ip}</td></tr>
                <tr><td><strong>Location:</strong></td><td>${speaker.location}</td></tr>
                <tr><td><strong>Model:</strong></td><td>${speaker.model}</td></tr>
            </table>
        `;
    });

});
