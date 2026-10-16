# Brand niche list: draft for founder approval

Approved October 15, 2026. Editorial data for the **Gatekeeper score** card and the **Mall ↔ Esoteric** slider on the Spectrum closer ([style-report-brief.md](style-report-brief.md), [spectrum-types-draft.md](spectrum-types-draft.md)). Add brands as testers buy them. Next step: this becomes `data/brand-niche.json`.

These scores are opinions about how widely known a label is, not facts about a person. Code only ever shows a person their own brands ranked by this list; it never claims anything the receipts don't show.

## Columns

- **Niche** (0–100): how obscure the label is to a general shopper in the US/UK/EU. 0 = everyone's mall; 100 = only people who read the stockist list. This measures **obscurity, not price**: Louis Vuitton is expensive and scores 10.
- **Tier**: rough price position, used only for the Thrifty ↔ Spendy slider and never shown as money. `V` value · `M` mid · `P` premium · `L` luxury.
- **Lean**: used only for the Trendy ↔ Classic slider. `C` classic/heritage · `N` neither · `T` trend-led.
- **For**: where most of the range sits. `W` mostly womenswear · `M` mostly menswear · `A` both. Only used to check this list is balanced; never used on a person.

Bands, as a guide for edits:

| Score | Band | Feel |
|---|---|---|
| 0–15 | The mall | Everyone owns some |
| 16–35 | Known name | Recognized on sight by most people |
| 36–55 | Fashion-aware | Known to people who follow clothes |
| 56–75 | Cult | Known to people who *really* follow clothes |
| 76–100 | Deep cut | Friends will ask you to spell it |

## How the score is computed (proposal)

1. Match each order line to a brand on this list (by brand name, then by store domain). Unmatched brands are **left out, not guessed**.
2. For multi-brand stores (SSENSE, Nordstrom, Grailed…), use the **item's brand** when the receipt names one; fall back to the store's own row only when it doesn't.
3. Score = average niche of the person's most niche quarter of matched brands (at least 3), each brand counted once however many orders it has. Changed October 16 at the founder's request: an order-weighted average of all brands let restocked basics (Lululemon, Nike) drag down someone who also buys Satisfy, Bode and Eckhaus Latta.
4. Show the card only with **3+ matched distinct brands** covering at least half of the person's orders. Otherwise the card is skipped.

## Mass market and mall (0–15)

