import "./options.css";

const DEFAULT_BACKEND_BASE_URL = "http://localhost:8080";
const DEFAULT_LABEL_COMMENT = "orderNumber";

const senderFields = [
  ["name", "Nazwa nadawcy"],
  ["street", "Ulica"],
  ["houseNumber", "Nr domu"],
  ["houseNumberInfo", "Nr lokalu"],
  ["city", "Miasto"],
  ["zipCode", "Kod pocztowy"],
  ["countryIsoCode", "Kraj"],
  ["contactName", "Kontakt"],
  ["contactPhone", "Telefon"],
  ["contactEmail", "Email"],
];

let settings = {};
let accounts = [];
let apiDataTemporary = {};

document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupStaticActions();
  await loadOptions();
});

function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((item) => item.classList.toggle("active", item === tab));
      panels.forEach((panel) =>
        panel.classList.toggle("active", panel.id === tab.dataset.tab)
      );
    });
  });
}

function setupStaticActions() {
  document
    .getElementById("saveBackendSettings")
    .addEventListener("click", (event) => saveBackendSettings(event.currentTarget));
  document
    .getElementById("saveGlsCzConfig")
    .addEventListener("click", (event) => saveGlsCzConfig(event.currentTarget));
  document
    .getElementById("saveLabelSettings")
    .addEventListener("click", (event) => saveLabelSettings(event.currentTarget));
  document
    .getElementById("addSenderAccount")
    .addEventListener("click", addSenderAccount);
  document
    .getElementById("apiConnectButton")
    .addEventListener("click", connectApilo);
  document
    .getElementById("apiResetButton")
    .addEventListener("click", resetApiloConnection);

  ["aliasInput", "idInput", "secretInput", "codeInput"].forEach((inputId) => {
    document.getElementById(inputId).addEventListener("change", saveApiDraft);
  });
}

async function loadOptions() {
  const localData = await chrome.storage.local.get([
    "settings",
    "accounts",
    "apiConnection",
  ]);
  const sessionData = await chrome.storage.session.get(["apiDataTemporary"]);

  settings = localData.settings ?? {};
  accounts = Array.isArray(localData.accounts) ? localData.accounts : [];
  apiDataTemporary = sessionData.apiDataTemporary ?? {};

  renderSettings();
  renderSenderAccounts();
  renderApiDraft();
  renderApiConnection(localData.apiConnection);
}

function renderSettings() {
  setInputValue("backendApiKey", settings.apiKey || "");
  setInputValue("userUuid", settings.userUuid || "");
  setInputValue("printNodePrinterId", settings.printerId || "");
  setInputValue("labelCommentOption", settings.labelComment || DEFAULT_LABEL_COMMENT);
  setInputValue("glsUsername", settings.glsCzConfig?.username || "");
  setInputValue("glsPassword", settings.glsCzConfig?.password || "");
  setInputValue("glsClientNumber", settings.glsCzConfig?.clientNumber || "");
  document.getElementById("glsSandbox").checked =
    settings.glsCzConfig?.sandbox ?? false;
}

function saveBackendSettings(button) {
  setButtonSaving(button);
  settings.backendBaseUrl = DEFAULT_BACKEND_BASE_URL;
  settings.apiKey = inputValue("backendApiKey");
  settings.userUuid = inputValue("userUuid");
  saveSettings("Zapisano backend GLS CZ", button);
}

async function saveGlsCzConfig(button) {
  setButtonSaving(button);
  settings.backendBaseUrl = DEFAULT_BACKEND_BASE_URL;
  settings.apiKey = inputValue("backendApiKey");
  settings.userUuid = inputValue("userUuid");
  settings.glsCzConfig = {
    username: inputValue("glsUsername"),
    password: inputValue("glsPassword"),
    clientNumber: inputValue("glsClientNumber"),
    sandbox: document.getElementById("glsSandbox").checked,
  };

  if (!settings.apiKey || !settings.userUuid) {
    finishButtonAction(button, false);
    showToast("Uzupełnij X-API-KEY i kod licencji");
    return;
  }

  if (
    !settings.glsCzConfig.username ||
    !settings.glsCzConfig.password ||
    !settings.glsCzConfig.clientNumber
  ) {
    finishButtonAction(button, false);
    showToast("Uzupełnij dane konta GLS CZ");
    return;
  }

  const clientNumber = Number(settings.glsCzConfig.clientNumber);
  if (!Number.isInteger(clientNumber) || clientNumber <= 0) {
    finishButtonAction(button, false);
    showToast("Numer klienta GLS CZ musi być liczbą większą od 0");
    return;
  }

  try {
    const response = await fetch(`${DEFAULT_BACKEND_BASE_URL}/api/glscz`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": settings.apiKey,
      },
      body: JSON.stringify({
        userUuid: settings.userUuid,
        username: settings.glsCzConfig.username,
        password: settings.glsCzConfig.password,
        clientNumber,
        sandbox: settings.glsCzConfig.sandbox,
      }),
    });

    if (!response.ok) {
      finishButtonAction(button, false);
      showToast(`Błąd konfiguracji GLS CZ: ${response.status}`);
      return;
    }

    saveSettings("Zapisano konfigurację GLS CZ", button);
  } catch (error) {
    finishButtonAction(button, false);
    showToast(error?.message || "Błąd konfiguracji GLS CZ");
  }
}

