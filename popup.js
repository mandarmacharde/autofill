const websiteElement = document.getElementById("website");
const excelElement = document.getElementById("excel");
const excelFileElement = document.getElementById("excelFile");
const modeAutoElement = document.getElementById("modeAuto");
const modeSingleElement = document.getElementById("modeSingle");
const prnSelectElement = document.getElementById("prnSelect");
const prnElement = document.getElementById("prn");
const processedElement = document.getElementById("processed");
const remainingElement = document.getElementById("remaining");
const statusElement = document.getElementById("status");
const progressBarElement = document.getElementById("progressBar");
const startButtonElement = document.getElementById("startBtn");
const stopButtonElement = document.getElementById("stopBtn");

const READY_TEXT = "Ready";
const LOADING_TEXT = "Loading...";
const UNSUPPORTED_PAGE_TEXT = "Unsupported Page";
const NO_EXCEL_TEXT = "Not Selected";
const NO_PRN_TEXT = "Not Found";

let excelRows = [];
let activeTabId = null;
let statusTimer = null;
let automationRunning = false;

function setText(element, text) {
    element.innerText = text;
}

function setButtonStates(isRunning) {
    automationRunning = isRunning;
    const selectedRows = getRowsForSelectedMode();

    startButtonElement.disabled = isRunning || selectedRows.length === 0 || !activeTabId;
    stopButtonElement.disabled = !isRunning || !activeTabId;
    modeAutoElement.disabled = isRunning;
    modeSingleElement.disabled = isRunning;
    prnSelectElement.disabled = isRunning || getSelectedMode() !== "single" || getRowsWithPRN().length === 0;
}

function getPRN(row) {
    return row && row.PRN ? String(row.PRN).trim() : "";
}

function getRowsWithPRN() {
    return excelRows.filter((row) => getPRN(row));
}

function getSelectedMode() {
    return modeSingleElement.checked ? "single" : "auto";
}

function getRowsForSelectedMode() {
    if (getSelectedMode() === "auto") {
        return excelRows;
    }

    const selectedPRN = prnSelectElement.value;

    if (!selectedPRN) {
        return [];
    }

    return excelRows.filter((row) => getPRN(row) === selectedPRN).slice(0, 1);
}

function updatePRNSelector() {
    const rowsWithPRN = getRowsWithPRN();

    prnSelectElement.innerHTML = "";

    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.innerText = "Select PRN";
    prnSelectElement.appendChild(placeholderOption);

    for (const row of rowsWithPRN) {
        const prn = getPRN(row);
        const option = document.createElement("option");

        option.value = prn;
        option.innerText = prn;
        prnSelectElement.appendChild(option);
    }

    prnSelectElement.disabled = automationRunning || getSelectedMode() !== "single" || rowsWithPRN.length === 0;
}

function updateModeUI() {
    prnSelectElement.disabled = automationRunning || getSelectedMode() !== "single" || getRowsWithPRN().length === 0;
    updateCounts(0, getRowsForSelectedMode().length);
    setButtonStates(automationRunning);
}

function updateProgress(processed, total) {
    const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
    progressBarElement.value = percent;
}

function updateCounts(processed, total) {
    setText(processedElement, String(processed));
    setText(remainingElement, String(Math.max(total - processed, 0)));
    updateProgress(processed, total);
}

function updatePageInfo(info) {
    setText(websiteElement, info.website || UNSUPPORTED_PAGE_TEXT);
    setText(prnElement, info.prn || NO_PRN_TEXT);
}

function updateStatus(status) {
    setText(statusElement, status || READY_TEXT);
}

function showUnsupportedPage() {
    activeTabId = null;
    setText(websiteElement, UNSUPPORTED_PAGE_TEXT);
    setText(prnElement, NO_PRN_TEXT);
    updateStatus(UNSUPPORTED_PAGE_TEXT);
    setButtonStates(false);
}

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    return tab;
}

function sendMessageToTab(action, payload = {}) {
    return new Promise((resolve, reject) => {
        if (!activeTabId) {
            reject(new Error(UNSUPPORTED_PAGE_TEXT));
            return;
        }

        chrome.tabs.sendMessage(
            activeTabId,
            {
                action,
                ...payload
            },
            (response) => {
                if (chrome.runtime.lastError || !response) {
                    reject(new Error(UNSUPPORTED_PAGE_TEXT));
                    return;
                }

                resolve(response);
            }
        );
    });
}

