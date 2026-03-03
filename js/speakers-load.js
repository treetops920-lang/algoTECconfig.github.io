document.addEventListener("DOMContentLoaded", function () {

    const districtInput = document.getElementById("currentDistrict");
    const schoolInput = document.getElementById("currentSchool");
    const speakerSelect = document.getElementById("speakerSelect");
    const speakerLocation = document.getElementById("speakerLocation");

    let speakerData = {};

    document.getElementById("currentDistrict").value
    document.getElementById("currentSchool").value

    // 🔹 Load JSON
    fetch("json/IP-arraies.json") // <-- adjust path if needed
        .then(response => response.json())
        .then(data => {
            speakerData = data;
            populateSpeakers();
        })
        .catch(error => {
            console.error("Error loading IP JSON:", error);
        });

    function populateSpeakers() {

        const district = districtInput.value;
        const school = schoolInput.value;

        // Clear dropdown
        speakerSelect.innerHTML = `<option value="">-- Select Speaker --</option>`;
        speakerLocation.value = "";

        if (!speakerData[district] || !speakerData[district][school]) {
            console.warn("No speakers found for:", district, school);
            return;
        }

        const speakers = speakerData[district][school];

        speakers.forEach(speaker => {
            const option = document.createElement("option");
            option.value = speaker.ip;
            option.textContent = speaker.ip;
            option.dataset.location = speaker.location || "Unknown";
            speakerSelect.appendChild(option);
        });
    }

    // 🔹 When IP is selected → fill location
    speakerSelect.addEventListener("change", function () {
        const selectedOption = this.options[this.selectedIndex];

        if (!selectedOption.value) {
            speakerLocation.value = "";
            return;
        }

        speakerLocation.value = selectedOption.dataset.location || "Unknown";
    });

});