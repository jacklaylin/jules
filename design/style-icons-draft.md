# Style icon catalog: draft for founder approval

Draft, October 15, 2026. 38 icons for the Style icon card ([style-report-brief.md](style-report-brief.md)). Mark each **keep / cut / edit**, and add any names you want. Once approved, this becomes `data/style-icons.json` and the matcher uses it.

## How matching works

Jules compares a person's purchase patterns with each icon's profile below. Brand overlap counts most, then the other attributes. Any attribute without enough data in someone's orders is left out instead of guessed. The match percentage is computed, so the same history always gets the same icon. Gender from signup is never used for matching; anyone can get any icon.

Attribute key:

- **Palette**: black · neutrals (black/white/grey/navy/camel) · color · pink/pastel · mixed
- **Price**: value · mid · premium · luxury, judged relative to all of the person's orders
- **Signals**: `uniform` buys the same item repeatedly · `niche` obscure or cult brands (Gatekeeper score) · `resale` buys from resale sites · `sporty` many athletic orders · `statement` loud shoes, bags or accessories · `tailoring` suits, blazers, shirts · `knit` many sweaters · `denim`

MVP: each icon uses a freely licensed photo where one exists (e.g. Wikimedia Commons), with source, license and credit recorded per icon. Icons without one (most characters) show an empty photo frame with their name. Paid licensing comes later. The emblem column is only a shorthand for the look; nothing is illustrated.

## The catalog