async function loadWebsite() {
    setText(websiteElement, LOADING_TEXT);
    updateStatus(LOADING_TEXT);

    try {
        const tab = await getActiveTab();
        activeTabId = tab && tab.id ? tab.id : null;
        const pageInfo = await sendMessageToTab("GET_PAGE_INFO");

        updatePageInfo(pageInfo);
        updateCounts(pageInfo.processed || 0, pageInfo.total || excelRows.length);
        updateStatus(pageInfo.status || READY_TEXT);
        setButtonStates(Boolean(pageInfo.isRunning));
    } catch (error) {
        showUnsupportedPage();
    }
}

function normalizeRows(rows) {
    return rows.filter((row) => row && Object.keys(row).length > 0);
}

async function readExcelFile(file) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, {
        type: "array"
    });
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = workbook.Sheets[firstSheetName];

    return normalizeRows(XLSX.utils.sheet_to_json(firstSheet, {
        defval: ""
    }));
}

async function handleExcelSelection(event) {
    const [file] = event.target.files;

    if (!file) {
        excelRows = [];
        setText(excelElement, NO_EXCEL_TEXT);
        updatePRNSelector();
        updateCounts(0, 0);
        setButtonStates(false);
        return;
    }

    try {
        updateStatus("Reading Excel...");
        excelRows = await readExcelFile(file);
        setText(excelElement, `${file.name} (${excelRows.length} rows)`);
        updatePRNSelector();
        updateCounts(0, getRowsForSelectedMode().length);
        updateStatus(excelRows.length > 0 ? READY_TEXT : "Excel has no rows");
        setButtonStates(false);
    } catch (error) {
        excelRows = [];
        setText(excelElement, "Could not read Excel");
        updatePRNSelector();
        updateCounts(0, 0);
        updateStatus("Excel read failed");
        setButtonStates(false);
    }
}

async function loadAutomationStatus() {
    try {
        const state = await sendMessageToTab("GET_AUTOMATION_STATUS");
        const selectedTotal = getRowsForSelectedMode().length;
        const stateTotal = state.total || 0;
        const shouldShowSavedRun = state.isRunning || (
            (state.status === "Done" || state.status === "Stopped") &&
            stateTotal === selectedTotal
        );
        const total = shouldShowSavedRun ? stateTotal : selectedTotal;
        const processed = shouldShowSavedRun ? state.processed || 0 : 0;

        setText(prnElement, state.currentPRN || NO_PRN_TEXT);
        updateCounts(processed, total);
        updateStatus(state.status || READY_TEXT);
        setButtonStates(Boolean(state.isRunning));
    } catch (error) {
        showUnsupportedPage();
    }
}

function startStatusPolling() {
    stopStatusPolling();
    statusTimer = setInterval(loadAutomationStatus, 1000);
}

function stopStatusPolling() {
    if (statusTimer) {
        clearInterval(statusTimer);
        statusTimer = null;
    }
}

async function startAutomation() {
    if (excelRows.length === 0) {
        updateStatus("Select Excel first");
        return;
    }

    const rowsToProcess = getRowsForSelectedMode();

    if (rowsToProcess.length === 0) {
        updateStatus("Select a PRN first");
        return;
    }

    try {
        updateStatus("Starting...");
        updateCounts(0, rowsToProcess.length);
        await sendMessageToTab("START_AUTOMATION", {
            rows: rowsToProcess
        });
        setButtonStates(true);
        startStatusPolling();
    } catch (error) {
        showUnsupportedPage();
    }
}

async function stopAutomation() {
    try {
        await sendMessageToTab("STOP_AUTOMATION");
        await loadAutomationStatus();
    } catch (error) {
        showUnsupportedPage();
    }
}

function bindEvents() {
    excelFileElement.addEventListener("change", handleExcelSelection);
    modeAutoElement.addEventListener("change", updateModeUI);
    modeSingleElement.addEventListener("change", updateModeUI);
    prnSelectElement.addEventListener("change", updateModeUI);
    startButtonElement.addEventListener("click", startAutomation);
    stopButtonElement.addEventListener("click", stopAutomation);
    window.addEventListener("beforeunload", stopStatusPolling);
}

async function initPopup() {
    bindEvents();
    updatePRNSelector();
    updateCounts(0, 0);
    await loadWebsite();
    startStatusPolling();
}

initPopup();
