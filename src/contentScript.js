import "./contentScript.css";
import {orderNumberList} from "./ordersFunction";
import {addLabelToBackground, clearPdfLabelsInBackground, downloadMergedPdfFromBackground,} from "./pdfService.js";

import {convertHomeToCompanyButton} from "./orderEditView.js";

const PATHNAME = window.location.pathname;

const DEFAULT_BACKEND_BASE_URL = "http://localhost:8080";
const GLS_CZ_SHIPMENTS_PATH = "/api/glscz/shipments";
const GLS_CZ_CARRIER_PROVIDER_ID = 6;
const APILO_REQUEST_DELAY_MS = 900;
const APILO_MEDIA_READY_DELAY_MS = 3000;
const APILO_INVALID_MEDIA_RETRY_DELAY_MS = 3000;
const APILO_SHIPMENT_CREATE_ATTEMPTS = 6;
const GLS_CZ_SHIPMENT_TIMEOUT_MS = 60000;
const APILO_WRITE_TIMEOUT_MS = 30000;
const CASH_ON_DELIVERY_PAYMENT_TYPES = [2, 65];

const labelsMedia = new Map();
const orderDataCache = new Map();
let lastApiloRequestAt = 0;
let selectedOrderIds = [];
let selectedOrdersPreviewPromise = Promise.resolve();
let selectedOrdersPreviewToken = 0;

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectOptionsLink);
} else {
    injectOptionsLink();
}

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
let backendApiKey = "";
let userUuid = "";

async function init() {
    try {
        await refreshExtensionSettings();
        createGlsButton();
    } catch (error) {
        console.error("Błąd pobierania ustawień:", error);
    }
}

async function refreshExtensionSettings() {
    const result = await chrome.storage.local.get([
        "apiData",
        "settings",
        "accounts",
    ]);

    apiData = result.apiData || false;
    printerId = result?.settings?.printerId || false;
    labelComment = result?.settings?.labelComment || "orderNumber";
    backendApiKey = result?.settings?.apiKey || "";
    userUuid = result?.settings?.userUuid || "";
    senderAccounts = Array.isArray(result.accounts) ? result.accounts : [];
}

function injectOptionsLink() {
    const menuItemId = "gls-cz-options-item";
    const nav = document.querySelector("ul.kt-menu__nav");

    if (!nav || nav.querySelector(`#${menuItemId}`)) {
        return;
    }

    const item = document.createElement("li");
    item.id = menuItemId;
    item.className = "kt-menu__item";
    item.innerHTML =
        '<a href="#" class="kt-menu__link"><span class="kt-menu__link-icon"><i class="flaticon flaticon-settings-1"></i></span><span class="kt-menu__link-text">Integracja GLS CZ</span></a>';

    item.querySelector("a").addEventListener("click", (event) => {
        event.preventDefault();
        openOptionsPage();
    });

    nav.appendChild(item);
}

function openOptionsPage() {
    const runtime = globalThis.chrome?.runtime;

    if (!runtime) {
        alert("Nie można otworzyć ustawień. Odśwież stronę po załadowaniu rozszerzenia.");
        return;
    }

    if (typeof runtime.openOptionsPage === "function") {
        runtime.openOptionsPage();
        return;
    }

    runtime.sendMessage({type: "OPEN_OPTIONS"}, (response) => {
        if (runtime.lastError || !response?.ok) {
            alert("Nie udało się otworzyć ustawień GLS CZ.");
        }
    });
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
              <input type="text" id="glsParcelComment" class="form-control">
          </div>

          <div id="orderPreviewContainer" class="order-preview-container"></div>

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
               style="width: 0;" aria-valuemin="0" aria-valuemax="100">
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
    const selectedValue = select.value;
    select.textContent = "";

    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "-- Wybierz --";
    select.appendChild(emptyOption);

    senderAccounts.forEach((account, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = account.name || `Nadawca ${index + 1}`;
        select.appendChild(option);
    });

    if (selectedValue && Number(selectedValue) < senderAccounts.length) {
        select.value = selectedValue;
    }
};

