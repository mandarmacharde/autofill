const CONFIG = {
    prStatusDropdown: ".filters .filter-group:nth-child(1) select",
    prStatusBlankOption: "",

    purchasingDropdown: ".filters .filter-group:nth-child(2) select",
    purchasingBlankOption: "",

    requisitionDropdown: ".filters .filter-group:nth-child(3) select",
    requisitionAllOption: "All",

    searchInput: "#searchInput",
    searchButton: "#searchBtn",
    searchClear: "#clearSearch",

    firstRowCheckbox: "#tableBody tr:first-child .checkbox",

    loadingIndicator: ".loading"
};

const STORAGE_KEY = "formbotAutomationState";
const DEFAULT_STATE = {
    rows: [],
    index: 0,
    processed: 0,
    failed: [],
    phase: "idle",
    isRunning: false,
    currentPRN: "",
    status: "Ready",
    filtersConfigured: false
};

let automationLoopActive = false;

function cloneDefaultState() {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function getState() {
    const storedState = window.sessionStorage.getItem(STORAGE_KEY);
    if (!storedState) return cloneDefaultState();
    try {
        return { ...cloneDefaultState(), ...JSON.parse(storedState) };
    } catch (error) {
        return cloneDefaultState();
    }
}

function saveState(state) {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function updateState(changes) {
    const state = { ...getState(), ...changes };
    saveState(state);
    return state;
}

function getPageInfo() {
    const state = getState();
    return {
        website: window.location.hostname,
        prn: state.currentPRN,
        processed: state.processed,
        total: state.rows.length,
        remaining: Math.max(state.rows.length - state.processed, 0),
        status: state.status,
        isRunning: state.isRunning,
        failed: state.failed
    };
}

function isWritableInput(element) {
    return element &&
        !element.disabled &&
        !element.readOnly &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

function setNativeValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor && descriptor.set) {
        descriptor.set.call(element, value);
    } else {
        element.value = value;
    }
}

function fillElement(element, value) {
    if (!isWritableInput(element)) return false;

    if (element.tagName === "SELECT") {
        element.value = String(value);
    } else {
        setNativeValue(element, String(value));
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
}

function clickElement(element) {
    element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
    }));
}

function waitForCondition(checkCondition, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const existingValue = checkCondition();
        if (existingValue) {
            resolve(existingValue);
            return;
        }

        const observer = new MutationObserver(() => {
            const value = checkCondition();
            if (value) {
                observer.disconnect();
                clearTimeout(timeoutId);
                resolve(value);
            }
        });

        const timeoutId = window.setTimeout(() => {
            observer.disconnect();
            reject(new Error("Timed out waiting for page update"));
        }, timeoutMs);

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true
        });
    });
}

function waitForElement(selector, timeoutMs = 30000) {
    if (!selector) return Promise.resolve(null);
    return waitForCondition(() => document.querySelector(selector), timeoutMs);
}

function failCurrentRow(state, prn, error) {
    const failed = [
        ...state.failed,
        {
            prn: prn || "Missing PRN",
            reason: error.message
        }
    ];

    console.error("Automation failed for PRN:", prn || "Missing PRN", error);

    return updateState({
        index: state.index + 1,
        processed: state.processed + 1,
        failed,
        currentPRN: "",
        status: `Failed ${prn || "missing PRN"}; continuing...`
    });
}

/**
 * Configure the dropdown filters before processing PRNs.
 * Should happen only once.
 */
async function configureFilters() {
    updateState({ status: "Configuring filters..." });

    if (CONFIG.prStatusDropdown) {
        updateState({ status: "Selecting PR Status..." });
        const prStatus = await waitForElement(CONFIG.prStatusDropdown);
        if (prStatus) fillElement(prStatus, CONFIG.prStatusBlankOption);
    }

    if (CONFIG.purchasingDropdown) {
        updateState({ status: "Selecting Purchasing Type..." });
        const purchasing = await waitForElement(CONFIG.purchasingDropdown);
        if (purchasing) fillElement(purchasing, CONFIG.purchasingBlankOption);
    }

    if (CONFIG.requisitionDropdown) {
        updateState({ status: "Selecting Requisition Date..." });
        const requisition = await waitForElement(CONFIG.requisitionDropdown);
        if (requisition) fillElement(requisition, CONFIG.requisitionAllOption);
    }

    updateState({ filtersConfigured: true });
}