| # | Icon | Real or character | Age range | Vibe | 3 traits (on the card) | Anchor brands | Palette | Price | Signals | Emblem |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Moira Rose | Character (Schitt's Creek) | 60s | Theatrical monochrome | Monochrome drama · Statement coats · Never underdressed | Rick Owens, Givenchy, Alexander McQueen, Comme des Garçons | black | luxury | statement | Wig wall |
| 2 | Paris Hilton | Real | 40s | Y2K pink | Pink, always · Velour forever · That's hot | Juicy Couture, Von Dutch, Skims, Miu Miu | pink/pastel | mid–premium | statement | Velour tracksuit |
| 3 | Jacob Elordi | Real | 20s | Off-duty heartthrob | Big coat · Old loafers · Effortless on purpose | Bottega Veneta, Our Legacy, Levi's, Loewe | neutrals | premium–luxury | | Shearling coat |
| 4 | Carolyn Bessette-Kennedy | Real | 1990s, 30s | 90s minimalism | Clean lines · Black and camel · Nothing extra | Calvin Klein, Prada, Jil Sander, The Row | neutrals | luxury | | Tortoiseshell headband |
| 5 | Harry Styles | Real | 30s | Joyful dandy | Flares · Pearls · Pattern on pattern | Gucci, S.S. Daley, Marni, JW Anderson | color | luxury | statement | Pearl necklace |
| 6 | Rihanna | Real | 30s | Fearless mix | Oversized everything · High-low · Rules optional | Fenty, Balenciaga, Miu Miu, Nike | mixed | luxury | statement | Oversized sunglasses |
| 7 | Iris Apfel | Real | 90s+ | Maximalist | More is more · Color on color · Accessories first | Etro, Dries Van Noten, vintage | color | premium | statement, resale | Giant round glasses |
| 8 | Diane Keaton | Real | 70s | Menswear chic | Wide-leg everything · Turtleneck season · Hat on | Ralph Lauren, Thom Browne, Brooks Brothers | neutrals | premium | tailoring | Bowler hat |
| 9 | Jeff Goldblum | Real | 70s | Eccentric uncle | Loud shirts · Sharp frames · Charmingly odd | Prada, Saint Laurent, Moscot | mixed | luxury | statement, tailoring | Patterned shirt |
| 10 | Steve Jobs | Real | historic | The uniform | Same thing daily · Black turtleneck · New Balance | Issey Miyake, Levi's, New Balance, Uniqlo | black | mid | uniform | Black turtleneck |
| 11 | Carrie Bradshaw | Character (Sex and the City) | 30s–50s | Shoe-first romantic | Shoes before rent · Tutu energy · Mix it up | Manolo Blahnik, Dior, Fendi, Vivienne Westwood | mixed | luxury | statement | Manolo heel |
| 12 | Elle Woods | Character (Legally Blonde) | 20s | Pink power | Pink is a neutral · Polished · Underestimated | Ralph Lauren, Kate Spade, Juicy Couture | pink/pastel | mid–premium | | Pink scented résumé |
| 13 | Cher Horowitz | Character (Clueless) | teens | 90s prep | Matching sets · Plaid · Total betty | Dolce & Gabbana, Calvin Klein, Alaïa | color | premium | | Yellow plaid blazer |
| 14 | Rachel Green | Character (Friends) | 20s–30s | 90s everyday | Slip dresses · Knee socks · The haircut | Ralph Lauren, Gap, Banana Republic, Madewell | neutrals | mid | denim | Ralph Lauren tag |
| 15 | Kendall Roy | Character (Succession) | 40s | Stealth wealth | Logo-free · Cashmere cap · Quietly expensive | Loro Piana, Brunello Cucinelli, Tom Ford, Common Projects | neutrals | luxury | | Baseball cap (no logo) |
| 16 | Carmy Berzatto | Character (The Bear) | 30s | Workwear uniform | White tee · Good denim · Yes, chef | Merz b. Schwanen, Levi's, Carhartt, Red Wing | neutrals | mid | uniform, denim | White tee |
| 17 | Don Draper | Character (Mad Men) | 40s | Classic tailoring | Grey suit · Pocket square · Old-fashioned | Brooks Brothers, Suitsupply, Ralph Lauren Purple Label | neutrals | premium | tailoring | Fedora |
| 18 | Miranda Priestly | Character (The Devil Wears Prada) | 50s | Power luxury | Statement coat · Cerulean opinions · That's all | Prada, Valentino, Chanel, Hermès | neutrals | luxury | statement | Coat tossed on a desk |
| 19 | Sofia Coppola | Real | 50s | Quiet French-American | Navy and stripes · Ballet flats · Understated | Celine, Chanel, A.P.C., Sézane | neutrals | premium | | Striped shirt |
| 20 | Jane Birkin | Real | historic | Laid-back French | Basket bag · White tee · Jeans | Levi's, Saint James, Hermès | neutrals | mid | denim | Wicker basket |
| 21 | A$AP Rocky | Real | 30s | Fashion-forward street | Archive pieces · Designer layers · Very online | Raf Simons, Maison Margiela, Bottega Veneta, Rick Owens | black | luxury | niche, resale | Raf Simons-style parka |
| 22 | Bad Bunny | Real | 30s | Playful rule-breaker | Bold color · Painted nails · Zero fear | Jacquemus, Gucci, Adidas, Marni | color | premium–luxury | statement | Shell sunglasses |
| 23 | Timothée Chalamet | Real | 20s | Red-carpet experiment | Harness era · Hoodie off-duty · Takes risks | Haider Ackermann, Stüssy, Louis Vuitton, Bode | mixed | luxury | statement, niche | Sequined harness |
| 24 | Pharrell | Real | 50s | Colorful creative | Big hats · Bright colors · Billionaire boy | Louis Vuitton, Billionaire Boys Club, Humanrace, Adidas | color | luxury | statement, sporty | Buffalo hat |
| 25 | Mary-Kate & Ashley Olsen | Real | 30s | Bag-lady minimalism | Oversized layers · Black on black · Big bag | The Row, Khaite, Toteme | black | luxury | niche | Oversized tote |
| 26 | Princess Diana | Real | historic | Off-duty icon | Sweatshirt + bike shorts · Blazers · Revenge dress | Ralph Lauren, Harvard sweatshirt, Reebok, Catherine Walker | mixed | premium | sporty | Oversized sweatshirt |
| 27 | Bill Cunningham | Real | historic, 80s | Utilitarian uniform | Blue work jacket · Same every day · Always on a bike | Le Laboureur, Uniqlo, workwear | neutrals | value | uniform | Blue chore jacket and bicycle |
| 28 | Frank Ocean | Real | 30s | Cult minimalist | Cult brands · Clean shapes · Says little | Prada, Homer, Our Legacy, Nike | neutrals | luxury | niche | Bike chain necklace |
| 29 | Jerry Seinfeld | Real | 70s | Sneaker dad | Jeans and sneakers · Tucked in · Nothing to see | Nike, New Balance, Levi's, Gap | neutrals | value–mid | sporty, denim, uniform | White sneaker |
| 30 | Paul Mescal | Real | 20s | Short-shorts summer | Tiny shorts · Tank top · Silver chain | Gucci, vintage, Nike | neutrals | mid | sporty, resale | Silver chain |
| 31 | Sporty Spice | Real (Mel C) | 50s, 90s era | Athleisure original | Tracksuit forever · Trainers · High ponytail | Adidas, Nike, Puma, Lululemon | color | value–mid | sporty | Adidas tracksuit stripes |
| 32 | Wednesday Addams | Character (Wednesday) | teens | Gothic minimal | Black only · White collar · Unimpressed | Comme des Garçons, Simone Rocha, Dr. Martens | black | mid–premium | uniform | White collar |
| 33 | John F. Kennedy | Real | historic, 40s | New England prep | Sailing sweaters · Wayfarers · Hyannis Port ease | Brooks Brothers, J.Press, Ray-Ban, Sperry | neutrals | premium | tailoring, knit | Wayfarer sunglasses |
| 34 | Blair Waldorf | Character (Gossip Girl) | teens–20s | Upper East Side prep | Headbands · Pleated skirts · Never casual | Tory Burch, Ralph Lauren, Kate Spade, Chanel | color | premium–luxury | statement | Velvet headband |
| 35 | Ralph Lauren | Real | 80s | Heritage Americana | Polo everything · Western denim · Old money, new label | Ralph Lauren, RRL, Polo, Brooks Brothers | neutrals | premium | denim, tailoring | Polo pony |
| 36 | Yvon Chouinard | Real | 80s | Original gorpcore | Fleece first · Mended gear · Dirtbag at heart | Patagonia, Arc'teryx, The North Face, Black Diamond | color | mid | sporty, uniform | Patagonia fleece |
| 37 | Cheryl Strayed | Real | 50s | Trail-tested | Hiking boots · Layers · One very big pack | REI, Merrell, Smartwool, Fjällräven | neutrals | value–mid | sporty | Hiking boot |
| 38 | Ron Swanson | Character (Parks and Recreation) | 50s | Lumberjack dad | Flannel · Polo tucked in · Wood shop chic | L.L.Bean, Filson, Carhartt, Pendleton | neutrals | mid | uniform | Flannel shirt |