| Brand | Niche | Tier | Lean | For | Reason |
|---|---|---|---|---|---|
| Shein | 1 | V | T | W | The most-downloaded shopping app on earth |
| Walmart | 1 | V | N | A | A store, not a clue |
| Amazon | 1 | V | N | A | Where every search ends eventually |
| H&M | 2 | V | T | A | On every high street in every country |
| Old Navy | 2 | V | N | A | Matching family tees, the national costume |
| Nike | 2 | M | N | A | The most famous swoosh in the world |
| Target | 2 | V | N | A | Went in for shampoo, left with a cardigan |
| Kohl's | 2 | V | C | A | Coupon-powered department store |
| Men's Wearhouse | 2 | V | C | M | The suit rental at every prom |
| Primark | 3 | V | T | A | High street at its lowest price point |
| Zara | 3 | M | T | A | The runway, three weeks later, in every mall |
| Forever 21 | 3 | V | T | W | A teenage rite of passage |
| Fashion Nova | 3 | V | T | W | Built on Instagram, worn all over it |
| Adidas | 3 | M | N | A | Three stripes, globally |
| Macy's | 3 | M | C | A | The parade, the department store, the default |
| Skechers | 3 | V | N | A | Comfort shoes for every age |
| TJ Maxx | 3 | V | N | A | Treasure hunt, mostly for other people's overstock |
| Under Armour | 3 | M | N | A | Sports-team-locker-room famous |
| Gap | 4 | M | C | A | Hoodie with the logo, since forever |
| American Eagle | 4 | V | N | A | Every school hallway's denim |
| Puma | 4 | M | N | A | Global sportswear staple |
| Converse | 4 | M | C | A | The Chuck Taylor needs no introduction |
| Nordstrom Rack | 4 | V | N | A | The outlet everyone has a story about |
| Victoria's Secret | 4 | M | N | W | Mall anchor for decades |
| Uniqlo | 5 | V | C | A | Heattech is basically infrastructure |
| ASOS | 5 | V | T | A | Ten thousand new arrivals a week |
| Hollister | 5 | V | N | A | Dim lighting, loud cologne, every mall |
| Express | 5 | M | N | A | Mall workwear for the first job |
| Jos. A. Bank | 5 | M | C | M | Famous for its multi-suit deals |
| Columbia | 5 | M | C | A | The fleece at every school pickup |
| Tommy Hilfiger | 5 | M | C | A | Red, white, blue, everywhere |
| Cole Haan | 8 | M | C | A | Dress shoes for the commute |
| Michael Kors | 5 | M | N | W | The airport bag of a generation |
| Vans | 5 | M | C | A | Skate shoes that went fully mainstream |
| Mango | 6 | M | T | W | Spain's other giant high-street label |
| Levi's | 6 | M | C | A | The original jeans |
| Calvin Klein | 6 | M | C | A | The waistband everyone has seen |
| Ann Taylor / LOFT | 6 | M | C | W | Office staple for decades |
| Lands' End | 6 | M | C | A | Catalog classics, monogram optional |
| The North Face | 6 | M | N | A | The puffer on every commute |
| Champion | 6 | V | C | A | The C logo on every gym sweatshirt |
| Crocs | 6 | V | T | A | Divisive, and still everywhere |
| Ugg | 6 | M | N | A | A whole season's footwear |
| Ray-Ban | 6 | M | C | A | The default sunglasses |
| Lulus | 6 | V | T | W | Wedding-guest dress headquarters |
| Lululemon | 7 | M | N | A | Leggings that became a uniform |
| Talbots | 7 | M | C | W | Classic, buttoned-up, reliable |
| Abercrombie & Fitch | 8 | M | N | A | Rebranded and back in every mall |
| Banana Republic | 8 | M | C | A | Business casual, the original |
| Nordstrom | 8 | P | C | A | The nice department store |
| Skims | 8 | M | T | W | A celebrity basics line known to all |
| Coach | 8 | M | C | W | The leather bag your mom also had |
| eBay | 8 | V | N | A | The internet's attic |
| Chico's | 8 | M | C | W | Mall staple with a loyal following |
| Athleta | 9 | M | N | W | Gap's activewear, in every suburb |
| Kate Spade | 9 | M | C | W | Polka dots and bows, widely gifted |
| L.L.Bean | 9 | M | C | A | The boot and the tote everyone inherits |
| Hugo Boss | 10 | P | C | M | The airport-lounge suit |
| Ralph Lauren | 9 | P | C | A | The pony is on every continent |
| Princess Polly | 9 | V | T | W | Aussie fast fashion, very online |
| New Balance | 9 | M | C | A | Dad shoe turned everyone shoe |
| Patagonia | 10 | P | C | A | The fleece vest of every office |
| J.Crew | 10 | M | C | A | American preppy default |
| Dr. Martens | 10 | M | C | A | Yellow stitching, every subculture |
| Birkenstock | 10 | M | C | A | Cork footbed, universal |
| J.Jill | 10 | M | C | W | Relaxed layers, mall and catalog |
| Urban Outfitters | 10 | M | T | A | Dorm room and vintage-looking tees |
| Poshmark | 10 | V | N | A | Closet resale for everyone |
| ThredUp | 10 | V | N | W | The giant online thrift store |
| Alo Yoga | 12 | M | T | W | Studio wear seen in every café |
| Vineyard Vines | 12 | M | C | M | Pink whale, very visible |
| Free People | 12 | M | T | W | Boho, in every mall |
| Madewell | 12 | M | C | W | The jeans brand of the 2010s |
| Carhartt | 12 | M | C | A | Real workwear, also on every campus |
| Dickies | 12 | V | C | A | Work pants with a skater second life |
| Hoka | 12 | M | T | A | Chunky running shoe gone mainstream |
| On | 12 | M | T | A | The Swiss runner on every commuter |
| Anthropologie | 13 | M | N | W | Whimsical mall staple |
| Revolve | 13 | M | T | W | The influencer department store |
| Quince | 14 | V | C | A | Cheap cashmere, heavily advertised |
| Allbirds | 14 | M | N | A | The wool sneaker of every startup |
| Johnston & Murphy | 12 | M | C | M | Dress shoes, mall and outlet |
| Chubbies | 14 | M | T | M | Short shorts, loud prints |
| Bonobos | 15 | M | C | M | Chinos that fit, built online |
| Brooks Brothers | 14 | M | C | M | America's oldest menswear name |
| Vinted | 14 | V | N | A | Europe's peer-to-peer resale app |
| Clarks Originals | 14 | M | C | A | The desert boot, widely known |

