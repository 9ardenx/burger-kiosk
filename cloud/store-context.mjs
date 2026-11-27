import {check} from './problems.mjs';
// Request-local context: never mutate the shared D1 binding between requests.
export const storeId=db=>db.storeId??1;
export function storeDb(db,id){return {storeId:id,prepare:sql=>db.prepare(sql),batch:commands=>db.batch(commands)};}
export async function resolveStore(db,request){
 const raw=request.headers.get('X-Kiosk-Store')??'1';
 check(/^[1-9]\d{0,8}$/.test(raw),'매장 번호를 확인해 주세요.',400,'INVALID_STORE');
 const store=await db.prepare('SELECT id,name FROM store WHERE id=? AND enabled=1').bind(Number(raw)).first();
 check(store,'이용할 수 없는 매장입니다.',404,'STORE_NOT_FOUND');return store;
}
