export function orderNumberList() {
  const orders = [];

  if (window.location.pathname.startsWith("/order/order/detail/")) {
    const orderId = window.location.pathname.match(
      /\/order\/order\/detail\/([^/]+)\//
    )?.[1];
    return orderId ? [decodeURIComponent(orderId)] : [];
  }

  const table =
    document.getElementById("order-rdatatable") ||
    document.getElementById("DataTables_Table_0");

  if (!table) {
    return [];
  }

  const rows = table.querySelectorAll("tr.selected, tr[class~='selected']");
  rows.forEach((row) => {
    const orderLink =
      row.querySelector('a[href*="/order/order/detail/"]') ||
      row.querySelector("a");
    const orderIdFromHref = orderLink?.href?.match(
      /\/order\/order\/detail\/([^/]+)\//
    )?.[1];
    const orderId = orderIdFromHref
      ? decodeURIComponent(orderIdFromHref)
      : orderLink?.textContent?.trim();

    if (orderId && !orders.includes(orderId)) {
      orders.push(orderId);
    }
  });

  return orders;
}
