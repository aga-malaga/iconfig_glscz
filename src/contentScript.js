import "./contentScript.css";
import { orderNumberList } from "./ordersFunction";
import {
  addLabelToBackground,
  clearPdfLabelsInBackground,
  downloadMergedPdfFromBackground,
} from "./pdfService.js";

import { convertHomeToCompanyButton } from "./orderEditView.js";
const PATHNAME = window.location.pathname;

const DEFAULT_BACKEND_BASE_URL = "http://localhost:8080";
const GLS_CZ_SHIPMENTS_PATH = "/api/glscz/shipments";
const GLS_CZ_CARRIER_PROVIDER_ID = 6;

const labelsMedia = new Map();

if (
  PATHNAME.startsWith("/order/order/status/") ||
  PATHNAME.startsWith("/order/order/detail/")
) {
  init();
}

if (PATHNAME.startsWith("/order/order/edit/")) {
  convertHomeToCompanyButton();
}

let apiData = false;
let labelComment = null;
let senderAccounts = [];
let printerId = false;
let backendBaseUrl = DEFAULT_BACKEND_BASE_URL;
let backendApiKey = "";
let userUuid = "";

async function init() {
  try {
    const result = await chrome.storage.local.get([
      "apiData",
      "settings",
      "accounts",
    ]);
    apiData = result.apiData || false;
    printerId = result?.settings?.printerId || false;
    labelComment = result?.settings?.labelComment || "orderNumber";
    backendBaseUrl = normalizeBackendBaseUrl(result?.settings?.backendBaseUrl);
    backendApiKey = result?.settings?.apiKey || "";
    userUuid = result?.settings?.userUuid || "";
    senderAccounts = result.accounts || [];
    createGlsButton();
  } catch (error) {
    console.error("Błąd pobierania ustawień:", error);
  }
}

const createGlsButton = () => {
  const glsButton = document.createElement("button");
  glsButton.id = "parcelForcePackagesICG";
  glsButton.type = "button";
  glsButton.className = "btn btn-primary";
  glsButton.ariaExpanded = "false";
  glsButton.textContent = "GLS CZ";

  const modal = createModal();
  appendElementsToDOM(glsButton, modal);
  populateSenderAccounts(modal);

  glsButton.addEventListener("click", (event) => {
    clearPdfLabelsInBackground();
    handleGlsButtonClick(event, modal);
  });

  setupModalCloseActions(modal);
  setupAddParcelAction(modal);
  setupFormSubmission(modal);
  setupDownloadLabelsAction(modal);
};

const createModal = () => {
  const modal = document.createElement("div");
  modal.className = "custom-modal-overlay";
  modal.style.display = "none";
  modal.innerHTML = `
    <div class="custom-modal">
      <div class="modal-header">
        <h4 class="modal-title">GLS CZ - Utwórz przesyłkę</h4>
        <button class="close-modal">&times;</button>
      </div>
      <div class="modal-body">
        <form id="gls-form">
          <div class="form-group-icg">
            <div class="mb-3">
              <label for="senderAccountGls">Konto wysyłki</label>
              <select id="senderAccountGls" class="form-control">
                <option value="">-- Wybierz --</option>
              </select>
            </div>
            <div class="mb-3">
              <label for="printType">Wydruk</label>
              <select id="printType" class="form-control">
                <option value="allLabels">Drukuj etykietę</option>
                <option value="false" selected>Bez wydruku</option>
              </select>
            </div>
          </div>

          <div class="mb-3 hidden" id="glsCommentContainer">
              <label for="glsLabelComment">Komentarz na etykiecie</label>
              <input type="text" id="glsParcelComment" class="form-control"></input>
          </div>

          <div class="form-group" id="parcel-group">
            <label for="parcelCount">Liczba paczek</label>
            <input type="number" id="parcelCount" class="form-control" min="1" max="99" value="1">
          </div>

          <div class="form-group-icg">
            <button type="button" class="btn btn-default close-modal">Anuluj</button>
            <button type="button" id="download-gls-labels" class="btn btn-info">
              Pobierz PDF
            </button>
            <button type="submit" class="btn btn-success">Wyślij</button>
          </div>
        </form>

        <div id="progressContainer" class="progress">
          <div id="progressBar" class="progress-bar" role="progressbar" 
               style="width: 0%;" aria-valuemin="0" aria-valuemax="100">
            0%
          </div>
        </div>

        <div id="resultTableContainer" class="result-table-container"></div>
      </div>
    </div>
  `;
  return modal;
};

