import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import useCampaignsStore, { extractAsin } from '@/lib/state/campaignsStore';

interface Props {
  url: string;
}

const TYPE_LABEL: Record<string, string> = {
  affiliate_plus: 'Affiliate+',
  sponsored_products: 'Sponsored',
};

function daysUntil(isoDate: string): number | null {
  try {
    const end = new Date(`${isoDate}T23:59:59`);
    const ms = end.getTime() - Date.now();
    if (ms < 0) return null;
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

/**
 * Shown above the URL field on the closet Add/Edit Item flow when the pasted
 * URL's ASIN is in an active campaign. Mirrors the web equivalent. Pulls from
 * useCampaignsStore (loaded on app start by the dashboard); fetches on mount
 * if not already loaded so it works even when the user lands on Add Item
 * before scrolling to the dashboard.
 */
export function CampaignMatchBanner({ url }: Props) {
  const fetchActive = useCampaignsStore((s) => s.fetchActive);
  const loaded = useCampaignsStore((s) => s.loaded);
  const findByAsin = useCampaignsStore((s) => s.findByAsin);

  useEffect(() => {
    if (!loaded) fetchActive();
  }, [loaded, fetchActive]);

  if (!url || !/amazon\.com|a\.co|amzn\./i.test(url)) return null;
  const asin = extractAsin(url);
  if (!asin) return null;
  const campaign = findByAsin(asin);
  if (!campaign) return null;

  const daysLeft = daysUntil(campaign.endDate);

  return (
    <View style={styles.banner}>
      <View style={styles.icon}>
        <Sparkles size={16} color="#B87063" strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>
          This product is in a{' '}
          <Text style={styles.bonus}>+{campaign.commissionRatePct}% bonus</Text>{' '}
          campaign with{' '}
          <Text style={styles.brand}>{campaign.brandName}</Text>.
        </Text>
        <Text style={styles.meta}>
          {TYPE_LABEL[campaign.campaignType] ?? campaign.campaignType}
          {'  ·  '}
          {daysLeft === null
            ? `Ends ${campaign.endDate}`
            : daysLeft === 0
              ? 'Ends today'
              : daysLeft === 1
                ? 'Ends tomorrow'
                : `${daysLeft} days left`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(184, 112, 99, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(184, 112, 99, 0.4)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(184, 112, 99, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  body: {
    flex: 1,
  },
  title: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
    lineHeight: 18,
  },
  bonus: {
    color: '#B87063',
    fontFamily: 'DMSans_500Medium',
  },
  brand: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 15,
    color: '#1A1210',
  },
  meta: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#6B5E58',
    marginTop: 4,
  },
});
