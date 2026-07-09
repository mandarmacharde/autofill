chrome.runtime.onMessage.addListener((request, sender, sendResponse)=>{

    if(request.action==="CHECK_PAGE"){

        sendResponse({
            message:
            "Connected to\n\n" + window.location.href
        });

    }

});