## Known names and contemporary (16–35)

| Brand | Niche | Tier | Lean | For | Reason |
|---|---|---|---|---|---|
| Everlane | 16 | M | C | A | Radical transparency, heavily marketed |
| Psycho Bunny | 16 | M | N | M | Skull-bunny polos at the outlet mall |
| Fear of God Essentials | 16 | M | T | M | The beige hoodie of every airport |
| Charles Tyrwhitt | 16 | M | C | M | Shirts by the box |
| Blundstone | 16 | M | C | A | Chelsea boot gone everyday |
| Shopbop | 16 | P | N | W | Big contemporary multi-brand site |
| Fjällräven | 16 | M | C | A | The square backpack on every commute |
| Barbour | 18 | P | C | A | Waxed jacket, countryside to city |
| AllSaints | 18 | M | N | A | Leather jackets and sheepskin, high street |
| Aritzia | 18 | M | T | W | North American fan favorite |
| Massimo Dutti | 18 | M | C | A | Zara's grown-up sibling |
| Eileen Fisher | 18 | P | C | W | Soft, loose, consistent |
| Arc'teryx | 18 | P | N | A | Gorpcore made it a city brand |
| Golden Goose | 18 | P | T | A | Distressed sneakers, very recognizable |
| Moncler | 18 | L | N | A | The luxury puffer everyone clocks |
| Supreme | 18 | M | T | A | The box logo needs no explanation |
| Vuori | 18 | M | N | A | Joggers on every dad at the airport |
| Mejuri | 18 | M | T | W | Everyday gold, heavily advertised |
| Smartwool | 18 | M | C | A | Hiking socks everyone owns |
| Saks Fifth Avenue | 18 | P | C | A | Famous luxury department store |
| Neiman Marcus | 18 | P | C | A | Famous luxury department store |
| Club Monaco | 20 | M | C | A | Clean basics, mall-adjacent |
| Reformation | 22 | P | T | W | The cool-girl dress everyone knows |
| COS | 22 | M | C | A | H&M's minimal side, very widespread |
| Theory | 22 | P | C | A | Office tailoring, well known |
| Allen Edmonds | 22 | P | C | M | American-made dress shoes |
| Peter Millar | 22 | P | C | M | Golf-club polos and quarter-zips |
| Reiss | 22 | P | C | A | British high-street premium |
| Salomon | 22 | M | T | A | Trail shoes that moved to the city |
| Farfetch | 22 | P | N | A | Giant luxury marketplace |
| Depop | 22 | V | T | A | Gen Z resale with a filter |
| Cotopaxi | 22 | M | N | A | Bright backpacks, very visible |
| Vince | 24 | P | C | A | Soft cashmere, quiet but widespread |
| Mizzen+Main | 24 | M | N | M | Stretch dress shirts, sports-star ads |
| Rhone | 24 | M | N | M | Gym-to-office for men |
| Veja | 24 | M | N | A | The V sneaker on every city street |
| Stüssy | 24 | M | N | A | Surf-streetwear, long famous |
| Outdoor Voices | 24 | M | T | W | "Doing things" activewear |
| Sandro | 26 | P | N | A | Parisian contemporary at department stores |
| Maje | 26 | P | T | W | Sandro's sister, same reach |
| & Other Stories | 26 | M | T | W | H&M Group's more curated label |
| Rag & Bone | 26 | P | C | A | New York denim and boots |
| Mack Weldon | 26 | M | N | M | Underwear subscriptions for men |
| Kith | 26 | P | T | A | Sneaker store turned lifestyle label |
| Carhartt WIP | 26 | M | N | A | The European streetwear Carhartt |
| The RealReal | 26 | P | N | A | Consigned luxury, famous ads |
| Faherty | 28 | P | C | M | Beachy shirts, very coastal |
| Suitsupply | 28 | M | C | M | Sharp suits, big footprint |
| Net-a-Porter | 28 | L | N | W | The original luxury e-tailer |
| Chloé | 28 | L | N | W | Boho luxury house, well known |
| Frame | 30 | P | N | W | Jeans with a celebrity following |
| Sézane | 30 | P | C | W | French-girl in a box, heavily followed |
| Palace | 30 | M | T | A | Skate label with lines around the block |
| Filson | 30 | P | C | A | Seattle bags built for logging |
| Red Wing | 30 | P | C | A | Work boots turned heritage icon |
| Huckberry | 30 | M | C | M | Online store for weekend-cabin menswear |
| Stone Island | 30 | P | N | M | The compass badge, terrace-famous |
| Belstaff | 30 | P | C | M | Motorcycle jackets with history |
| Represent | 30 | P | T | M | Manchester streetwear, very online |
| Jacquemus | 30 | L | T | A | The tiny bag that went viral |
| Max Mara | 30 | L | C | W | The camel coat everyone recognizes |
| Mytheresa | 30 | L | N | A | Big luxury e-tailer |
| Bergdorf Goodman | 30 | L | C | A | Fifth Avenue legend |
| Cuyana | 30 | P | C | W | "Fewer, better" leather goods |
| Mr Porter | 32 | L | C | M | The menswear e-tailer |
| Arket | 32 | M | C | A | H&M Group's Nordic, quieter label |
| Todd Snyder | 32 | P | C | M | American menswear, collab-heavy |
| Citizens of Humanity | 32 | P | N | W | Premium denim, department-store staple |
| Isabel Marant | 32 | L | T | W | Wedge sneakers, Paris cool |
| Mother | 32 | P | T | W | Premium denim with cheeky names |
| Polène | 34 | P | T | W | The Paris bag that went everywhere |
| Gentle Monster | 32 | P | T | A | Seoul eyewear in every celebrity selfie |
| Miu Miu | 32 | L | T | W | Prada's younger sister, very online |
| Agolde | 34 | P | T | W | The 90s jean of the moment |
| Buck Mason | 34 | P | C | M | Clean American basics for men |
| Outerknown | 34 | P | N | M | Surfer-founded, sustainable |
| Staud | 34 | P | T | W | The bucket bag of 2019 |
| Ami Paris | 34 | P | N | A | The heart logo on many sweaters |
| Sporty & Rich | 34 | M | T | A | Wellness slogans on sweatshirts |
| Vestiaire Collective | 34 | P | N | A | European luxury resale |
| Moscot | 34 | P | C | A | Old Lower East Side opticians |
| Matches | 34 | L | N | A | London luxury e-tailer |
| Celine | 34 | L | N | A | Luxury house, widely known |
| Bottega Veneta | 34 | L | N | A | The woven leather everyone now knows |

