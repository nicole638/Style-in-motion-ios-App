-- Fix: furniture and electronics are shoppable in a fashion app.
--
-- infer_department() had no non-fashion branch at all, so a sofa or a USB cable
-- fell through to department='Other' — which the app renders as a perfectly
-- normal category chip (92,261 products). Live count of the damage:
--
--   Zulily ................ 2,542 furniture + 10,487 electronics  (general marketplace)
--   Bloomingdale's ........   397 furniture +  1,276 electronics
--   TikTok Shop US ........   582 furniture +    619 electronics
--   Amazon (partnerboost) .   656 furniture +    449 electronics   <- the one Nicole spotted
--   ...                       ~15,600 non-fashion products, all shoppable
--
-- We cannot simply hide 'Other': the large majority of those 92k rows are
-- legitimate fashion that merely failed to match a department. So instead we
-- classify the junk explicitly into 'Home' and 'Tech', and the app filters those
-- two out.
--
-- PLACEMENT IS THE WHOLE TRICK: these two branches go immediately BEFORE the
-- final `ELSE 'Other'`, i.e. dead last. They can therefore only ever catch rows
-- that were already going to be 'Other' — no existing fashion classification can
-- change. Put them first instead and "laptop sleeve BAG" stops being a Bag,
-- "camera BAG" stops being a Bag, and a "compact MIRROR" leaves Beauty.
--
-- For the same reason the vocabularies below deliberately avoid bare words that
-- collide with apparel: no bare "case" (suitcase, makeup case), no bare "band"
-- (Apple Watch bands already resolve to Watches), no bare "wireless" (a wireless
-- BRA is Lingerie), and no bare "sheet" (a sheet MASK is not bedding).
--
-- Applying this function alone changes nothing that is already stored —
-- affiliate_products is a materialized view, so it takes effect on REFRESH.

CREATE OR REPLACE FUNCTION public.infer_department(p_name text, p_category text, p_merchant_category text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
DECLARE blob text;
BEGIN
  blob := lower(coalesce(p_name, '') || ' ' || coalesce(p_merchant_category, '') || ' ' || coalesce(p_category, ''));

  IF blob ~ '\m(jewelry|jewellery|earrings?|necklaces?|bracelets?|rings?|chains?|pendants?|cuffs?|anklets?|brooch(es)?|charms?)\M' THEN RETURN 'Jewelry';
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

  -- ── non-fashion, evaluated LAST: only ever catches would-be 'Other' ──
  ELSIF blob ~ '\m(sofas?|couch(es)?|sectionals?|loveseats?|armchairs?|recliners?|ottomans?|chairs?|stools?|desks?|tables?|nightstands?|dressers?|wardrobes?|armoires?|mattress(es)?|bedframes?|headboards?|bookshel(f|ves)|bookcases?|shel(f|ves)|cabinets?|sideboards?|credenzas?|futons?|cribs?|rugs?|carpets?|curtains?|drapes?|blinds?|lamps?|chandeliers?|sconces?|vases?|planters?|cushions?|pillows?|duvets?|comforters?|bedding|bedsheets?|blankets?|quilts?|towels?|cookware|dinnerware|utensils?|furniture|decor|vacuums?|blenders?|toasters?|microwaves?|kettles?|humidifiers?|purifiers?|heaters?)\M'
    THEN RETURN 'Home';
  ELSIF blob ~ '\m(laptops?|monitors?|keyboards?|headphones?|earbuds?|earphones?|headsets?|speakers?|chargers?|charging|cables?|adapters?|routers?|modems?|webcams?|ssds?|usb|hdmi|tablets?|ipads?|iphones?|smartphones?|televisions?|tvs?|projectors?|printers?|scanners?|consoles?|playstation|xbox|nintendo|drones?|powerbanks?|bluetooth|electronics?|computers?|processors?|motherboards?)\M'
     OR blob ~ 'phone case'
    THEN RETURN 'Tech';

  ELSE RETURN 'Other';
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.infer_department(text, text, text) IS
  'Maps a product to a department. Home/Tech are evaluated LAST so they can only catch rows that would otherwise be Other — the app filters those two out of the shoppable catalog.';
