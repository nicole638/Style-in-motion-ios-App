-- Extend the Bag branch of set_default_item_category() with two more bag
-- style-names that do not contain the word "bag": "shopper" and "messenger".
--
-- CONTEXT — the substantive Bag-branch fix shipped earlier today in
-- 20260714183000_fix_item_category_amazon_boilerplate.sql, which added
-- hobo/duffel/baguette/carryall/weekender/minaudiere and cited the exact
-- Diesel "D-LINE HOBO S" case. This migration only appends the remaining two
-- unambiguous style-words. Everything else in the function is unchanged and is
-- reproduced verbatim from 20260714183000 so this file is a faithful full
-- definition (CREATE OR REPLACE), not a drifted partial.
--
-- Deliberately NOT added (same reasoning as 20260714183000):
--   * bare "bucket" / "bowler"  -> a *bucket hat* / *bowler hat* is an Accessory,
--     and the Bag branch is evaluated BEFORE the Accessory branch, so a bare
--     match would misfile hats as Bags. The phrase forms "bucket bag" /
--     "bowler bag" are already caught by the existing "bags?" alternative.
--   * "saddle bag" / "shoulder bag" / "camera bag" -> already caught by "bags?".
--
-- "shopper" (a shopper tote) and "messenger" (a messenger bag) have no garment
-- homograph, and the Bag branch runs before Dress/Pants/Top, so appending them
-- is safe. They match zero existing creator_items rows today; the value is
-- forward-looking (correctly classifying future items whose name is only the
-- bag *shape*, e.g. "Longchamp Le Pliage Shopper").
--
-- Behaviour-preserving for existing rows: like every classifier change, this
-- trigger only fires on INSERT/UPDATE, and it never overrides a creator's own
-- valid category choice. Re-classifying the existing back-catalogue of
-- mis-filed bags is done as a separate one-off data fix, not in this migration
-- (see scripts/db/20260715-reclassify-stuck-bags.sql).

CREATE OR REPLACE FUNCTION public.set_default_item_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE n text := lower(coalesce(NEW.name, ''));
BEGIN
  -- Strip Amazon department boilerplate — see 20260714183000. Order matters:
  -- remove the "Amazon.com:" prefix and the trailing department tail, then
  -- belt-and-braces remove any lingering "clothing, shoes & jewelry" anywhere.
  n := regexp_replace(n, '^amazon\.com\s*:\s*', '');
  n := regexp_replace(n, '\s*:\s*clothing,\s*shoes\s*(&|and)\s*jewelry\s*$', '');
  n := regexp_replace(n, '\s+at\s+amazon\b[^:]*\bstore\s*$', '');
  n := regexp_replace(n, 'clothing,\s*shoes\s*(&|and)\s*jewelry', '', 'g');

  -- "short sleeve" / "short-sleeve" must NOT read as shorts (bottoms).
  n := regexp_replace(n, 'short[\s-]+sleeve', 'shortsleeve', 'g');

  IF NEW.category IS NULL OR NEW.category NOT IN ('Top','Pants','Dress','Shoes','Bag','Jewelry','Accessory','Outerwear','Intimates','Swimwear') THEN
    NEW.category := CASE
      WHEN n ~ '\m(shoes?|boots?|sandals?|sneakers?|heels?|loafers?|slippers?|mules?|clogs?|wedges?|pumps?)\M' THEN 'Shoes'
      WHEN n ~ '\m(handbags?|bags?|purses?|clutch|clutches|backpacks?|wallets?|totes?|crossbody|satchels?|hobos?|duffels?|duffles?|baguettes?|carryalls?|weekenders?|minaudi[eè]res?|shoppers?|messengers?)\M' THEN 'Bag'
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
