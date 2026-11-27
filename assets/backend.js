import {accountToken,clearAccount} from './account-client.js?v=20261128-v113';
const API_ORIGIN = "https://burger-kiosk-9ardenx-api.epicowl12.chatgpt.site";
const keyPrefix = "burger-kiosk.cloud.v1.";
export function getStoreId(){const value=new URL(location.href).searchParams.get('store')??'1';return /^[1-9]\d{0,8}$/.test(value)?Number(value):1;}
export function selectStore(id,section,workspace){
  const before=new URL(location.href),url=new URL(before);url.searchParams.set('store',String(id));if(section)url.hash=section;if(workspace)url.searchParams.set('workspace',workspace);
  // Assigning only a hash does not reload modules; reopen the selected store view.
  if(url.pathname===before.pathname&&url.search===before.search){history.pushState(null,'',url);location.reload();}
  else location.assign(url.href);
}
for(const link of document.querySelectorAll('.mast a[href]')){const url=new URL(link.href);if(url.origin===location.origin){url.searchParams.set('store',String(getStoreId()));link.href=url.href;}}
function customerKey() {
  let key=sessionStorage.getItem(keyPrefix+"customer"+(getStoreId()===1?"":"."+getStoreId()));
  if(!key){key=crypto.randomUUID()+crypto.randomUUID();sessionStorage.setItem(keyPrefix+"customer"+(getStoreId()===1?"":"."+getStoreId()),key);}
  return key;
}
export function beginLogout(){const legacy=sessionStorage.getItem(keyPrefix+'staff');const account=clearAccount();sessionStorage.removeItem(keyPrefix+'staff');return account??legacy??'';}
async function api(path,body,tokenSnapshot) {
  const headers={"X-Kiosk-Session":customerKey(),"X-Kiosk-Store":String(getStoreId())};
  const token=sessionStorage.getItem(keyPrefix+"staff");
  const protectedPath=path.startsWith('/api/admin/')||path.startsWith('/api/account');
  const account=tokenSnapshot!==undefined?tokenSnapshot:protectedPath&&!['/api/admin/login','/api/admin/claim-account'].includes(path)?await accountToken():null;
  if(protectedPath&&(account||token))headers.Authorization='Bearer '+(account||token);
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
    if(response.status===401&&protectedPath&&tokenSnapshot===undefined){sessionStorage.removeItem(keyPrefix+'staff');clearAccount();}
    throw Object.assign(new Error(data.error||"요청을 처리하지 못했습니다."),{status:response.status,code:data.code});
  }
  if(path==='/api/admin/login'&&data.token){clearAccount();sessionStorage.setItem(keyPrefix+'staff',data.token);}
  if(path==='/api/admin/logout'&&tokenSnapshot===undefined){clearAccount();sessionStorage.removeItem(keyPrefix+'staff');}
  return data;
}
export { api };

export const photoUrl = key => new URL("/api/menu-photos/"+key, API_ORIGIN).href;
export const adPhotoUrl = key => new URL('/api/ad-photos/'+key, API_ORIGIN).href;