const appendElementsToDOM = (button, modal) => {
  if (window.location.pathname.startsWith("/order/order/detail/")) {
    const baseElement = document.querySelector(".btn-group.mr-md-5");
    if (baseElement?.parentElement) {
      baseElement.parentElement.prepend(button);
    }
  } else {
    button.style.marginLeft = "20px";
    button.style.marginBottom = "-8px";

    const baseElement = document.querySelector("#rt_save");
    if (baseElement?.parentElement) {
      baseElement.parentElement.appendChild(button);
    }
  }

  document.body.appendChild(modal);
};

const populateSenderAccounts = (modal) => {
  const select = modal.querySelector("#senderAccountGls");
  senderAccounts.forEach((account, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = account.name || `Nadawca ${index + 1}`;
    select.appendChild(option);
  });
};

const handleGlsButtonClick = (event, modal) => {
  event.preventDefault();
  if (!apiData) {
    alert("Połącz API Apilo");
    return;
  }

  if (!backendApiKey || !userUuid) {
    alert("Uzupełnij Backend GLS CZ, X-API-KEY i User UUID w ustawieniach.");
    return;
  }

  if (!senderAccounts.length) {
    alert("Dodaj nadawcę GLS CZ w ustawieniach.");
    return;
  }

  const orders = orderNumberList();
  if (!orders?.length) {
    alert("Zaznacz zamówienia na liście");
    return;
  }

  labelsMedia.clear();
  orders.forEach((code) => labelsMedia.set(code, null));

  resetFormState(modal);

  const parcelGroup = modal.querySelector("#parcel-group");

  if (orders.length > 1 && parcelGroup) {
    parcelGroup.style.display = "none";
  } else if (parcelGroup) {
    parcelGroup.style.display = "block";
    loadSingleFormOrderData(orders[0]);
  }

  modal.style.display = "flex";
};

const setupModalCloseActions = (modal) => {
  modal.querySelectorAll(".close-modal").forEach((btn) => {
    btn.addEventListener("click", () => (modal.style.display = "none"));
  });
};

const setupAddParcelAction = (modal) => {
  const addParcelButton = modal.querySelector("#add-parcel");
  if (addParcelButton) {
    addParcelButton.addEventListener("click", () => addParcel(modal));
  }
};

const setupDownloadLabelsAction = (modal) => {
  const downloadButton = modal.querySelector("#download-gls-labels");
  if (!downloadButton) {
    console.warn("GLS modal: download button not found.");
    return;
  }

  downloadButton.addEventListener("click", async () => {
    const originalTextContent = downloadButton.textContent;
    const originalDisabledState = downloadButton.disabled;

    downloadButton.disabled = true;
    downloadButton.textContent = "Przygotowywanie PDF...";

    try {
      const response = await downloadMergedPdfFromBackground({
        filename: "gls-etykiety.pdf",
        clearAfterDownload: false,
      });

      if (!response || response.ok === false) {
        console.error("GLS merge/download PDF error:", response?.error);
        alert("Nie udało się pobrać etykiet. Spróbuj ponownie.");
        return;
      }
    } catch (error) {
      console.error("GLS merge/download PDF exception:", error);
      alert("Wystąpił błąd podczas pobierania etykiet.");
    } finally {
      downloadButton.disabled = originalDisabledState;
      downloadButton.textContent = originalTextContent;
    }
  });
};

const addParcel = (modal) => {
  const parcelList = modal.querySelector("#parcel-list");
  if (!parcelList) {
    return;
  }
  const parcelDiv = document.createElement("div");
  parcelDiv.className = "parcel-item";
  parcelDiv.innerHTML = `
    <input type="number" class="form-control parcel-weight" step="0.01" min="0.01" placeholder="Waga (kg)">
    <button type="button" class="remove-parcel btn btn-danger">X</button>
  `;

  parcelList.appendChild(parcelDiv);

  parcelDiv
    .querySelector(".remove-parcel")
    .addEventListener("click", () => parcelDiv.remove());
};

