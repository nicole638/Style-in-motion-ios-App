import React, { useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Dimensions,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useFonts, DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { ArrowLeft, UserPlus, UserCheck, Heart, Grid3X3, MapPin } from 'lucide-react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import useProfileStore, { SocialHandle } from '@/lib/state/profileStore';
import useFollowStore from '@/lib/state/followStore';
import useLookStore, { Look } from '@/lib/state/lookStore';
import useLikeStore from '@/lib/state/likeStore';
import { ItemListSheet } from '@/components/ItemListSheet';
import FollowPromptSheet from '@/components/FollowPromptSheet';
import FoundingCreatorBadge from '@/components/FoundingCreatorBadge';
import useAnalyticsStore from '@/lib/state/analyticsStore';
import useAuthStore from '@/lib/state/authStore';
import { useBrandIdentity } from '@/lib/queries/storefront';
import { useCreatorLooks } from '@/lib/queries/creatorLooks';
import SignUpNudgeSheet from '@/components/SignUpNudgeSheet';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_GAP = 2;
const GRID_COLS = 3;
const TILE_SIZE = (SCREEN_WIDTH - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;

export default function CreatorProfileScreen() {
  const { creatorId } = useLocalSearchParams<{ creatorId: string }>();
  const [fontsLoaded] = useFonts({ DMSans_400Regular, DMSans_500Medium, CormorantGaramond_600SemiBold });

  const profile = useProfileStore((s) => s.profiles[creatorId ?? '']);
  const fetchProfile = useProfileStore((s) => s.fetchProfile);
  // Dedicated React Query fetch for the *viewed* creator's published looks.
  // Pre-2026-06-08 this read useLookStore.looks (signed-in user only) and
  // returned 0 looks for any creator-other-than-self. Now any shopper can
  // open any creator's profile and see their catalog.
  const creatorLooksQuery = useCreatorLooks(creatorId ?? null);
  const archivedByCreator = useLookStore((s) => s.archivedLooksByCreator);
  const fetchArchivedLooksByCreator = useLookStore((s) => s.fetchArchivedLooksByCreator);
  // DB-backed follows (2026-06-09). Subscribe to followedIds so the heart +
  // Following button re-render on toggle. Follower count comes from the
  // trigger-maintained creator_profiles.app_follower_count (real, cross-device)
  // — the old getFollowerCount only counted follows made on this device.
  const followedIds = useFollowStore((s) => s.followedIds);
  const isFollowing = creatorId ? followedIds.includes(creatorId) : false;
  const toggleFollow = useFollowStore((s) => s.toggleFollow);
  const followerCount = profile?.appFollowerCount ?? 0;
  // Guests (deep-link look viewers, not signed in) get a sign-up nudge
  // instead of a silent no-op when they tap Follow.
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const [showSignUpNudge, setShowSignUpNudge] = React.useState(false);
  // Subscribe to the maps so the heart fill + count re-render on toggle
  // (the previous `s.getLikeCount` subscription was a function reference and
  // never triggered re-render on count updates).
  const likeCounts = useLikeStore((s) => s.likeCounts);
  const likedLookIds = useLikeStore((s) => s.likedLookIds);
  const toggleLike = useLikeStore((s) => s.toggleLike);
  const getLikeCount = useCallback(
    (lookId: string) => likeCounts[lookId] ?? 0,
    [likeCounts]
  );

  const [selectedLook, setSelectedLook] = React.useState<Look | null>(null);
  const [itemSheetVisible, setItemSheetVisible] = React.useState(false);
  const [tab, setTab] = React.useState<'all' | 'archives'>('all');
  const [followPromptCreatorId, setFollowPromptCreatorId] = React.useState<string | null>(null);

  useEffect(() => {
    if (creatorId) {
      fetchProfile(creatorId);
      fetchArchivedLooksByCreator(creatorId);
    }
  }, [creatorId]);

  // creatorLooks: prefer the React Query result. Falls through to empty
  // array during the initial load; the empty-state copy stays out of the
  // way because we don't render "No looks yet" while isLoading.
  const creatorLooks = creatorLooksQuery.data ?? [];

  const archivedLooks = useMemo(
    () => archivedByCreator[creatorId ?? ''] ?? [],
    [archivedByCreator, creatorId]
  );

  const displayLooks = tab === 'archives' ? archivedLooks : creatorLooks;

  // Seed like counts from the loaded look rows so the tile counts reflect the
  // real base and optimistic +/-1 starts from the correct value. initCounts
  // merges and preserves any in-flight delta.
  useEffect(() => {
    if (displayLooks.length === 0) return;
    const counts: Record<string, number> = {};
    displayLooks.forEach((l) => {
      counts[l.id] = l.likesCount ?? 0;
    });
    useLikeStore.getState().initCounts(counts);
  }, [displayLooks]);

  const totalLikes = useMemo(
    () => creatorLooks.reduce((sum, l) => sum + getLikeCount(l.id), 0),
    [creatorLooks, getLikeCount]
  );

  const handleFollow = useCallback(async () => {
    if (!creatorId) return;
    // Not signed in → nudge to create an account instead of a silent no-op.
    if (!isLoggedIn) {
      setShowSignUpNudge(true);
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // toggleFollow returns the resulting state (true = now following). Only
    // surface the cross-social follow prompt on a fresh follow, not an unfollow.
    const nowFollowing = await toggleFollow(creatorId);
    if (nowFollowing) {
      setFollowPromptCreatorId(creatorId);
    }
  }, [creatorId, toggleFollow, isLoggedIn]);

  const handleOpenSheet = useCallback((look: Look) => {
    setSelectedLook(look);
    setItemSheetVisible(true);
    useAnalyticsStore.getState().trackView(look.id, look.creatorId ?? '', 'profile');
  }, []);

  const handleCloseSheet = useCallback(() => {
    setItemSheetVisible(false);
    setSelectedLook(null);
  }, []);

  // Brand-aware identity lookup — when this profile belongs to a partner_brand
  // account, swap the human-creator chrome (username, follower count, founding
  // badge) for the brand mark + brand name. Falls through to creator UI when
  // not loaded or when identity.isPartnerBrand === false.
  // MUST run before any early return so hook order stays stable across renders.
  const { identity } = useBrandIdentity(creatorId ?? '');

  if (!fontsLoaded || !creatorId) return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;

  const isBrandProfile = identity?.isPartnerBrand === true;

  const username = isBrandProfile
    ? (identity?.brandName ?? 'Brand')
    : (profile?.username || 'Creator');
  const bio = profile?.bio || '';
  const locationCity = profile?.location ?? null;
  const photoUri = isBrandProfile
    ? (identity?.brandLogoUrl ?? profile?.photoUri ?? '')
    : (profile?.photoUri || '');
  const initial = username.charAt(0).toUpperCase();
  // Brands never carry the founding-creator program badge.
  const isFoundingCreator = !isBrandProfile && (profile?.isFoundingCreator ?? false);
  const socials = (profile?.socials ?? []).filter((s: SocialHandle) => s.enabled && s.handle);

  const renderHeader = () => (
    <View>
      {/* Profile info */}
      <View style={s.profileSection}>
        {/* Avatar + name on ONE horizontal line (matches the web profile
            header). Bio / location / stats stay centered below. */}
        <View style={s.identityRow}>
          <View style={s.avatarWrap}>
            {isFoundingCreator ? (
              <FoundingCreatorBadge
                size="sm"
                photoUri={photoUri || null}
                firstInitial={initial}
                testID="creator-profile-founding-badge"
                onPress={() => router.push({ pathname: '/founding-badge-info', params: { photoUri: photoUri || '', firstInitial: initial } })}
              />
            ) : photoUri ? (
              <Image source={{ uri: photoUri }} style={s.avatar} contentFit="cover" />
            ) : (
              <View style={[s.avatar, s.avatarFallback]}>
                <Text style={s.avatarInitial}>{initial}</Text>
              </View>
            )}
          </View>
          <Text style={s.username} numberOfLines={1}>{isBrandProfile ? username : `@${username}`}</Text>
        </View>
        {bio ? <Text style={s.bio}>{bio}</Text> : null}
        {locationCity ? (
          <View style={s.locationRow} testID="creator-profile-location">
            <MapPin size={13} color="#6B5E58" />
            <Text style={s.locationText}>{locationCity}</Text>
          </View>
        ) : null}

        {/* Stats row */}
        <View style={s.statsRow}>
          <View style={s.stat}>
            <Text style={s.statNumber}>{creatorLooks.length}</Text>
            <Text style={s.statLabel}>Looks</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statNumber}>{followerCount}</Text>
            <Text style={s.statLabel}>Followers</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statNumber}>{totalLikes}</Text>
            <Text style={s.statLabel}>Likes</Text>
          </View>
        </View>

        {/* Follow button */}
        <Pressable
          onPress={handleFollow}
          style={[s.followBtn, isFollowing && s.followingBtn]}
          testID="creator-profile-follow-button"
        >
          {isFollowing ? (
            <UserCheck size={16} color="#1A1210" />
          ) : (
            <UserPlus size={16} color="#FFFFFF" />
          )}
          <Text style={[s.followBtnText, isFollowing && s.followingBtnText]}>
            {isFollowing ? 'Following' : 'Follow'}
          </Text>
        </Pressable>

        {/* Socials */}
        {socials.length > 0 ? (
          <View style={s.socialsRow}>
            {socials.map((social: SocialHandle) => (
              <Pressable
                key={social.platform}
                onPress={() => Linking.openURL(`${social.urlPrefix}${social.handle}`)}
                style={s.socialChip}
                testID={`social-${social.platform.toLowerCase()}`}
              >
                <Ionicons name={social.icon as any} size={16} color="#6B5E58" />
                <Text style={s.socialText}>@{social.handle}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {/* Tab bar */}
      <View style={s.tabBar} testID="creator-profile-tab-bar">
        <Pressable
          onPress={() => setTab('all')}
          style={[s.tabPill, tab === 'all' && s.tabPillActive]}
          testID="creator-profile-tab-all"
        >
          <Grid3X3 size={14} color={tab === 'all' ? '#FFFFFF' : '#6B5E58'} />
          <Text style={[s.tabPillText, tab === 'all' && s.tabPillTextActive]}>
            All Looks
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab('archives')}
          style={[s.tabPill, tab === 'archives' && s.tabPillActive]}
          testID="creator-profile-tab-archives"
        >
          <Text style={[s.tabPillText, tab === 'archives' && s.tabPillTextActive]}>
            Archives
          </Text>
        </Pressable>
      </View>
    </View>
  );

  const renderLookTile = ({ item, index }: { item: Look; index: number }) => {
    const isLeftEdge = index % GRID_COLS === 0;
    return (
      <Pressable
        onPress={() => handleOpenSheet(item)}
        testID={`creator-look-${item.id}`}
        style={{
          width: TILE_SIZE,
          height: TILE_SIZE,
          marginLeft: isLeftEdge ? 0 : GRID_GAP,
          marginBottom: GRID_GAP,
        }}
      >
        <Image source={{ uri: item.photoUri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            toggleLike(item.id);
          }}
          hitSlop={6}
          style={({ pressed }) => [s.tileMeta, pressed && { opacity: 0.7 }]}
          testID={`creator-look-like-${item.id}`}
        >
          <Heart
            size={10}
            color="#FFFFFF"
            fill={likedLookIds.includes(item.id) ? '#B87063' : '#FFFFFF'}
          />
          <Text style={s.tileMetaText}>{getLikeCount(item.id)}</Text>
          {item.clicks > 0 ? (
            <Text style={s.tileMetaText}>{' · '}{item.clicks}</Text>
          ) : null}
        </Pressable>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} testID="creator-profile-screen">
      {/* Header bar */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#F7F4F0' }}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="creator-profile-back">
            <ArrowLeft size={24} color="#1A1210" />
          </Pressable>
          <Text style={s.headerTitle} numberOfLines={1}>@{username}</Text>
          <View style={{ width: 24 }} />
        </View>
      </SafeAreaView>

      <FlatList
        data={displayLooks}
        keyExtractor={(item) => item.id}
        renderItem={renderLookTile}
        numColumns={GRID_COLS}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyText}>
              {tab === 'archives'
                ? 'No archived looks.'
                : creatorLooksQuery.isLoading
                  ? 'Loading…'
                  : 'No looks yet'}
            </Text>
          </View>
        }
        testID={tab === 'archives' ? 'creator-profile-archives-grid' : 'creator-profile-looks-grid'}
      />

      {itemSheetVisible ? (
        <ItemListSheet look={selectedLook} onClose={handleCloseSheet} testIDPrefix="creator-profile-item-sheet" />
      ) : null}

      <FollowPromptSheet
        visible={followPromptCreatorId !== null}
        creatorId={followPromptCreatorId ?? ''}
        onDismiss={() => setFollowPromptCreatorId(null)}
      />
      <SignUpNudgeSheet
        visible={showSignUpNudge}
        onDismiss={() => setShowSignUpNudge(false)}
        context={profile?.username ? `to follow @${profile.username}` : 'to follow creators'}
      />
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
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  profileSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 20,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    maxWidth: '100%',
  },
  avatarWrap: {
    position: 'relative',
  },
  avatarBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
  },
  avatarFallback: {
    backgroundColor: '#E8E0D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 36,
    color: '#6B5E58',
  },
  username: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 18,
    color: '#1A1210',
    flexShrink: 1,
  },
  bio: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 4,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 4,
  },
  locationText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 16,
  },
  stat: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  statNumber: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 17,
    color: '#1A1210',
  },
  statLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#8A7F78',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E8E0D8',
  },
  followBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1A1210',
    borderRadius: 24,
    paddingHorizontal: 32,
    paddingVertical: 10,
    marginBottom: 16,
  },
  followingBtn: {
    backgroundColor: '#F0EBE5',
    borderWidth: 1,
    borderColor: '#D4C8C2',
  },
  followBtnText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#FFFFFF',
  },
  followingBtnText: {
    color: '#1A1210',
  },
  socialsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  socialChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0EBE5',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  socialText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
  },
  gridHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E8E0D8',
  },
  gridHeaderText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#6B5E58',
  },
  tabBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#E8E0D8',
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D4C8C2',
    minHeight: 34,
  },
  tabPillActive: {
    backgroundColor: '#1A1210',
    borderColor: '#1A1210',
  },
  tabPillText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#3D3330',
  },
  tabPillTextActive: {
    color: '#FFFFFF',
  },
  tileMeta: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tileMetaText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    color: '#FFFFFF',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#8A7F78',
  },
});
