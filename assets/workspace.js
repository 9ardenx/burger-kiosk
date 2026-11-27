// Workspace is navigation only. Every API still verifies the server-side role.
export const hqTabs={hqhome:'본사 관리',hqsales:'통합 매출',hqsupply:'본사 발주 취합',franchise:'가맹점 관리',hqaccounts:'계정 관리'};
export const storeTabs={orders:'주문 현황',sales:'매출 분석',inventory:'재고 관리',materials:'재료 재고',supplies:'재료 발주·입고',menu:'메뉴 관리',categories:'분류 관리',ads:'광고 관리',promotions:'할인 관리',storeinfo:'매장 정보',accounts:'계정 관리'};
export const directStores=account=>(account?.stores??[]).filter(s=>s.membership_role==='OWNER');
export function workspaceRoute(account,{workspace,tab,storeId,freshLogin=false}={}){
 const hq=account?.platform_role==='HQ',stores=account?.stores??[];
 const mode=hq&&(freshLogin||workspace!=='store'||!stores.length)?'hq':'store';
 const store=stores.find(s=>s.id===storeId)??stores[0];
 if(mode==='hq'){
  const allowed={...hqTabs,...(store?{accounts:'',storeinfo:''}:{})};
  return {workspace:mode,tab:!freshLogin&&Object.hasOwn(allowed,tab)?tab:'hqhome',storeId:store?.id??null};
 }
 const allowed=store?.role==='STAFF'?{orders:storeTabs.orders}:{...storeTabs,...(account?.legacy?{security:'암호 관리'}:{})};
 return {workspace:mode,tab:store?.address_pending&&store.role!=='STAFF'&&!hq?'storeinfo':!freshLogin&&Object.hasOwn(allowed,tab)?tab:'orders',storeId:store?.id??null};
}
export function workspaceTabs(account,workspace){
 if(workspace==='hq'&&account?.platform_role==='HQ')return hqTabs;
 return {...storeTabs,...(account?.legacy?{security:'암호 관리'}:{})};
}
export const parentTab=tab=>tab==='accounts'?'hqaccounts':tab==='storeinfo'?'franchise':tab;
