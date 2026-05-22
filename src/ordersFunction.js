export function orderNumberList() {
  let orders = [];

  if (window.location.pathname.startsWith("/order/order/detail/")) {
    orders.push(window.location.pathname.split("/")[4]);
  } else {
    const table = document.getElementById("DataTables_Table_0");
    const rows = table.querySelectorAll('[class$="selected"]');
    if (!rows.length) {
      return false;
    }
    rows.forEach((row) => {
      orders.push(row.querySelector("a").textContent);
    });
  }

  return orders;
}
