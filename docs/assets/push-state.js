const database='burger-kiosk.push.v113';
export async function pushState(key,value){
 const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(database,1);request.onupgradeneeded=()=>request.result.createObjectStore('state');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 try{return await new Promise((resolve,reject)=>{const transaction=db.transaction('state',arguments.length>1?'readwrite':'readonly'),store=transaction.objectStore('state');const request=arguments.length>1?(value===null?store.delete(key):store.put(value,key)):store.get(key);let result;request.onsuccess=()=>{result=request.result;};transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});}finally{db.close();}
}