## Luxury houses (scored by obscurity, not price)

| Brand | Niche | Tier | Lean | For | Reason |
|---|---|---|---|---|---|
| Louis Vuitton | 10 | L | C | A | The monogram is a global language |
| Gucci | 12 | L | T | A | Double G, globally |
| Chanel | 12 | L | C | W | Instantly recognized anywhere |
| Burberry | 14 | L | C | A | The check, the trench |
| Dior | 14 | L | C | A | Household-name couture |
| Versace | 14 | L | T | A | Medusa head, very loud |
| Saint Laurent | 20 | L | N | A | Famous name, famous logo |
| Prada | 20 | L | N | A | The triangle plaque everyone knows |
| Balenciaga | 22 | L | T | A | Ugly-sneaker headlines |
| Fendi | 22 | L | N | W | Baguette bag fame |
| Hermès | 22 | L | C | A | Waitlists, orange boxes |
| Valentino | 24 | L | N | W | Red-carpet regular |
| Givenchy | 26 | L | N | A | Big house, big name |
| Tom Ford | 26 | L | C | A | Famous name, sharp suits |
| Alexander McQueen | 28 | L | N | A | Chunky white sneakers everywhere |
| Loewe | 38 | L | T | A | Clever leather, rising fast |
| Loro Piana | 44 | L | C | A | Quiet luxury memes made it famous |
| Thom Browne | 44 | L | C | A | The grey suit with the stripe |
| Maison Margiela | 46 | L | N | A | Tabi boots and four white stitches |
| Brunello Cucinelli | 48 | L | C | A | Cashmere for people who don't do logos |
| Comme des Garçons | 48 | L | N | A | The heart logo is famous; the mainline isn't |
| Marni | 50 | L | T | A | Color and odd proportions |
| Issey Miyake | 52 | L | N | A | Pleats Please and the Bao Bao bag |
| JW Anderson | 52 | L | T | A | Clever, playful London house |
| Jil Sander | 52 | L | C | A | German minimalism, for minimalism fans |
| The Row | 54 | L | C | W | Discreet to the point of no logo at all |
| Rick Owens | 60 | L | N | A | Dark, draped, devoted fans |
| Dries Van Noten | 62 | L | N | A | Antwerp prints for people who know |
| Raf Simons | 64 | L | N | M | Archive-worthy to collectors |
| Yohji Yamamoto | 68 | L | N | A | Black, cut by a legend |

