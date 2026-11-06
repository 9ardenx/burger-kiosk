export const app = document.querySelector("#app");
export const money = value => new Intl.NumberFormat("ko-KR").format(value) + "원";
export const escapeText = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

export { api } from "./backend.js";

export function notice(message = "") {
  const element = document.querySelector("#notice");
  element.textContent = message;
  element.hidden = !message;
}

export function itemsHtml(items) {
  return items.map(item => {
    const options = item.options.map(option => option.name).join(", ");
    const unit = item.price + item.options.reduce((sum, option) => sum + option.option_price, 0);
    return '<div class="receipt-line"><div><b>' + escapeText(item.name) + ' × ' + item.quantity +
      '</b><small>' + escapeText(options || "기본 구성") + '</small></div><strong>' +
      money(unit * item.quantity) + '</strong></div>';
  }).join("");
}
