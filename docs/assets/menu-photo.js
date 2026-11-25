// Publishing uses one exact ratio; source files remain untouched.
export const PHOTO_WIDTH=720, PHOTO_HEIGHT=465;
export function cropForPhoto(width,height,x=.5,y=.5,targetWidth=PHOTO_WIDTH,targetHeight=PHOTO_HEIGHT) {
  const scale=Math.max(targetWidth/width,targetHeight/height);
  const sw=targetWidth/scale, sh=targetHeight/scale;
  return {sx:(width-sw)*Math.max(0,Math.min(1,x)),sy:(height-sh)*Math.max(0,Math.min(1,y)),sw,sh};
}
export function photoPosition(form) {
  return {x:Number(form.elements['photo-x'].value)/100,y:Number(form.elements['photo-y'].value)/100};
}
export async function jpegForUpload(file,{x=.5,y=.5,width=PHOTO_WIDTH,height=PHOTO_HEIGHT}={}) {
  if(file.size>10*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(file.type))
    throw new Error('10 MB 이하의 JPG, PNG 또는 WebP 파일을 선택해 주세요.');
  const url=URL.createObjectURL(file), img=new Image();
  try {
    img.src=url;
    try {await img.decode();} catch {throw new Error('사진을 읽을 수 없습니다. 다른 사진을 선택해 주세요.');}
    // An already compliant JPEG does not need another lossy encoding pass.
    if(img.naturalWidth===width && img.naturalHeight===height && file.type==='image/jpeg' && file.size<=192000) {
      const bytes=new Uint8Array(await file.arrayBuffer());
      return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
    }
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#f5ead6';ctx.fillRect(0,0,width,height);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    const {sx,sy,sw,sh}=cropForPhoto(img.naturalWidth,img.naturalHeight,x,y,width,height);
    ctx.drawImage(img,sx,sy,sw,sh,0,0,width,height);
    for(const quality of [.92,.86,.72,.55,.38]) {
      const data=canvas.toDataURL('image/jpeg',quality).split(',')[1];
      if(data && data.length<=256000)return data;
    }
    throw new Error('사진 용량이 큽니다. 더 작은 이미지를 선택해 주세요.');
  } finally {URL.revokeObjectURL(url);}
}
