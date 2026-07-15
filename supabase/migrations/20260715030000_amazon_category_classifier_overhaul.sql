-- Amazon category grids were showing wrong/junk items on first impression:
--   * boots, bras, men's shirts filed under JEWELRY (Amazon's "Clothing, Shoes &
--     Jewelry" department string poisoned the blob; the Jewelry branch runs first)
--   * pill organizer under BAGS, screwdriver under WATCHES, mattress topper under
--     CLOTHING (non-fashion items riding a stray fashion keyword)
--   * men's items, outdoor/tactical gear, power tools, drinkware in a women's app
--
-- Fix = two parts, both server-side (no app build):
--  1. infer_department(): strip Amazon boilerplate, gate on the Amazon department
--     field, and route men's-only / gear / tools / drinkware / baby items to the
--     hidden buckets. Rescue luggage->Bags, lashes/nails->Beauty, pasties->Lingerie.
--  2. The three brand RPCs only ever display a fashion department allowlist
--     (Home/Tech/Pet/Other never surface as chips, in the grid, or in starters).
--
-- After applying, refresh affiliate_products + affiliate_products_browse
-- (refresh_affiliate_products_daily). NOTE the refresh must run with
-- statement_timeout disabled at the CRON COMMAND level, not just the function's
-- SET clause — service_role carries statement_timeout=120s and the timer arms on
-- the top-level statement before the function body can change it. See
-- reference brand-catalog-perf.

