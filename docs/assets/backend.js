const API_ORIGIN = "https://burger-kiosk-9ardenx-api.epicowl12.chatgpt.site";
const keyPrefix = "burger-kiosk.cloud.v1.";
function customerKey() {
  let key=sessionStorage.getItem(keyPrefix+"customer");
  if(!key){key=crypto.randomUUID()+crypto.randomUUID();sessionStorage.setItem(keyPrefix+"customer",key);}
  return key;
}
async function api(path,body) {
  const headers={"X-Kiosk-Session":customerKey()};
  const token=sessionStorage.getItem(keyPrefix+"staff");
  if(path.startsWith("/api/admin/") && token)headers.Authorization="Bearer "+token;
  if(body!==undefined)headers["Content-Type"]="application/json";
  let response, data;
  try {
    response=await fetch(new URL(path,API_ORIGIN),{
      method:body===undefined?"GET":"POST",headers,body:body===undefined?undefined:JSON.stringify(body),
      cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer"
    });
    data=await response.json();
  } catch {
    throw new Error("매장 서버에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
  }
  if(!response.ok){
    if(response.status===401 && path.startsWith("/api/admin/"))sessionStorage.removeItem(keyPrefix+"staff");
    throw Object.assign(new Error(data.error||"요청을 처리하지 못했습니다."),{status:response.status,code:data.code});
  }
  if(path==="/api/admin/login" && data.token) sessionStorage.setItem(keyPrefix+"staff",data.token);
  if(path==="/api/admin/logout") sessionStorage.removeItem(keyPrefix+"staff");
  return data;
}
export { api };

export const photoUrl = key => new URL("/api/menu-photos/"+key, API_ORIGIN).href;
