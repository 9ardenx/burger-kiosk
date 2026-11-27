import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAdSlides} from '../docs/assets/ad-slides.js';

test('v1.7 slides put intro and editorial priority before newest registered menus',()=>{
 const menu=[{id:2,name:'둘째',description:'설명',photo_key:'2'},{id:9,name:'최신',photo_key:'9'},{id:1,name:'첫째',photo_key:'1'}];
 const ads=[{id:'ordinary',enabled:true,placement:'NORMAL'},{id:'priority-2',enabled:true,placement:'PRIORITY'},{id:'intro',enabled:true,placement:'INTRO'},{id:'priority-1',enabled:true,placement:'PRIORITY'}];
 assert.deepEqual(buildAdSlides(ads,menu).map(s=>s.id),['intro','priority-2','priority-1','menu:9','menu:2','menu:1','ordinary']);
 assert.equal(buildAdSlides([],menu)[1].description,'설명');assert.deepEqual(menu.map(m=>m.id),[2,9,1]);
});
test('v1.7 hidden ads, sold-out and unpictured menus are excluded; edits do not become new registration',()=>{
 const menus=[{id:1,name:'방금 수정한 옛 메뉴',photo_key:'1'},{id:5,name:'최신 등록',photo_key:'5'},{id:6,photo_key:'6',is_sold_out:1},{id:7,photo_key:null}];
 assert.deepEqual(buildAdSlides([{id:'hidden',placement:'PRIORITY',enabled:false}],menus).map(s=>s.id),['menu:5','menu:1']);
 assert.deepEqual(buildAdSlides([],[]),[]);
});