const setupFormSubmission = (modal) => {
  const glsForm = modal.querySelector("#gls-form");
  glsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = glsForm.querySelector("button[type='submit']");
    setButtonState(submitButton, "Tworzenie...", "btn btn-warning", true);

    const orders = orderNumberList();
    const parcelCountInput = glsForm.querySelector("#parcelCount");
    const parcelCount = Number(parcelCountInput.value);

    if (!Number.isInteger(parcelCount) || parcelCount < 1 || parcelCount > 99) {
      alert("Podaj liczbę paczek od 1 do 99.");
      restoreSubmitButton(submitButton);
      return;
    }

    const senderAccountSelect = glsForm.querySelector("#senderAccountGls");
    if (!senderAccountSelect.value) {
      alert("Wybierz konto nadawcy!");
      restoreSubmitButton(submitButton);
      return;
    }

    const selectedSender = senderAccounts[senderAccountSelect.selectedIndex - 1];
    try {
      checkRequiredFields(senderToPickupAddress(selectedSender), [
        "name",
        "street",
        "city",
        "zipCode",
        "countryIsoCode",
      ]);
    } catch (error) {
      alert("Uzupełnij dane nadawcy GLS CZ w ustawieniach.");
      restoreSubmitButton(submitButton);
      return;
    }

    const printType = glsForm.querySelector("#printType").value;
    const requiredRecipientFields = [
      "name",
      "street",
      "city",
      "zipCode",
      "countryIsoCode",
    ];

    const orderResults = [];
    let processedOrders = 0;
    const progressBar = modal.querySelector("#progressBar");

    for (const orderId of orders) {
      const orderStatus = { orderId, statuses: [] };
      try {
        const recipient = await extractRecipientDetails(
          orderId,
          requiredRecipientFields
        );

        const payload = buildGlsCzShipmentPayload(
          recipient,
          selectedSender,
          parcelCount
        );

        try {
          const response = await fetch(glsCzShipmentsUrl(), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-KEY": backendApiKey,
            },
            body: JSON.stringify(payload),
          });
          if (!response.ok) {
            const errorStatus = await handleErrorResponse(
              response,
              recipient.orderNo
            );
            orderStatus.statuses.push({
              service: "shipment",
              status: errorStatus,
            });
            continue;
          }
          const labelResponse = await response.json();
          const glsCzError = glsCzResponseError(labelResponse);
          if (glsCzError) {
            orderStatus.statuses.push({
              service: "shipment",
              status: glsCzError,
            });
            continue;
          }

          await uploadLabel(labelResponse, recipient.orderNo, printType);

          orderStatus.statuses.push({ service: "shipment", status: "OK" });
        } catch (error) {
          orderStatus.statuses.push({
            service: "shipment",
            status: `Error: ${error.message}`,
          });
        }
      } catch (error) {
        orderStatus.statuses.push({ service: "error", status: error.message });
      }

      await wait(500);

      afterSingleOrder(
        orderStatus,
        orderResults,
        ++processedOrders,
        orders.length,
        progressBar
      );
    }

    if (
      orderResults.every((order) =>
        order.statuses.every((item) => item.status === "OK")
      )
    ) {
      console.log("Wszystkie zamówienia zostały przetworzone poprawnie!");
    }
    finalizeProcessing(modal, submitButton);
  });
};

const afterSingleOrder = (
  orderStatus,
  orderResults,
  processed,
  total,
  progressBar
) => {
  orderResults.push(orderStatus);
  updateProgressBar(progressBar, processed, total);
  displayResultsTable(orderResults);
};

const setButtonState = (button, text, className, disabled) => {
  button.textContent = text;
  button.className = className;
  button.style.pointerEvents = disabled ? "none" : "";
};

const restoreSubmitButton = (submitButton) =>
  setButtonState(submitButton, "Wyślij", "btn btn-success", false);

