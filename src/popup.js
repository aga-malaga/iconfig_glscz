import "./popup.css";

let settings = {};
let apiDataTemporary = {};
let apiData = {};
let apiConnection = {};
let licenceStatus = true;
let accounts = [];

document.addEventListener("DOMContentLoaded", function () {
  document
    .getElementById("api-page-btn")
    .addEventListener("click", function () {
      document.getElementById("api-page").style.display = "flex";
    });

  document
    .getElementById("contactId-page-btn")
    .addEventListener("click", function () {
      document.getElementById("list-page").style.display = "flex";
    });

  document
    .getElementById("api-page-back-btn")
    .addEventListener("click", function () {
      document.getElementById("api-page").style.display = "none";
    });

  document
    .getElementById("list-page-back-btn")
    .addEventListener("click", function () {
      document.getElementById("list-page").style.display = "none";
    });

  chrome.storage.session.get(["apiDataTemporary"], (res) => {
    apiDataTemporary = res.apiDataTemporary ? res.apiDataTemporary : {};
  });

  chrome.storage.local.get(
    ["settings", "apiData", "apiConnection", "accounts"],
    (res) => {
      settings = res.settings ?? {};
      apiData = res.apiData ?? {};
      accounts = res.accounts ?? [];
      apiConnection = res.apiConnection ?? false;

      if (!apiConnection) {
        renderApiForm();
      }

      checkApiConnectionStatus();
      renderAccountsContainer();

      const printNodePrinterId = document.getElementById("printNodePrinterId");
      if (!settings.printerId) {
        printNodePrinterId.value = "";
      } else {
        printNodePrinterId.value = settings.printerId;
      }

      printNodePrinterId.addEventListener("change", () => {
        settings.printerId = printNodePrinterId.value;
        saveSettings();
      });

      const backendBaseUrl = document.getElementById("backendBaseUrl");
      backendBaseUrl.value = settings.backendBaseUrl || "http://localhost:8080";
      backendBaseUrl.addEventListener("change", () => {
        settings.backendBaseUrl = backendBaseUrl.value.trim();
        saveSettings();
      });

      const backendApiKey = document.getElementById("backendApiKey");
      backendApiKey.value = settings.apiKey || "";
      backendApiKey.addEventListener("change", () => {
        settings.apiKey = backendApiKey.value.trim();
        saveSettings();
      });

      const userUuid = document.getElementById("userUuid");
      userUuid.value = settings.userUuid || "";
      userUuid.addEventListener("change", () => {
        settings.userUuid = userUuid.value.trim();
        saveSettings();
      });

      const labelComment = document.getElementById("labelCommentOption");
      if (!settings.labelComment) {
        labelComment.value = "orderNumber";
      } else {
        labelComment.value = settings.labelComment;
      }

      labelComment.addEventListener("change", () => {
        settings.labelComment = labelComment.value;
        saveSettings();
      });
    }
  );

  //////////////////////////////////////////////////
  //////////////// LIST  ///////////////////////////
  //////////////////////////////////////////////////

  const addAccBtn = document.getElementById("listBtn");

  function renderAccountsContainer() {
    const accountsContainer = document.getElementById("listDataContainer");
    accountsContainer.textContent = "";
    accounts.forEach((statusText, statusNum) => {
      renderAccountsList(statusNum);
    });
  }

  function renderAccountsList(statusNum) {
    const accRow = document.createElement("div");
    accRow.className = "horizontal-row";
    accRow.id = "status-row";
    const sender = accounts[statusNum];

    const name = senderInput(sender, "name", "Nazwa nadawcy");
    const street = senderInput(sender, "street", "Ulica");
    const houseNumber = senderInput(sender, "houseNumber", "Nr domu");
    const houseNumberInfo = senderInput(sender, "houseNumberInfo", "Nr lokalu");
    const city = senderInput(sender, "city", "Miasto");
    const zipCode = senderInput(sender, "zipCode", "Kod pocztowy");
    const countryIsoCode = senderInput(sender, "countryIsoCode", "Kraj", "CZ");
    const contactName = senderInput(sender, "contactName", "Kontakt");
    const contactPhone = senderInput(sender, "contactPhone", "Telefon");
    const contactEmail = senderInput(sender, "contactEmail", "Email");

    const upButton = document.createElement("input");
    upButton.className = "btns-arrow-btn";
    upButton.type = "button";
    upButton.value = "\u2B9D";
    upButton.addEventListener("click", () => moveAccUp(statusNum));

    const downButton = document.createElement("input");
    downButton.className = "btns-arrow-btn";
    downButton.type = "button";
    downButton.value = "\u2B9F";
    downButton.addEventListener("click", () => moveAccDown(statusNum));

    const deleteBtn = document.createElement("input");
    deleteBtn.id = "delbtn";
    deleteBtn.type = "button";
    deleteBtn.value = "X";
    deleteBtn.addEventListener("click", () => {
      deleteTask(statusNum);
    });

    accRow.appendChild(name);
    accRow.appendChild(street);
    accRow.appendChild(houseNumber);
    accRow.appendChild(houseNumberInfo);
    accRow.appendChild(city);
    accRow.appendChild(zipCode);
    accRow.appendChild(countryIsoCode);
    accRow.appendChild(contactName);
    accRow.appendChild(contactPhone);
    accRow.appendChild(contactEmail);
    accRow.appendChild(upButton);
    accRow.appendChild(downButton);

    accRow.appendChild(deleteBtn);

    const container = document.getElementById("listDataContainer");
    container.appendChild(accRow);
  }

  function senderInput(sender, fieldName, placeholder, defaultValue = "") {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.value = sender[fieldName] ?? defaultValue;
    if (input.value === "undefined") {
      input.value = "";
    }

    input.addEventListener("change", () => {
      sender[fieldName] = input.value.trim();
      saveAccountsList();
    });

    return input;
  }

  function moveAccUp(index) {
    if (index <= 0) return;
    [accounts[index - 1], accounts[index]] = [
      accounts[index],
      accounts[index - 1],
    ];

    renderAccountsContainer();
    saveAccountsList();
  }

  function moveAccDown(index) {
    if (index >= accounts.length - 1) return;
    [accounts[index], accounts[index + 1]] = [
      accounts[index + 1],
      accounts[index],
    ];

    renderAccountsContainer();
    saveAccountsList();
  }

  function saveAccountsList() {
    chrome.storage.local.set({
      accounts,
    });
  }

  function saveSettings() {
    chrome.storage.local.set({
      settings,
    });
  }

  function deleteTask(statusNum) {
    accounts.splice(statusNum, 1);
    renderAccountsContainer();
    saveAccountsList();
  }

  addAccBtn.addEventListener("click", () => {
    addAccount();
  });

  function addAccount() {
    const statusNum = accounts.length;
    accounts.push({});
    renderAccountsList(statusNum);
    saveAccountsList();
  }
});

