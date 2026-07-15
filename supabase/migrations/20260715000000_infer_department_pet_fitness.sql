-- Fix: a general-marketplace feed (Amazon PartnerBoost) was leaking pet supplies
-- and fitness equipment into fashion departments — a dog life jacket under
-- Outerwear, a weight bench under Activewear, a stepper in the grid.
--
-- ROOT CAUSE: pet apparel matched fashion keywords ("dog JACKET" -> Outerwear,
-- "dog DRESS" -> Clothing) because those branches ran before anything caught the
-- pet context; exercise EQUIPMENT fell through to 'Other'. Counts on the Amazon
-- feed alone: ~596 pet items in Outerwear (+65 dog life jackets), 306 in Clothing.
--
-- FIX:
--  1. PET branch FIRST (before every fashion branch) so pet context wins over the
--     garment word. High-precision: requires "for dogs/cats/pets" OR
--     "dog/cat/pet/puppy + <pet-item word>" — NOT bare "dog"/"cat"/"kitten", so
--     "kitten heel" (Shoes), "dog tag" pendant (Jewelry) and "Love Dogs" graphic
--     tees (Clothing) are untouched. Verified: 2,168 matches, all genuine pet.
--  2. FITNESS-EQUIPMENT branch (dumbbell, bench, treadmill, resistance band,
--     yoga mat, stepper, ...) -> 'Home', placed before Activewear so exercise
--     GEAR doesn't ride the Activewear (exercise CLOTHING) keywords.
--
-- Pet/Home/Tech are all non-fashion and hidden from browse by the companion
-- migration on get_brand_* RPCs. Takes effect on the next matview REFRESH (chips)
-- and immediately for the grid (reads affiliate_products_live).

