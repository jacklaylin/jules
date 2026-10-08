// Reviewed logo files, not text impersonating a brand mark. Unknown assets are omitted.
export const BRAND_ASSETS=[
 {names:['sown again'],src:'/brand-assets/sown-again.png',source:'https://sownagain.com/'},
 {names:['oakley'],src:'/brand-assets/oakley.svg',source:'https://commons.wikimedia.org/wiki/File:Oakley_logo.svg'},
 {names:['adidas originals','adidas original'],src:'/brand-assets/adidas-originals.svg',source:'https://commons.wikimedia.org/wiki/File:Original_Adidas_logo.svg'},
 {names:['ssense'],src:'/brand-assets/ssense.svg',source:'https://commons.wikimedia.org/wiki/File:Ssense_logo.svg'},
];
export function brandAssetFor(label){return BRAND_ASSETS.find(asset=>asset.names.includes(String(label).trim().toLowerCase()))??null;}