//////////////////////////////////////////////////
//////////////// API CONNECTION  /////////////////
//////////////////////////////////////////////////

function renderApiForm() {
  let aliasInput = document.getElementById("aliasInput");
  aliasInput.value = apiDataTemporary.alias;

  if (aliasInput.value === "undefined") {
    aliasInput.value = "";
  }

  aliasInput.addEventListener("change", () => {
    apiDataTemporary.alias = aliasInput.value;
    saveApiTemporaryData();
  });

  let idInput = document.getElementById("idInput");
  idInput.value = apiDataTemporary.id;

  if (idInput.value === "undefined") {
    idInput.value = "";
  }

  idInput.addEventListener("change", () => {
    apiDataTemporary.id = idInput.value;
    saveApiTemporaryData();
  });

  let secretInput = document.getElementById("secretInput");
  secretInput.value = apiDataTemporary.secret;

  if (secretInput.value === "undefined") {
    secretInput.value = "";
  }

  secretInput.addEventListener("change", () => {
    apiDataTemporary.secret = secretInput.value;
    saveApiTemporaryData();
  });

  let codeInput = document.getElementById("codeInput");
  codeInput.value = apiDataTemporary.authCode;

  if (codeInput.value === "undefined") {
    codeInput.value = "";
  }

  codeInput.addEventListener("change", () => {
    apiDataTemporary.authCode = codeInput.value;
    saveApiTemporaryData();
  });
}

const apiConnectButton = document.getElementById("apiBtn");
apiConnectButton.addEventListener("click", () => {
  if (licenceStatus) {
    handleApiButtonClick();
    checkApiConnectionStatus();
  }
});

