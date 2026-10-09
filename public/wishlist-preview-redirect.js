const item=new URLSearchParams(location.search).get('item');
if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item??''))location.replace('/wishlist?item='+item);