const handleGlsButtonClick = async (event, modal) => {
    event.preventDefault();
    await refreshExtensionSettings();
    populateSenderAccounts(modal);

    if (!apiData) {
        alert("Połącz API Apilo");
        return;
    }

    if (!backendApiKey || !userUuid) {
        alert("Uzupełnij X-API-KEY i kod licencji w ustawieniach.");
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
    orderDataCache.clear();
    selectedOrderIds = orders;

    resetFormState(modal);
    const previewToken = ++selectedOrdersPreviewToken;
    selectedOrdersPreviewPromise = loadSelectedOrdersPreview(modal, orders, previewToken);

    const parcelGroup = modal.querySelector("#parcel-group");

    if (orders.length > 1 && parcelGroup) {
        parcelGroup.style.display = "none";
    } else if (parcelGroup) {
        parcelGroup.style.display = "block";
    }

    modal.style.display = "flex";
};

const setupModalCloseActions = (modal) => {
    modal.querySelectorAll(".close-modal").forEach((btn) => {
        btn.addEventListener("click", () => {
            modal.style.display = "none";
            selectedOrderIds = [];
            selectedOrdersPreviewPromise = Promise.resolve();
            selectedOrdersPreviewToken += 1;
            orderDataCache.clear();
        });
    });
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
                alert(
                    response?.error ||
                    "Nie udało się pobrać etykiet. Spróbuj ponownie."
                );

            }
        } catch (error) {
            console.error("GLS merge/download PDF exception:", error);
            alert(error?.message || "Wystąpił błąd podczas pobierania etykiet.");
        } finally {
            downloadButton.disabled = originalDisabledState;
            downloadButton.textContent = originalTextContent;
        }
    });
};

const setupFormSubmission = (modal) => {
    const glsForm = modal.querySelector("#gls-form");
    glsForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitButton = glsForm.querySelector("button[type='submit']");

        if (
            glsForm.dataset.processing === "true" ||
            glsForm.dataset.shipmentsCreated === "true"
        ) {
            return;
        }

        glsForm.dataset.processing = "true";
        setButtonState(submitButton, "Tworzenie...", "btn btn-warning", true);

        try {
            const orders = selectedOrderIds.length ? selectedOrderIds : orderNumberList();
            if (!orders?.length) {
                alert("Zaznacz zamówienia na liście");
                restoreSubmitButton(submitButton, glsForm);
                return;
            }

            await selectedOrdersPreviewPromise;
            const senderAccountSelect = glsForm.querySelector("#senderAccountGls");
            if (!senderAccountSelect.value) {
                alert("Wybierz konto nadawcy!");
                restoreSubmitButton(submitButton, glsForm);
                return;
            }

            const selectedSender = senderAccounts[senderAccountSelect.selectedIndex - 1];
            try {
                checkRequiredFields(selectedSender, [
                    "name",
                    "street",
                    "city",
                    "zipCode",
                    "countryIsoCode",
                ]);
            } catch (error) {
                alert("Uzupełnij dane nadawcy GLS CZ w ustawieniach.");
                restoreSubmitButton(submitButton, glsForm);
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
                const orderStatus = {orderId, statuses: []};
                try {
                    const shipmentStatus = await createGlsCzShipmentForOrder(
                        modal,
                        orderId,
                        selectedSender,
                        printType,
                        requiredRecipientFields
                    );
                    orderStatus.statuses.push(shipmentStatus);
                } catch (error) {
                    orderStatus.statuses.push({service: "error", status: error.message});
                } finally {
                    await wait(500);
                    afterSingleOrder(
                        orderStatus,
                        orderResults,
                        ++processedOrders,
                        orders.length,
                        progressBar
                    );
                }
            }

            const allOrdersCreated = orderResults.every((order) =>
                order.statuses.every((item) => item.status === "OK")
            );

            finalizeProcessing(glsForm, submitButton, allOrdersCreated);
        } catch (error) {
            alert(error?.message || "Wystąpił nieoczekiwany błąd tworzenia przesyłki.");
            restoreSubmitButton(submitButton, glsForm);
        }
    });
};

