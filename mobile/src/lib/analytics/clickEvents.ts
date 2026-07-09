import { supabase } from '@/lib/supabase';
import { CLICK_SOURCE } from '@/lib/analytics/source';

type LogClickArgs = {
  lookId: string | null;
  itemId: string | null;
  creatorId: string | null;
  itemUrl: string;
  redirectUrl: string;
  wasAffiliated: boolean;
  affiliateNetwork: 'amazon' | 'awin' | 'rakuten' | 'cj' | null;
};

function domainOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

export async function logClickEvent(args: LogClickArgs): Promise<void> {
  try {
    await supabase.from('click_events').insert({
      look_id: args.lookId,
      item_id: args.itemId,
      creator_id: args.creatorId,
      item_url: args.itemUrl,
      redirect_url: args.redirectUrl,
      was_affiliated: args.wasAffiliated,
      affiliate_network: args.affiliateNetwork,
      merchant_domain: domainOf(args.itemUrl),
      source: CLICK_SOURCE,
    });
  } catch (err) {
    console.warn('[click_events] insert failed', err);
  }
}

// TheRealReal partnership landing page. Conversions land in TRR's attribution
// system and ladder up to our commission. Single source of truth for both the
// click_events redirect_url and the URL the Consign modal opens.
export const TRR_PARTNERSHIP_LP = 'https://www.therealreal.com/styledinmotion';

// Records a tap on the Consign modal's "Continue on The RealReal" CTA. This is
// the ONLY thing the consign flow writes — there is no consignment_requests
// insert and no backend call. Fire-and-forget: never block navigation to the LP.
export async function logConsignClick(args: {
  creatorId: string | null;
  itemId: string;
}): Promise<void> {
  try {
    await supabase.from('click_events').insert({
      look_id: null, // no look context — consign is a closet-item action
      item_id: args.itemId,
      creator_id: args.creatorId,
      item_url: TRR_PARTNERSHIP_LP,
      redirect_url: TRR_PARTNERSHIP_LP,
      was_affiliated: true,
      affiliate_network: 'trr_partnership',
      merchant_domain: 'therealreal.com',
      source: CLICK_SOURCE,
      source_surface: 'consign_modal',
    });
  } catch (err) {
    console.warn('[click_events] consign click insert failed', err);
  }
}