function saveLabelSettings(button) {
  setButtonSaving(button);
  settings.printerId = inputValue("printNodePrinterId");
  settings.labelComment = inputValue("labelCommentOption") || DEFAULT_LABEL_COMMENT;
  saveSettings("Zapisano ustawienia etykiet", button);
}

function saveSettings(message, button) {
  chrome.storage.local.set({ settings }, () => {
    if (chrome.runtime.lastError) {
      finishButtonAction(button, false);
      showToast("Nie udało się zapisać ustawień");
      return;
    }

    finishButtonAction(button, true);
    showToast(message);
  });
}

function setButtonSaving(button) {
  if (!button) {
    return;
  }

  button.dataset.defaultText = button.dataset.defaultText || button.textContent;
  button.textContent = "Zapisywanie...";
  button.disabled = true;
  button.classList.remove("saved", "error");
}

function finishButtonAction(button, saved) {
  if (!button) {
    return;
  }

  button.disabled = false;
  button.textContent = saved ? "Zapisano" : "Błąd zapisu";
  button.classList.toggle("saved", saved);
  button.classList.toggle("error", !saved);

  window.setTimeout(() => {
    button.textContent = button.dataset.defaultText || button.textContent;
    button.classList.remove("saved", "error");
  }, 1600);
}

function renderSenderAccounts(openIndex = -1) {
  const container = document.getElementById("senderAccounts");
  container.textContent = "";

  if (!accounts.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "Brak dodanych nadawców GLS CZ.";
    container.appendChild(emptyState);
    return;
  }

  accounts.forEach((account, index) => {
    const card = document.createElement("details");
    card.className = "sender-card";
    card.dataset.index = String(index);
    card.open = index === openIndex;
    card.innerHTML = senderCardHtml(account, index);

    card
      .querySelector('[data-action="save-sender"]')
      .addEventListener("click", () => saveSenderAccount(card));
    card
      .querySelector('[data-action="move-up"]')
      .addEventListener("click", () => moveSenderAccountUp(index));
    card
      .querySelector('[data-action="move-down"]')
      .addEventListener("click", () => moveSenderAccountDown(index));
    card
      .querySelector('[data-action="remove-sender"]')
      .addEventListener("click", () => removeSenderAccount(index));

    container.appendChild(card);
  });
}

function senderCardHtml(account, index) {
  const name = account.name || `Nadawca ${index + 1}`;
  const summary = senderSummary(account);
  const inputs = senderFields
    .map(([fieldName, label]) => senderInputHtml(account, fieldName, label))
    .join("");

  return `
    <summary class="sender-summary">
      <span>
        <strong>${escapeHtml(name)}</strong>
        <small>${escapeHtml(summary)}</small>
      </span>
    </summary>
    <div class="sender-body">
      <div class="grid sender-grid">
        ${inputs}
      </div>
      <div class="sender-actions">
        <button class="secondary" type="button" data-action="move-up">W górę</button>
        <button class="secondary" type="button" data-action="move-down">W dół</button>
        <button class="save" type="button" data-action="save-sender">Zapisz</button>
        <button class="danger" type="button" data-action="remove-sender">Usuń</button>
      </div>
    </div>
  `;
}

function senderInputHtml(account, fieldName, label) {
  const defaultValue = fieldName === "countryIsoCode" ? "CZ" : "";
  const value = account[fieldName] ?? defaultValue;

  return `
    <label>
      ${escapeHtml(label)}
      <input type="text" data-field="${fieldName}" value="${escapeHtml(value)}" />
    </label>
  `;
}

function senderSummary(account) {
  const city = account.city || "";
  const street = account.street || "";

  if (!city && !street) {
    return "Adres nieuzupełniony";
  }

  return [street, city].filter(Boolean).join(", ");
}

function addSenderAccount() {
  accounts.push({ countryIsoCode: "CZ" });
  saveAccounts(() => {
    renderSenderAccounts(accounts.length - 1);
    showToast("Dodano nadawcę");
  });
}

function saveSenderAccount(card) {
  const index = Number(card.dataset.index);
  const savedAccount = {};

  senderFields.forEach(([fieldName]) => {
    savedAccount[fieldName] = card
      .querySelector(`[data-field="${fieldName}"]`)
      .value.trim();
  });

  if (!savedAccount.countryIsoCode) {
    savedAccount.countryIsoCode = "CZ";
  }

  accounts[index] = savedAccount;
  saveAccounts(() => {
    renderSenderAccounts(index);
    showToast("Zapisano nadawcę");
  });
}

