import {check} from './problems.mjs';
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
// Preserve the existing v1.7 cover without rewriting its photo or stored catalog.
const placement=a=>a.placement??(a.id==='v17-new-products-banner'?'INTRO':'NORMAL');
export async function adState(db,publicOnly=false){
  const row=await db.prepare('SELECT items,revision FROM ad_catalog WHERE id=1').first();
  const items=JSON.parse(row?.items??'[]').map(a=>({...a,placement:placement(a)}));return {items:publicOnly?items.filter(a=>a.enabled):items,revision:row?.revision??0};
}
export async function saveAds(db,bucket,body){
  check(Number.isInteger(body.revision)&&body.revision>=0&&Array.isArray(body.items)&&body.items.length<=10,'광고는 최대 10개까지 등록할 수 있습니다.');
  const current=await adState(db);check(current.revision===body.revision,'광고가 변경되었습니다. 최신 목록에서 다시 수정해 주세요.',409,'ADS_CHANGED');
  const cleaned=[];
  for(const item of body.items){
    check(item&&typeof item.id==='string'&&/^[A-Za-z0-9_-]{16,80}$/.test(item.id),'광고 식별자를 확인해 주세요.');
    check(typeof item.title==='string'&&item.title.trim()&&[...item.title.trim()].length<=40,'광고 제목을 1~40자로 입력해 주세요.');
    check(typeof item.description==='string'&&[...item.description.trim()].length<=120&&typeof item.enabled==='boolean','광고 설명과 노출 상태를 확인해 주세요.');
    const previous=current.items.find(a=>a.id===item.id),position=item.placement??previous?.placement??placement(item);
    check(['INTRO','PRIORITY','NORMAL'].includes(position),'광고 노출 위치를 선택해 주세요.');
    let key=previous?.photo_key;
    if(Object.hasOwn(item,'photo')){
      check(typeof item.photo==='string'&&item.photo.length<=256000&&/^[A-Za-z0-9+/]+={0,2}$/.test(item.photo),'광고 사진 형식이 올바르지 않습니다.');
      let bytes;try{bytes=Uint8Array.from(atob(item.photo),c=>c.charCodeAt(0));}catch{check(false,'광고 사진 형식이 올바르지 않습니다.');}
      check(bytes.length<=192000&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217,'광고 사진 형식이 올바르지 않습니다.');
      key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      await bucket.put('ads/'+key,bytes,{httpMetadata:{contentType:'image/jpeg'}});
    }
    check(key,'광고 사진을 선택해 주세요.');
    cleaned.push({id:item.id,title:item.title.trim(),description:item.description.trim(),photo_key:key,enabled:item.enabled,placement:position});
  }
  check(new Set(cleaned.map(a=>a.id)).size===cleaned.length,'광고가 중복되었습니다.');
  check(cleaned.filter(a=>a.placement==='INTRO').length<=1,'첫 화면 소식은 하나만 지정할 수 있습니다. 기존 소식의 노출 위치를 먼저 변경해 주세요.');
  const results=await db.batch([db.prepare('INSERT OR IGNORE INTO ad_catalog(id) VALUES(1)'),
    stmt(db,'UPDATE ad_catalog SET items=?,revision=revision+1 WHERE id=1 AND revision=?',JSON.stringify(cleaned),body.revision)]);
  check(results[1].meta.changes===1,'광고가 변경되었습니다. 최신 목록에서 다시 수정해 주세요.',409,'ADS_CHANGED');
  return {items:cleaned,revision:body.revision+1};
}