async function createGlsCzShipmentForOrder(
    modal,
    orderId,
    selectedSender,
    printType,
    requiredRecipientFields
) {
    const parcelCount = parcelCountForOrder(modal, orderId);
    const recipient = await extractRecipientDetails(orderId, requiredRecipientFields);
    const payload = buildGlsCzShipmentPayload(recipient, selectedSender, parcelCount);

    try {
        const response = await fetchWithTimeout(glsCzShipmentsUrl(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-KEY": backendApiKey,
            },
            body: JSON.stringify(payload),
        }, GLS_CZ_SHIPMENT_TIMEOUT_MS);

        if (!response.ok) {
            return {
                service: "shipment",
                status: await handleErrorResponse(response, recipient.orderNo),
            };
        }

        let labelResponse = null;
        try {
            labelResponse = await response.json();
        } catch (error) {
            return {
                service: "shipment",
                status: "GLS CZ zwrócił nieprawidłową odpowiedź.",
            };
        }

        const glsCzError = glsCzResponseError(labelResponse);
        if (glsCzError) {
            return {service: "shipment", status: glsCzError};
        }

        const uploadResult = await uploadLabel(
            labelResponse,
            recipient.orderNo,
            printType
        );
        return {
            service: "shipment",
            status: uploadResult.ok ? "OK" : uploadResult.status,
        };
    } catch (error) {
        return {service: "shipment", status: `Error: ${error.message}`};
    }
}

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
    button.disabled = disabled;
    button.style.pointerEvents = disabled ? "none" : "";
};

const restoreSubmitButton = (submitButton, glsForm) => {
    if (glsForm) {
        delete glsForm.dataset.processing;
    }

    setButtonState(submitButton, "Wyślij", "btn btn-success", false);
};

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
        const {code, value} = errorResponse.errors[0];
        const searchString = "Response body:";
        const index = typeof code === "string" ? code.indexOf(searchString) : -1;
        errorMessage =
            index !== -1
                ? `Zamówienie ${orderNo}: szczegóły błędu: ${code
                    .substring(index + searchString.length)
                    .trim()}`
                : `Zamówienie ${orderNo}: błąd: ${value}`;
    }
    return errorMessage;
};

const resetFormState = (modal) => {
    const glsForm = modal.querySelector("#gls-form");
    glsForm.reset();
    delete glsForm.dataset.processing;
    delete glsForm.dataset.shipmentsCreated;
    restoreSubmitButton(glsForm.querySelector("button[type='submit']"), glsForm);
    modal.querySelector("#resultTableContainer").innerHTML = "";
    const progressBar = modal.querySelector("#progressBar");
    progressBar.style.width = "0%";
    progressBar.textContent = "0%";
    modal.querySelector("#orderPreviewContainer").innerHTML = "";
    modal.querySelector("#glsCommentContainer")?.classList.add("hidden");
};

const finalizeProcessing = (glsForm, submitButton, allOrdersCreated) => {
    delete glsForm.dataset.processing;
    glsForm.dataset.shipmentsCreated = "true";

    if (allOrdersCreated) {
        setButtonState(submitButton, "Utworzono", "btn btn-success", true);
        return;
    }

    setButtonState(submitButton, "Zakończono z błędami", "btn btn-warning", true);
};

const fetchOrderData = async (orderId) => {
    if (orderDataCache.has(orderId)) {
        return orderDataCache.get(orderId);
    }

    const orderData = await getApiData(`orders/${orderId}`);
    if (!orderData)
        throw new Error(`Brak danych z API dla zamówienia: ${orderId}.`);
    orderDataCache.set(orderId, orderData);
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
        houseNumberInfo: null,
        city,
        zipCode,
        countryIsoCode: normalizeCountryIsoCode(country),
        content: note || orderId,
        orderNo: orderId,
        clientReference: String(orderId),
        codAmount,
        codReference: codAmount ? String(orderId) : null,
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
                recipient.name || "?"
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
        serviceList: shipmentServiceList(recipient),
    };
}

function shipmentServiceList(recipient) {
    if (!recipient.codAmount) {
        return [];
    }

    return [{Code: "COD"}];
}

