-- Fix: brand catalog + subcategory grids showed the same product many times
-- (Amazon lists each color/size as its own row — e.g. one HUSKARY maxi dress
-- appeared 42–68x). Deduping at query time is impossible within timeout (103s on
-- the live view, 29s on the matview — both must fetch all variant rows and can't
-- early-terminate on LIMIT).
--
-- FIX: a pre-materialized deduped index `affiliate_products_browse` holds ONE row
-- per (merchant, brand, name) with department + subcategory + created_at. The grid
-- pages through it (indexed, early-terminating) and joins the main matview for the
-- ~200 rows' full data. Chip counts now count DISTINCT products, not variants.
-- (browse matview + its indexes + refresh wiring live in the companion migration;
--  this file only repoints the RPCs onto it.)

-- Department chips — deduped counts.
CREATE OR REPLACE FUNCTION public.get_brand_departments(p_merchant_id uuid)
RETURNS TABLE(department text, count bigint)
LANGUAGE sql STABLE AS $function$
  SELECT department, count(*)::bigint AS count
  FROM public.affiliate_products_browse
  WHERE merchant_id = p_merchant_id AND department IS NOT NULL AND department <> ''
  GROUP BY department
  ORDER BY count DESC;
$function$;

-- Subcategory chips — deduped counts.
CREATE OR REPLACE FUNCTION public.get_brand_subcategories(p_merchant_id uuid, p_department text)
RETURNS TABLE(subcategory text, count bigint)
LANGUAGE sql STABLE AS $function$
  SELECT subcategory, count(*)::bigint AS count
  FROM public.affiliate_products_browse
  WHERE merchant_id = p_merchant_id AND department = p_department AND subcategory IS NOT NULL
  GROUP BY subcategory
  ORDER BY count DESC;
$function$;

-- Catalog grid — driven by the deduped index (fast page), full data from the matview.
DROP FUNCTION IF EXISTS public.get_brand_catalog(uuid, text, text, integer, integer, text);
CREATE FUNCTION public.get_brand_catalog(
  p_merchant_id uuid,
  p_department text DEFAULT NULL::text,
  p_search text DEFAULT NULL::text,
  p_limit integer DEFAULT 60,
  p_offset integer DEFAULT 0,
  p_subcategory text DEFAULT NULL::text
)
RETURNS TABLE(id uuid, network text, product_id_in_feed text, name text, brand text,
              department text, category text, merchant_category text, price numeric,
              currency text, product_url text, deep_link text, image_urls text[],
              lifestyle_image_url text, created_at timestamp with time zone)
LANGUAGE sql STABLE AS $function$
  SELECT ap.id, ap.network, ap.product_id_in_feed, ap.name, ap.brand, ap.department,
         ap.category, ap.merchant_category, ap.price, ap.currency, ap.product_url,
         ap.deep_link, ap.image_urls, ap.lifestyle_image_url, ap.created_at
  FROM public.affiliate_products_browse b
  JOIN public.affiliate_products ap ON ap.id = b.id
  WHERE b.merchant_id = p_merchant_id
    AND (p_department IS NULL OR p_department = '' OR b.department = p_department)
    AND (p_subcategory IS NULL OR p_subcategory = '' OR b.subcategory = p_subcategory)
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
  ORDER BY b.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200))
  OFFSET GREATEST(0, p_offset);
$function$;

-- Starter picks — deduped too (join browse for identity, matview for image tiering).
CREATE OR REPLACE FUNCTION public.get_brand_starter_picks(p_merchant_id uuid, p_limit integer DEFAULT 12)
RETURNS TABLE(product_id_in_feed text, name text, brand text, price numeric, currency text,
              primary_image_url text, lifestyle_image_url text, image_urls text[],
              product_url text, awin_deep_link text, tier text)
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
  )
  SELECT product_id_in_feed, name, brand, price, currency, primary_image_url,
         lifestyle_image_url, image_urls, product_url, awin_deep_link, tier
  FROM ranked
  ORDER BY tier_rank, first_seen_at DESC NULLS LAST
  LIMIT p_limit;
$function$;
