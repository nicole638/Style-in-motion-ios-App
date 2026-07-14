-- Fix: "Consign Now" was appearing on items that are not TheRealReal designers.
--
-- ROOT CAUSE — is_trr_eligible() matched the item's brand against the 922-brand
-- accepted list using a bidirectional *substring* test with a 2-char minimum:
--
--     position(b.brand_slug IN n) > 0  OR  position(n IN b.brand_slug) > 0
--
-- The accepted list contains 2- and 3-character slugs ('co', 'erl', 'agl', 'cos',
-- 'iro', 'apc', ...), so in practice this matched almost anything:
--
--   target.com / amazon.com / shein.com  → 'co'   (every ".COm" contains "co")
--   "American Eagle"                     → 'agl'  ("e-AGL-e")
--   "...Sterling Silver Earrings..."     → 'erl'  ("st-ERL-ing")
--   "Cowgirl Suede Dress"                → 'co'   ("CO-wgirl")
--
-- and the reverse direction promoted brands into unrelated sub-brands:
--
--   Nike → 'nike acg',  Adidas → 'adidas yeezy',  Golden → 'golden goose',
--   AQUA (Bloomingdale's house label) → 'aquazzura',  Van → 'vanessa bruno'
--
-- Net effect: Consign Now rendered on Nike socks, Havaianas flip-flops, $32
-- denim shorts and SHEIN tops. Creators concluded the feature was broken and
-- stopped trusting it — including on their genuine luxury.
--
-- FIX — match on WHOLE WORDS, forward direction only:
--   * exact match (normalized brand = accepted slug), OR
--   * the accepted brand appears as a complete word-phrase inside the item's
--     brand — so "PS Paul Smith" → Paul Smith and "POLO RALPH LAUREN" → Ralph
--     Lauren still match, but "targetcom" no longer contains the *word* "co".
--   * the reverse direction is dropped entirely: a short brand may no longer
--     match a longer, different brand.
--
-- NOT a price gate. TheRealReal accepts accepted-designer items at any price;
-- the $200 threshold only governs the $250 consignment bonus, which is applied
-- at payout, not at eligibility.
--
-- trr_eligible is a derived column — rollback is simply restoring the previous
-- function body and re-running refresh_all_trr_eligible().

CREATE OR REPLACE FUNCTION public.is_trr_eligible(p_brand text, p_category text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH normalized AS (
    SELECT normalize_brand(p_brand) AS n
  )
  SELECT EXISTS (
    SELECT 1
    FROM trr_accepted_brands b, normalized
    WHERE length(normalized.n) >= 2
      AND (
            normalized.n = b.brand_slug
         OR normalized.n ~ ('\m' || regexp_replace(b.brand_slug, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M')
          )
      AND (
            b.accepted_categories IS NULL
         OR p_category IS NULL
         OR EXISTS (
              SELECT 1 FROM unnest(b.accepted_categories) cat
              WHERE position(lower(cat) IN lower(coalesce(p_category, ''))) > 0
                 OR position(lower(coalesce(p_category, '')) IN lower(cat)) > 0
            )
          )
  );
$function$;

COMMENT ON FUNCTION public.is_trr_eligible(text, text) IS
  'TheRealReal consignment eligibility. Whole-word brand match against trr_accepted_brands (922 accepted designers). No price floor — the $200 threshold governs the $250 bonus, not eligibility.';
