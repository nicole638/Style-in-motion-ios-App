import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Stack, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useMutation } from '@tanstack/react-query';
import { X, Camera, ImagePlus, Trash2 } from 'lucide-react-native';
import useAuthStore from '@/lib/state/authStore';
import useLookStore, { ClothingItem, ItemCategory } from '@/lib/state/lookStore';
import { persistPickedPhoto } from '@/lib/utils/persistPickedPhoto';
import CategoryChips from '@/components/CategoryChips';
import { CATEGORIES } from '@/lib/constants/categories';

// Beta guardrail: shopper closets are capped at 25 items client-side.
const MAX_CLOSET_ITEMS = 25;
// Batch cap: at most 4 flat-lay photos per add.
const MAX_BATCH = 4;

interface PhotoDraft {
  uri: string;
  name: string;
  category: ItemCategory | null;
}

export default function AddClosetPhotosScreen() {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetHeight = (windowHeight - insets.top) * 0.95;

  const creatorId = useAuthStore((s) => s.creatorId);
  const accountType = useAuthStore((s) => s.accountType);
  const closetItems = useLookStore((s) => s.closetItems);

  // Account-type-aware "back to closet" target: shoppers live in the audience
  // (public-tabs) shell and must never land in the creator (tabs) group;
  // creators return to their Studio → Closet view.
  const closetTarget = React.useMemo(
    () =>
      accountType === 'shopper'
        ? ('/(public-tabs)/closet' as const)
        : ('/(tabs)/shop?view=closet' as const),
    [accountType],
  );

  // Ensure the closet slice is hydrated so the cap is enforced against a real
  // count (the realtime channel in shop.tsx may not have run yet on this route).
  useEffect(() => {
    if (creatorId && closetItems.length === 0) {
      useLookStore.getState().loadClosetItems(creatorId).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorId]);

  // Guard: no creator context → bounce back.
  useEffect(() => {
    if (!creatorId) router.back();
  }, [creatorId]);

  const currentCount = closetItems.length;
  const isFull = currentCount >= MAX_CLOSET_ITEMS;
  const remaining = Math.max(0, MAX_CLOSET_ITEMS - currentCount);
  // How many more photos this batch may accept.
  const batchLimit = Math.min(MAX_BATCH, remaining);

  const [drafts, setDrafts] = useState<PhotoDraft[]>([]);

  // Quick-capture running count: how many pieces have been auto-saved in this
  // quick-capture run (each shot → one item, then the camera re-arms). Distinct
  // from `drafts` (the review-then-save picker/one-shot flow).
  const [quickCaptured, setQuickCaptured] = useState<number>(0);
  const [quickCapturing, setQuickCapturing] = useState<boolean>(false);

  const canAddMore = drafts.length < batchLimit && !isFull;

  const appendUris = useCallback((uris: string[]) => {
    setDrafts((prev) => {
      const room = Math.max(0, batchLimit - prev.length);
      const toAdd = uris.slice(0, room).map((uri) => ({ uri, name: '', category: null as ItemCategory | null }));
      return [...prev, ...toAdd];
    });
  }, [batchLimit]);

  const handleShoot = useCallback(async () => {
    if (!canAddMore) return;
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (!result.canceled && result.assets[0]) {
      const stable = await persistPickedPhoto(result.assets[0].uri);
      appendUris([stable]);
    }
  }, [canAddMore, appendUris]);

  const handlePickLibrary = useCallback(async () => {
    if (!canAddMore) return;
    const room = Math.max(1, batchLimit - drafts.length);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: true,
      selectionLimit: Math.min(MAX_BATCH, room),
    });
    if (!result.canceled && result.assets.length > 0) {
      const stable = await Promise.all(result.assets.map((a) => persistPickedPhoto(a.uri)));
      appendUris(stable);
    }
  }, [canAddMore, appendUris, batchLimit, drafts.length]);

  const updateDraft = useCallback((idx: number, patch: Partial<PhotoDraft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }, []);

  const removeDraft = useCallback((idx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // Persist one draft as a standalone closet item. Returns the new item id, or
  // null if the upload/insert failed. Never throws — callers rely on this so
  // one bad item can't sink the rest of a batch. Each successful call fires
  // cutout-item-photo automatically inside addStandaloneClosetItem (url stays
  // NULL — no scrape; the cutout is the single-subject flat-lay cutout).
  const persistDraft = useCallback(
    async (d: PhotoDraft, seed: number): Promise<string | null> => {
      if (!creatorId) return null;
      const add = useLookStore.getState().addStandaloneClosetItem;
      const category: ItemCategory = d.category ?? 'Other';
      const item: ClothingItem = {
        id: String(Date.now()) + seed,
        name: (d.name.trim() || (d.category ?? '')).trim(),
        brand: null,
        price: '',
        link: '',
        category,
        emoji: CATEGORIES.find((c) => c.value === category)?.emoji ?? '🛍️',
        photoUri: d.uri,
        fetchStatus: 'complete',
        fetchError: null,
        alternates: [],
      };
      try {
        return await add(creatorId, item);
      } catch (e) {
        console.warn('[add-closet-photos] persistDraft failed:', e);
        return null;
      }
    },
    [creatorId],
  );

  // Partial-success banner text ("Added 3 of 4 — one didn't upload, try again").
  const [partialMessage, setPartialMessage] = useState<string | null>(null);

  // Quick-capture: photograph pieces one-at-a-time, auto-saving each shot and
  // re-arming the camera, with a running count — no review step. One piece per
  // shot (the cutout EF is single-subject; we do NOT auto-split multi-garment
  // shots). Respects the 25-item cap and the ≤4-per-batch limit. On the last
  // saved piece (or on cancel) we land back on the closet grid.
  const handleQuickCapture = useCallback(async () => {
    if (!creatorId || isFull || quickCapturing) return;
    setPartialMessage(null);
    setQuickCapturing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    let saved = 0;
    let failed = 0;
    try {
      // Re-read the cap fresh so an already-partly-full closet still stops at 25.
      const startCount = useLookStore.getState().closetItems.length;
      const roomForCap = Math.max(0, MAX_CLOSET_ITEMS - startCount);
      const runLimit = Math.min(MAX_BATCH, roomForCap);
      for (let i = 0; i < runLimit; i++) {
        const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
        if (result.canceled || !result.assets[0]) break; // user done snapping
        const stable = await persistPickedPhoto(result.assets[0].uri);
        const id = await persistDraft({ uri: stable, name: '', category: null }, i);
        if (id) {
          saved += 1;
          setQuickCaptured((c) => c + 1);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        } else {
          failed += 1;
        }
      }
    } catch (e) {
      console.warn('[add-closet-photos] quick-capture failed:', e);
    } finally {
      setQuickCapturing(false);
    }
    if (saved > 0 && failed === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace(closetTarget as any);
    } else if (saved > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setPartialMessage(
        `Added ${saved} — ${failed === 1 ? "one didn't" : `${failed} didn't`} upload. Your saved pieces are in the closet.`,
      );
    } else if (failed > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setPartialMessage("Couldn't save that piece — check your connection and try again.");
    }
    // saved===0 && failed===0 → user cancelled the very first shot; do nothing.
  }, [creatorId, isFull, quickCapturing, persistDraft, closetTarget]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!creatorId) throw new Error('No creator context.');
      // Resilient batch: persist every draft independently and tally results so
      // a single failed upload/insert can't collapse the batch to 1 or throw
      // the whole thing away. Ordering is preserved via the sequential loop.
      let ok = 0;
      const total = drafts.length;
      for (let i = 0; i < drafts.length; i++) {
        const id = await persistDraft(drafts[i], i);
        if (id) ok += 1;
      }
      return { ok, total };
    },
    onSuccess: ({ ok, total }) => {
      if (ok === total) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        router.replace(closetTarget as any);
        return;
      }
      // Partial success: keep the user on the sheet with the failed drafts still
      // present (nothing is cleared), surface how many landed, and let them
      // retry the stragglers rather than silently losing the batch.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      if (ok === 0) {
        setPartialMessage("Nothing uploaded — check your connection and try again.");
      } else {
        const missed = total - ok;
        setPartialMessage(
          `Added ${ok} of ${total} — ${missed === 1 ? "one didn't" : `${missed} didn't`} upload, try again.`,
        );
      }
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setPartialMessage('Something went wrong. Please try again.');
    },
  });

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
          presentation: 'formSheet',
          sheetAllowedDetents: [0.95],
          sheetGrabberVisible: true,
        }}
      />
      <SafeAreaView style={[styles.container, { height: sheetHeight }]} edges={['bottom']} testID="add-closet-photos-screen">
        <View style={styles.header}>
          <Text style={styles.title}>Add from your closet</Text>
          <Pressable onPress={() => router.back()} hitSlop={8} testID="add-closet-photos-close">
            <X size={22} color="#3D3330" />
          </Pressable>
        </View>

        {isFull ? (
          <View style={styles.fullWrap} testID="add-closet-photos-full">
            <Text style={styles.fullTitle}>Your closet's full for beta</Text>
            <Text style={styles.fullBody}>
              You've hit the {MAX_CLOSET_ITEMS}-item limit for now. Remove a piece to make
              room, or check back as we open things up.
            </Text>
            <Pressable
              className="bg-white rounded-full py-3.5 px-6 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
              style={{ marginTop: 20 }}
              onPress={() => router.back()}
              testID="add-closet-photos-full-back"
            >
              <Text className="text-[#1A1210] text-[15px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
                Back to closet
              </Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            <Text style={styles.helper} testID="add-closet-photos-helper">
              Lay it on the bed, don't fuss
            </Text>
            <Text style={styles.subHelper}>
              Add up to {batchLimit} {batchLimit === 1 ? 'photo' : 'photos'} — we'll cut each one out for you.
            </Text>

            {/* Quick-capture: snap piece after piece, auto-saved as you go. */}
            <View style={styles.quickCard} testID="add-closet-photos-quick-card">
              <Text style={styles.quickCopy} testID="add-closet-photos-quick-copy">
                One piece per shot — lay it flat-ish, we'll do the rest.
              </Text>
              {quickCaptured > 0 ? (
                <Text style={styles.quickCount} testID="add-closet-photos-quick-count">
                  {quickCaptured} of {batchLimit} added — keep snapping
                </Text>
              ) : null}
              <Pressable
                className="bg-[#B87063] rounded-full py-3 px-4 flex-row items-center justify-center active:opacity-85"
                style={{ marginTop: 12, opacity: !canAddMore || quickCapturing ? 0.5 : 1 }}
                onPress={handleQuickCapture}
                disabled={!canAddMore || quickCapturing}
                testID="add-closet-photos-quick-capture"
              >
                {quickCapturing ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Camera size={18} color="#FFFFFF" />
                    <Text className="ml-2 text-white text-[14px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
                      Quick capture
                    </Text>
                  </>
                )}
              </Pressable>
            </View>

            {partialMessage ? (
              <View style={styles.partialBanner} testID="add-closet-photos-partial">
                <Text style={styles.partialText}>{partialMessage}</Text>
              </View>
            ) : null}

            <Text style={styles.orDivider}>or add one at a time</Text>

            {/* Pick buttons */}
            <View style={styles.pickRow}>
              <Pressable
                className="flex-1 bg-white rounded-full py-3 px-4 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
                style={{ opacity: canAddMore ? 1 : 0.4 }}
                onPress={handleShoot}
                disabled={!canAddMore}
                testID="add-closet-photos-camera"
              >
                <Camera size={18} color="#1A1210" />
                <Text className="ml-2 text-[#1A1210] text-[14px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
                  Take Photo
                </Text>
              </Pressable>
              <Pressable
                className="flex-1 bg-white rounded-full py-3 px-4 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
                style={{ opacity: canAddMore ? 1 : 0.4 }}
                onPress={handlePickLibrary}
                disabled={!canAddMore}
                testID="add-closet-photos-library"
              >
                <ImagePlus size={18} color="#1A1210" />
                <Text className="ml-2 text-[#1A1210] text-[14px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
                  Library
                </Text>
              </Pressable>
            </View>

            {/* Selected photo drafts */}
            {drafts.map((d, idx) => (
              <View key={`${d.uri}-${idx}`} style={styles.draftCard} testID={`add-closet-photos-draft-${idx}`}>
                <View style={styles.draftTop}>
                  <Image source={{ uri: d.uri }} style={styles.draftImage} contentFit="cover" />
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={styles.nameInput}
                      value={d.name}
                      onChangeText={(t) => updateDraft(idx, { name: t })}
                      placeholder="Black midi skirt"
                      placeholderTextColor="#B0A8A2"
                      testID={`add-closet-photos-name-${idx}`}
                    />
                    <Pressable
                      onPress={() => removeDraft(idx)}
                      className="flex-row items-center gap-1.5 py-2 active:opacity-70"
                      testID={`add-closet-photos-remove-${idx}`}
                    >
                      <Trash2 size={15} color="#B4453C" />
                      <Text className="text-[#B4453C] text-[13px] font-medium" style={{ fontFamily: 'DMSans_500Medium' }}>
                        Remove
                      </Text>
                    </Pressable>
                  </View>
                </View>
                <Text style={styles.catLabel}>Category (optional)</Text>
                <CategoryChips
                  selected={d.category}
                  onSelect={(v) => updateDraft(idx, { category: v })}
                />
              </View>
            ))}

            {drafts.length === 0 ? (
              <View style={styles.emptyHint} testID="add-closet-photos-empty">
                <Text style={styles.emptyHintText}>
                  No photos yet — tap Take Photo or Library above.
                </Text>
              </View>
            ) : null}
          </ScrollView>
        )}

        {/* Save footer */}
        {!isFull ? (
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <Pressable
              className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
              style={{ shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2, opacity: drafts.length === 0 || saveMutation.isPending ? 0.5 : 1 }}
              onPress={() => saveMutation.mutate()}
              disabled={drafts.length === 0 || saveMutation.isPending}
              testID="add-closet-photos-save"
            >
              {saveMutation.isPending ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text className="text-white text-[15px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
                  {drafts.length > 0 ? `Add ${drafts.length} to closet` : 'Add to closet'}
                </Text>
              )}
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#F7F4F0' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 26, color: '#1A1210' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 24 },
  helper: { fontFamily: 'DMSans_500Medium', fontSize: 16, color: '#1A1210', marginTop: 4 },
  subHelper: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#8C8580', marginTop: 4, marginBottom: 16 },
  quickCard: { backgroundColor: '#FBF3F0', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#F0DED8' },
  quickCopy: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#1A1210', lineHeight: 20 },
  quickCount: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#B87063', marginTop: 8 },
  partialBanner: { backgroundColor: '#FDF6E8', borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#EAD9B0' },
  partialText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#7A5A1E', lineHeight: 18 },
  orDivider: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#B0A8A2', textAlign: 'center', marginBottom: 12 },
  pickRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  draftCard: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#EDE5DE' },
  draftTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  draftImage: { width: 64, height: 84, borderRadius: 10, backgroundColor: '#F0EBE5' },
  nameInput: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: '#1A1210', borderBottomWidth: 1, borderBottomColor: '#E8E0D8', paddingVertical: 6 },
  catLabel: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#8C8580', marginTop: 12, marginBottom: 4, marginLeft: 4 },
  emptyHint: { paddingVertical: 32, alignItems: 'center' },
  emptyHintText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#B0A8A2', textAlign: 'center' },
  footer: { paddingHorizontal: 20, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EDE5DE', backgroundColor: '#F7F4F0' },
  fullWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  fullTitle: { fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 24, color: '#1A1210', marginBottom: 10, textAlign: 'center' },
  fullBody: { fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 22, color: '#6B5E58', textAlign: 'center' },
});
