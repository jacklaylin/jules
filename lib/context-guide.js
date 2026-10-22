// How to read the derived rows of the user context layer (lib/user-context.js). Each derived fact used
// to carry this text inside its own value, so it was sent with the data on every agent round of every turn
// (October 22: about 4,600 tokens of profile per turn). Now it is stated once, in the instructions of each
// model that reads the rows, where the prompt cache keeps it. No imports: the guide is plain text.
export const FIELD_NOTES={
  shopping_history:'shopping_history: purchases from receipts. Soft evidence, not favourites, verified fit, ownership or a size default. fit_notes are the person\'s own reports of how one item fit in the size bought (true_to_size, runs_small, runs_large): that brand only, never converted to another size, never a category size.',
  store_orders:'shopping_history.store_orders counts orders, returns and the order totals shown per store: how often and how much they buy there, not loyalty.',
  wardrobe:'wardrobe: what they own now, by kind of item, from receipts and item photos. Owning is not wearing or liking.',
  outfit_photos:'outfit_photos: how many photos of their own outfits are kept and, when read, short observations of what they wear.',
  liked_items:'liked_items: items they liked (screenshots of their likes, shown options they liked). Taste, never wishlist items, purchases, stock or a size. Many are sold or one-of-a-kind: find similar items, not these listings.',
  wishlist:'wishlist: items they saved to their wishlist: things they want. Taste, not purchases, stock or a size.',
  brand_taste:'brand_taste: the brands they like. said: what they told Jules, dated (from: another source, such as the style report); bought: items kept, without returns, gifts and basics (bought_recently: last two years); wishlisted: distinct saves, newest dated; liked: likes. bought_as and wishlisted_as are kinds of items, not a limit: liking a brand carries across what it makes (its trousers make its shirts a good bet), but a sportswear- or basics-only label informs only those requests. Repeated, recent saves, likes and purchases show taste now; one old statement with nothing behind it is weaker. Purchases are not favourites. Never a filter, whitelist or claim of loyalty.',
};

// The notes for the given derived fields, in one block. Derived rows are soft evidence below anything the
// person states; avoids and corrections win.
export function contextGuide(fields=Object.keys(FIELD_NOTES)){
  const notes=fields.map(f=>FIELD_NOTES[f]).filter(Boolean);
  return notes.length?'Derived profile rows (field basis inferred) are soft evidence below anything the person states; their avoids and corrections win. How to read them:\n'+notes.join('\n')+'\n':'';
}
