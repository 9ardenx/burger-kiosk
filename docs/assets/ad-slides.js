// Ads are editorial overrides; menu introductions are derived, never stored as ads.
export function buildAdSlides(ads,menus){
 const visible=ads.filter(a=>a.enabled!==false);
 const intro=visible.filter(a=>a.placement==='INTRO');
 const priority=visible.filter(a=>a.placement==='PRIORITY');
 const ordinary=visible.filter(a=>!['INTRO','PRIORITY'].includes(a.placement));
 const automatic=menus.filter(m=>m.photo_key&&!m.is_sold_out).toSorted((a,b)=>b.id-a.id)
  .map(m=>({id:'menu:'+m.id,slide_type:'MENU',menu:m,title:m.name,description:m.description}));
 return [...intro,...priority,...automatic,...ordinary];
}
