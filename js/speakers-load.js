document.addEventListener("DOMContentLoaded", function () {

    const district = sessionStorage.getItem("district");
    const school = sessionStorage.getItem("school");
    const speakerSelect = document.getElementById("speakerSelect");

    if (!district || !school) {
        alert("No district/school selected. Returning to login.");
        window.location.href = "index.html";
        return;
    }

    console.log("Session District:", district);
    console.log("Session School:", school);

    fetch("json/IP-arraies.json")
        .then(response => response.text()) // fetch as text first
        .then(text => {
            try {
                const data = JSON.parse(text);
                console.log("Loaded JSON:", data);

                const speakers = data[district]?.[school] || [];

                speakerSelect.innerHTML = "";

                if (speakers.length === 0) {
                    const opt = document.createElement("option");
                    opt.value = "";
                    opt.textContent = "No speakers found for this school";
                    speakerSelect.appendChild(opt);
                    speakerSelect.disabled = true;
                    return;
                }

                speakers.forEach(ip => {
                    const option = document.createElement("option");
                    option.value = ip;
                    option.textContent = ip;
                    speakerSelect.appendChild(option);
                });

            } catch (e) {
                console.error("JSON parse error:", e);
                console.log("Text received:", text);
                speakerSelect.innerHTML = "";
                const opt = document.createElement("option");
                opt.value = "";
                opt.textContent = "Error loading speakers";
                speakerSelect.appendChild(opt);
                speakerSelect.disabled = true;
            }
        })
        .catch(error => {
            console.error("Fetch error:", error);
            speakerSelect.innerHTML = "";
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "Error loading speakers";
            speakerSelect.appendChild(opt);
            speakerSelect.disabled = true;
        });

});
