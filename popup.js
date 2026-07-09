document.getElementById("checkBtn").addEventListener("click", async () => {

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    chrome.tabs.sendMessage(
        tab.id,
        { action: "CHECK_PAGE" },
        (response) => {

            if (chrome.runtime.lastError) {
                document.getElementById("result").innerText =
                    chrome.runtime.lastError.message;
                return;
            }

            document.getElementById("result").innerText =
                response.message;

        });

});