## Premium and fashion-aware (36–55)

| Brand | Niche | Tier | Lean | For | Reason |
|---|---|---|---|---|---|
| Ganni | 35 | P | T | W | Danish cool, now on every high street |
| Faithfull the Brand | 36 | M | T | W | Holiday dresses, very Instagram |
| Cult Gaia | 36 | P | T | W | The acrylic bag of a summer |
| Acne Studios | 38 | P | N | A | Pink bags, scarves, followers |
| A.P.C. | 38 | P | C | A | Raw denim and very plain sweatshirts |
| Aimé Leon Dore | 38 | P | C | M | New York nostalgia, long queues |
| Castelli | 38 | P | N | A | Scorpion logo, every group ride |
| Girlfriend Collective | 38 | M | N | W | Recycled-bottle leggings |
| Set Active | 38 | M | T | W | Matching sets, waitlists |
| The Frankie Shop | 40 | P | T | W | Oversized blazers, very downtown |
| Rapha | 40 | P | N | A | Gateway premium cycling |
| SSENSE | 40 | P | T | A | Where the cult brands are found online |
| Common Projects | 40 | L | C | A | Gold serial numbers, quiet sneaker |
| Rouje | 40 | P | T | W | Parisian dresses with a following |
| Realisation Par | 40 | P | T | W | The slip skirt of 2017 |
| Taylor Stitch | 40 | P | C | M | Workwear for the slow-fashion crowd |
| Unbound Merino | 38 | M | N | M | Travel clothes for one-bag packers |
| Ulla Johnson | 40 | P | N | W | Prairie romance, fashion-week regular |
| Doen | 42 | P | N | W | Californian prairie dresses |
| End. Clothing | 42 | P | N | M | Menswear store for sneaker nerds |
| Spier & Mackay | 44 | M | C | M | Online-forum tailoring favorite |
| C.P. Company | 42 | P | N | M | Goggle jackets, Italian terrace cult |
| Proper Cloth | 42 | P | C | M | Made-to-measure shirts online |
| Noah | 46 | P | C | M | Preppy New York label from an ex-Supreme founder |
| Bodega | 44 | P | T | A | Boston store behind a fake bodega |
| Mansur Gavriel | 44 | P | C | W | Bucket bag, minimalist favorite |
| Wax London | 46 | M | N | M | Small London menswear label |
| Norse Projects | 46 | P | C | M | Scandi menswear basics |
| Sunspel | 46 | P | C | A | The plain tee, since 1860 |
| Rotate Birger Christensen | 46 | P | T | W | Copenhagen party dresses |
| Ancient Greek Sandals | 48 | P | C | W | The sandal fashion editors keep buying |
| Toteme | 48 | P | C | W | Stockholm minimalism with a scarf coat |
| Drake's | 50 | P | C | M | Ties and Ivy, cult among the tailored |
| Ciele | 50 | M | N | A | Running caps, cult among runners |
| Nanushka | 50 | P | T | W | Vegan leather from Budapest |
| Lisa Says Gah | 50 | M | T | W | Indie San Francisco shop and label |
| Aeyde | 50 | P | C | W | Clean Berlin shoes |
| Khaite | 52 | L | C | W | New York minimalism, quietly loved |
| Alden | 52 | L | C | M | Shell cordovan, waitlists among shoe nerds |
| Oliver Spencer | 52 | P | C | M | Small British menswear house |
| Snow Peak | 52 | P | N | A | Japanese camping, fashion fans followed |
| Grailed | 52 | P | N | M | Menswear resale for archive hunters |
| Percival | 54 | M | N | M | Small London label, embroidered details |
| Tricker's | 54 | P | C | M | Northampton country boots |

## Cycling and running

