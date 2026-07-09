import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Dimensions,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { ArrowLeft, Eye, MousePointerClick, Heart, Bookmark, TrendingUp } from 'lucide-react-native';
import useAuthStore from '@/lib/state/authStore';
import useLookStore from '@/lib/state/lookStore';
import useLikeStore from '@/lib/state/likeStore';
import { useAppFollowerCount } from '@/lib/queries/creatorStats';
// useAnalyticsStore removed 2026-06-08 — views + clicks now read from
// DB-backed looks.views + looks.clicks (see useCreatorStats query).

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function StatsScreen() {
  const { creatorId: paramCreatorId } = useLocalSearchParams<{ creatorId?: string }>();
  const authCreatorId = useAuthStore((s) => s.creatorId);
  const creatorId = paramCreatorId || authCreatorId || '';

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const allLooks = useLookStore((s) => s.looks);
  const looks = useMemo(() => allLooks.filter((l) => l.creatorId === creatorId), [allLooks, creatorId]);
  const likeCounts = useLikeStore((s) => s.likeCounts);
  // DB-backed in-app follower count (creator_profiles.app_follower_count).
  const followerCount = useAppFollowerCount(creatorId).data ?? 0;

  // Views + clicks now come from DB-backed columns on the looks row
  // (looks.views via increment_look_views RPC; looks.clicks via
  // increment_look_clicks RPC). The legacy analyticsStore.lookViews was
  // per-device Zustand and never aggregated cross-device — Kerri opened
  // her stats page and saw 0 even when real shoppers viewed her looks.
  // Switching to look.views + look.clicks closes that gap.
  const totalViews = looks.reduce(
    (sum, l) => sum + (Number((l as { views?: number }).views) || 0),
    0,
  );
  const totalClicks = looks.reduce(
    (sum, l) => sum + (Number(l.clicks) || 0),
    0,
  );
  const totalLikes = looks.reduce((sum, l) => sum + (likeCounts[l.id] ?? 0), 0);
  const ctr = totalViews > 0 ? ((totalClicks / totalViews) * 100).toFixed(1) : '0.0';

  // Per-look performance from the same DB-backed counters, sorted views desc.
  const lookPerformance = useMemo(() => {
    return looks.map((look) => ({
      look,
      views: Number((look as { views?: number }).views) || 0,
      clicks: Number(look.clicks) || 0,
      likes: likeCounts[look.id] ?? 0,
      saves: 0,
    })).sort((a, b) => b.views - a.views);
  }, [looks, likeCounts]);

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;

  return (
    <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} testID="stats-screen">
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#F7F4F0' }}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="stats-back">
            <ArrowLeft size={24} color="#1A1210" />
          </Pressable>
          <Text style={s.headerTitle}>Analytics</Text>
          <View style={{ width: 24 }} />
        </View>
      </SafeAreaView>

      <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120 }}
        >
          {/* Overview cards */}
          <View style={s.overviewGrid}>
            <View style={s.overviewCard}>
              <View style={s.overviewIconRow}>
                <Eye size={18} color="#B87063" />
              </View>
              <Text style={s.overviewValue}>{totalViews}</Text>
              <Text style={s.overviewLabel}>Views</Text>
            </View>
            <View style={s.overviewCard}>
              <View style={s.overviewIconRow}>
                <MousePointerClick size={18} color="#B87063" />
              </View>
              <Text style={s.overviewValue}>{totalClicks}</Text>
              <Text style={s.overviewLabel}>Link Clicks</Text>
            </View>
            <View style={s.overviewCard}>
              <View style={s.overviewIconRow}>
                <TrendingUp size={18} color="#B87063" />
              </View>
              <Text style={s.overviewValue}>{ctr}%</Text>
              <Text style={s.overviewLabel}>CTR</Text>
            </View>
            <View style={s.overviewCard}>
              <View style={s.overviewIconRow}>
                <Heart size={18} color="#B87063" />
              </View>
              <Text style={s.overviewValue}>{totalLikes}</Text>
              <Text style={s.overviewLabel}>Likes</Text>
            </View>
          </View>

          {/* Summary row */}
          <View style={s.summaryRow}>
            <View style={s.summaryItem}>
              <Text style={s.summaryValue}>{looks.length}</Text>
              <Text style={s.summaryLabel}>Looks</Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryItem}>
              <Text style={s.summaryValue}>{followerCount}</Text>
              <Text style={s.summaryLabel}>Followers</Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryItem}>
              <Text style={s.summaryValue}>{looks.reduce((sum, l) => sum + l.items.length, 0)}</Text>
              <Text style={s.summaryLabel}>Items</Text>
            </View>
          </View>

          {/* Top performing looks */}
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Top Performing Looks</Text>
          </View>

          {lookPerformance.length === 0 ? (
            <View style={s.emptyContainer}>
              <Text style={s.emptyText}>No looks yet. Create your first look to start tracking.</Text>
            </View>
          ) : (
            lookPerformance.map((lp, idx) => (
              <View key={lp.look.id} style={s.lookRow} testID={`stats-look-${lp.look.id}`}>
                <Text style={s.rankNumber}>{idx + 1}</Text>
                {lp.look.photoUri ? (
                  <Image source={{ uri: lp.look.photoUri }} style={s.lookThumb} contentFit="cover" />
                ) : (
                  <View style={[s.lookThumb, { backgroundColor: '#E0D8D0', alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ fontSize: 18 }}>👗</Text>
                  </View>
                )}
                <View style={s.lookInfo}>
                  <Text style={s.lookTitle} numberOfLines={1}>
                    {lp.look.title || 'Untitled Look'}
                  </Text>
                  <View style={s.lookStatsRow}>
                    <View style={s.lookStatItem}>
                      <Eye size={12} color="#8A7F78" />
                      <Text style={s.lookStatText}>{lp.views}</Text>
                    </View>
                    <View style={s.lookStatItem}>
                      <MousePointerClick size={12} color="#8A7F78" />
                      <Text style={s.lookStatText}>{lp.clicks}</Text>
                    </View>
                    <View style={s.lookStatItem}>
                      <Heart size={12} color="#8A7F78" />
                      <Text style={s.lookStatText}>{lp.likes}</Text>
                    </View>
                    <View style={s.lookStatItem}>
                      <Bookmark size={12} color="#8A7F78" />
                      <Text style={s.lookStatText}>{lp.saves}</Text>
                    </View>
                  </View>
                </View>
                {lp.views > 0 ? (
                  <View style={s.ctrBadge}>
                    <Text style={s.ctrBadgeText}>
                      {((lp.clicks / lp.views) * 100).toFixed(0)}%
                    </Text>
                  </View>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#1A1210',
  },
  // Overview grid
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  overviewCard: {
    width: (SCREEN_WIDTH - 42) / 2,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#C4A882',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  overviewIconRow: {
    marginBottom: 8,
  },
  overviewValue: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 32,
    color: '#1A1210',
  },
  overviewLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#8A7F78',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Summary row
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 16,
    shadowColor: '#C4A882',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  summaryItem: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  summaryValue: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 18,
    color: '#1A1210',
  },
  summaryLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#8A7F78',
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#E8E0D8',
  },
  // Section
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 12,
  },
  sectionTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
  },
  // Look rows
  lookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8E0D8',
  },
  rankNumber: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#8A7F78',
    width: 24,
    textAlign: 'center',
  },
  lookThumb: {
    width: 48,
    height: 48,
    borderRadius: 10,
    marginLeft: 8,
  },
  lookInfo: {
    flex: 1,
    marginLeft: 12,
  },
  lookTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
    marginBottom: 4,
  },
  lookStatsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  lookStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  lookStatText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#8A7F78',
  },
  ctrBadge: {
    backgroundColor: '#F0EBE5',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
  },
  ctrBadgeText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#B87063',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 32,
  },
  emptyText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#8A7F78',
    textAlign: 'center',
  },
});
