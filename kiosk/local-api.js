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

export const photoUrl = key => "/api/menu-photos/"+key;
