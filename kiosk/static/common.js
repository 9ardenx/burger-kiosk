export const app = document.querySelector("#app");
export const money = value => new Intl.NumberFormat("ko-KR").format(value) + "원";
export const escapeText = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

export async function api(path, body) {
  let response;
  try {
    response = await fetch(path, body === undefined ? {cache: "no-store"} : {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)
    });
  } catch {
    throw new Error("서버에 연결할 수 없습니다. 연결을 확인하고 다시 시도해 주세요.");
  }
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || "요청을 처리하지 못했습니다."), {
    status: response.status, code: data.code
  });
  return data;
}

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
