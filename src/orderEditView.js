const CONVERT_HOME_TO_COMPANY_BUTTON_ID =
  "convert-home-to-company-address-button";

export function convertHomeToCompanyButton() {
  const copyAddressDeliveryButtonElement = findCopyAddressDeliveryButton();
  if (!copyAddressDeliveryButtonElement) {
    return;
  }

  const portletElement = findPortletForElement(
    copyAddressDeliveryButtonElement
  );
  if (!portletElement) {
    return;
  }

  const existingConvertButtonElement = portletElement.querySelector(
    `#${CONVERT_HOME_TO_COMPANY_BUTTON_ID}`
  );
  if (existingConvertButtonElement) {
    return;
  }

  const convertButtonElement = createConvertHomeToCompanyButtonElement();

  const parentElement = copyAddressDeliveryButtonElement.parentElement;
  if (!parentElement) {
    return;
  }

  parentElement.insertBefore(
    convertButtonElement,
    copyAddressDeliveryButtonElement
  );

  convertButtonElement.addEventListener(
    "click",
    handleConvertHomeToCompanyAddressClick
  );
}

function findCopyAddressDeliveryButton() {
  const buttonsWithOnClick = Array.from(
    document.querySelectorAll("a[onclick]")
  );

  const targetButton = buttonsWithOnClick.find((anchorElement) => {
    const onClickAttributeValue = anchorElement.getAttribute("onclick") || "";
    return onClickAttributeValue.includes(
      "copyAddress('#order_addressDelivery'"
    );
  });

  return targetButton || null;
}

function findPortletForElement(element) {
  if (!element) {
    return null;
  }

  return element.closest(".kt-portlet");
}

function createConvertHomeToCompanyButtonElement() {
  const buttonElement = document.createElement("button");
  buttonElement.id = CONVERT_HOME_TO_COMPANY_BUTTON_ID;
  buttonElement.type = "button";
  buttonElement.className = "btn btn-xs btn-secondary";
  buttonElement.textContent = "Typ Domowy na Firmowy";

  return buttonElement;
}

function getDeliveryAddressSnapshot(deliveryContainerElement) {
  if (!deliveryContainerElement) {
    return null;
  }

  const fieldElements = deliveryContainerElement.querySelectorAll(
    "input[name], select[name], textarea[name]"
  );

  const snapshotByFieldName = {};

  fieldElements.forEach((fieldElement) => {
    const fieldName = fieldElement.name;
    if (!fieldName) {
      console.log("skip1", fieldName);

      return;
    }

    if (
      fieldElement.id === "order_addressDelivery_type" ||
      fieldName === "order[addressDelivery][type]"
    ) {
      console.log("skip2", fieldName);
      return;
    }

    snapshotByFieldName[fieldName] = fieldElement.value;
  });

  return snapshotByFieldName;
}

function applyDeliveryAddressSnapshot(
  deliveryContainerElement,
  snapshotByFieldName
) {
  if (!deliveryContainerElement || !snapshotByFieldName) {
    return;
  }

  const fieldElements = deliveryContainerElement.querySelectorAll(
    "input[name], select[name], textarea[name]"
  );

  fieldElements.forEach((fieldElement) => {
    const fieldName = fieldElement.name;
    if (!fieldName) {
      return;
    }

    if (!(fieldName in snapshotByFieldName)) {
      console.log("return", fieldName);
      return;
    }

    const previousValue = snapshotByFieldName[fieldName];

    if (previousValue === undefined || previousValue === null) {
      return;
    }

    const tagName = fieldElement.tagName.toLowerCase();

    if (tagName === "select") {
      if (typeof window.jQuery === "function") {
        window.jQuery(fieldElement).val(previousValue).trigger("change");
      } else {
        fieldElement.value = previousValue;
        const changeEvent = new Event("change", { bubbles: true });
        fieldElement.dispatchEvent(changeEvent);
      }
    } else {
      fieldElement.value = previousValue;
    }
  });
}

function handleConvertHomeToCompanyAddressClick(event) {
  const clickedButtonElement = event.currentTarget;
  const portletElement = findPortletForElement(clickedButtonElement);

  if (!portletElement) {
    return;
  }

  const deliveryContainerElement = portletElement.querySelector(
    "#order_addressDelivery"
  );
  const addressTypeSelectElement = portletElement.querySelector(
    "#order_addressDelivery_type"
  );

  if (!deliveryContainerElement || !addressTypeSelectElement) {
    return;
  }

  const currentAddressSnapshot = getDeliveryAddressSnapshot(
    deliveryContainerElement
  );

  console.log(currentAddressSnapshot);

  addressTypeSelectElement.value = "company";
  const changeEvent = new Event("change", { bubbles: true });
  addressTypeSelectElement.dispatchEvent(changeEvent);

  window.setTimeout(() => {
    const refreshedDeliveryContainerElement =
      portletElement.querySelector("#order_addressDelivery") ||
      deliveryContainerElement;

    applyDeliveryAddressSnapshot(
      refreshedDeliveryContainerElement,
      currentAddressSnapshot
    );
  }, 500);
}
