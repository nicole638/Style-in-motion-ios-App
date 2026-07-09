import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import useAuthStore from '@/lib/state/authStore';
import useLookStore, { Look } from '@/lib/state/lookStore';
import useDraftLookStore from '@/lib/state/draftLookStore';

const EMPTY_DRAFTS: Look[] = [];

function relativeTime(iso: string | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return 'just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

export default function DraftsScreen() {
  const creatorId = useAuthStore((s) => s.creatorId);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const userType = useAuthStore((s) => s.userType);
  const accountType = useAuthStore((s) => s.accountType);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);

  const drafts = useLookStore((s) =>
    creatorId ? s.draftLooksByCreator[creatorId] ?? EMPTY_DRAFTS : EMPTY_DRAFTS
  );
  const fetchDraftLooksByCreator = useLookStore((s) => s.fetchDraftLooksByCreator);
  const deleteLook = useLookStore((s) => s.deleteLook);

  const [loading, setLoading] = useState<boolean>(true);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  // Auth gate — creators have drafts, and shoppers reuse this list to reopen
  // their private collage drafts (creatorId is set for shoppers too).
  useEffect(() => {
    if (!hasHydrated) return;
    if (!isLoggedIn || (userType !== 'creator' && accountType !== 'shopper')) {
      router.replace('/welcome' as any);
    }
  }, [hasHydrated, isLoggedIn, userType, accountType]);

  useEffect(() => {
    let cancelled = false;
    if (!creatorId) return;
    setLoading(true);
    fetchDraftLooksByCreator(creatorId).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [creatorId, fetchDraftLooksByCreator]);

  const sorted = useMemo(() => {
    return [...drafts].sort((a, b) => {
      const ta = new Date(a.updatedAt ?? a.createdAt).getTime();
      const tb = new Date(b.updatedAt ?? b.createdAt).getTime();
      return tb - ta;
    });
  }, [drafts]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else if (accountType === 'shopper' && userType !== 'creator') {
      // Shoppers live in the (public-tabs) closet — /creator-account and the
      // creator (tabs) group are surfaces they should never land on.
      router.replace('/(public-tabs)/closet' as any);
    } else {
      router.replace('/creator-account' as any);
    }
  };

  const handleEditDraft = (look: Look) => {
    // Phase 2 collage edit — looks tagged 'collage' with a saved layout open in
    // the collage builder. Mirrors the routing in (tabs)/index.tsx, shop.tsx,
    // and ItemDetailSheet.tsx so the Drafts list honors the same discriminator.
    if (look.tags?.includes('collage') && look.collageLayout) {
      router.push({
        pathname: '/collage-builder',
        params: { lookId: look.id },
      });
      return;
    }
    useDraftLookStore.getState().setEditingLookId(look.id);
    router.push({
      pathname: '/(tabs)/create',
      params: { editLookId: look.id },
    });
  };

  const handleLongPressDraft = (look: Look) => {
    Alert.alert(
      'Delete draft?',
      'This will permanently remove the draft.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete draft',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteLook(look.id);
            } catch (e) {
              console.warn('drafts: delete failed', e);
            }
          },
        },
      ],
    );
  };

  if (!fontsLoaded || !hasHydrated || !isLoggedIn) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top', 'bottom']}
      testID="drafts-screen"
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
          testID="drafts-back-button"
        >
          <ChevronLeft size={24} color="#1A1210" strokeWidth={1.8} />
        </Pressable>
        <Text style={styles.title}>Drafts</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.centered} testID="drafts-loading">
          <ActivityIndicator size="large" color="#1A1210" />
        </View>
      ) : sorted.length === 0 ? (
        <View style={styles.centered}>
          <View style={styles.emptyCard} testID="drafts-empty">
            <Text style={styles.emptyTitle}>No drafts yet</Text>
            <Text style={styles.emptyBody}>
              Tap &quot;Save Draft&quot; on any look to keep it here.
            </Text>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} testID="drafts-list">
          {sorted.map((draft) => (
            <Pressable
              key={draft.id}
              onPress={() => handleEditDraft(draft)}
              onLongPress={() => handleLongPressDraft(draft)}
              style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}
              testID={`draft-tile-${draft.id}`}
            >
              <View style={styles.thumbWrap}>
                {draft.photoUri ? (
                  <Image
                    source={{ uri: draft.photoUri }}
                    style={styles.thumb}
                    contentFit="cover"
                    testID={`draft-thumb-${draft.id}`}
                  />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder]}>
                    <Text style={{ fontSize: 28 }}>👗</Text>
                  </View>
                )}
              </View>
              <View style={styles.tileBody}>
                <Text style={styles.tileTitle} numberOfLines={1}>
                  {draft.title?.trim() || 'Untitled draft'}
                </Text>
                <Text style={styles.tileMeta}>
                  Edited {relativeTime(draft.updatedAt ?? draft.createdAt)}
                </Text>
                <Text style={styles.tileItems} numberOfLines={1}>
                  {draft.items.length} item{draft.items.length === 1 ? '' : 's'}
                </Text>
              </View>
              <ChevronRight size={20} color="#A0938D" strokeWidth={1.8} />
            </Pressable>
          ))}
          <Text style={styles.hint}>Long-press a draft to delete it.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F4F0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE6DF',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  headerSpacer: {
    width: 40,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
    textAlign: 'center',
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyCard: {
    backgroundColor: '#FFFDF8',
    borderRadius: 18,
    paddingVertical: 28,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EDE6DF',
  },
  emptyTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    textAlign: 'center',
    lineHeight: 20,
  },
  list: {
    padding: 16,
    paddingBottom: 48,
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFDF8',
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EDE6DF',
  },
  thumbWrap: {
    width: 64,
    height: 80,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#EDE6DF',
    marginRight: 12,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBody: {
    flex: 1,
  },
  tileTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#1A1210',
    marginBottom: 2,
  },
  tileMeta: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginBottom: 2,
  },
  tileItems: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#A0938D',
  },
  hint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#A0938D',
    textAlign: 'center',
    marginTop: 12,
  },
});
