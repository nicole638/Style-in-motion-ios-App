import { supabase } from '@/lib/supabase';
import type { AmazonCampaign } from '@/lib/queries/amazonCampaigns';

export interface AddAmazonCampaignResult {
  ok: boolean;
  itemId: string | null;
  error?: string;
}

/** Minimal product shape the preview sheet can pass to add a specific ASIN. */
export interface AddCampaignProductOverride {
  asin: string;
  product_name: string | null;
  image_url: string | null;
  product_url: string;
}

/**
 * One-tap add of a product from an Amazon bonus campaign into the creator's
 * closet.
 *
 * Default behavior (when only { campaign, creatorId } is passed): adds the
 * campaign's FEATURED product (campaign.asins[0]). The deep link from
 * asin_links carries the campaign's linkId so affiliate attribution survives,
 * falling back to a platform-tagged URL only if asin_links is empty.
 *
 * Override: pass `asin` (+ optional `product`) to add a SPECIFIC product from
 * the campaign instead of the featured one — used by the tappable product
 * preview sheet. When `asin` is omitted the function behaves exactly as before,
 * so existing `{ campaign, creatorId }` call sites are unchanged.
 */
export async function addAmazonCampaignProductToCloset(args: {
  campaign?: AmazonCampaign;
  creatorId: string;
  asin?: string;
  product?: AddCampaignProductOverride;
}): Promise<AddAmazonCampaignResult> {
  const { campaign, creatorId, asin, product } = args;
  if (!creatorId) return { ok: false, itemId: null, error: 'No creator id' };

  // Resolve which ASIN we're adding: explicit override wins, else the
  // campaign's featured (first) ASIN.
  const targetAsin = asin ?? campaign?.asins[0];
  if (!targetAsin) return { ok: false, itemId: null, error: 'No ASIN on campaign' };

  // Tracked URL preference order:
  //   1. campaign.asin_links[targetAsin] (carries the campaign linkId)
  //   2. campaign.shop_url
  //   3. the override's product_url
  //   4. a plain dp link as last resort
  const trackedUrl =
    campaign?.asin_links?.[targetAsin] ??
    campaign?.shop_url ??
    product?.product_url ??
    `https://www.amazon.com/dp/${targetAsin}`;

  // Photo / name: prefer the override's resolved metadata, then the campaign's
  // featured product, then the brand name (never the raw ASIN as a title).
  const featuredMatchesTarget = campaign?.featured?.asin === targetAsin;
  const photo =
    product?.image_url ??
    (featuredMatchesTarget ? campaign?.featured?.image_url ?? null : null);
  const name =
    product?.product_name ??
    (featuredMatchesTarget ? campaign?.featured?.title ?? null : null) ??
    campaign?.brand_name ??
    'Amazon product';
  const brand = campaign?.brand_name ?? 'Amazon';

  const insertPayload: Record<string, unknown> = {
    creator_id: creatorId,
    name,
    brand,
    category: 'Other',
    url: trackedUrl,
    photo_url: photo,
    original_photo_url: photo,
    affiliate_url: trackedUrl,
    affiliate_provider: 'amazon',
    affiliate_wrapped_at: new Date().toISOString(),
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
      if ((error as any).code === '23505') {
        return { ok: true, itemId: null };
      }
      console.warn('[addAmazonCampaignProductToCloset] insert error:', error.message);
      return { ok: false, itemId: null, error: error.message };
    }

    const itemId = data?.id ?? null;

    if (itemId && photo) {
      supabase.functions
        .invoke('cutout-item-photo', { body: { item_id: itemId } })
        .catch((err) => console.warn('[addAmazonCampaignProductToCloset] cutout invoke failed:', err));
    }

    return { ok: true, itemId };
  } catch (e: any) {
    console.warn('[addAmazonCampaignProductToCloset] threw:', e);
    return { ok: false, itemId: null, error: e?.message ?? 'unknown' };
  }
}
