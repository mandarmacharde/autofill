const CONFIG = {
    prnInput: "#prn",
    saveButton: "#save",
    nextButton: "#next",
    backButton: "",
    successMessage: ".success, .alert-success, [role='status']"
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
    status: "Ready"
};

let automationLoopActive = false;

function cloneDefaultState() {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function getState() {
    const storedState = window.sessionStorage.getItem(STORAGE_KEY);

    if (!storedState) {
        return cloneDefaultState();
    }

    try {
        return {
            ...cloneDefaultState(),
            ...JSON.parse(storedState)
        };
    } catch (error) {
        return cloneDefaultState();
    }
}

function saveState(state) {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function updateState(changes) {
    const state = {
        ...getState(),
        ...changes
    };

    saveState(state);
    return state;
}

function getCurrentRow(state) {
    return state.rows[state.index] || null;
}

function getCurrentPRN(row) {
    return row && row.PRN ? String(row.PRN).trim() : "";
}

function getPageInfo() {
    const state = getState();
    const prnInput = document.querySelector(CONFIG.prnInput);

    return {
        website: window.location.hostname,
        prn: state.currentPRN || (prnInput ? prnInput.value : ""),
        processed: state.processed,
        total: state.rows.length,
        remaining: Math.max(state.rows.length - state.processed, 0),
        status: state.status,
        isRunning: state.isRunning,
        failed: state.failed
    };
}

function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
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
    if (!isWritableInput(element)) {
        return false;
    }

    if (element.tagName === "SELECT") {
        element.value = String(value);
    } else {
        setNativeValue(element, String(value));
    }

    element.dispatchEvent(new Event("input", {
        bubbles: true
    }));
    element.dispatchEvent(new Event("change", {
        bubbles: true
    }));

    return true;
}

function findMatchingField(columnName) {
    const normalizedColumn = normalizeText(columnName);
    const fields = document.querySelectorAll("input, textarea, select");

    for (const field of fields) {
        if (!isWritableInput(field)) {
            continue;
        }

        const names = [
            field.name,
            field.id,
            field.placeholder
        ].map(normalizeText);

        if (names.includes(normalizedColumn)) {
            return field;
        }
    }

    return null;
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
    return waitForCondition(() => document.querySelector(selector), timeoutMs);
}

function waitForFormFields(row) {
    return waitForCondition(() => {
        if (document.querySelector(CONFIG.saveButton)) {
            return true;
        }

        return Object.keys(row).some((columnName) => columnName !== "PRN" && findMatchingField(columnName));
    });
}

function waitForSaveComplete(previousUrl, timeoutMs = 30000) {
    return waitForCondition(() => {
        const successElement = document.querySelector(CONFIG.successMessage);
        const urlChanged = window.location.href !== previousUrl;
        const prnInputReturned = document.querySelector(CONFIG.prnInput);

        return successElement || urlChanged || prnInputReturned;
    }, timeoutMs);
}

function clickElement(element) {
    element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
    }));
}

function submitPRN(input) {
    fillElement(input, input.value);

    if (CONFIG.nextButton) {
        const nextButton = document.querySelector(CONFIG.nextButton);

        if (nextButton && !nextButton.disabled) {
            clickElement(nextButton);
            return;
        }
    }

    input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true
    }));
    input.dispatchEvent(new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true
    }));
}

function fillMatchingFields(row) {
    let filledCount = 0;

    for (const [columnName, value] of Object.entries(row)) {
        if (columnName === "PRN") {
            continue;
        }

        const field = findMatchingField(columnName);

        if (field && fillElement(field, value)) {
            filledCount += 1;
        }
    }

    return filledCount;
}

function completeCurrentRow(state) {
    return updateState({
        index: state.index + 1,
        processed: state.processed + 1,
        phase: "enter_prn",
        currentPRN: "",
        status: "Returning to PRN page..."
    });
}

function failCurrentRow(state, prn, error) {
    const failed = [
        ...state.failed,
        {
            prn: prn || "Missing PRN",
            reason: error.message
        }
    ];

    console.error("FormBot failed for PRN:", prn || "Missing PRN", error);

    return updateState({
        index: state.index + 1,
        processed: state.processed + 1,
        failed,
        phase: "enter_prn",
        currentPRN: "",
        status: `Failed ${prn || "missing PRN"}; continuing...`
    });
}

async function handleEnterPRNPhase(state) {
    const row = getCurrentRow(state);

    if (!row) {
        updateState({
            isRunning: false,
            phase: "done",
            currentPRN: "",
            status: "Done"
        });
        return;
    }

    const prn = getCurrentPRN(row);

    if (!prn) {
        failCurrentRow(state, "", new Error("PRN missing from Excel row"));
        return;
    }

    updateState({
        currentPRN: prn,
        status: `Finding PRN box for ${prn}...`
    });

    const prnInput = await waitForElement(CONFIG.prnInput);
    fillElement(prnInput, prn);

    updateState({
        phase: "fill_form",
        currentPRN: prn,
        status: `Submitted PRN ${prn}; waiting for form...`
    });

    submitPRN(prnInput);
}

async function handleFillFormPhase(state) {
    const row = getCurrentRow(state);
    const prn = getCurrentPRN(row);

    updateState({
        currentPRN: prn,
        status: `Waiting for fields for ${prn}...`
    });

    await waitForFormFields(row);

    const filledCount = fillMatchingFields(row);
    const saveButton = await waitForElement(CONFIG.saveButton);

    updateState({
        phase: "return_prn",
        currentPRN: prn,
        status: `Filled ${filledCount} fields for ${prn}; saving...`
    });

    const previousUrl = window.location.href;
    clickElement(saveButton);
    await waitForSaveComplete(previousUrl);
}

async function handleReturnPRNPhase(state) {
    const completedState = completeCurrentRow(state);

    if (CONFIG.backButton) {
        const backButton = document.querySelector(CONFIG.backButton);

        if (backButton && !backButton.disabled) {
            clickElement(backButton);
        } else {
            window.history.back();
        }
    } else {
        window.history.back();
    }

    await waitForElement(CONFIG.prnInput);
    saveState(completedState);
}

async function runAutomation() {
    if (automationLoopActive) {
        return;
    }

    automationLoopActive = true;

    try {
        while (true) {
            const state = getState();

            if (!state.isRunning) {
                break;
            }

            if (state.index >= state.rows.length) {
                updateState({
                    isRunning: false,
                    phase: "done",
                    currentPRN: "",
                    status: "Done"
                });
                break;
            }

            try {
                if (state.phase === "enter_prn") {
                    await handleEnterPRNPhase(state);
                } else if (state.phase === "fill_form") {
                    await handleFillFormPhase(state);
                } else if (state.phase === "return_prn") {
                    await handleReturnPRNPhase(state);
                } else {
                    updateState({
                        phase: "enter_prn"
                    });
                }
            } catch (error) {
                const failedState = failCurrentRow(state, state.currentPRN || getCurrentPRN(getCurrentRow(state)), error);
                saveState(failedState);

                if (!document.querySelector(CONFIG.prnInput)) {
                    window.history.back();
                    await waitForElement(CONFIG.prnInput);
                }
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
        phase: "enter_prn",
        status: "Starting..."
    };

    saveState(state);
    runAutomation();

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

if (getState().isRunning) {
    runAutomation();
}