async function handleApiButtonClick() {
  const userInputs = getUserInputs();
  const validatedInputs = validateInputs(userInputs);

  if (validatedInputs) {
    try {
      const apiResponse = await getTokens(validatedInputs);

      if (isValidApiResponse(apiResponse)) {
        processApiResponse(apiResponse, validatedInputs);
      } else {
        console.log("Failed to get tokens");
      }
    } catch (error) {
      displayApiErrorMessage(error);
    }
  } else {
    alert("Wypełnij prawidłowo wszystkie pola.", "apiErrorMessage", "red");
  }
}

function saveApiTemporaryData() {
  chrome.storage.session.set({
    apiDataTemporary: apiDataTemporary,
  });
}

function getUserInputs() {
  return {
    userAlias: document.getElementById("aliasInput").value.trim(),
    userID: document.getElementById("idInput").value.trim(),
    userSecret: document.getElementById("secretInput").value.trim(),
    userAuthCode: document.getElementById("codeInput").value.trim(),
  };
}

async function processApiResponse(apiResponse, userInputs) {
  storageAPIdata(apiResponse, userInputs);
  checkApiConnectionStatus();
}

function validateInputs({ userAlias, userID, userSecret, userAuthCode }) {
  let normalizedUserAlias = "";
  if (userAlias.length > 0) {
    normalizedUserAlias = normalizeUserAlias(userAlias);
  } else return null;

  const isValid =
    normalizedUserAlias.length > 0 &&
    userID.length > 0 &&
    userSecret.length > 30 &&
    userAuthCode.length > 30;

  if (isValid) {
    return {
      userAlias: normalizedUserAlias,
      userID,
      userSecret,
      userAuthCode,
    };
  } else {
    return null;
  }
}

function normalizeUserAlias(userAlias) {
  const pattern = /^(?:https?:\/\/)?(?:[^@\/\n]+@)?(?:www\.)?([^:\/?\n]+)/;
  const match = userAlias.match(pattern);
  return match && match[1].split(".")[0];
}

function storageAPIdata(
  apiResponse,
  { userAlias, userID, userSecret, userAuthCode }
) {
  chrome.storage.local.set({
    apiConnection: true,
    lastApiRequest: null,
    apiData: {
      accessToken: apiResponse["accessToken"],
      refreshToken: apiResponse["refreshToken"],
      accessTokenExpire: Date.parse(apiResponse["accessTokenExpireAt"]),
      alias: userAlias,
      id: userID,
      secret: userSecret,
      authCode: userAuthCode,
    },
  });
}

async function getTokens({ userAlias, userID, userSecret, userAuthCode }) {
  const tokenUrl = `https://${userAlias}.apilo.com/rest/auth/token/`;
  const authBasicToken = btoa(`${userID}:${userSecret}`);

  const postData = {
    grantType: "authorization_code",
    token: userAuthCode,
    developerId: "94492966-d826-4c73-aba2-2d303394b72e",
  };

  try {
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
      console.log("ApiloBooster: api error");

      throw new Error(`Error! Status: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    throw error;
  }
}

function isValidApiResponse(apiResponse) {
  return apiResponse && apiResponse["accessToken"];
}

function checkApiConnectionStatus() {
  chrome.storage.local.get(["apiConnection"], (res) => {
    if (res.apiConnection) {
      var aliasElement = document.getElementById("aliasInput");
      aliasElement.style.backgroundColor = "#f0f0f0";
      aliasElement.disabled = true;

      var idElement = document.getElementById("idInput");
      idElement.style.backgroundColor = "#f0f0f0";
      idElement.disabled = true;

      var secretElement = document.getElementById("secretInput");
      secretElement.style.backgroundColor = "#f0f0f0";
      secretElement.disabled = true;

      var codeElement = document.getElementById("codeInput");
      codeElement.style.backgroundColor = "#f0f0f0";
      codeElement.disabled = true;

      var apiConnectBtn = document.getElementById("apiBtn");
      apiConnectBtn.className = "default-btn-disabled";
      apiConnectBtn.disabled = true;
      apiConnectBtn.textContent = "Połączono!";

      aliasElement.value = "-- ukryto --";
      idElement.value = "-- ukryto --";
      secretElement.value = "-- ukryto --";
      codeElement.value = "-- ukryto --";
    }
  });
}