const updateProgressBar = (bar, completed, total) => {
  const percentage = Math.round((completed / total) * 100);
  bar.style.width = `${percentage}%`;
  bar.textContent = `${completed} / ${total}`;
};

const handleErrorResponse = async (response, orderNo) => {
  let errorMessage = `Wystąpił błąd podczas wysyłania zamówienia ${orderNo}.`;
  let errorResponse = null;
  try {
    errorResponse = await response.json();
  } catch (error) {
    return `${errorMessage} Status: ${response.status}`;
  }

  if (errorResponse.errors?.length) {
    const { code, value } = errorResponse.errors[0];
    const searchString = "Response body:";
    const index = typeof code === "string" ? code.indexOf(searchString) : -1;
    errorMessage =
      index !== -1
        ? `Zamówienie ${orderNo}: Error details: ${code
            .substring(index + searchString.length)
            .trim()}`
        : `Zamówienie ${orderNo}: Error: ${value}`;
  }
  return errorMessage;
};

const resetFormState = (modal) => {
  const glsForm = modal.querySelector("#gls-form");
  glsForm.reset();
  const parcelCountInput = modal.querySelector("#parcelCount");
  if (parcelCountInput) {
    parcelCountInput.value = "1";
  }
  modal.querySelector("#resultTableContainer").innerHTML = "";
  const progressBar = modal.querySelector("#progressBar");
  progressBar.style.width = "0%";
  progressBar.textContent = "0%";
};

const finalizeProcessing = (modal, submitButton) => {
  restoreSubmitButton(submitButton);
};

const fetchOrderData = async (orderId) => {
  const orderData = await getApiData(`orders/${orderId}`);
  if (!orderData)
    throw new Error(`Brak danych z API dla zamówienia: ${orderId}.`);
  return orderData;
};

const parseRecipientData = (orderData, orderId) => {
  const noteElement = document.querySelector("#glsParcelComment");
  const note = noteElement?.value || prepareComment(orderData);
  const codAmount = cashOnDeliveryAmount(orderData);

  const {
    name,
    companyName,
    email,
    streetName,
    streetNumber,
    phone,
    city,
    zipCode,
    country,
  } = orderData.addressDelivery;

  const deliveryName = companyName || name;
  return {
    name: deliveryName,
    contactName: name,
    contactPhone: phone || null,
    contactEmail: email || null,
    street: streetName,
    houseNumber: streetNumber || null,
    city,
    zipCode,
    countryIsoCode: normalizeCountryIsoCode(country),
    content: note || orderId,
    orderNo: orderId,
    clientReference: orderData.idExternal || String(orderId),
    codAmount,
    codReference: codAmount ? orderData.idExternal || String(orderId) : null,
    codCurrency: codAmount ? orderData.originalCurrency || "CZK" : null,
  };
};

const extractRecipientDetails = async (
  orderId,
  requiredFields
) => {
  const orderData = await fetchOrderData(orderId);
  const recipient = parseRecipientData(orderData, orderId);

  checkRequiredFields(recipient, requiredFields);
  return recipient;
};

const checkRequiredFields = (recipient, requiredFields) => {
  const missingFields = requiredFields.filter((field) => !recipient[field]);
  if (missingFields.length) {
    throw new Error(
      `Brak wymaganych pól [${missingFields.join(", ")}] dla odbiorcy ${
        recipient.name1 || "?"
      }.`
    );
  }
};

function buildGlsCzShipmentPayload(recipient, selectedSender, parcelCount) {
  return {
    userUuid,
    clientReference: limitText(recipient.clientReference, 40),
    count: parcelCount,
    content: limitText(recipient.content, 255),
    codAmount: recipient.codAmount,
    codReference: limitText(recipient.codReference, 40),
    codCurrency: recipient.codCurrency,
    pickupAddress: senderToPickupAddress(selectedSender),
    deliveryAddress: recipientToDeliveryAddress(recipient),
    serviceList: [],
  };
}

