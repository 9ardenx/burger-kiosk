export const cartSessionKey=id=>'burger-kiosk-session-v1'+(String(id)==='1'?'':'.'+id);
export function capturePaymentReturn(href,binding,storage){
 const url=new URL(href);if(!url.pathname.endsWith('/payment-return.html'))return null;
 const q=url.searchParams,id=q.get('store'),attempt=q.get('attempt');
 const clean=new URL('./',url);if(/^[1-9]\d{0,8}$/.test(id??''))clean.searchParams.set('store',id);clean.searchParams.set('v','20261128-v115');
 const result={clean:clean.href,error:'결제를 시작한 브라우저와 매장에서 결과를 다시 확인해 주세요.'};
 if(!/^[1-9]\d{0,8}$/.test(id??'')||!/^\w{32}$/.test(attempt??'')||(binding&&String(binding.storeId)!==id))return result;
 let state;try{state=JSON.parse(storage.getItem(cartSessionKey(id)));}catch{return result;}
 if(!state?.orderId||state.paymentId!==attempt||!storage.getItem('burger-kiosk.cloud.v1.customer'+(id==='1'?'':'.'+id)))return result;
 const data=q.get('failed')==='1'?{cancel:true}:{paymentKey:q.get('paymentKey'),orderId:q.get('orderId'),amount:Number(q.get('amount'))};
 if(!data.cancel&&(data.orderId!==attempt||typeof data.paymentKey!=='string'||!data.paymentKey||data.paymentKey.length>200||!Number.isSafeInteger(data.amount)||data.amount<=0))return result;
 state.callback={attempt,data};storage.setItem(cartSessionKey(id),JSON.stringify(state));return {clean:clean.href,error:null};
}
