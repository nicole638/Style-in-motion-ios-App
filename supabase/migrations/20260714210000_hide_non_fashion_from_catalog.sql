-- Hide the non-fashion catalog from the browse surfaces.
--
-- Companion to 20260714203000_infer_department_non_fashion.sql, which taught
-- infer_department() to return 'Home' and 'Tech'. That migration only LABELS the
-- junk — on its own it actually makes things worse, because the brand pages would
-- now render explicit "Home (7,549)" and "Tech (12,288)" category chips. This one
-- removes those two departments from everything a creator browses.
--
-- Three read paths, and they do not all read the same object:
--   get_brand_departments   -> the matview (department is materialized)
--   get_brand_starter_picks -> the matview
--   get_brand_catalog       -> affiliate_products_live (department computed per row)
--
-- Deliberately NOT filtered: lookup_catalog_product() and suggest_affiliate_matches().
-- Those resolve a URL a creator actually shared into a commissionable product. If a
-- creator shares a phone case, we still want her to earn on it — we just don't put
-- phone cases in front of her while she browses a fashion brand.
--
-- NULL department stays visible everywhere (it did before); only the two explicit
-- non-fashion labels are removed.

CREATE OR REPLACE FUNCTION public.get_brand_departments(p_merchant_id uuid)
RETURNS TABLE(department text, count bigint)
LANGUAGE sql
STABLE
AS $function$
  -- Read the matview (department is materialized) NOT affiliate_products_live
  -- (which computes department per-row via infer_department() and times out on
  -- large brands like Bloomingdale's 178k -> no chips).
  SELECT department, count(*)::bigint AS count
  FROM public.affiliate_products
  WHERE merchant_id = p_merchant_id
    AND department IS NOT NULL
    AND department <> ''
    AND department NOT IN ('Home', 'Tech')   -- non-fashion: never offer it as a chip
  GROUP BY department
  ORDER BY count DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_brand_catalog(
  p_merchant_id uuid,
  p_department text DEFAULT NULL::text,
  p_search text DEFAULT NULL::text,
  p_limit integer DEFAULT 60,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, network text, product_id_in_feed text, name text, brand text,
              department text, category text, merchant_category text, price numeric,
              currency text, product_url text, deep_link text, image_urls text[],
              lifestyle_image_url text, created_at timestamp with time zone)
LANGUAGE sql
STABLE
AS $function$
  SELECT ap.id, ap.network, ap.product_id_in_feed, ap.name, ap.brand, ap.department,
         ap.category, ap.merchant_category, ap.price, ap.currency, ap.product_url,
         ap.deep_link, ap.image_urls, ap.lifestyle_image_url, ap.created_at
  FROM public.affiliate_products_live ap
  WHERE ap.merchant_id = p_merchant_id
    AND coalesce(ap.department, '') NOT IN ('Home', 'Tech')   -- no furniture, no electronics
    AND (p_department IS NULL OR p_department = '' OR ap.department = p_department)
    AND (
      p_search IS NULL OR p_search = ''
      OR ap.name ILIKE '%' || p_search || '%'
      OR ap.brand ILIKE '%' || p_search || '%'
      OR ap.merchant_category ILIKE '%' || p_search || '%'
    )
    AND (
      ap.brand IS NULL
      OR NOT (ap.brand = ANY (
        coalesce((SELECT m.excluded_brands FROM public.affiliate_merchants m WHERE m.id = p_merchant_id), '{}'::text[])
      ))
    )
  ORDER BY ap.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200))
  OFFSET GREATEST(0, p_offset);
$function$;

CREATE OR REPLACE FUNCTION public.get_brand_starter_picks(p_merchant_id uuid, p_limit integer DEFAULT 12)
RETURNS TABLE(product_id_in_feed text, name text, brand text, price numeric, currency text,
              primary_image_url text, lifestyle_image_url text, image_urls text[],
              product_url text, awin_deep_link text, tier text)
LANGUAGE sql
STABLE
AS $function$
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
    FROM public.affiliate_products p
    WHERE p.merchant_id = p_merchant_id
      AND p.removed_at IS NULL
      AND p.in_stock = true
      AND array_length(p.image_urls, 1) >= 1
      AND coalesce(p.department, '') NOT IN ('Home', 'Tech')   -- never feature furniture
  )
  SELECT product_id_in_feed, name, brand, price, currency, primary_image_url,
         lifestyle_image_url, image_urls, product_url, awin_deep_link, tier
  FROM ranked
  ORDER BY tier_rank, first_seen_at DESC NULLS LAST
  LIMIT p_limit;
$function$;