| Brand | Niche | Tier | Lean | For | Reason |
|---|---|---|---|---|---|
| Tracksmith | 56 | P | C | A | Ivy-league-looking running kit |
| MAAP | 58 | P | T | A | Melbourne cycling kit with a cult following |
| Pas Normal Studios | 64 | P | T | A | Copenhagen kit, fashion-adjacent riders |
| Velocio | 66 | P | N | A | Small Vermont cycling label |
| Café du Cycliste | 66 | P | N | A | Côte d'Azur kit, mostly known to riders |
| Ornot | 70 | P | N | A | Small-batch San Francisco cycling kit |
| Attaquer | 70 | P | T | A | Sydney kit, graphic and cultish |
| Bandit | 72 | P | T | A | Brooklyn running crew label |
| Soar | 72 | P | N | A | Technical running kit for obsessives |
| Satisfy | 74 | L | T | A | Paris running gear, deliberately frayed |
| District Vision | 74 | P | T | A | Running sunglasses and meditation |
| Search and State | 82 | P | N | A | Made-in-New-York cycling kit, tiny runs |

## Outdoor and technical

| Brand | Niche | Tier | Lean | For | Reason |
|---|---|---|---|---|---|
| Norrøna | 60 | P | N | A | Norwegian technical, little US presence |
| Veilance | 64 | L | N | M | Arc'teryx's city line, very hushed |
| Goldwin | 66 | P | N | A | Japanese technical outerwear |
| And Wander | 72 | P | T | A | Tokyo hiking gear with design obsessives |

## Cult and indie, womenswear-led

| Brand | Niche | Tier | Lean | For | Reason |
|---|---|---|---|---|---|
| Rachel Comey | 58 | P | N | W | New York label for creative types |
| Paloma Wool | 58 | M | T | W | Barcelona art-school knits |
| St. Agni | 58 | P | C | W | Australian minimal leather |
| Sandy Liang | 62 | P | T | W | Chinatown-raised bows and fleece |
| Rejina Pyo | 62 | P | N | W | London label with sculptural shoes |
| Simone Rocha | 62 | L | N | W | Pearls, tulle and a little gothic |
| Molly Goddard | 64 | L | T | W | Big tulle dresses, London |
| Christopher Esber | 66 | P | T | W | Sydney cut-outs |
| Cecilie Bahnsen | 66 | L | N | W | Puffed Copenhagen dresses |
| Collina Strada | 66 | P | T | W | Upcycled and very psychedelic |
| Matteau | 66 | P | C | W | Sydney swimwear, very minimal |
| Ciao Lucia | 70 | P | N | W | Small LA label, Italian summer |
| Baserange | 72 | P | C | W | Undyed basics from France and Denmark |
| Shushu/Tong | 74 | P | T | W | Shanghai bows and schoolgirl twists |
| Low Classic | 74 | P | N | W | Seoul minimalism |
| Le Monde Béryl | 76 | P | C | W | London ballet flats in silk |
| Eckhaus Latta | 76 | P | T | A | Art-world downtown label |
| Maryam Nassir Zadeh | 76 | P | N | W | MNZ, the downtown indie store and label |
| Jesse Kamm | 78 | P | C | W | The sailor pant, from a tiny LA studio |
| Ninamounah | 80 | P | T | W | Amsterdam, dark and conceptual |
| Black Crane | 80 | P | C | W | LA architectural basics |
| Lauren Manoogian | 82 | P | C | W | Hand-knit textures from Los Angeles |
| Martiniano | 82 | P | C | W | Hand-made slippers from Milan |
| Amomento | 84 | P | C | W | Korean minimalism, few Western stockists |
| Cawley Studio | 84 | P | C | W | Small London studio, workwear shapes |

## Cult and indie, menswear-led

