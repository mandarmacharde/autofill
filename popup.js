const websiteElement = document.getElementById("website");
const excelElement = document.getElementById("excel");
const excelFileElement = document.getElementById("excelFile");
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

function setText(element, text) {
    element.innerText = text;
}

function setButtonStates(isRunning) {
    startButtonElement.disabled = isRunning || excelRows.length === 0 || !activeTabId;
    stopButtonElement.disabled = !isRunning || !activeTabId;
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
        updateCounts(0, 0);
        setButtonStates(false);
        return;
    }

    try {
        updateStatus("Reading Excel...");
        excelRows = await readExcelFile(file);
        setText(excelElement, `${file.name} (${excelRows.length} rows)`);
        updateCounts(0, excelRows.length);
        updateStatus(excelRows.length > 0 ? READY_TEXT : "Excel has no rows");
        setButtonStates(false);
    } catch (error) {
        excelRows = [];
        setText(excelElement, "Could not read Excel");
        updateCounts(0, 0);
        updateStatus("Excel read failed");
        setButtonStates(false);
    }
}

async function loadAutomationStatus() {
    try {
        const state = await sendMessageToTab("GET_AUTOMATION_STATUS");
        const total = state.total || excelRows.length;

        setText(prnElement, state.currentPRN || NO_PRN_TEXT);
        updateCounts(state.processed || 0, total);
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

    try {
        updateStatus("Starting...");
        await sendMessageToTab("START_AUTOMATION", {
            rows: excelRows
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
    startButtonElement.addEventListener("click", startAutomation);
    stopButtonElement.addEventListener("click", stopAutomation);
    window.addEventListener("beforeunload", stopStatusPolling);
}

async function initPopup() {
    bindEvents();
    updateCounts(0, 0);
    await loadWebsite();
    startStatusPolling();
}

initPopup();