CREATE OR REPLACE FUNCTION public.infer_department(p_name text, p_category text, p_merchant_category text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
DECLARE blob text;
BEGIN
  blob := lower(coalesce(p_name, '') || ' ' || coalesce(p_merchant_category, '') || ' ' || coalesce(p_category, ''));

  -- ── non-fashion, evaluated FIRST so it beats garment keywords ──
  -- Pet: "for dogs/cats/pets", or dog/cat/pet/puppy followed by a pet-item word,
  -- or a standalone strong pet signal. Deliberately NOT bare dog/cat/kitten.
  IF blob ~ '\mfor\s+(small\s+|large\s+|medium\s+|x-?large\s+|extra\s+large\s+|tiny\s+|big\s+)?(dogs?|cats?|pets?|puppies|kittens?)\M'
     OR blob ~ '\m(dogs?|cats?|puppy|puppies|pet|pets|kitten)\s+(jackets?|coats?|dress(es)?|costumes?|life\s?jackets?|vests?|collars?|bandanas?|harness(es)?|sweaters?|hoodies?|shoes?|boots?|clothes|clothing|apparel|shampoos?|toys?|beds?|bowls?|treats?|leash(es)?|carriers?|kennels?|diapers?|raincoats?|paw)'
     OR blob ~ '\m(kennels?|litterbox|cat\s?litter|pet\s?supplies|doggie|puppy\s?pad)\M'
  THEN RETURN 'Pet';

  -- Fitness equipment (gear, not activewear clothing) -> Home.
  ELSIF blob ~ '\m(dumbbells?|barbells?|kettlebells?|treadmills?|ellipticals?|steppers?|rowing machine|exercise bike|stationary bike|spin bike|resistance bands?|yoga mat|exercise mat|pilates (ring|bar)|jump ropes?|ab (roller|wheel|mat)|pull.?up bars?|squat rack|weight (bench(es)?|rack|plate|set|stack)|workout bench(es)?|foam rollers?|balance board)\M'
  THEN RETURN 'Home';

  ELSIF blob ~ '\m(jewelry|jewellery|earrings?|necklaces?|bracelets?|rings?|chains?|pendants?|cuffs?|anklets?|brooch(es)?|charms?)\M' THEN RETURN 'Jewelry';
  ELSIF blob ~ '\m(sunglass(es)?|eyewear|spectacles?)\M' THEN RETURN 'Sunglasses';
  ELSIF blob ~ '\m(watch(es)?|wristwatch(es)?|smartwatch(es)?)\M' THEN RETURN 'Watches';
  ELSIF blob ~ '\m(shoes?|boots?|sandals?|sneakers?|heels?|loafers?|pumps?|mules?|wedges?|slippers?|clogs?|stilettos?|espadrilles?|moccasins?|flats?|footwear)\M' THEN RETURN 'Shoes';
  ELSIF blob ~ '\m(bags?|handbags?|purses?|clutch(es)?|backpacks?|wallets?|totes?|crossbody|crossbodies|satchels?|hobos?|baguettes?|messengers?|pouch(es)?)\M' THEN RETURN 'Bags';
  ELSIF blob ~ '\m(fragrances?|perfumes?|colognes?|skincare|moisturizers?|serums?|cleansers?|foundations?|mascaras?|lipsticks?|lipgloss(es)?|eyeshadows?|blush(es)?|bronzers?|highlighters?|concealers?|toners?|creams?|lotions?|makeup|cosmetics?|beauty|shampoos?|conditioners?|deodorants?)\M' THEN RETURN 'Beauty';
  ELSIF blob ~ '\m(belts?|hats?|caps?|beanies?|fedoras?|visors?|scarf|scarves|gloves?|mittens?|headbands?|hairbands?|barrettes?|ties?|bowties?)\M' THEN RETURN 'Accessories';
  ELSIF blob ~ '\m(activewear|workout|gym|yoga|leggings?|joggers?|trackpants?|sweatpants?)\M' OR blob ~ '\m(running|training|athletic|performance)\M' THEN RETURN 'Activewear';
  ELSIF blob ~ '\m(bras?|lingerie|underwear|pant(y|ies)|sleepwear|nightgowns?|pajamas?|loungewear|robes?|chemises?|thongs?|briefs?|boyshorts?)\M' THEN RETURN 'Lingerie';
  ELSIF blob ~ '\m(jackets?|coats?|trench|trenches|parkas?|puffers?|blazers?|cardigans?|hoodies?|sweatshirts?|vests?|kimonos?|outerwear|anoraks?|peacoats?|windbreakers?)\M' THEN RETURN 'Outerwear';
  ELSIF blob ~ '\m(dress(es)?|gowns?|maxis?|midis?|jumpsuits?|rompers?|onesies?|catsuits?)\M'
     OR blob ~ '\m(tops?|shirts?|tees?|tshirts?|t-shirts?|blouses?|tanks?|camis?|bodysuits?|corsets?|bustiers?|crops?|halters?)\M'
     OR blob ~ '\m(pants?|jeans?|shorts?|skirts?|capris?|trousers?|chinos?)\M'
     OR blob ~ '\m(sweaters?|pullovers?|knits?)\M'
     OR blob ~ '\m(swimsuits?|bikinis?|swimwear)\M' THEN RETURN 'Clothing';

  ELSIF blob ~ '\m(sofas?|couch(es)?|sectionals?|loveseats?|armchairs?|recliners?|ottomans?|chairs?|stools?|desks?|tables?|nightstands?|dressers?|wardrobes?|armoires?|mattress(es)?|bedframes?|headboards?|bookshel(f|ves)|bookcases?|shel(f|ves)|cabinets?|sideboards?|credenzas?|futons?|cribs?|rugs?|carpets?|curtains?|drapes?|blinds?|lamps?|chandeliers?|sconces?|vases?|planters?|cushions?|pillows?|duvets?|comforters?|bedding|bedsheets?|blankets?|quilts?|towels?|cookware|dinnerware|utensils?|furniture|decor|vacuums?|blenders?|toasters?|microwaves?|kettles?|humidifiers?|purifiers?|heaters?|toppers?)\M'
    THEN RETURN 'Home';
  ELSIF blob ~ '\m(laptops?|monitors?|keyboards?|headphones?|earbuds?|earphones?|headsets?|speakers?|chargers?|charging|cables?|adapters?|routers?|modems?|webcams?|ssds?|usb|hdmi|tablets?|ipads?|iphones?|smartphones?|televisions?|tvs?|projectors?|printers?|scanners?|consoles?|playstation|xbox|nintendo|drones?|powerbanks?|bluetooth|electronics?|computers?|processors?|motherboards?)\M'
     OR blob ~ 'phone case'
    THEN RETURN 'Tech';

  ELSE RETURN 'Other';
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.infer_department(text, text, text) IS
  'Maps a product to a department. Pet + fitness-equipment + Home + Tech are non-fashion and hidden from browse. Pet & fitness run FIRST so pet apparel / exercise gear cannot ride garment keywords.';