| Brand | Niche | Tier | Lean | For | Reason |
|---|---|---|---|---|---|
| Universal Works | 56 | M | C | M | Nottingham workwear with a fan base |
| YMC | 58 | P | N | A | You Must Create, London indie |
| Paraboot | 58 | P | C | A | Norwegian-welted French shoes |
| Studio Nicholson | 62 | P | C | A | Wide trousers for the very particular |
| Our Legacy | 64 | P | N | M | Stockholm label, quiet cult |
| Margaret Howell | 64 | P | C | A | British plain clothes, devoted fans |
| Beams Plus | 64 | P | C | M | Japanese take on American Ivy |
| ERL | 64 | P | T | M | Venice Beach surf nostalgia |
| Lemaire | 66 | L | C | A | Paris softness, the croissant bag |
| J.M. Weston | 66 | L | C | M | Paris loafers, very old school |
| Nigel Cabourn | 66 | P | C | M | Military archive obsessive |
| Sacai | 62 | L | T | A | Two garments spliced into one |
| Brain Dead | 62 | M | T | A | LA collective, graphic and weird |
| Junya Watanabe | 66 | L | N | A | CdG's patchwork genius |
| Engineered Garments | 68 | P | N | M | New York pockets on pockets |
| Wales Bonner | 68 | L | N | A | Sharp, scholarly, Adidas Sambas |
| Jacques Marie Mage | 68 | L | N | A | Very heavy, very expensive frames |
| Bode | 70 | L | N | A | Antique quilts turned into shirts |
| Cav Empt | 70 | P | T | M | Tokyo glitch graphics |
| Le Laboureur | 72 | M | C | A | French work jackets, the real ones |
| Needles | 70 | P | T | M | Butterfly track pants |
| Martine Rose | 70 | L | T | M | London club-culture tailoring |
| Charles Jeffrey Loverboy | 70 | P | T | A | Punk tartan from London |
| Online Ceramics | 70 | M | T | A | Psychedelic tees for Deadheads |
| Undercover | 70 | L | N | A | Jun Takahashi's punk-Tokyo |
| Anderson & Sheppard | 70 | L | C | M | Savile Row's haberdashery shop |
| Kapital | 72 | P | N | A | Boro patchwork and smiley bandanas |
| S.S. Daley | 72 | P | N | M | Young London label, theatrical |
| Craig Green | 72 | L | N | M | Quilted workwear with straps |
| Ottolinger | 72 | P | T | W | Berlin burn-and-drape |
| Hereu | 72 | P | C | A | Barcelona woven leather shoes |
| Viberg | 72 | L | C | M | Canadian boots for boot forums |
| Visvim | 74 | L | N | M | Japanese folk-art luxury |
| The Armoury | 74 | L | C | M | Tailoring shop for the forum crowd |
| Orslow | 74 | P | C | M | Japanese fatigue pants |
| Blue Blue Japan | 74 | P | C | A | Indigo dyeing as a lifestyle |
| Séfr | 74 | P | N | M | Malmö menswear, softly odd |
| Sky High Farm Workwear | 74 | P | N | A | Farm-charity workwear |
| JJJJound | 76 | P | C | A | Montreal mood board turned label |
| Auralee | 78 | P | C | A | Tokyo label of fabric obsessives |
| Paolina Russo | 78 | P | T | W | Knit sportswear from London |
| Story mfd. | 80 | P | N | A | Hand-dyed, hand-stitched, Brighton |
| Bryceland's | 80 | P | C | M | Western-leaning tailoring shop |
| Lady White Co. | 80 | P | C | M | The tee for people with a tee opinion |
| Arpenteur | 82 | P | C | M | Lyon workwear, very French |
| Kardo | 82 | P | N | M | Hand-block prints from Delhi |
| Mfpen | 82 | P | C | M | Copenhagen, soft and slow |
| Nicholas Daley | 82 | P | N | M | Craft-led London menswear |
| Toogood | 84 | P | N | A | Tailored workwear by a furniture designer |
| Comoli | 86 | P | C | M | Tokyo, nearly impossible to find |
| Camoshita | 84 | P | C | M | Tokyo tailoring with a United Arrows lineage |
| Stoffa | 86 | L | C | M | Made-to-order New York, no website frills |
| Kaptain Sunshine | 88 | P | C | M | Tokyo label with few Western stockists |
| Evan Kinori | 88 | P | C | M | One-man San Francisco studio |
| Taiga Takahashi | 88 | L | C | M | Archival denim, tiny runs |

## Added from tester receipts (October 15, drafts pending founder approval)

Brands that showed up in tester histories but weren't on the list. Labels that couldn't be scored confidently (and non-clothing stores) are left out until someone knows them.

