const PdfServiceMessageType = {
  ADD_LABEL: "PDF_SERVICE_ADD_LABEL",
  CLEAR_LABELS: "PDF_SERVICE_CLEAR_LABELS",
  MERGE_AND_DOWNLOAD: "PDF_SERVICE_MERGE_AND_DOWNLOAD",
};

function sendPdfServiceMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(lastError);
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export async function addLabelToBackground(labelBase64, options = {}) {
  if (typeof labelBase64 !== "string" || !labelBase64.trim()) {
    console.warn("pdfServiceContent: Skipping invalid labelBase64.");
    return;
  }

  const message = {
    type: PdfServiceMessageType.ADD_LABEL,
    payload: {
      labelBase64,
      orderId: options.orderId ?? null,
      filename: options.filename ?? null,
      isShopReturn: options.isShopReturn ?? false,
    },
  };

  await sendPdfServiceMessage(message);
}

export async function clearPdfLabelsInBackground() {
  const message = {
    type: PdfServiceMessageType.CLEAR_LABELS,
  };

  await sendPdfServiceMessage(message);
}

export async function downloadMergedPdfFromBackground(options = {}) {
  const message = {
    type: PdfServiceMessageType.MERGE_AND_DOWNLOAD,
    payload: {
      filename: options.filename ?? null,
      clearAfterDownload: options.clearAfterDownload ?? false,
    },
  };

  return sendPdfServiceMessage(message);
}
