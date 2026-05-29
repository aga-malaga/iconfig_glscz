import { PDFDocument } from "pdf-lib";

const PdfServiceMessageType = {
  ADD_LABEL: "PDF_SERVICE_ADD_LABEL",
  CLEAR_LABELS: "PDF_SERVICE_CLEAR_LABELS",
  MERGE_AND_DOWNLOAD: "PDF_SERVICE_MERGE_AND_DOWNLOAD",
};

const OptionsMessageType = {
  OPEN_OPTIONS: "OPEN_OPTIONS",
};

const PDF_SESSION_KEY = "pdfServiceState";
const DEFAULT_MERGED_FILENAME_PREFIX = "gls-etykiety";

async function loadPdfServiceState() {
  const result = await chrome.storage.session.get(PDF_SESSION_KEY);
  const stored = result[PDF_SESSION_KEY];

  if (stored && Array.isArray(stored.pendingLabelEntries)) {
    return stored;
  }

  return {
    pendingLabelEntries: [],
  };
}

async function savePdfServiceState(state) {
  await chrome.storage.session.set({
    [PDF_SESSION_KEY]: state,
  });
}

async function addLabelBase64ToSession(params) {
  const {
    labelBase64,
    orderId = null,
    filename = null,
    isShopReturn = false,
  } = params || {};

  if (typeof labelBase64 !== "string" || !labelBase64.trim()) {
    console.warn(
      "pdfServiceBackground: Received invalid labelBase64, skipping."
    );
    return 0;
  }

  const state = await loadPdfServiceState();

  state.pendingLabelEntries.push({
    labelBase64,
    orderId,
    filename,
    isShopReturn: Boolean(isShopReturn),
    createdAt: Date.now(),
  });

  await savePdfServiceState(state);

  return state.pendingLabelEntries.length;
}

async function clearAllLabelsInSession() {
  await chrome.storage.session.remove(PDF_SESSION_KEY);
}

async function getAllLabelEntriesFromSession() {
  const state = await loadPdfServiceState();
  return Array.isArray(state.pendingLabelEntries)
    ? state.pendingLabelEntries
    : [];
}

function base64ToUint8Array(base64) {
  const cleanedBase64 = base64.trim();
  const binaryString = atob(cleanedBase64);
  const length = binaryString.length;
  const bytes = new Uint8Array(length);

  for (let index = 0; index < length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }

  return bytes;
}

function uint8ArrayToBase64(bytes) {
  let binaryString = "";
  const length = bytes.byteLength;

  for (let index = 0; index < length; index += 1) {
    binaryString += String.fromCharCode(bytes[index]);
  }

  return btoa(binaryString);
}

async function mergeLabelEntriesToSinglePdfBytes(labelEntries) {
  if (!Array.isArray(labelEntries) || labelEntries.length === 0) {
    throw new Error("Brak zapisanych etykiet PDF do połączenia.");
  }

  const mergedPdfDocument = await PDFDocument.create();

  for (const entry of labelEntries) {
    if (!entry || typeof entry.labelBase64 !== "string") {
      console.warn(
        "pdfServiceBackground: Pomijam nieprawidłowy entry etykiety."
      );
      continue;
    }

    try {
      const pdfBytes = base64ToUint8Array(entry.labelBase64);
      const sourceDocument = await PDFDocument.load(pdfBytes);
      const pageIndices = sourceDocument.getPageIndices();
      const copiedPages = await mergedPdfDocument.copyPages(
        sourceDocument,
        pageIndices
      );

      copiedPages.forEach((page) => mergedPdfDocument.addPage(page));
    } catch (error) {
      console.error(
        "pdfServiceBackground: Błąd podczas łączenia jednej etykiety:",
        error
      );
    }
  }

  const mergedBytes = await mergedPdfDocument.save();
  return mergedBytes;
}

function buildPdfDataUrlFromBytes(pdfBytes) {
  const base64 = uint8ArrayToBase64(pdfBytes);
  return `data:application/pdf;base64,${base64}`;
}

function buildDefaultMergedFilename() {
  const now = new Date();
  const isoDate = now.toISOString().split("T")[0]; // YYYY-MM-DD
  return `${DEFAULT_MERGED_FILENAME_PREFIX}-${isoDate}.pdf`;
}

function initiatePdfDownload(url, filename) {
  return new Promise((resolve, reject) => {
    try {
      chrome.downloads.download(
        {
          url,
          filename,
          saveAs: false,
        },
        (downloadId) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(lastError);
            return;
          }
          resolve(downloadId);
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

async function downloadMergedPdfFromSession(
  requestedFilename,
  clearAfterDownload
) {
  const labelEntries = await getAllLabelEntriesFromSession();

  if (!labelEntries.length) {
    throw new Error("Brak zapisanych etykiet PDF do połączenia.");
  }

  const mergedBytes = await mergeLabelEntriesToSinglePdfBytes(labelEntries);
  const dataUrl = buildPdfDataUrlFromBytes(mergedBytes);
  const filename =
    requestedFilename && requestedFilename.trim().length > 0
      ? requestedFilename.trim()
      : buildDefaultMergedFilename();

  const downloadId = await initiatePdfDownload(dataUrl, filename);

  if (clearAfterDownload) {
    await clearAllLabelsInSession();
  }

  return downloadId;
}

function handleAddLabelMessage(message, sendResponse) {
  addLabelBase64ToSession(message.payload || {})
    .then((totalCount) => {
      sendResponse({ ok: true, totalCount });
    })
    .catch((error) => {
      console.error("pdfServiceBackground: ADD_LABEL error:", error);
      sendResponse({ ok: false, error: String(error) });
    });
}

function handleClearLabelsMessage(sendResponse) {
  clearAllLabelsInSession()
    .then(() => {
      sendResponse({ ok: true });
    })
    .catch((error) => {
      console.error("pdfServiceBackground: CLEAR_LABELS error:", error);
      sendResponse({ ok: false, error: String(error) });
    });
}

function handleMergeAndDownloadMessage(message, sendResponse) {
  const payload = message.payload || {};
  const requestedFilename = payload.filename;
  const clearAfterDownload =
    typeof payload.clearAfterDownload === "boolean"
      ? payload.clearAfterDownload
      : false;

  downloadMergedPdfFromSession(requestedFilename, clearAfterDownload)
    .then((downloadId) => {
      sendResponse({ ok: true, downloadId });
    })
    .catch((error) => {
      console.error("pdfServiceBackground: MERGE_AND_DOWNLOAD error:", error);
      sendResponse({ ok: false, error: String(error) });
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === OptionsMessageType.OPEN_OPTIONS) {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return;
  }

  if (!message || typeof message.type !== "string") {
    return;
  }

  if (message.type === PdfServiceMessageType.ADD_LABEL) {
    handleAddLabelMessage(message, sendResponse);
    return true;
  }

  if (message.type === PdfServiceMessageType.CLEAR_LABELS) {
    handleClearLabelsMessage(sendResponse);
    return true;
  }

  if (message.type === PdfServiceMessageType.MERGE_AND_DOWNLOAD) {
    handleMergeAndDownloadMessage(message, sendResponse);
    return true;
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
