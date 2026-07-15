-- One-off data fix (NOT a migration — pure data correction, per docs/schema-discipline.md).
--
-- WHY: 20260714183000_fix_item_category_amazon_boilerplate.sql taught the
-- classifier the bag *shapes* that don't contain the word "bag" (hobo, duffel,
-- ...), and 20260715001000 added shopper/messenger. But the classifier is a
-- BEFORE INSERT/UPDATE trigger that (correctly) never overrides a creator's
-- existing valid category — so items that were mis-filed BEFORE those fixes
-- stayed mis-filed. This backfills exactly the bag back-catalogue.
--
-- SCOPE: 11 rows whose (normalized) name matches the Bag branch and NOT the
-- higher-priority Shoes branch, and that are not already 'Bag'. Verified by
-- preview on 2026-07-14 to be genuine handbags (5x Prada, 2x Pinko, Diesel
-- D-LINE HOBO S, a Straw Studios crossbody, a Bolsa Nova handbag/backpack, and
-- a Steve Madden bag bundle). This is the exact bag scope — it deliberately
-- does NOT do a blanket re-classification, which would also flip ~52 unrelated
-- rows and REGRESS several (e.g. "thong swimsuit" -> Intimates, "SHORT LACE
-- BLAZER" -> Pants, "Bra-Free Tank" -> Intimates).
--
-- Setting category = 'Bag' fires the BEFORE UPDATE OF category triggers, which
-- recompute trr_eligible via is_trr_eligible(brand,'Bag'). refresh_all_trr_eligible()
-- is then run as a full belt-and-suspenders recompute.
--
-- ROLLBACK (before-state snapshot, category / trr_eligible captured pre-change):
--   86d074ed-5b2c-4cdf-b15d-cc06436fd4b9  D-LINE HOBO S (Diesel)                  Accessory  f
--   dcf7b984-2c43-4b3c-b58a-e8451f1f695a  Pinko Love One Mini Top Handle Bag       Accessory  t
--   74040b52-29f2-491d-8b43-4785c9aeb90e  Pinko Love One Mini Top Handle Bag       Accessory  t
--   5f46c022-c139-4d33-8b19-88c30b58c9b4  Prada Arque ... Mini Shoulder Bag        Accessory  t
--   34777288-4b25-4ebd-9103-2fa22e19a200  Prada Arque ... Mini Shoulder Bag        Accessory  t
--   dbfef4c4-e272-48d9-8d8a-3277088bc770  Prada Large Leather Tote Bag             Accessory  t
--   e01af2d5-e1c0-4d17-a32e-39dc32b47a3d  Prada Large Leather Tote Bag             Accessory  t
--   16e0c2ce-9d23-48b1-9cb3-ffec0203463d  Prada Large Leather Tote Bag             Accessory  t
--   07ef5fd5-706d-48b9-8497-5baf027497a3  Woven Straw Crossbody (Straw Studios)    Accessory  f
--   ebac38f9-0977-476a-860a-ea899daecb79  Buttery Soft Leather Handbags ... (Bolsa Nova)  Other  f
--   9cacc27a-b3a5-4616-b212-a91d70e79882  LUCIA FLAT & CHEYANN BAG BUNDLE (Steve Madden)  Top    f
-- To revert: UPDATE creator_items SET category = <old> WHERE id = <id>;  (per row above)

WITH base AS (
  SELECT id,
    regexp_replace(
     regexp_replace(
      regexp_replace(
       regexp_replace(
        regexp_replace(
         lower(coalesce(name,'')),
        '^amazon\.com\s*:\s*',''),
       '\s*:\s*clothing,\s*shoes\s*(&|and)\s*jewelry\s*$',''),
      '\s+at\s+amazon\b[^:]*\bstore\s*$',''),
     'clothing,\s*shoes\s*(&|and)\s*jewelry','','g'),
    'short[\s-]+sleeve','shortsleeve','g') AS n,
    category
  FROM creator_items
)
UPDATE creator_items ci
SET category = 'Bag'
FROM base b
WHERE ci.id = b.id
  AND b.category IS DISTINCT FROM 'Bag'
  AND b.n ~ '\m(handbags?|bags?|purses?|clutch|clutches|backpacks?|wallets?|totes?|crossbody|satchels?|hobos?|duffels?|duffles?|baguettes?|carryalls?|weekenders?|minaudi[eè]res?|shoppers?|messengers?)\M'
  AND b.n !~ '\m(shoes?|boots?|sandals?|sneakers?|heels?|loafers?|slippers?|mules?|clogs?|wedges?|pumps?)\M'
RETURNING ci.id, ci.name, ci.brand, ci.category AS new_category, ci.trr_eligible AS new_trr_eligible;

-- Full recompute of the derived eligibility column across the closet.
SELECT public.refresh_all_trr_eligible();
