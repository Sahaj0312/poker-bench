// These marks identify participants when the dealer moves them to a new seat.
const marks=[
 '<path d="m12 1 2.5 7.4 7.5 3.6-7.5 3.4L12 23l-2.8-7.6L2 12l7.2-3.6z"/>',
 '<g stroke="currentColor" stroke-width="2.8"><path d="M12 1v22M1 12h22M4 4l16 16M4 20 20 4M7.7 1.9l8.6 20.2M1.9 7.7l20.2 8.6M1.9 16.3l20.2-8.6M7.7 22.1l8.6-20.2"/></g>',
 '<path d="m2 17 4-10 3 10 4-10 3 10 5-10" fill="none" stroke="currentColor" stroke-width="3.3"/>',
 '<path d="M2 3c0 4-1 7-2 9 3 1 5 4 6 8 0-4 3-7 6-8-4-3-5-5-6-9zM16 1c-1 5-4 9-7 11 3 1 6 4 7 10 1-5 4-8 7-10-4-2-6-6-7-11z"/>',
 '<path d="m2 18 7-13 4 6-4 7zm10 0 6-11 5 11z"/>'
];
const inks=['#9679f2','#e58d4c','#42b7a1','#7198fa','#caaa42'];
export function symbol(index){
 const i=Math.max(0,index)%marks.length;
 return '<span class="face glyph" style="--tone:'+inks[i]+'"><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">'+marks[i]+'</svg></span>';
}