function moveSenderAccountUp(index) {
  if (index <= 0) {
    return;
  }

  [accounts[index - 1], accounts[index]] = [accounts[index], accounts[index - 1]];
  saveAccounts(() => renderSenderAccounts(index - 1));
}

function moveSenderAccountDown(index) {
  if (index >= accounts.length - 1) {
    return;
  }

  [accounts[index], accounts[index + 1]] = [accounts[index + 1], accounts[index]];
  saveAccounts(() => renderSenderAccounts(index + 1));
}

function removeSenderAccount(index) {
  accounts.splice(index, 1);
  saveAccounts(() => {
    renderSenderAccounts();
    showToast("Usunięto nadawcę");
  });
}

function saveAccounts(callback) {
  chrome.storage.local.set({ accounts }, callback);
}

function renderApiDraft() {
  setInputValue("aliasInput", apiDataTemporary.alias || "");
  setInputValue("idInput", apiDataTemporary.id || "");
  setInputValue("secretInput", apiDataTemporary.secret || "");
  setInputValue("codeInput", apiDataTemporary.authCode || "");
}

function saveApiDraft() {
  apiDataTemporary.alias = inputValue("aliasInput");
  apiDataTemporary.id = inputValue("idInput");
  apiDataTemporary.secret = inputValue("secretInput");
  apiDataTemporary.authCode = inputValue("codeInput");
  chrome.storage.session.set({ apiDataTemporary });
}

async function connectApilo() {
  const userInputs = {
    userAlias: normalizeUserAlias(inputValue("aliasInput")),
    userID: inputValue("idInput"),
    userSecret: inputValue("secretInput"),
    userAuthCode: inputValue("codeInput"),
  };

  if (!validApiloInputs(userInputs)) {
    showToast("Wypełnij prawidłowo wszystkie pola Apilo");
    return;
  }

  try {
    const apiResponse = await getTokens(userInputs);
    if (!apiResponse?.accessToken) {
      showToast("Apilo nie zwróciło tokenu");
      return;
    }

    await chrome.storage.local.set({
      apiConnection: true,
      lastApiRequest: null,
      apiData: {
        accessToken: apiResponse.accessToken,
        refreshToken: apiResponse.refreshToken,
        accessTokenExpire: Date.parse(apiResponse.accessTokenExpireAt),
        alias: userInputs.userAlias,
        id: userInputs.userID,
        secret: userInputs.userSecret,
        authCode: userInputs.userAuthCode,
      },
    });

    renderApiConnection(true);
    showToast("Połączono z Apilo");
  } catch (error) {
    showToast(error?.message || "Błąd połączenia z Apilo");
  }
}

async function resetApiloConnection() {
  await chrome.storage.local.remove(["apiConnection", "apiData", "lastApiRequest"]);
  await chrome.storage.session.remove(["apiDataTemporary"]);
  apiDataTemporary = {};
  renderApiDraft();

  ["aliasInput", "idInput", "secretInput", "codeInput"].forEach((inputId) => {
    const input = document.getElementById(inputId);
    input.disabled = false;
  });

  const connectButton = document.getElementById("apiConnectButton");
  connectButton.textContent = "Połącz";
  connectButton.disabled = false;
  document.getElementById("apiResetButton").classList.add("hidden");
  showToast("Możesz wprowadzić dane Apilo ponownie");
}

function validApiloInputs({ userAlias, userID, userSecret, userAuthCode }) {
  return Boolean(
    userAlias &&
      userID &&
      userSecret &&
      userSecret.length > 30 &&
      userAuthCode &&
      userAuthCode.length > 30
  );
}

async function getTokens({ userAlias, userID, userSecret, userAuthCode }) {
  const tokenUrl = `https://${userAlias}.apilo.com/rest/auth/token/`;
  const authBasicToken = btoa(`${userID}:${userSecret}`);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${authBasicToken}`,
    },
    body: JSON.stringify({
      grantType: "authorization_code",
      token: userAuthCode,
      developerId: "94492966-d826-4c73-aba2-2d303394b72e",
    }),
  });

  if (!response.ok) {
    throw new Error(`Apilo API: ${response.status}`);
  }

  return response.json();
}

function renderApiConnection(apiConnection) {
  if (!apiConnection) {
    return;
  }

  ["aliasInput", "idInput", "secretInput", "codeInput"].forEach((inputId) => {
    const input = document.getElementById(inputId);
    input.value = "-- ukryto --";
    input.disabled = true;
  });

  const button = document.getElementById("apiConnectButton");
  button.textContent = "Połączono";
  button.disabled = true;
  document.getElementById("apiResetButton")?.classList.remove("hidden");
}

function normalizeUserAlias(userAlias) {
  const pattern = /^(?:https?:\/\/)?(?:[^@/\n]+@)?(?:www\.)?([^:/?\n]+)/;
  const match = userAlias.match(pattern);
  return match?.[1]?.split(".")[0] || "";
}

function inputValue(id) {
  return document.getElementById(id).value.trim();
}

function setInputValue(id, value) {
  document.getElementById(id).value = value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2200);
}
