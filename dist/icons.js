const paths={
table:'<rect x="2" y="5" width="20" height="14" rx="7"/><path d="M7 9h10M7 15h10"/>',
archive:'<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9m-10 4h6"/>',
sliders:'<path d="M4 7h7m4 0h5M4 17h3m4 0h9"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
plus:'<path d="M12 5v14M5 12h14"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',
eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
spade:'<path d="M12 2c-2 4-8 7-8 12 0 4.5 5.5 6.5 8 2 2.5 4.5 8 2.5 8-2 0-5-6-8-8-12Z"/><path d="m12 16-2 5h4z"/>',
chat:'<path d="M20 14a4 4 0 0 1-4 4H9l-5 3v-5a4 4 0 0 1-1-3V8a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z"/><path d="M7 9h9m-9 4h6"/>',
layers:'<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v5c0 4 16 4 16 0V6M4 11v5c0 4 16 4 16 0v-5"/>',
people:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3m0-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 4 5"/>',
shield:'<path d="m12 2 8 3v6c0 6-8 11-8 11S4 17 4 11V5z"/><path d="m8 11 3 3 5-6"/>',
replay:'<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6"/><path d="M12 7v6l4 2"/>',
prev:'<path d="M6 5v14"/><path d="m17 5-9 7 9 7z" fill="currentColor"/>',next:'<path d="M18 5v14"/><path d="m7 5 9 7-9 7z" fill="currentColor"/>',
play:'<path d="m7 4 12 8-12 8z" fill="currentColor" stroke-linejoin="round"/>',pause:'<path d="M8 5v14m8-14v14" stroke-width="4"/>',
download:'<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 17v4h16v-4"/>',
chart:'<path d="M4 20h16M7 16v-4m5 4V5m5 11V9"/>',card:'<rect x="5" y="2" width="14" height="20" rx="2"/><path d="m12 8 3 4-3 4-3-4z"/>',
check:'<path d="m4 12 5 5L20 6"/>',chevron:'<path d="m9 5 7 7-7 7"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v7l4 2"/>'
};
export const icon=k=>'<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">'+(paths[k]||'')+'</svg>';
export function paintIcons(){document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);});}
