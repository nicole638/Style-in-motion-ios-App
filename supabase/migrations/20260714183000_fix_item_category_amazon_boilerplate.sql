-- Fix: closet items were landing in the wrong category, which made collage
-- templates render them in the wrong-shaped slot (a pair of jeans in a wide
-- "shoes" box). Reported by a creator via the Dupe Drop template.
--
-- ROOT CAUSE — Amazon's own page titles poison the classifier. Every Amazon
-- product title carries the department string in its tail:
--
--   "Amazon.com: Eddoyee Denim Mini Skirt ... : Clothing, Shoes & Jewelry"
--   "Eddoyee Wide Leg Barrel Jeans ... at Amazon Women's Clothing store"
--
-- The Shoes branch is evaluated FIRST, and the literal word "shoes" in that
-- boilerplate matched it — so jeans, skirts and tees all classified as Shoes.
-- Confirmed live: 3 of this creator's wide-leg jeans were stored as 'Shoes'.
--
-- FIX 1 — strip Amazon's boilerplate before classifying. The garment words in
-- the actual product name then win, as intended.
--
-- FIX 2 — teach the Bag branch the bag shapes that don't contain the word
-- "bag": hobo, duffel, baguette, carryall, weekender, minaudiere. A real Diesel
-- "D-LINE HOBO S" handbag was being filed as an Accessory, which also hid its
-- "Consign Now" button (TheRealReal accepts Diesel bags, not Diesel accessories).
-- Deliberately NOT added: bare "bucket" or "pouch" — a *bucket hat* is an
-- Accessory, and adding them would misfile it as a Bag.
--
-- Everything else about the classifier is unchanged, including the rule that a
-- creator's own valid category choice is never overridden.

CREATE OR REPLACE FUNCTION public.set_default_item_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE n text := lower(coalesce(NEW.name, ''));
BEGIN
  -- Strip Amazon department boilerplate — see header. Order matters: remove the
  -- "Amazon.com:" prefix and the trailing department tail, then belt-and-braces
  -- remove any lingering "clothing, shoes & jewelry" anywhere in the string.
  n := regexp_replace(n, '^amazon\.com\s*:\s*', '');
  n := regexp_replace(n, '\s*:\s*clothing,\s*shoes\s*(&|and)\s*jewelry\s*$', '');
  n := regexp_replace(n, '\s+at\s+amazon\b[^:]*\bstore\s*$', '');
  n := regexp_replace(n, 'clothing,\s*shoes\s*(&|and)\s*jewelry', '', 'g');

  -- "short sleeve" / "short-sleeve" must NOT read as shorts (bottoms). Collapse
  -- it so "Short Sleeve Tops" classifies as Top.
  n := regexp_replace(n, 'short[\s-]+sleeve', 'shortsleeve', 'g');

  IF NEW.category IS NULL OR NEW.category NOT IN ('Top','Pants','Dress','Shoes','Bag','Jewelry','Accessory','Outerwear','Intimates','Swimwear') THEN
    NEW.category := CASE
      WHEN n ~ '\m(shoes?|boots?|sandals?|sneakers?|heels?|loafers?|slippers?|mules?|clogs?|wedges?|pumps?)\M' THEN 'Shoes'
      WHEN n ~ '\m(handbags?|bags?|purses?|clutch|clutches|backpacks?|wallets?|totes?|crossbody|satchels?|hobos?|duffels?|duffles?|baguettes?|carryalls?|weekenders?|minaudi[eè]res?)\M' THEN 'Bag'
      WHEN n ~ '\m(earrings?|necklaces?|bracelets?|rings?|pendants?|anklets?|brooch|brooches|jewelry)\M' THEN 'Jewelry'
      WHEN n ~ '\m(belts?|hats?|beanies?|visors?|berets?|fedoras?|snapbacks?|scarf|scarves|sunglasses|eyewear|watch|watches|gloves?|mittens?|headbands?|pins?)\M'
        OR (n ~ '\mcaps?\M' AND n !~ '\mcaps?[\s-]*sleeve') THEN 'Accessory'
      WHEN n ~ '\m(bras?|bralettes?|lingerie|thongs?|panties|boyshorts?|briefs?|underwear)\M' THEN 'Intimates'
      WHEN n ~ '\m(swim|swimsuits?|swimwear|bikinis?|tankinis?|monokini|bathing\s+suits?|rashguards?|board\s?shorts?)\M' THEN 'Swimwear'
      WHEN n ~ '\m(dress|dresses|gowns?|jumpsuits?|rompers?|skirts?)\M' THEN 'Dress'
      WHEN n ~ '\m(pants?|jeans?|shorts?|leggings?|capris?|trousers?|chinos?|joggers?|sweatpants?|skorts?)\M'
        AND n !~ '\m(tops?|tees?|t-shirts?|shirts?|blouses?|tanks?|camis?|sweaters?|cardigans?|hoodies?|sweatshirts?|bodysuits?)\M' THEN 'Pants'
      WHEN n ~ '\m(tops?|tees?|t-shirts?|shirts?|blouses?|tanks?|camis?|sweaters?|cardigans?|hoodies?|sweatshirts?|bodysuits?)\M'
        AND n !~ '\m(pants?|jeans?|shorts?|leggings?|capris?|trousers?|chinos?|joggers?|sweatpants?)\M' THEN 'Top'
      ELSE NEW.category
    END;
  END IF;

  NEW.trr_eligible := public.is_trr_eligible(NEW.brand, NEW.category);
  RETURN NEW;
END;
$function$;