## Coverage check

- **Ages:** teens (Cher, Wednesday, Blair), 20s (Elordi, Elle, Timothée, Mescal), 30s–50s (most), 60s+ (Moira, Iris, Keaton, Goldblum, Seinfeld, Cunningham, Ralph Lauren, Chouinard).
- **Gender mix:** 18 women, 19 men, 1 pair, plus gender-fluid styling (Harry, Bad Bunny, Timothée).
- **Vibes:** monochrome (Moira, Olsens, Jobs, Wednesday), pink (Paris, Elle), quiet luxury (Kendall, CBK, Olsens), maximal (Iris, Harry, Goldblum, Pharrell), tailoring (Keaton, Draper, Miranda), street/niche (A$AP, Frank, Timothée), workwear/uniform (Carmy, Cunningham, Jobs), sporty (Sporty Spice, Diana, Seinfeld, Mescal), prep (JFK, Blair, Ralph Lauren, Cher, Elle), outdoors (Chouinard, Strayed, Ron Swanson), French (Birkin, Coppola), 90s (Rachel, Cher, CBK).
- **Price spread:** value (Cunningham, Seinfeld, Sporty Spice) through luxury.

## Founder answers (October 15)

1. Added prep (JFK, Blair Waldorf, Ralph Lauren) and outdoors (Yvon Chouinard, Cheryl Strayed, Ron Swanson). Cycling shoppers can match Chouinard or Cunningham.
2. Icons who have died stay in.
3. Legal check stays a launch gate; not blocking the build.
