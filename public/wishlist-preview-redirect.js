const params=new URLSearchParams(location.search),item=params.get('item');
if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item??''))location.replace('/wishlist?item='+item);
else if(params.has('items'))location.replace('/wishlist');