function senderToPickupAddress(sender) {
  return {
    name: limitText(sender?.name, 40),
    street: limitText(sender?.street, 40),
    houseNumber: limitText(sender?.houseNumber, 10),
    houseNumberInfo: limitText(sender?.houseNumberInfo, 10),
    city: limitText(sender?.city, 40),
    zipCode: limitText(sender?.zipCode, 10),
    countryIsoCode: normalizeCountryIsoCode(sender?.countryIsoCode || "CZ"),
    contactName: limitText(sender?.contactName, 40),
    contactPhone: limitText(sender?.contactPhone, 35),
    contactEmail: limitText(sender?.contactEmail, 80),
  };
}

function recipientToDeliveryAddress(recipient) {
  return {
    name: limitText(recipient.name, 40),
    street: limitText(recipient.street, 40),
    houseNumber: limitText(recipient.houseNumber, 10),
    city: limitText(recipient.city, 40),
    zipCode: limitText(recipient.zipCode, 10),
    countryIsoCode: recipient.countryIsoCode,
    contactName: limitText(recipient.contactName, 40),
    contactPhone: limitText(recipient.contactPhone, 35),
    contactEmail: limitText(recipient.contactEmail, 80),
  };
}

function cashOnDeliveryAmount(orderData) {
  if (orderData.paymentType !== 2) {
    return null;
  }

  const total = Number(orderData.originalAmountTotalWithTax || 0);
  const paid = Number(orderData.originalAmountTotalPaid || 0);
  const amount = Math.round((total - paid) * 100) / 100;
  return amount > 0 ? amount : null;
}

function glsCzShipmentsUrl() {
  return `${backendBaseUrl}${GLS_CZ_SHIPMENTS_PATH}`;
}

function normalizeBackendBaseUrl(value) {
  const baseUrl = value || DEFAULT_BACKEND_BASE_URL;
  return baseUrl.replace(/\/+$/, "");
}

function normalizeCountryIsoCode(country) {
  return String(country || "CZ").trim().slice(0, 2).toUpperCase();
}

function limitText(value, maxLength) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  return text.slice(0, maxLength);
}

function glsCzResponseError(response) {
  const errors =
    response?.PrintLabelsErrorList || response?.printLabelsErrorList || [];
  if (!Array.isArray(errors) || errors.length === 0) {
    return null;
  }

  const firstError = errors[0];
  return (
    firstError.ErrorDescription ||
    firstError.errorDescription ||
    "GLS CZ zwrócił błąd tworzenia etykiety."
  );
}

const displayResultsTable = (orderResults) => {
  const tableHtml = `
    <table border="1" cellspacing="0" cellpadding="5" class="table table-striped">
      <thead>
        <tr>
          <th>Order ID</th>
          <th>Service</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${orderResults
          .map((order) =>
            order.statuses
              .map(
                (status, index) => `
            <tr>
              ${
                index === 0
                  ? `<td rowspan="${order.statuses.length}">
                  <a target="_blank" href="${window.location.origin}/order/order/detail/${order.orderId}/">${order.orderId}</a>
                  <br>
                  <a target="_blank" href="${window.location.origin}/order/order/edit/${order.orderId}/">Edytuj</a>
                  </td>`
                  : ""
              }
              <td>${status.service}</td>
              <td>${status.status}</td>
            </tr>
          `
              )
              .join("")
          )
          .join("")}
      </tbody>
    </table>
  `;
  document.getElementById("resultTableContainer").innerHTML = tableHtml;
};

