export const DEVICE_STORE_KEY='burger-kiosk.device-store.v114';
export function validStoreId(value){return /^[1-9]\d{0,8}$/.test(String(value??''));}
export function readDeviceStore(storage){
 let value;try{value=JSON.parse((storage??localStorage).getItem(DEVICE_STORE_KEY));}catch{return null;}
 return value?.version===1&&Number.isInteger(value.storeId)&&validStoreId(value.storeId)&&typeof value.storeName==='string'&&value.storeName.trim()&&Number.isFinite(value.linkedAt)?{version:1,storeId:value.storeId,storeName:value.storeName,linkedAt:value.linkedAt}:null;
}
export function writeDeviceStore(store,storage){
 if(!validStoreId(store.id)||typeof store.name!=='string'||!store.name.trim())throw new Error('연결할 매장을 다시 선택해 주세요.');
 const binding={version:1,storeId:Number(store.id),storeName:store.name,linkedAt:Date.now()};
 try{storage??=localStorage;storage.setItem(DEVICE_STORE_KEY,JSON.stringify(binding));if(readDeviceStore(storage)?.storeId!==binding.storeId)throw new Error();}
 catch{throw new Error('이 기기에 매장을 저장할 수 없습니다. 브라우저의 사이트 데이터 저장을 허용한 뒤 다시 시도해 주세요.');}
 return binding;
}
export function removeDeviceStore(storage=localStorage){storage.removeItem(DEVICE_STORE_KEY);if(storage.getItem(DEVICE_STORE_KEY)!==null)throw new Error('기기 연결을 해제하지 못했습니다. 다시 시도해 주세요.');}
export function customerStore(binding,url){if(binding)return binding.storeId;const id=new URL(url).searchParams.get('store');return validStoreId(id)?Number(id):null;}
export function setupStores(account){return account?.legacy?[]:(account?.stores??[]).filter(s=>account.platform_role==='HQ'||s.role==='OWNER');}