CREATE OR REPLACE FUNCTION public.infer_department(p_name text, p_category text, p_merchant_category text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  cat text := lower(coalesce(p_category,''));
  blob text;
BEGIN
  blob := lower(coalesce(p_name,'') || ' ' || coalesce(p_merchant_category,'') || ' ' || coalesce(p_category,''));
  -- Strip Amazon generic-department boilerplate (esp. "…Jewelry") + accessory/packaging
  -- mentions so a free bag / gift box / belt clip can't drive the classification.
  blob := regexp_replace(blob, 'clothing,\s*shoes\s*(&|and)\s*jewelry', ' ', 'g');
  blob := regexp_replace(blob, '^amazon\.com\s*:\s*', '');
  blob := regexp_replace(blob, '\s+at\s+amazon\b[^:]*\bstore\b', ' ');
  blob := regexp_replace(blob, '\m(gift\s?(box|bag|set)|storage\s?bag|carry(ing)?\s?(case|bag|pouch)|with\s?(a\s?)?(free\s?)?bag|bag\s?included|travel\s?(case|box|bag|pouch)|zip\s?lock\s?bag|drawstring\s?bag|dust\s?bag|box\s?&\s?bag|collection\s?bag|grass\s?bag|paint\s?bags?|leaf\s?bag|belt\s?clip)\M', ' ', 'g');

  -- Amazon department gate: the category field is a strong non-fashion signal.
  IF cat ~ '\m(home\s*(&|and)\s*kitchen|health\s*(&|and)\s*household|tools\s*(&|and)\s*home|patio|lawn|garden|industrial|automotive|appliances|office\s*products|grocery|baby\s*(products|&)|toys\s*(&|and)\s*games|musical\s*instruments|arts.*crafts|kitchen\s*(&|and)\s*dining|furniture|pet\s*supplies)\M'
    THEN RETURN 'Home';
  ELSIF cat ~ '\m(electronics|cell\s*phones|computers|camera\s*(&|and)|video\s*games|software)\M'
    THEN RETURN 'Tech';
  END IF;

  -- Women's app: hide men's-only items, outdoor/survival gear, and baby/toddler
  -- and drinkware into the hidden "Other" bucket (the brand RPCs never display it).
  IF (blob ~ '\m(men''s|mens|for men|male|boys?|gentlemens?)\M'
        AND blob !~ '\m(women''?s?|womens|woman|ladies|female|girls?|unisex)\M')
     OR blob ~ '\m(fishing|tackle|hunting|wading|angler|molle|holster|trolling|survival|carabiner|sublimation)\M'
     OR blob ~ '\mwater\s?(filter|purifier|bottle)\M'
     OR blob ~ '\m(toddler|infants?|newborns?)\M'
     OR blob ~ '\m(tumblers?|shot\s?glass(es)?|drinkware)\M'
  THEN RETURN 'Other';
  END IF;

  IF blob ~ '\mfor\s+(small\s+|large\s+|medium\s+|x-?large\s+|extra\s+large\s+|tiny\s+|big\s+)?(dogs?|cats?|pets?|puppies|kittens?)\M'
     OR blob ~ '\m(dogs?|cats?|puppy|puppies|pet|pets|kitten)\s+(jackets?|coats?|dress(es)?|costumes?|life\s?jackets?|vests?|collars?|bandanas?|harness(es)?|sweaters?|hoodies?|shoes?|boots?|clothes|clothing|apparel|shampoos?|toys?|beds?|bowls?|treats?|leash(es)?|carriers?|kennels?|diapers?|raincoats?|paw)'
     OR blob ~ '\m(kennels?|litterbox|cat\s?litter|pet\s?supplies|doggie|puppy\s?pad)\M'
  THEN RETURN 'Pet';

  ELSIF blob ~ '\m(dumbbells?|barbells?|kettlebells?|treadmills?|ellipticals?|steppers?|rowing machine|exercise bike|stationary bike|spin bike|resistance bands?|yoga mat|exercise mat|pilates (ring|bar)|jump ropes?|ab (roller|wheel|mat)|pull.?up bars?|squat rack|weight (bench(es)?|rack|plate|set|stack)|workout bench(es)?|foam rollers?|balance board|pill organizers?|screwdrivers?|desiccants?|leaf blowers?|lawn\s?mowers?|dethatchers?|scarifiers?|wood\s?chippers?|chippers?|paint sprayers?|pressure washers?|chainsaws?|hedge trimmers?|string trimmers?|weed (eaters?|wackers?)|snow\s?blowers?|generators?|air compressors?|shop\s?vac|nail guns?|sanders?|grinders?|welders?|impact\s?wrench(es)?|impact\s?drivers?|cordless\s?drills?|power\s?drills?|brushless|torque)\M'
  THEN RETURN 'Home';

  ELSIF blob ~ '\m(jewelry|jewellery|earrings?|necklaces?|bracelets?|rings?|chains?|pendants?|anklets?|brooch(es)?|charms?)\M' THEN RETURN 'Jewelry';
  ELSIF blob ~ '\m(sunglass(es)?|eyewear|spectacles?)\M' THEN RETURN 'Sunglasses';
  ELSIF blob ~ '\m(chargers?|charging|power ?banks?)\M' THEN RETURN 'Tech';
  ELSIF blob ~ '\m(watch(es)?|wristwatch(es)?|smartwatch(es)?)\M' THEN RETURN 'Watches';
  ELSIF blob ~ '\m(shoes?|boots?|sandals?|sneakers?|heels?|loafers?|pumps?|mules?|wedges?|slippers?|clogs?|stilettos?|espadrilles?|moccasins?|flats?|footwear)\M' THEN RETURN 'Shoes';
  ELSIF blob ~ '\m(bags?|handbags?|purses?|clutch(es)?|backpacks?|wallets?|totes?|crossbody|crossbodies|satchels?|hobos?|baguettes?|messengers?|pouch(es)?|luggage|suitcases?|carry.?ons?|weekenders?|duffels?|duffles?)\M' THEN RETURN 'Bags';
  ELSIF blob ~ '\m(fragrances?|perfumes?|colognes?|skincare|moisturizers?|serums?|cleansers?|foundations?|mascaras?|lipsticks?|lipgloss(es)?|eyeshadows?|blush(es)?|bronzers?|highlighters?|concealers?|toners?|creams?|lotions?|makeup|cosmetics?|beauty|shampoos?|conditioners?|deodorants?|lash(es)?|eyelash(es)?|nail\s?tips?|press.?on\s?nails?|acrylic\s?nails?|fake\s?nails?|false\s?nails?)\M' THEN RETURN 'Beauty';
  ELSIF blob ~ '\m(belts?|hats?|caps?|beanies?|fedoras?|visors?|scarf|scarves|gloves?|mittens?|headbands?|hairbands?|barrettes?|ties?|bowties?)\M' THEN RETURN 'Accessories';
  ELSIF blob ~ '\m(activewear|workout|gym|yoga|leggings?|joggers?|trackpants?|sweatpants?)\M' OR blob ~ '\m(running|training|athletic|performance)\M' THEN RETURN 'Activewear';
  ELSIF blob ~ '\m(bras?|lingerie|underwear|pant(y|ies)|sleepwear|nightgowns?|pajamas?|loungewear|robes?|chemises?|thongs?|briefs?|boyshorts?|pasties|nipple\s?covers?|breast\s?petals?)\M' THEN RETURN 'Lingerie';
  ELSIF blob ~ '\m(jackets?|coats?|trench|trenches|parkas?|puffers?|blazers?|cardigans?|hoodies?|sweatshirts?|vests?|kimonos?|outerwear|anoraks?|peacoats?|windbreakers?)\M' THEN RETURN 'Outerwear';
  ELSIF blob ~ '\m(dress(es)?|gowns?|maxis?|midis?|jumpsuits?|rompers?|onesies?|catsuits?)\M'
     OR blob ~ '\m(tops?|shirts?|tees?|tshirts?|t-shirts?|blouses?|tanks?|camis?|bodysuits?|corsets?|bustiers?|crops?|halters?)\M'
     OR blob ~ '\m(pants?|jeans?|shorts?|skirts?|capris?|trousers?|chinos?)\M'
     OR blob ~ '\m(sweaters?|pullovers?|knits?)\M'
     OR blob ~ '\m(swimsuits?|bikinis?|swimwear)\M' THEN RETURN 'Clothing';

  ELSIF blob ~ '\m(sofas?|couch(es)?|sectionals?|loveseats?|armchairs?|recliners?|ottomans?|chairs?|stools?|desks?|tables?|nightstands?|dressers?|wardrobes?|armoires?|mattress(es)?|bedframes?|headboards?|bookshel(f|ves)|bookcases?|shel(f|ves)|cabinets?|sideboards?|credenzas?|futons?|cribs?|rugs?|carpets?|curtains?|drapes?|blinds?|lamps?|chandeliers?|sconces?|vases?|planters?|cushions?|pillows?|duvets?|comforters?|bedding|bedsheets?|blankets?|quilts?|towels?|cookware|dinnerware|utensils?|furniture|decor|vacuums?|blenders?|toasters?|microwaves?|kettles?|humidifiers?|purifiers?|heaters?|toppers?)\M'
    THEN RETURN 'Home';
  ELSIF blob ~ '\m(laptops?|monitors?|keyboards?|headphones?|earbuds?|earphones?|headsets?|speakers?|cables?|adapters?|routers?|modems?|webcams?|ssds?|usb|hdmi|tablets?|ipads?|iphones?|smartphones?|televisions?|tvs?|projectors?|printers?|scanners?|consoles?|playstation|xbox|nintendo|drones?|bluetooth|electronics?|computers?|processors?|motherboards?|mice|mouse)\M'
     OR blob ~ 'phone case'
    THEN RETURN 'Tech';

  ELSE RETURN 'Other';
  END IF;
END;
$function$;

-- ---- Brand RPCs: display a fashion-department allowlist only ----
DO $$ BEGIN PERFORM 1; END $$;  -- (bodies below; see brand-catalog-perf reference)

CREATE OR REPLACE FUNCTION public.get_brand_departments(p_merchant_id uuid)
RETURNS TABLE(department text, count bigint)
LANGUAGE sql STABLE AS $function$
  SELECT department, count(*)::bigint AS count
  FROM public.affiliate_products_browse
  WHERE merchant_id = p_merchant_id
    AND department = ANY (ARRAY['Clothing','Outerwear','Activewear','Lingerie','Shoes',
                                'Bags','Jewelry','Watches','Sunglasses','Accessories','Beauty'])
  GROUP BY department
  ORDER BY count DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_brand_catalog(p_merchant_id uuid, p_department text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0, p_subcategory text DEFAULT NULL::text)
RETURNS TABLE(id uuid, network text, product_id_in_feed text, name text, brand text, department text, category text, merchant_category text, price numeric, currency text, product_url text, deep_link text, image_urls text[], lifestyle_image_url text, created_at timestamp with time zone)
LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lim int := GREATEST(1, LEAST(p_limit, 200));
  v_off int := GREATEST(0, p_offset);
  v_dept text := nullif(p_department, '');
  v_sub  text := nullif(p_subcategory, '');
  v_q    text := nullif(p_search, '');
  v_cols text := 'ap.id, ap.network, ap.product_id_in_feed, ap.name, ap.brand, ap.department,
                  ap.category, ap.merchant_category, ap.price, ap.currency, ap.product_url,
                  ap.deep_link, ap.image_urls, ap.lifestyle_image_url, ap.created_at';
  v_excl text := 'ap.brand IS NULL OR NOT (ap.brand = ANY (coalesce((SELECT m.excluded_brands FROM public.affiliate_merchants m WHERE m.id = ' || quote_literal(p_merchant_id) || '), ''{}''::text[])))';
  v_fashion text := 'b.department = ANY (ARRAY[''Clothing'',''Outerwear'',''Activewear'',''Lingerie'',''Shoes'',''Bags'',''Jewelry'',''Watches'',''Sunglasses'',''Accessories'',''Beauty''])';
BEGIN
  IF v_q IS NULL THEN
    RETURN QUERY EXECUTE format(
      'SELECT %s FROM public.affiliate_products_browse b
         JOIN public.affiliate_products ap ON ap.id = b.id
       WHERE b.merchant_id = %L
         AND (%L IS NULL OR b.department = %L)
         AND (%L IS NULL OR b.subcategory = %L)
         AND (%s) AND (%s)
       ORDER BY b.created_at DESC LIMIT %s OFFSET %s',
      v_cols, p_merchant_id, v_dept, v_dept, v_sub, v_sub, v_fashion, v_excl, v_lim, v_off);
  ELSE
    RETURN QUERY EXECUTE format(
      'SELECT %s FROM public.affiliate_products ap
         JOIN public.affiliate_products_browse b ON b.id = ap.id
       WHERE b.merchant_id = %L
         AND (%L IS NULL OR b.department = %L)
         AND (%L IS NULL OR b.subcategory = %L)
         AND (ap.name ILIKE %L OR ap.brand ILIKE %L OR ap.merchant_category ILIKE %L)
         AND (%s) AND (%s)
       ORDER BY ap.created_at DESC LIMIT %s OFFSET %s',
      v_cols, p_merchant_id, v_dept, v_dept, v_sub, v_sub,
      '%'||v_q||'%', '%'||v_q||'%', '%'||v_q||'%', v_fashion, v_excl, v_lim, v_off);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_brand_starter_picks(p_merchant_id uuid, p_limit integer DEFAULT 12)
RETURNS TABLE(product_id_in_feed text, name text, brand text, price numeric, currency text, primary_image_url text, lifestyle_image_url text, image_urls text[], product_url text, awin_deep_link text, tier text)
LANGUAGE sql STABLE AS $function$
  WITH ranked AS (
    SELECT p.product_id_in_feed, p.name, p.brand, p.price, p.currency,
           COALESCE(p.lifestyle_image_url, p.image_urls[1]) AS primary_image_url,
           p.lifestyle_image_url, p.image_urls, p.product_url,
           p.deep_link AS awin_deep_link,
           CASE WHEN p.lifestyle_image_url IS NOT NULL THEN 'lifestyle'
                WHEN array_length(p.image_urls, 1) >= 2 THEN 'multi_image'
                ELSE 'single_image' END AS tier,
           CASE WHEN p.lifestyle_image_url IS NOT NULL THEN 1
                WHEN array_length(p.image_urls, 1) >= 2 THEN 2
                ELSE 3 END AS tier_rank,
           p.first_seen_at
    FROM public.affiliate_products_browse b
    JOIN public.affiliate_products p ON p.id = b.id
    WHERE b.merchant_id = p_merchant_id
      AND array_length(p.image_urls, 1) >= 1
      AND b.department = ANY (ARRAY['Clothing','Outerwear','Activewear','Lingerie','Shoes',
                                    'Bags','Jewelry','Watches','Sunglasses','Accessories','Beauty'])
  )
  SELECT product_id_in_feed, name, brand, price, currency, primary_image_url,
         lifestyle_image_url, image_urls, product_url, awin_deep_link, tier
  FROM ranked
  ORDER BY tier_rank, first_seen_at DESC NULLS LAST
  LIMIT p_limit;
$function$;