function senderToPickupAddress(sender) {
    return withoutEmptyFields({
        Name: limitText(sender?.name, 40),
        Street: limitText(sender?.street, 40),
        HouseNumber: limitText(sender?.houseNumber, 10),
        HouseNumberInfo: limitText(sender?.houseNumberInfo, 10),
        City: limitText(sender?.city, 40),
        ZipCode: limitText(sender?.zipCode, 10),
        CountryIsoCode: normalizeCountryIsoCode(sender?.countryIsoCode || "CZ"),
        ContactName: limitText(sender?.contactName, 40),
        ContactPhone: limitText(sender?.contactPhone, 35),
        ContactEmail: limitText(sender?.contactEmail, 80),
    });
}

function recipientToDeliveryAddress(recipient) {
    return withoutEmptyFields({
        Name: limitText(recipient.name, 40),
        Street: limitText(recipient.street, 40),
        HouseNumber: limitText(recipient.houseNumber, 10),
        HouseNumberInfo: limitText(recipient.houseNumberInfo, 10),
        City: limitText(recipient.city, 40),
        ZipCode: limitText(recipient.zipCode, 10),
        CountryIsoCode: recipient.countryIsoCode,
        ContactName: limitText(recipient.contactName, 40),
        ContactPhone: limitText(recipient.contactPhone, 35),
        ContactEmail: limitText(recipient.contactEmail, 80),
    });
}

function withoutEmptyFields(data) {
    const result = {};

    Object.entries(data).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== "") {
            result[key] = value;
        }
    });

    return result;
}

function cashOnDeliveryAmount(orderData) {
    if (!CASH_ON_DELIVERY_PAYMENT_TYPES.includes(Number(orderData.paymentType))) {
        return null;
    }

    const total = Number(
        orderData.originalAmountTotalWithTax ?? orderData.amountTotalWithTax ?? 0
    );
    const amount = Math.round(total * 100) / 100;
    return amount > 0 ? amount : null;
}

function glsCzShipmentsUrl() {
    return `${DEFAULT_BACKEND_BASE_URL}${GLS_CZ_SHIPMENTS_PATH}`;
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
    document.getElementById("resultTableContainer").innerHTML = `
    <table border="1" cellspacing="0" cellpadding="5" class="table table-striped">
      <thead>
        <tr>
          <th>Zamówienie</th>
          <th>Usługa</th>
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
                  <a target="_blank" href="${window.location.origin}/order/order/detail/${encodeURIComponent(order.orderId)}/">${escapeHtml(order.orderId)}</a>
                  <br>
                  <a target="_blank" href="${window.location.origin}/order/order/edit/${encodeURIComponent(order.orderId)}/">Edytuj</a>
                  </td>`
                            : ""
                    }
              <td>${escapeHtml(displayServiceName(status.service))}</td>
              <td>${escapeHtml(status.status)}</td>
            </tr>
          `
                )
                .join("")
        )
        .join("")}
      </tbody>
    </table>
  `;
};

function displayServiceName(service) {
    if (service === "shipment") {
        return "Przesyłka";
    }

    if (service === "error") {
        return "Błąd";
    }

    return service;
}

async function uploadLabel(response, orderId, printType) {
    const labelData = response?.Labels || response?.labels;
    const parcelInfos =
        response?.PrintLabelsInfoList || response?.printLabelsInfoList || [];
    const firstParcel = parcelInfos[0] || {};
    const filename = String(firstParcel.ParcelNumber || orderId);

    if (!labelData) {
        console.error("Unexpected response structure:", response);
        return {
            ok: false,
            status: "GLS CZ nie zwrócił etykiety PDF.",
        };
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
        const uploadResponse = await fetchApiloWithTimeout(uploadEndpoint, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/pdf",
                "Content-Disposition": `filename=${filename}`,
                Authorization: `Bearer ${apiData.accessToken}`,
            },
            body: pdfBlob,
        }, APILO_WRITE_TIMEOUT_MS);

        if (!uploadResponse.ok) {
            const errorDetails = await responseErrorDetails(uploadResponse);
            console.error(
                "Failed to upload PDF label:",
                uploadResponse.status,
                errorDetails
            );
            return {
                ok: false,
                status: `Etykieta utworzona, ale nie udało się zapisać PDF w Apilo (${errorDetails}).`,
            };
        }

        const uploadData = await uploadResponse.json();
        const mediaUuid = uploadData.uuid;

        if (!mediaUuid) {
            console.error("Media UUID not found in response for GLS CZ label.");
            return {
                ok: false,
                status: "Etykieta utworzona, ale Apilo nie zwróciło UUID pliku PDF.",
            };
        }

        await wait(APILO_MEDIA_READY_DELAY_MS);

        const tracking = String(firstParcel.ParcelNumber || orderId);

        const shipmentResult = await createApiloShipmentWithRetry(
            orderId,
            tracking,
            mediaUuid
        );

        if (!shipmentResult.ok) {
            return {
                ok: false,
                status: shipmentResult.status,
            };
        }

        processPrint(mediaUuid, printType);

        return {
            ok: true,
            status: "OK",
        };
    } catch (error) {
        console.error("Error occurred during GLS CZ label processing:", error);
        return {
            ok: false,
            status: `Etykieta utworzona, ale zapis w Apilo nie zakończył się poprawnie: ${error.message}`,
        };
    }
}