async function uploadLabel(response, orderId, printType) {
  const labelData = response?.Labels || response?.labels;
  const parcelInfos =
    response?.PrintLabelsInfoList || response?.printLabelsInfoList || [];
  const firstParcel = parcelInfos[0] || {};
  const filename = String(firstParcel.ParcelNumber || orderId);

  if (!labelData) {
    console.error("Unexpected response structure:", response);
    return;
  }

  const uploadEndpoint = `${window.location.origin}/rest/api/media/`;

  try {
    await addLabelToBackground(labelData, {
      orderId,
      filename,
      isShopReturn: false,
    });
  } catch (error) {
    console.warn("Could not store label in background PDF service:", error);
  }

  const pdfBlob = base64ToBlob(labelData, "application/pdf");

  try {
    const uploadResponse = await fetch(uploadEndpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/pdf",
        "Content-Disposition": `filename=${filename}`,
        Authorization: `Bearer ${apiData.accessToken}`,
      },
      body: pdfBlob,
    });

    if (!uploadResponse.ok) {
      console.error(
        "Failed to upload PDF label:",
        uploadResponse.status,
        uploadResponse.statusText
      );
      return;
    }

    const uploadData = await uploadResponse.json();
    await wait(500);
    const mediaUuid = uploadData.uuid;

    if (!mediaUuid) {
      console.error("Media UUID not found in response for GLS CZ label.");
      return;
    }

    processPrint(mediaUuid, printType);

    const shipmentNumbers = parcelInfos.length
      ? parcelInfos.map((parcelInfo) => parcelInfo.ParcelNumber)
      : [filename];

    for (const shipmentNumber of shipmentNumbers) {
      const shipmentEndpoint = `${window.location.origin}/rest/api/orders/${orderId}/shipment/`;
      const tracking = String(shipmentNumber);

      const payload = {
        idExternal: tracking,
        tracking,
        carrierProviderId: GLS_CZ_CARRIER_PROVIDER_ID,
        media: mediaUuid,
      };

      const shipmentResponse = await fetch(shipmentEndpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiData.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!shipmentResponse.ok) {
        console.error(
          "Failed to create shipment for GLS CZ label:",
          shipmentResponse.status,
          shipmentResponse.statusText
        );
      }
    }
  } catch (error) {
    console.error("Error occurred during GLS CZ label processing:", error);
  }
}

function base64ToBlob(base64, mimeType) {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

async function getApiData(href) {
  let api_access_token = await checkApiToken();
  if (!api_access_token) {
    alert("Błąd komunikacji z Api Apilo");
    return false;
  }
  try {
    const response = await fetch(`${window.location.origin}/rest/api/${href}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiData.accessToken}`,
      },
    });
    if (!response.ok) {
      throw new Error("Network response unsuccessful");
    }
    return await response.json();
  } catch (error) {
    console.error("Error API connection:", error.message);
    throw error;
  }
}

////////////////////////////////
///////// API TOKEN ////////////
////////////////////////////////

async function checkApiToken() {
  if (Date.now() >= apiData.accessTokenExpire) {
    try {
      const apiResponse = await getNewTokens();
      if (apiResponse && apiResponse.accessToken) {
        const result = await syncNewApiData(apiResponse);
        if (result) return true;
      } else {
        return false;
      }
    } catch (error) {
      alert("Błąd pobierania nowego tokenu API Apilo");
      return false;
    }
  } else return true;
}

