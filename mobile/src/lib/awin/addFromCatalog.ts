import { supabase } from '@/lib/supabase';
import { buildAwinUrl } from '@/lib/awin/wrap';
import type { AwinProduct } from '@/lib/queries/awinProducts';
import type { AwinMerchant } from '@/lib/state/awinMerchantsStore';
import type { ItemCategory } from '@/lib/state/lookStore';
import { emojiForCategory } from '@/lib/constants/categories';

export { emojiForCategory };

/**
 * Best-effort map from Awin's free-form `category` text to our closet ItemCategory.
 * Skirts fold into `Dress`, and swim/intimates get their own buckets — matching
 * the canonical taxonomy (see lib/constants/categories.ts).
 */
export function categoryFromAwinText(text: string | null | undefined): ItemCategory {
  const c = (text ?? '').toLowerCase();
  if (!c) return 'Other';
  if (/(swim|bikini|bathing|trunks|one[- ]?piece|cover[- ]?up)/.test(c)) return 'Swimwear';
  if (/(lingerie|bralette|underwear|intimates?|knicker|thong|boyshort|\bbra\b|\bbras\b|sports bra)/.test(c)) return 'Intimates';
  if (/(dress|gown|skirt)/.test(c)) return 'Dress';
  if (/(jacket|coat|outer|blazer|cardigan|hoodie|sweater|knit)/.test(c)) return 'Outerwear';
  if (/(top|shirt|blouse|tee|tunic|cami)/.test(c)) return 'Top';
  if (/(pant|jean|trouser|short|legging)/.test(c)) return 'Pants';
  if (/(shoe|sneaker|boot|heel|sandal|loafer|flat)/.test(c)) return 'Shoes';
  if (/(bag|purse|tote|backpack|clutch|handbag)/.test(c)) return 'Bag';
  if (/(jewel|ring|earring|necklace|bracelet|pendant)/.test(c)) return 'Jewelry';
  if (/(scarf|hat|belt|sunglass|glove|accessory|accessories)/.test(c)) return 'Accessory';
  return 'Other';
}

export interface AddFromCatalogResult {
  ok: boolean;
  itemId: string | null;
  error?: string;
}

/**
 * One-tap add of an Awin product to the creator's closet.
 *
 * Inserts directly into creator_items. Realtime channel on shop.tsx will
 * pick up the INSERT and surface it. We also fire-and-forget the
 * cutout-item-photo Edge Function so Photoroom runs in the background.
 */
export async function addAwinProductToCloset(args: {
  product: AwinProduct;
  merchant: AwinMerchant;
  creatorId: string;
}): Promise<AddFromCatalogResult> {
  const { product, merchant, creatorId } = args;
  if (!creatorId) return { ok: false, itemId: null, error: 'No creator id' };

  const category = categoryFromAwinText(product.category);
  const priceStr = product.price !== null ? product.price.toFixed(2) : '';

  // Always rebuild the affiliate tracking URL with the current creator's clickref.
  // Don't try to surgically edit awin_deep_link — easier to be safe.
  //
  // For Rakuten merchants (network === 'rakuten' or awinmid == null) we can't build
  // an Awin URL. Rakuten product catalogs (SFTP feeds) are not yet enabled, so this
  // path is only reached via Brands → drilldown → Add for Awin merchants. We choose
  // option (b) from the spec: bail with a console.log and pass the raw URL through.
  // When the affiliate-wrap-url Edge Function is ready, swap this to invoke it.
  const productUrl = product.productUrl || merchant.clickThroughUrl || '';
  const isRakuten = merchant.network === 'rakuten' || merchant.awinmid == null;
  let trackedUrl = '';
  if (productUrl) {
    if (isRakuten) {
      console.log('[addAwinProductToCloset] rakuten merchant — affiliate wrap not yet supported, using raw URL');
      // Intentionally leave trackedUrl empty so we don't mark this as wrapped.
    } else {
      trackedUrl = buildAwinUrl({
        awinmid: merchant.awinmid,
        clickref: creatorId,
        productUrl,
      });
    }
  }

  const primaryPhoto = product.imageUrls[0] ?? null;

  const insertPayload: Record<string, unknown> = {
    creator_id: creatorId,
    name: product.name,
    brand: product.brand ?? merchant.name,
    price: priceStr,
    category,
    // Store the RAW merchant URL in `url` so scrape-product's Shopify
    // fast path (and any host-based detection) can recognize the merchant.
    // The wrapped tracking URL lives in `affiliate_url` for /api/shop.
    url: productUrl,
    affiliate_url: trackedUrl || null,
    affiliate_provider: trackedUrl ? 'awin' : null,
    affiliate_wrapped_at: trackedUrl ? new Date().toISOString() : null,
    photo_url: primaryPhoto,
    original_photo_url: primaryPhoto,
    candidate_photo_urls: product.imageUrls.slice(0, 6),
    fetch_status: 'complete',
    archived: false,
    alternates: [],
  };

  try {
    const { data, error } = await supabase
      .from('creator_items')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error) {
      // 23505 unique violation — already in closet. Treat as success.
      if ((error as any).code === '23505') {
        return { ok: true, itemId: null };
      }
      console.warn('[addAwinProductToCloset] insert error:', error.message);
      return { ok: false, itemId: null, error: error.message };
    }

    const itemId = data?.id ?? null;

    // Fire-and-forget Photoroom cutout — the Edge Function dedupes and
    // updates the creator_items row, which propagates via realtime.
    if (itemId && primaryPhoto) {
      supabase.functions
        .invoke('cutout-item-photo', { body: { item_id: itemId } })
        .catch((err) => console.warn('[addAwinProductToCloset] cutout invoke failed:', err));
    }

    // Fire-and-forget scrape-product to enrich the gallery. Awin feeds often
    // give only 1 image; the Shopify-aware fast path in scrape-product pulls
    // the full gallery and writes back to candidate_photo_urls so the picker
    // can offer all shots. Once it completes, chain cutout-all-candidates so
    // Photoroom runs on every candidate (writing candidate_cutout_urls[]).
    // Best-effort — failures are silent.
    if (itemId && productUrl) {
      supabase.functions
        .invoke('scrape-product', { body: { url: productUrl, item_id: itemId } })
        .then(() => {
          // Photoroom cutouts on every candidate, populates candidate_cutout_urls[]
          return supabase.functions.invoke('cutout-all-candidates', {
            body: { item_id: itemId, max: 4 },
          });
        })
        .catch((err) => console.warn('[addAwinProductToCloset] scrape/cutout chain failed:', err));
    }

    return { ok: true, itemId };
  } catch (e: any) {
    console.warn('[addAwinProductToCloset] threw:', e);
    return { ok: false, itemId: null, error: e?.message ?? 'unknown' };
  }
}
