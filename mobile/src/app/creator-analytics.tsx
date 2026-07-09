import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Dimensions,
  StyleSheet,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { router } from 'expo-router';
import { Settings, ChevronLeft } from 'lucide-react-native';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import Svg, { Path, Text as SvgText, Line as SvgLine } from 'react-native-svg';
import useAuthStore from '@/lib/state/authStore';
import useLookStore, { Look } from '@/lib/state/lookStore';
import useAnalyticsStore, { LookViewEvent, ItemClickEvent } from '@/lib/state/analyticsStore';
import useFollowerSnapshotsStore from '@/lib/state/followerSnapshotsStore';
import { useAwinPerformanceLast30Days } from '@/lib/queries/awinPerformance';
import { useAppFollowerCount } from '@/lib/queries/creatorStats';
import {
  useCreatorItemPerformance,
  useCreatorClicksByNetwork,
} from '@/lib/queries/creatorPerformance';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Period = '30days' | 'alltime';

function SimpleLineChart({ data, width, height }: { data: { x: number; y: number }[]; width: number; height: number }) {
  if (data.length < 2) return null;
  const pL = 50, pR = 20, pT = 10, pB = 30;
  const iW = width - pL - pR;
  const iH = height - pT - pB;
  const minX = Math.min(...data.map((d) => d.x));
  const maxX = Math.max(...data.map((d) => d.x));
  const minY = Math.min(...data.map((d) => d.y));
  const maxY = Math.max(...data.map((d) => d.y));
  const sx = (x: number) => pL + ((x - minX) / (maxX - minX || 1)) * iW;
  const sy = (y: number) => pT + iH - ((y - minY) / (maxY - minY || 1)) * iH;
  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${sx(d.x).toFixed(1)},${sy(d.y).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${sx(data[data.length - 1].x).toFixed(1)},${(pT + iH).toFixed(1)} L${sx(data[0].x).toFixed(1)},${(pT + iH).toFixed(1)} Z`;
  const xLabels = [0, 1, 2, 3, 4].map((i) => {
    const idx = Math.min(Math.round((i / 4) * (data.length - 1)), data.length - 1);
    const d = data[idx];
    const dt = new Date(d.x);
    return { x: sx(d.x), label: `${dt.getMonth() + 1}/${dt.getDate()}` };
  });
  const yLabels = [0, 1, 2, 3].map((i) => {
    const val = minY + ((maxY - minY) * i) / 3;
    return { y: sy(val), label: Math.round(val).toString() };
  });
  return (
    <Svg width={width} height={height}>
      <Path d={areaPath} fill="rgba(184,112,99,0.10)" />
      <SvgLine x1={pL} y1={pT + iH} x2={pL + iW} y2={pT + iH} stroke="#E8E0D8" strokeWidth={1} />
      <Path d={linePath} stroke="#B87063" strokeWidth={2} fill="none" />
      {xLabels.map((l, i) => (
        <SvgText key={i} x={l.x} y={pT + iH + 20} fontSize={11} fill="#6B5E58" textAnchor="middle">{l.label}</SvgText>
      ))}
      {yLabels.map((l, i) => (
        <SvgText key={i} x={pL - 6} y={l.y + 4} fontSize={11} fill="#6B5E58" textAnchor="end">{l.label}</SvgText>
      ))}
    </Svg>
  );
}

export default function AnalyticsScreen() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const creatorId = useAuthStore((s) => s.creatorId) ?? '';
  const allLooks = useLookStore((s) => s.looks);
  const looks = useMemo(() => allLooks.filter((l) => l.creatorId === creatorId), [allLooks, creatorId]);
  // DB-backed in-app follower count (creator_profiles.app_follower_count).
  const followerCount = useAppFollowerCount(creatorId).data ?? 0;

  const allViews = useAnalyticsStore((s) => s.lookViews);
  const allClicks = useAnalyticsStore((s) => s.itemClicks);

  const awinPerformanceQuery = useAwinPerformanceLast30Days(creatorId);
  const awinPerformance = awinPerformanceQuery.data ?? [];

  // Pass-2 stats (Top items + Traffic by network). Both are server-side
  // aggregations via SECURITY DEFINER RPCs that gate on auth.uid() so
  // passing someone else's id returns nothing.
  const itemPerfQuery = useCreatorItemPerformance(creatorId || null);
  const itemPerf = itemPerfQuery.data ?? [];
  const networkMixQuery = useCreatorClicksByNetwork(creatorId || null);
  const networkMix = networkMixQuery.data ?? [];
  const topItems = useMemo(
    () => itemPerf.filter((r) => r.clicks > 0).slice(0, 5),
    [itemPerf],
  );

  const takeSnapshotIfNeeded = useFollowerSnapshotsStore((s) => s.takeSnapshotIfNeeded);
  const fetchSnapshots = useFollowerSnapshotsStore((s) => s.fetchSnapshots);
  const snapshots = useFollowerSnapshotsStore((s) => s.snapshots);

  useEffect(() => {
    if (creatorId) {
      takeSnapshotIfNeeded(creatorId);
      fetchSnapshots(creatorId);
    }
  }, [creatorId, takeSnapshotIfNeeded, fetchSnapshots]);

  const [period, setPeriod] = useState<Period>('30days');
  const [selectedPlatform, setSelectedPlatform] = useState<'instagram' | 'tiktok'>('instagram');

  const platformSnapshots = useMemo(() => {
    return snapshots
      .filter((s) => s.platform === selectedPlatform)
      .slice()
      .sort(
        (a, b) => new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime()
      );
  }, [snapshots, selectedPlatform]);

  const chartData = useMemo(
    () =>
      platformSnapshots.map((snap) => ({
        x: new Date(snap.snapshot_date).getTime(),
        y: snap.follower_count,
      })),
    [platformSnapshots]
  );

  const { latestCount, growthDelta, growthPercent } = useMemo(() => {
    if (platformSnapshots.length === 0) {
      return { latestCount: 0, growthDelta: 0, growthPercent: '0' };
    }
    const latest = platformSnapshots[platformSnapshots.length - 1].follower_count;
    const thirtyAgo = new Date();
    thirtyAgo.setDate(thirtyAgo.getDate() - 30);
    const oldSnap = platformSnapshots.find(
      (s) => new Date(s.snapshot_date) >= thirtyAgo
    );
    const oldVal = oldSnap ? oldSnap.follower_count : latest;
    const delta = latest - oldVal;
    const pct = oldVal > 0 ? ((delta / oldVal) * 100).toFixed(1) : '0';
    return { latestCount: latest, growthDelta: delta, growthPercent: pct };
  }, [platformSnapshots]);

  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  }, []);

  // Filter events for this creator and period
  const creatorViews = useMemo(() => {
    let views = allViews.filter((e) => e.creator_id === creatorId);
    if (period === '30days') {
      views = views.filter((e) => e.viewed_at >= thirtyDaysAgo);
    }
    return views;
  }, [allViews, creatorId, period, thirtyDaysAgo]);

  const creatorClicks = useMemo(() => {
    let clicks = allClicks.filter((e) => e.creator_id === creatorId);
    if (period === '30days') {
      clicks = clicks.filter((e) => e.clicked_at >= thirtyDaysAgo);
    }
    return clicks;
  }, [allClicks, creatorId, period, thirtyDaysAgo]);

  const totalViews = creatorViews.length;
  const totalClicks = creatorClicks.length;

  // Views by source
  const viewsBySource = useMemo(() => {
    const counts: Record<string, number> = { following: 0, discover: 0, profile: 0, search: 0 };
    creatorViews.forEach((e) => { counts[e.source] = (counts[e.source] ?? 0) + 1; });
    return counts;
  }, [creatorViews]);

  const sourceLabels: Record<string, string> = {
    following: 'Following Feed',
    discover: 'Discover',
    profile: 'Profile',
    search: 'Search',
  };

  // Top looks by view count
  const topLooks = useMemo(() => {
    const viewCounts: Record<string, number> = {};
    const clickCounts: Record<string, number> = {};
    creatorViews.forEach((e) => { viewCounts[e.look_id] = (viewCounts[e.look_id] ?? 0) + 1; });
    creatorClicks.forEach((e) => { clickCounts[e.look_id] = (clickCounts[e.look_id] ?? 0) + 1; });

    return looks
      .map((look) => ({
        look,
        views: viewCounts[look.id] ?? 0,
        clicks: clickCounts[look.id] ?? 0,
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 5);
  }, [looks, creatorViews, creatorClicks]);

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="analytics-screen">
      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          testID="analytics-back"
        >
          <ChevronLeft size={26} color="#1A1210" />
        </Pressable>
        <Text style={s.headerTitle}>Your Stats</Text>
        <Pressable
          onPress={() => router.push('/payments-payouts' as any)}
          hitSlop={12}
          style={({ pressed }) => [s.gearButton, pressed && { opacity: 0.6 }]}
          testID="analytics-payments-gear"
        >
          <Settings size={22} color="#1A1210" strokeWidth={1.8} />
        </Pressable>
      </View>

      {/* Period toggle */}
      <View style={s.periodRow}>
        <Pressable
          style={[s.periodChip, period === '30days' && s.periodChipActive]}
          onPress={() => setPeriod('30days')}
          testID="period-30days"
        >
          <Text style={[s.periodText, period === '30days' && s.periodTextActive]}>Last 30 Days</Text>
        </Pressable>
        <Pressable
          style={[s.periodChip, period === 'alltime' && s.periodChipActive]}
          onPress={() => setPeriod('alltime')}
          testID="period-alltime"
        >
          <Text style={[s.periodText, period === 'alltime' && s.periodTextActive]}>All Time</Text>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120, paddingHorizontal: 16 }}
      >
        {totalViews === 0 && totalClicks === 0 ? (
          <View style={s.emptyContainer} testID="analytics-empty">
            <Text style={s.emptyText}>
              No stats yet — your data will appear once shoppers start viewing your looks.
            </Text>
          </View>
        ) : null}

        {/* 2x2 stat cards */}
        <View style={s.statGrid}>
          <View style={s.statCard}>
            <Text style={s.statNumber}>{totalViews}</Text>
            <Text style={s.statLabel}>Look Views</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statNumber}>{totalClicks}</Text>
            <Text style={s.statLabel}>Item Clicks</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statNumber}>{followerCount}</Text>
            <Text style={s.statLabel}>Followers</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statNumber}>{looks.length}</Text>
            <Text style={s.statLabel}>Looks Posted</Text>
          </View>
        </View>

        {/* Brand Performance (Last 30 Days) — Awin per-merchant clicks + earnings */}
        {awinPerformance.length > 0 ? (
          <View style={s.section} testID="brand-performance-section">
            <Text style={s.sectionTitle}>Brand Performance (Last 30 Days)</Text>
            {awinPerformance.map((row) => {
              const dimmed = row.clicks === 0 && row.confirmedValue === 0;
              return (
                <View
                  key={row.merchantId}
                  style={[s.brandRow, dimmed ? { opacity: 0.55 } : null]}
                  testID={`brand-perf-${row.merchantId}`}
                >
                  {row.logoUrl ? (
                    <Image source={{ uri: row.logoUrl }} style={s.brandLogo} contentFit="contain" />
                  ) : (
                    <View style={[s.brandLogo, s.brandLogoFallback]}>
                      <Text style={s.brandLogoLetter}>
                        {(row.merchantName?.[0] ?? '?').toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={s.brandName} numberOfLines={1}>
                      {row.merchantName || 'Brand'}
                    </Text>
                    <Text style={s.brandSub}>
                      {`${row.clicks} clicks \u00B7 ${row.confirmedCount} sales`}
                    </Text>
                  </View>
                  <Text style={s.brandValue}>{`$${row.confirmedValue.toFixed(2)}`}</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* How Shoppers Find You */}
        {totalViews > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>How Shoppers Find You</Text>
            {(['following', 'discover', 'profile', 'search'] as const).map((source) => {
              const count = viewsBySource[source] ?? 0;
              const pct = totalViews > 0 ? (count / totalViews) * 100 : 0;
              return (
                <View key={source} style={s.sourceRow} testID={`source-${source}`}>
                  <View style={s.sourceHeader}>
                    <Text style={s.sourceLabel}>{sourceLabels[source]}</Text>
                    <Text style={s.sourceCount}>{count} ({pct.toFixed(0)}%)</Text>
                  </View>
                  <View style={s.barOuter}>
                    <View style={[s.barInner, { width: `${Math.max(pct, 1)}%` }]} />
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Top Looks */}
        {topLooks.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>
              Top Looks {period === '30days' ? '(Last 30 Days)' : '(All Time)'}
            </Text>
            {topLooks.map((lp, idx) => (
              <View key={lp.look.id} style={s.lookRow} testID={`top-look-${lp.look.id}`}>
                <Text style={s.rankNum}>{idx + 1}</Text>
                {lp.look.photoUri ? (
                  <Image source={{ uri: lp.look.photoUri }} style={s.lookThumb} contentFit="cover" />
                ) : (
                  <View style={[s.lookThumb, s.lookThumbPlaceholder]}>
                    <Text style={{ fontSize: 18 }}>👗</Text>
                  </View>
                )}
                <View style={s.lookInfo}>
                  <Text style={s.lookTitle} numberOfLines={1}>
                    {lp.look.title || 'Untitled Look'}
                  </Text>
                  <Text style={s.lookMeta}>
                    {lp.views} views · {lp.clicks} clicks
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Top Items — per-closet-item ranking from creator_item_performance
            RPC. Powered by click_events × look_items × commissions on the
            server. Shows up only once there's at least one item with a
            click; otherwise the section stays hidden so the screen doesn't
            read as a wall of zeros for fresh creators. */}
        {topItems.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Top Items</Text>
            <Text style={s.sectionSubtitle}>Pieces shoppers gravitate to.</Text>
            {topItems.map((it, idx) => (
              <View key={it.itemId} style={s.lookRow} testID={`top-item-${it.itemId}`}>
                <Text style={s.rankNum}>{idx + 1}</Text>
                {it.photoUrl ? (
                  <Image
                    source={{ uri: it.photoUrl }}
                    style={s.lookThumb}
                    contentFit="contain"
                  />
                ) : (
                  <View style={[s.lookThumb, s.lookThumbPlaceholder]}>
                    <Text style={{ fontSize: 16 }}>🧺</Text>
                  </View>
                )}
                <View style={s.lookInfo}>
                  <Text style={s.lookTitle} numberOfLines={1}>
                    {it.name ?? it.category ?? 'Untitled piece'}
                  </Text>
                  <Text style={s.lookMeta}>
                    {it.brand ? `${it.brand} · ` : ''}
                    {it.clicks} {it.clicks === 1 ? 'click' : 'clicks'} · in {it.looksCount} looks
                    {it.earnings > 0 ? ` · $${it.earnings.toFixed(2)}` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Traffic by network — buckets every real shopper click + commission
            by the affiliate network. 'unaffiliated' bucket surfaces clicks
            on merchants we don't yet wrap (commission leakage signal). */}
        {networkMix.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Traffic by Network</Text>
            <Text style={s.sectionSubtitle}>Where your clicks land before they reach the merchant.</Text>
            {networkMix.map((row) => (
              <View
                key={row.network}
                style={s.networkRow}
                testID={`network-${row.network}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.networkLabel}>{row.label}</Text>
                  <Text style={s.networkMeta}>
                    {row.commissionCount} {row.commissionCount === 1 ? 'sale' : 'sales'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.networkClicks}>{row.clicks.toLocaleString()}</Text>
                  {row.earnings > 0 ? (
                    <Text style={s.networkEarnings}>${row.earnings.toFixed(2)}</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Your Growth */}
        <View style={s.section} testID="growth-section">
          <Text style={s.sectionTitle}>Your Growth</Text>

          {/* Platform toggle */}
          <View style={s.periodRow}>
            <Pressable
              style={[s.periodChip, selectedPlatform === 'instagram' && s.periodChipActive]}
              onPress={() => setSelectedPlatform('instagram')}
              testID="growth-platform-instagram"
            >
              <Text
                style={[s.periodText, selectedPlatform === 'instagram' && s.periodTextActive]}
              >
                Instagram
              </Text>
            </Pressable>
            <Pressable
              style={[s.periodChip, selectedPlatform === 'tiktok' && s.periodChipActive]}
              onPress={() => setSelectedPlatform('tiktok')}
              testID="growth-platform-tiktok"
            >
              <Text
                style={[s.periodText, selectedPlatform === 'tiktok' && s.periodTextActive]}
              >
                TikTok
              </Text>
            </Pressable>
          </View>

          {/* Summary badges */}
          <View style={s.growthBadgeRow}>
            <View style={s.growthBadge} testID="growth-current-card">
              <Text style={s.statNumber}>{latestCount.toLocaleString()}</Text>
              <Text style={s.statLabel}>Current Followers</Text>
            </View>
            <View style={s.growthBadge} testID="growth-delta-card">
              <Text
                style={[
                  s.statNumber,
                  growthDelta > 0
                    ? s.growthPositive
                    : growthDelta < 0
                    ? s.growthNegative
                    : s.growthNeutral,
                ]}
              >
                {growthDelta > 0 ? '+' : ''}
                {growthDelta.toLocaleString()}
              </Text>
              <Text style={s.statLabel}>
                30-Day Growth ({growthDelta >= 0 ? '+' : ''}
                {growthPercent}%)
              </Text>
            </View>
          </View>

          {/* Chart */}
          {chartData.length >= 2 ? (
            <View style={s.chartContainer} testID="growth-chart">
              <SimpleLineChart data={chartData} width={SCREEN_WIDTH - 64} height={200} />
            </View>
          ) : (
            <View style={s.emptyChartCard} testID="growth-chart-empty">
              <Text style={s.emptyChartText}>
                Growth data will appear here after a few days of tracking.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F4F0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1210',
  },
  gearButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  // Period toggle
  periodRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 16,
  },
  periodChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#E8E0D8',
  },
  periodChipActive: {
    backgroundColor: '#B87063',
  },
  periodText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#6B5E58',
  },
  periodTextActive: {
    color: '#FFFFFF',
  },
  // Stat grid
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    padding: 16,
    margin: '1%',
  },
  statNumber: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 28,
    fontWeight: 'bold',
    color: '#B87063',
  },
  statLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    marginTop: 4,
  },
  // Sections
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    marginBottom: 12,
  },
  sectionSubtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginTop: -8,
    marginBottom: 10,
  },
  // Network breakdown rows
  networkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8E0D8',
  },
  networkLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
  },
  networkMeta: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#8A7F78',
    marginTop: 2,
  },
  networkClicks: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
  },
  networkEarnings: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#B87063',
    marginTop: 2,
  },
  // Source bars
  sourceRow: {
    marginBottom: 14,
  },
  sourceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sourceLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
  },
  sourceCount: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
  },
  barOuter: {
    backgroundColor: '#E8E0D8',
    borderRadius: 4,
    height: 8,
    overflow: 'hidden',
  },
  barInner: {
    backgroundColor: '#B87063',
    borderRadius: 4,
    height: 8,
  },
  // Top looks
  lookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8E0D8',
  },
  rankNum: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#8A7F78',
    width: 24,
    textAlign: 'center',
  },
  lookThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    marginLeft: 8,
  },
  lookThumbPlaceholder: {
    backgroundColor: '#E0D8D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lookInfo: {
    flex: 1,
    marginLeft: 12,
  },
  lookTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
  },
  lookMeta: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#8A7F78',
    marginTop: 2,
  },
  // Empty
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  emptyText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    textAlign: 'center',
    lineHeight: 20,
  },
  // Growth section
  chartContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    padding: 12,
    marginTop: 12,
    marginBottom: 16,
  },
  growthBadgeRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  growthBadge: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    padding: 16,
    alignItems: 'center',
  },
  growthPositive: {
    color: '#4A7C59',
  },
  growthNegative: {
    color: '#C0392B',
  },
  growthNeutral: {
    color: '#6B5E58',
  },
  emptyChartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    padding: 24,
    marginTop: 12,
    alignItems: 'center',
  },
  emptyChartText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    textAlign: 'center',
  },
  // Brand performance rows
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8E0D8',
    gap: 12,
  },
  brandLogo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  brandLogoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8E0D8',
  },
  brandLogoLetter: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
  },
  brandName: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
  },
  brandSub: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginTop: 2,
  },
  brandValue: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#B87063',
  },
});