async function getNewTokens() {
  const refreshToken = apiData.refreshToken ?? null;
  const userID = apiData.id ?? null;
  const userSecret = apiData.secret ?? null;

  const tokenUrl = `${window.location.origin}/rest/auth/token/`;

  const authBasicToken = btoa(`${userID}:${userSecret}`);

  try {
    const postData = {
      grantType: "refresh_token",
      token: refreshToken,
    };

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Basic ${authBasicToken}`,
      },
      body: JSON.stringify(postData),
    });

    if (!response.ok) {
      throw new Error(`Error! Status: ${response.message}`);
    }
    return await response.json();
  } catch (error) {
    return null;
  }
}

function syncNewApiData(apiResponse) {
  return new Promise((resolve) => {
    apiData.accessToken = apiResponse["accessToken"];
    apiData.refreshToken = apiResponse["refreshToken"];
    apiData.accessTokenExpire = Date.parse(apiResponse["accessTokenExpireAt"]);

    chrome.storage.local.set({ apiData }, () => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

function processPrint(media, printType) {
  if (!printerId || printerId.length < 4) return;
  if (printType === "allLabels") {
    print(media);
  } else {
    return;
  }

  function print(media) {
    fetch(
      `${window.location.origin}/frontend/tmp/download/${media}/2/?printer=${printerId}&type=1`
    );
  }
}

async function processUpdateItems(order) {
  if (!order || !Array.isArray(order.orderItems)) {
    throw new Error("Invalid order object or orderItems array.");
  }

  const type1Items = order.orderItems.filter((item) => item.type === 1);
  const updatedItems = [];

  for (let index = 0; index < type1Items.length; index++) {
    const item = type1Items[index];

    if (!item.productId) {
      throw new Error(
        `Produkt ${item.originalName} nie jest połączony z magazynem.`
      );
    }

    const updatedItem = await updateItemObjectByModalFetch(item);
    updatedItems.push(updatedItem);
  }
  return updatedItems;
}

function totalWeight(items) {
  const totalWeight = items.reduce((total, item) => {
    if (!item.weight || typeof item.weight !== "number") {
      throw new Error(
        `Produkt <a target="_blank" href="${window.location.origin}/warehouse/product/edit/${item.productId}/">${item.originalName}</a> nie ma ustalonej wagi.`
      );
    }

    return total + item.weight * item.quantity;
  }, 0);

  return Math.round(totalWeight * 10) / 10;
}

async function updateItemObjectByModalFetch(item) {
  try {
    const url = `${window.location.origin}/warehouse/product/detail-modal/${item.productId}/`;
    const modalContent = await fetchData(url, "modal");

    if (!modalContent) {
      throw new Error(
        "Apilo Booster: fetchProductDetailsFromModal => error fetching modalContent."
      );
    }

    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = modalContent.trim();
    const urlElement = tempDiv.querySelector(
      ".flexbox-item.text-center.img-thumbnail.col-12 a"
    );

    if (urlElement && urlElement.href) {
      item.warehousePicture = urlElement.href || null;
    }

    const infoRows = tempDiv.querySelectorAll(".row.static-info");

    infoRows.forEach((row) => {
      const firstChild = row.firstElementChild;
      const lastChild = row.lastElementChild;

      if (firstChild && lastChild) {
        const label = firstChild.textContent.trim().toLowerCase();
        const value = lastChild.textContent.trim();

        switch (label) {
          case "waga:": {
            const weight = parseFloat(value.replace(",", ".")) || null;
            item.weight = weight;
            break;
          }
        }
      }
    });
    return item;
  } catch (error) {
    console.warn(
      `Apilo booster: error inside fetchProductDetailsFromModal for product ID ${item.productId}, ${error}`
    );
    return item;
  }
}

async function fetchData(fullHref, object) {
  try {
    const response = await fetch(fullHref);
    const data = await response.json();
    return data.content[object];
  } catch (error) {
    console.error(
      "Błąd podczas pobierania treści strony:",
      fullHref,
      object,
      error
    );
    return null;
  }
}

async function loadSingleFormOrderData(orderId) {
  if (!orderId) return false;
  let orderDetails = null;

  try {
    orderDetails = await fetchOrderData(orderId);
  } catch (error) {
    alert("Błąd pobierania danych zamówienia z API");
    return false;
  }

  const resultContainer = document.getElementById("resultTableContainer");
  resultContainer.innerHTML = "";

  try {
    const commentContainer = document.getElementById("glsCommentContainer");
    if (commentContainer) {
      commentContainer.querySelector("#glsParcelComment").value =
        prepareComment(orderDetails);

      commentContainer.classList.remove("hidden");
    }
  } catch (error) {
    console.log("error", error);
  }
}

function prepareComment(orderDetails) {
  if (!labelComment || labelComment === "orderNumber") {
    return orderDetails?.id ?? "";
  }

  if (!orderDetails || !Array.isArray(orderDetails.orderItems)) return "";

  const items = orderDetails.orderItems.filter((item) => item.type === 1);

  switch (labelComment) {
    case "quantityAndSku":
      return items
        .map(({ quantity = 0, sku }) => `${quantity}x ${sku ?? "???"}`)
        .join("; ");

    case "skuOnly":
      return items.map(({ sku }) => sku ?? "???").join("; ");

    default:
      return "";
  }
}

function createItemWeightTable(data) {
  const table = document.createElement("table");
  table.classList.add("table", "table-bordered", "mt-3");

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>Nazwa produktu</th>
      <th>Waga (kg)</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  data.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.originalName}</td>
      <td>${
        item.weight !== null && item.weight !== undefined ? item.weight : "Brak"
      }</td>
    `;
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  return table;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