| Brand | Niche | Tier | Lean | For | Reason |
|---|---|---|---|---|---|
| Oakley | 6 | M | N | A | Sport sunglasses everyone recognises |
| Asics | 6 | M | N | A | Running shoe staple |
| Bombas | 10 | M | N | A | The sock brand on every podcast ad |
| Umbro | 10 | V | C | A | Football kit name everyone knows |
| Calpak | 18 | M | T | W | The pastel carry-on of the internet |
| Madhappy | 30 | M | T | A | Optimism hoodies, heavily seen |
| Kotn | 35 | M | C | A | Egyptian-cotton basics, known online |
| John Elliott | 52 | P | N | M | LA luxury basics, known to people who follow menswear |
| Nili Lotan | 55 | P | C | W | Quiet New York luxury, insider favourite |
| Pamela Love | 55 | P | N | W | Downtown jewellery with a following |
| Entire Studios | 60 | M | T | A | Puffers and sweats with a cult following |
| Cherry Los Angeles | 60 | M | T | M | Americana menswear, very insider |
| Tekla | 65 | P | C | A | Danish bedding and sleepwear, design-crowd famous |
| CDLP | 70 | P | C | M | Swedish underwear, a menswear-nerd staple |
| Ondo | 20 | M | N | A | Sock brand, low on the niche scale (founder) |
| SquidHaus | 30 | V | T | A | Instagram brand, low-medium (founder) |
| Sown Again | 45 | V | T | A | Instagram T-shirt brand (founder) |
| KVRT STVFF | 75 | M | T | M | Queer cult label, niche and kinda cool (founder) |

## Stores, multi-brand and resale (store row used only when the item's brand is unknown)

| Store | Niche | Tier | Lean | For | Reason |
|---|---|---|---|---|---|
| Goodhood | 60 | P | T | A | London concept store |
| Haven | 62 | P | N | M | Canadian store for technical-meets-Japanese |
| Garmentory | 62 | P | N | W | Indie boutiques, one checkout |
| Mohawk General Store | 66 | P | N | A | LA boutique, deep Japanese edit |
| Dover Street Market | 72 | L | N | A | Comme des Garçons's own department store |

Resale and marketplaces already above: eBay, Poshmark, ThredUp, Vinted, Depop, The RealReal, Vestiaire Collective, Grailed. Multi-brand e-tailers already above: Nordstrom, Revolve, Shopbop, Farfetch, Net-a-Porter, Mytheresa, Matches, Mr Porter, SSENSE, End., Bodega, Kith.

## Coverage check

- **Rows:** 346, more than the 200 asked for, because tester receipts will be full of mall and department-store names and an unmatched brand is simply left out of the score. Cut freely: 87 mall, 84 known name, 30 luxury houses, 44 fashion-aware, 12 cycling/running, 4 outdoor, 25 cult womenswear, 55 cult menswear, 5 cult stores.
- **Women's vs men's:** 92 W-led, 75 M-led, 179 for both. Womenswear dominates the mall bands and menswear dominates the 75+ deep cuts, which mirrors how the online indie menswear scene is structured rather than a choice.
- **Score spread:** 93 rows under 16, 148 from 16–55, 105 above 55, so a typical tester lands in the middle and the extremes are earned.
- **Sample people:** Jack (Dries 62, Auralee 78, Our Legacy 64, SSENSE 40, MAAP 58) ≈ 62. Priya (Reformation 22, Aritzia 18, Zara 3, COS 22) ≈ 16. Dana (J.Crew 10, Eileen Fisher 18, L.L.Bean 9) ≈ 12.

## Judgement calls for the founder

1. **Obscurity, not price.** Luxury houses score low when they are household names (Louis Vuitton 10). This keeps "Gatekeeper" from becoming a wealth score, which the money rules forbid.
2. **Tier and Lean columns were added** because the Thrifty ↔ Spendy and Trendy ↔ Classic sliders need *some* reference beyond the person's own orders. They're coarse labels, never shown as money and never shown on a card.
3. **Multi-brand stores score low-ish** (SSENSE 40) and are used only when the item's brand is missing; otherwise the actual brand counts. A store row alone shouldn't make someone a gatekeeper.
4. **Comme des Garçons (48)** blends the famous Play heart tee with the obscure mainline. If receipts let us tell lines apart, split it into CdG Play (~25) and CdG mainline (~70).
5. **Arc'teryx (18) and Salomon (22)** are scored as their city-famous selves; their technical lines (Veilance) get their own row.
6. **Regional bias:** scored for a US/UK/EU general shopper. Some labels (Aritzia, Uniqlo) feel more or less niche depending on the country; we can add per-country overrides later if testers complain.
7. **Defunct or closed stores** (Totokaelo, Need Supply, Opening Ceremony stores) were left out; add them if older receipts show them.

## Founder answers (October 15)

Approved as drafted, including all seven judgement calls: obscurity rather than price, the Tier and Lean columns, low-ish multi-brand store scores, splitting Comme des Garçons by line when receipts allow, Arc'teryx/Salomon scored as their city selves, US/UK/EU scoring with per-country overrides later, and closed stores left out.