async function createApiloShipmentWithRetry(orderId, tracking, mediaUuid) {
    const shipmentEndpoint = `${window.location.origin}/rest/api/orders/${orderId}/shipment/`;
    const payload = {
        idExternal: tracking,
        tracking,
        carrierProviderId: GLS_CZ_CARRIER_PROVIDER_ID,
        media: mediaUuid,
    };
    let lastErrorDetails = "";

    for (let attempt = 1; attempt <= APILO_SHIPMENT_CREATE_ATTEMPTS; attempt += 1) {
        const shipmentResponse = await fetchApiloWithTimeout(shipmentEndpoint, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiData.accessToken}`,
            },
            body: JSON.stringify(payload),
        }, APILO_WRITE_TIMEOUT_MS);

        if (shipmentResponse.ok) {
            return {ok: true};
        }

        lastErrorDetails = await responseErrorDetails(shipmentResponse);
        if (!shouldRetryInvalidMedia(shipmentResponse.status, lastErrorDetails, attempt)) {
            break;
        }

        await wait(APILO_INVALID_MEDIA_RETRY_DELAY_MS);
    }

    console.error("Failed to create shipment for GLS CZ label:", lastErrorDetails);
    return {
        ok: false,
        status: `Etykieta PDF została zapisana w Apilo, ale Apilo nadal nie pozwala podpiąć jej do przesyłki po ${APILO_SHIPMENT_CREATE_ATTEMPTS} próbach (${lastErrorDetails}).`,
    };
}

function shouldRetryInvalidMedia(status, errorDetails, attempt) {
    return (
        status === 422 &&
        errorDetails.toLowerCase().includes("invalid media") &&
        attempt < APILO_SHIPMENT_CREATE_ATTEMPTS
    );
}

async function responseErrorDetails(response) {
    let responseText = "";
    try {
        responseText = await response.text();
    } catch (error) {
        return String(response.status);
    }

    if (!responseText) {
        return String(response.status);
    }

    try {
        const responseJson = JSON.parse(responseText);
        const errors = responseJson.errors;
        if (Array.isArray(errors) && errors.length) {
            const firstError = errors[0];
            const message = firstError.value || firstError.message || firstError.code;
            return message ? `${response.status}: ${message}` : String(response.status);
        }

        const message =
            responseJson.message || responseJson.error || responseJson.detail;
        return message ? `${response.status}: ${message}` : String(response.status);
    } catch (error) {
        return `${response.status}: ${responseText.slice(0, 250)}`;
    }
}

function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], {type: mimeType});
}

async function getApiData(href) {
    const hasAccessToken = await checkApiToken();
    if (!hasAccessToken) {
        alert("Błąd komunikacji z API Apilo");
        return false;
    }
    try {
        const response = await fetchApiloWithTimeout(`${window.location.origin}/rest/api/${href}`, {
            method: "GET",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiData.accessToken}`,
            },
        }, APILO_WRITE_TIMEOUT_MS);
        if (!response.ok) {
            throw new Error(`Apilo API: ${await responseErrorDetails(response)}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Error API connection:", error.message);
        throw error;
    }
}

async function checkApiToken() {
    if (!apiData?.accessToken) {
        return false;
    }

    const accessTokenExpire = Number(apiData.accessTokenExpire);
    if (Number.isFinite(accessTokenExpire) && Date.now() < accessTokenExpire) {
        return true;
    }

    try {
        const apiResponse = await getNewTokens();
        if (!apiResponse?.accessToken) {
            return false;
        }

        return syncNewApiData(apiResponse);
    } catch (error) {
        alert("Błąd pobierania nowego tokenu API Apilo");
        return false;
    }
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
            throw new Error(`Apilo API: ${response.status}`);
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

        chrome.storage.local.set({apiData}, () => {
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
    if (!printerId || printerId.length < 4 || printType !== "allLabels") {
        return;
    }

    fetch(
        `${window.location.origin}/frontend/tmp/download/${media}/2/?printer=${printerId}&type=1`
    );
}

async function loadSelectedOrdersPreview(modal, orders, previewToken) {
    const previewContainer = modal.querySelector("#orderPreviewContainer");
    previewContainer.innerHTML = `<div class="order-preview-loading">Pobieram dane zamówień...</div>`;

    const previewHtml = [];
    for (const orderId of orders) {
        if (previewToken !== selectedOrdersPreviewToken) {
            return;
        }

        try {
            const orderDetails = await fetchOrderData(orderId);
            const products = orderProducts(orderDetails);

            if (orders.length === 1) {
                fillSingleOrderComment(orderDetails);
            }

            previewHtml.push(orderPreviewHtml(orderDetails, orderId, products));
        } catch (error) {
            previewHtml.push(orderPreviewErrorHtml(orderId, error));
        }

        if (previewToken !== selectedOrdersPreviewToken) {
            return;
        }

        previewContainer.innerHTML = previewHtml.join("");
        setupOrderPreviewInteractions(previewContainer);
    }
}

function fillSingleOrderComment(orderDetails) {
    const commentContainer = document.getElementById("glsCommentContainer");
    if (!commentContainer) {
        return;
    }

    commentContainer.querySelector("#glsParcelComment").value =
        prepareComment(orderDetails);
    commentContainer.classList.remove("hidden");
}

function orderPreviewHtml(orderDetails, orderId, products) {
    const productRows = products.length
        ? products.map(productPreviewRowHtml).join("")
        : `<tr><td colspan="3">Brak produktów w zamówieniu.</td></tr>`;
    const orderUrl = `${window.location.origin}/order/order/detail/${encodeURIComponent(orderId)}/`;
    const cashOnDelivery = cashOnDeliveryAmount(orderDetails);
    const paymentBadge = cashOnDelivery
        ? `<small class="order-payment-badge">Pobranie: ${escapeHtml(formatMoney(cashOnDelivery, orderDetails.originalCurrency || "CZK"))}</small>`
        : "";

    return `
    <details class="order-preview-card">
      <summary>
        <span>
          <a class="order-preview-link" target="_blank" href="${orderUrl}">Zamówienie ${escapeHtml(orderId)}</a>
          <small>${escapeHtml(orderAddressSummary(orderDetails))}</small>
          ${paymentBadge}
        </span>
        <label class="order-parcel-count">
          Paczki
          <input
            type="number"
            min="1"
            max="99"
            value="1"
            data-parcel-count-order="${escapeHtml(orderId)}"
          />
        </label>
      </summary>
      <div class="order-preview-body">
        <section>
          <h5>Adres klienta</h5>
          ${customerAddressPreviewHtml(orderDetails)}
        </section>
        <section>
          <h5>Produkty</h5>
          <table class="table table-sm table-bordered order-products-table">
            <thead>
              <tr>
                <th>Zdjęcie</th>
                <th>Nazwa</th>
                <th>Ilość</th>
              </tr>
            </thead>
            <tbody>${productRows}</tbody>
          </table>
        </section>
      </div>
    </details>`;
}

function orderPreviewErrorHtml(orderId, error) {
    return `
    <details class="order-preview-card order-preview-card-error">
      <summary>
        <span>
          <strong>Zamówienie ${escapeHtml(orderId)}</strong>
          <small>Nie udało się pobrać danych zamówienia.</small>
        </span>
      </summary>
      <div class="order-preview-body">${escapeHtml(error.message)}</div>
    </details>`;
}

function customerAddressPreviewHtml(orderDetails) {
    const address = orderDetails?.addressDelivery || {};
    const lines = [
        address.companyName || address.name,
        [address.streetName, address.streetNumber].filter(Boolean).join(" "),
        [address.zipCode, address.city].filter(Boolean).join(" "),
        address.country,
        address.phone ? `Tel: ${address.phone}` : "",
        address.email ? `Email: ${address.email}` : "",
    ].filter(Boolean);

    if (!lines.length) {
        return `<p class="empty-preview">Brak adresu dostawy.</p>`;
    }

    return `<address>${lines.map((line) => escapeHtml(line)).join("<br>")}</address>`;
}

function productPreviewRowHtml(item) {
    const imageUrl = productImageUrl(item);
    const imageHtml = imageUrl
        ? `<img class="order-product-image" src="${escapeHtml(imageUrl)}" alt="">`
        : `<span class="order-product-image-placeholder">Brak</span>`;

    return `
    <tr>
      <td>${imageHtml}</td>
      <td>${escapeHtml(item.originalName || item.name || "")}</td>
      <td>${escapeHtml(item.quantity ?? "")}</td>
    </tr>`;
}

function orderProducts(orderDetails) {
    if (!Array.isArray(orderDetails?.orderItems)) {
        return [];
    }

    return orderDetails.orderItems.filter((item) => item.type === 1);
}

function productImageUrl(item) {
    const image =
        item.imageUrl ||
        item.originalImageUrl ||
        item.thumbnailUrl ||
        item.pictureUrl ||
        item.image ||
        item.thumbnail ||
        item.picture;

    if (typeof image === "string") {
        return image;
    }

    if (image && typeof image.url === "string") {
        return image.url;
    }

    return null;
}

function orderAddressSummary(orderDetails) {
    const address = orderDetails?.addressDelivery || {};
    return [address.companyName || address.name, address.zipCode, address.city]
        .filter(Boolean)
        .join(", ");
}

function formatMoney(amount, currency) {
    return `${amount.toFixed(2)} ${currency}`;
}

function setupOrderPreviewInteractions(previewContainer) {
    previewContainer
        .querySelectorAll(".order-preview-link, .order-parcel-count, .order-parcel-count input")
        .forEach((element) => {
            element.addEventListener("click", (event) => event.stopPropagation());
        });
}

function parcelCountForOrder(modal, orderId) {
    const input = modal.querySelector(
        `[data-parcel-count-order="${cssEscape(orderId)}"]`
    );
    const parcelCount = Number(input?.value);

    if (!Number.isInteger(parcelCount) || parcelCount < 1 || parcelCount > 99) {
        throw new Error(
            `Podaj liczbę paczek od 1 do 99 dla zamówienia ${orderId}.`
        );
    }

    return parcelCount;
}

function cssEscape(value) {
    if (globalThis.CSS?.escape) {
        return globalThis.CSS.escape(String(value));
    }

    return String(value).replaceAll('"', '\\"');
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
                .map(({quantity = 0, sku}) => `${quantity}x ${sku ?? "???"}`)
                .join("; ");

        case "skuOnly":
            return items.map(({sku}) => sku ?? "???").join("; ");

        default:
            return "";
    }
}

async function waitBeforeApiloRequest() {
    const elapsed = Date.now() - lastApiloRequestAt;
    if (elapsed < APILO_REQUEST_DELAY_MS) {
        await wait(APILO_REQUEST_DELAY_MS - elapsed);
    }
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
        });
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error(`Przekroczono czas oczekiwania na odpowiedź (${timeoutMs / 1000}s).`);
        }

        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

async function fetchApiloWithTimeout(url, options, timeoutMs) {
    await waitBeforeApiloRequest();

    try {
        return await fetchWithTimeout(url, options, timeoutMs);
    } finally {
        lastApiloRequestAt = Date.now();
    }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