/**
 * Clears search box and searches for a specific PRN.
 */
async function searchPRN(prn) {
    updateState({ status: `Searching PRN ${prn}...` });

    if (CONFIG.searchClear) {
        const clearBtn = document.querySelector(CONFIG.searchClear);
        if (clearBtn) clickElement(clearBtn);
    }

    const searchInput = await waitForElement(CONFIG.searchInput);
    if (!searchInput) {
        throw new Error("Search input selector not found");
    }
    
    // Fallback if clear button is not present
    if (!CONFIG.searchClear) {
        fillElement(searchInput, "");
    }

    fillElement(searchInput, prn);

    if (CONFIG.searchButton) {
        const searchBtn = await waitForElement(CONFIG.searchButton);
        if (searchBtn) clickElement(searchBtn);
    } else {
        searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    }
}

/**
 * Waits for the loading indicator to disappear and results to appear.
 */
async function waitForSearchResults() {
    await waitForCondition(() => {
        let isReady = true;

        if (CONFIG.loadingIndicator) {
            const loading = document.querySelector(CONFIG.loadingIndicator);
            if (loading) isReady = false;
        }

        if (isReady && CONFIG.firstRowCheckbox) {
            const checkbox = document.querySelector(CONFIG.firstRowCheckbox);
            if (!checkbox) isReady = false;
        }

        return isReady;
    });
}

/**
 * Ticks the checkbox in the first result row.
 */
async function tickFirstRow() {
    updateState({ status: "Ticking checkbox..." });
    if (!CONFIG.firstRowCheckbox) return;

    const checkbox = await waitForElement(CONFIG.firstRowCheckbox);
    if (checkbox && !checkbox.checked) {
        clickElement(checkbox);
    }
}

/**
 * Main loop: Processes all PRNs from the state.
 */
async function processAllPRNs(rows) {
    if (automationLoopActive) {
        return;
    }

    automationLoopActive = true;

    try {
        let state = getState();

        if (state.isRunning && !state.filtersConfigured) {
            await configureFilters();
        }

        while (true) {
            state = getState();

            if (!state.isRunning) {
                break;
            }

            if (state.index >= state.rows.length) {
                let finalStatus = "All done";
                if (state.failed && state.failed.length > 0) {
                    const missedPRNs = state.failed.map(f => f.prn).join(", ");
                    finalStatus = `Done. Missed: ${missedPRNs}`;
                }

                updateState({
                    isRunning: false,
                    phase: "done",
                    currentPRN: "",
                    status: finalStatus
                });
                break;
            }

            const row = state.rows[state.index];
            const prn = row && row.PRN ? String(row.PRN).trim() : "";

            if (!prn) {
                failCurrentRow(state, "", new Error("PRN missing from Excel row"));
                continue;
            }

            try {
                updateState({
                    currentPRN: prn,
                    status: `Processing ${state.index + 1} of ${state.rows.length}...`
                });

                await searchPRN(prn);
                await waitForSearchResults();
                await tickFirstRow();

                updateState({
                    index: state.index + 1,
                    processed: state.processed + 1,
                    currentPRN: ""
                });
            } catch (error) {
                failCurrentRow(state, prn, error);
            }
        }
    } finally {
        automationLoopActive = false;
    }
}

function startAutomation(rows) {
    const state = {
        ...cloneDefaultState(),
        rows,
        isRunning: true,
        status: "Starting..."
    };

    saveState(state);
    processAllPRNs(rows);

    return getPageInfo();
}

function stopAutomation() {
    updateState({
        isRunning: false,
        status: "Stopped"
    });

    return getPageInfo();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "GET_PAGE_INFO" || request.action === "GET_AUTOMATION_STATUS") {
        sendResponse(getPageInfo());
        return false;
    }

    if (request.action === "START_AUTOMATION") {
        sendResponse(startAutomation(request.rows || []));
        return false;
    }

    if (request.action === "STOP_AUTOMATION") {
        sendResponse(stopAutomation());
        return false;
    }

    return false;
});

// Auto-resume if extension was reloaded or page refreshed while running
if (getState().isRunning) {
    processAllPRNs(getState().rows);
}
