// "Creators to follow" — horizontal discovery rail on the Feed (For You mode)
// + reused in the Following-empty state. Each card shows a creator avatar,
// @username, follower count, and a Follow toggle. Encourages following, which
// drives the Following feed.
//
// Data: get_suggested_creators RPC (excludes self, brands, and already-
// followed). Hidden entirely when there are no suggestions (e.g. the viewer
// already follows everyone, or there are no other creators yet).

import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, UserCheck } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import useFollowStore from '@/lib/state/followStore';
import useAuthStore from '@/lib/state/authStore';
import SignUpNudgeSheet from '@/components/SignUpNudgeSheet';
import { COLORS, FONTS } from '@/constants/theme';

interface SuggestedCreator {
  creatorId: string;
  username: string | null;
  photoUrl: string | null;
  appFollowerCount: number;
  publishedLookCount: number;
}

async function fetchSuggestedCreators(): Promise<SuggestedCreator[]> {
  const { data, error } = await supabase.rpc('get_suggested_creators', { p_limit: 12 });
  if (error) {
    console.warn('[CreatorsToFollowRail] error:', error.message);
    return [];
  }
  return ((data ?? []) as Array<{
    creator_id: string;
    username: string | null;
    photo_url: string | null;
    app_follower_count: number;
    published_look_count: number;
  }>).map((r) => ({
    creatorId: r.creator_id,
    username: r.username,
    photoUrl: r.photo_url,
    appFollowerCount: r.app_follower_count ?? 0,
    publishedLookCount: r.published_look_count ?? 0,
  }));
}

export default function CreatorsToFollowRail({
  title = 'Creators to follow',
}: {
  title?: string;
}) {
  const { data: creators } = useQuery({
    queryKey: ['suggested-creators'],
    queryFn: fetchSuggestedCreators,
    staleTime: 5 * 60 * 1000,
  });
  const followedIds = useFollowStore((s) => s.followedIds);
  const toggleFollow = useFollowStore((s) => s.toggleFollow);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const [showSignUpNudge, setShowSignUpNudge] = useState(false);

  const openProfile = useCallback((creatorId: string) => {
    Haptics.selectionAsync().catch(() => {});
    router.push({ pathname: '/creator-profile' as never, params: { creatorId } } as never);
  }, []);

  if (!creators || creators.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>{title}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroller}
      >
        {creators.map((c) => {
          const isFollowing = followedIds.includes(c.creatorId);
          const initial = (c.username ?? 'C').slice(0, 1).toUpperCase();
          return (
            <View key={c.creatorId} style={styles.card} testID={`suggested-creator-${c.creatorId}`}>
              <Pressable onPress={() => openProfile(c.creatorId)} style={styles.cardTop}>
                {c.photoUrl ? (
                  <Image source={{ uri: c.photoUrl }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarInitial}>{initial}</Text>
                  </View>
                )}
                <Text style={styles.username} numberOfLines={1}>
                  @{c.username ?? 'creator'}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {c.appFollowerCount} {c.appFollowerCount === 1 ? 'follower' : 'followers'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!isLoggedIn) {
                    setShowSignUpNudge(true);
                    return;
                  }
                  Haptics.selectionAsync().catch(() => {});
                  toggleFollow(c.creatorId);
                }}
                style={[styles.followBtn, isFollowing && styles.followBtnActive]}
                testID={`suggested-follow-${c.creatorId}`}
              >
                {isFollowing ? (
                  <UserCheck size={13} color={COLORS.ink} strokeWidth={2} />
                ) : (
                  <UserPlus size={13} color="#FFFFFF" strokeWidth={2} />
                )}
                <Text style={[styles.followText, isFollowing && styles.followTextActive]}>
                  {isFollowing ? 'Following' : 'Follow'}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
      <SignUpNudgeSheet
        visible={showSignUpNudge}
        onDismiss={() => setShowSignUpNudge(false)}
        context="to follow creators"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  heading: {
    fontFamily: FONTS.serif,
    fontSize: 20,
    color: COLORS.ink,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  scroller: { paddingHorizontal: 12, gap: 10 },
  card: {
    width: 140,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    alignItems: 'center',
  },
  cardTop: { alignItems: 'center', width: '100%' },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.bgAlt },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: FONTS.serif, fontSize: 22, color: COLORS.inkMid },
  username: {
    marginTop: 8,
    fontFamily: FONTS.bodySemiBold,
    fontSize: 13,
    color: COLORS.ink,
    maxWidth: '100%',
  },
  meta: { marginTop: 2, fontFamily: FONTS.body, fontSize: 11, color: COLORS.inkMuted },
  followBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    alignSelf: 'stretch',
    backgroundColor: COLORS.ink,
    borderRadius: 999,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: COLORS.ink,
  },
  followBtnActive: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
  },
  followText: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 12,
    color: '#FFFFFF',
  },
  followTextActive: { color: COLORS.ink },
});
