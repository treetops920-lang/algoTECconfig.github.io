document.addEventListener("DOMContentLoaded", function () {

    const district = sessionStorage.getItem("district");
    const school = sessionStorage.getItem("school");

    const speakerSelect = document.getElementById("speakerSelect");

    if (!district || !school) {
        alert("No district/school selected. Returning to login.");
        window.location.href = "login.html";
        return;
    }

    console.log("Session District:", district);
    console.log("Session School:", school);

    fetch("js/IP-arraies.json")
        .then(response => response.json())
        .then(data => {

            console.log("Loaded JSON:", data);

            const speakers = data[district]?.[school];

            speakerSelect.innerHTML = "";

            if (!speakers || speakers.length === 0) {
                const opt = document.createElement("option");
                opt.value = "";
                opt.textContent = "No speakers found for this school";
                speakerSelect.appendChild(opt);
                return;
            }

            speakers.forEach(ip => {
                const option = document.createElement("option");
                option.value = ip;
                option.textContent = ip;
                speakerSelect.appendChild(option);
            });
        })
        .catch(error => {
            console.error("Error loading speaker file:", error);

            speakerSelect.innerHTML = "";
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "Error loading speakers";
            speakerSelect.appendChild(opt);
        });

});
