// Grab session data
const district = sessionStorage.getItem("district");
const school = sessionStorage.getItem("school");

const speakerSelect = document.getElementById("speakerSelect");

if (!district || !school) {
    alert("No district/school selected. Returning to login page.");
    window.location.href = "login.html";
}

// Load speaker list from JSON file
fetch('speakers.json')
    .then(res => res.json())
    .then(data => {
        // Get the speakers for this district + school
        const speakerList = data[district]?.[school] || [];

        speakerList.forEach(ip => {
            const opt = document.createElement("option");
            opt.value = ip;
            opt.textContent = ip;
            speakerSelect.appendChild(opt);
        });

        // Optional: handle case where no speakers found
        if (speakerList.length === 0) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "No speakers found for this school";
            speakerSelect.appendChild(opt);
        }
    })
    .catch(err => {
        console.error("Failed to load speakers:", err);
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "Error loading speakers";
        speakerSelect.appendChild(opt);
    });
