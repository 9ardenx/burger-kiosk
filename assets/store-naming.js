// Shared deterministic suggestion; the server reserves the final unique name.
export function suggestStoreName(address,locality='') {
 const text=String(address??'').normalize('NFC').trim();
 const tokens=text.match(/[가-힣A-Za-z0-9]+/g)??[];
 const city=tokens.find(t=>/[시군]$/.test(t)&&!/(특별시|광역시|특별자치시)$/.test(t));
 const district=tokens.find(t=>/구$/.test(t));
 const place=String(locality??'').normalize('NFC').trim()||tokens.find(t=>/[읍면동]$/.test(t));
 if(!place||! /^[가-힣A-Za-z0-9·-]{1,30}[읍면동]$/.test(place))return '';
 const root=/[읍면]$/.test(place)?(city??district):(district??city??tokens.find(t=>/(특별시|광역시|특별자치시)$/.test(t)));
 if(!root)return '';
 const area=root.replace(/특별자치시$|특별시$|광역시$|시$|군$|구$/,'');
 const local=place.replace(/[읍면동]$/,'');
 return area+local+'점';
}
