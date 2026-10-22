import {digest} from './gmail-client.js';

// Which details a wishlist save's tag was made from (lib/wishlist-tags.js). Its own module, so readers of
// tags (brand taste, in the user context layer) don't import the tagger and the purchase modules behind it.
export const WISHLIST_TAG_VERSION=1;
const text=value=>typeof value==='string'?value.trim():'';
export const wishlistTagDetails=e=>({brand:text(e.brand)||null,name:text(e.display_name??e.name)||null,description:text(e.description??e.item_description).slice(0,300)||null});
export const wishlistTagFingerprint=e=>digest(JSON.stringify([WISHLIST_TAG_VERSION,wishlistTagDetails(e)])).slice(0,16);
