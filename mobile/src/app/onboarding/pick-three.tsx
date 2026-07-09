import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Dimensions, Alert } from 'react-native';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react-native';
import useAuthStore from '@/lib/state/authStore';
import useFirstLookStore from '@/lib/state/firstLookStore';
import { supabase } from '@/lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_GAP = 12;
const GRID_PAD = 24;
const TILE_SIZE = (SCREEN_WIDTH - GRID_PAD * 2 - GRID_GAP) / 2;
const MIN_PICK = 3;
const MAX_PICK = 5;

interface PickerItem {
  source: string;
  ref_id: string;
  name: string;
  brand: string | null;
  category: string | null;
  price: string | null;
  photo_url: string | null;
  cutout_url: string | null;
  product_url: string | null;
  affiliate_url: string | null;
  affiliate_provider: string | null;
}

/**
 * Loads the rotating "picker pool" via get_picker_items: aesthetic-matched
 * curated pieces first, then a mix of curated + affiliate, already-cut-out
 * items pulled from creators' closets. The RPC rotates the set every ~4 days
 * (server-side) so creators don't keep collaging the same things.
 */
async function fetchPickerItems(aesthetics: string[], creatorId: string | null): Promise<PickerItem[]> {
  const { data, error } = await supabase.rpc('get_picker_items', {
    p_aesthetics: aesthetics.length > 0 ? aesthetics : null,
    p_creator_id: creatorId,
    p_limit: 50,
  });
  if (error) {
    console.warn('[pick-three] get_picker_items failed:', error.message);
    return [];
  }
  return (data ?? []) as PickerItem[];
}

export default function OnboardingPickThreeScreen() {
  const creatorId = useAuthStore((s) => s.creatorId);
  const aestheticTags = useFirstLookStore((s) => s.aestheticTags);
  const setPickedItemIds = useFirstLookStore((s) => s.setPickedItemIds);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [adding, setAdding] = useState<boolean>(false);

  const [fontsLoaded] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_700Bold });

  const { data, isLoading } = useQuery({
    queryKey: ['pickerItems', creatorId, aestheticTags],
    queryFn: () => fetchPickerItems(aestheticTags, creatorId),
    enabled: !!creatorId,
    staleTime: 1000 * 60 * 5,
  });

  const items: PickerItem[] = useMemo(() => data ?? [], [data]);
  const byId = useMemo(() => {
    const m = new Map<string, PickerItem>();
    for (const it of items) m.set(it.ref_id, it);
    return m;
  }, [items]);

  const toggleItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        Haptics.selectionAsync().catch(() => {});
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= MAX_PICK) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        return prev;
      }
      Haptics.selectionAsync().catch(() => {});
      return [...prev, id];
    });
  }, []);

  const canContinue = selectedIds.length >= MIN_PICK;

  const handleContinue = useCallback(async () => {
    if (!canContinue || adding || !creatorId) return;
    setAdding(true);
    try {
      const picks = selectedIds
        .map((id) => byId.get(id))
        .filter((it): it is PickerItem => !!it);

      const norm = (u: string | null | undefined) => (u ?? '').trim().toLowerCase();

      const toPayload = (it: PickerItem) => ({
        creator_id: creatorId,
        name: it.name,
        brand: it.brand,
        category: it.category || 'Other',
        price: it.price || '',
        url: it.product_url,
        // Leave affiliate fields NULL on copy so /api/shop re-stamps the link
        // with THIS creator's affiliate tag at click time (snapshot re-stamp).
        affiliate_url: null,
        affiliate_provider: null,
        affiliate_wrapped_at: null,
        photo_url: it.photo_url,
        original_photo_url: it.photo_url,
        cutout_photo_url: it.cutout_url, // reuse the existing cut-out — collage-ready
        from_starter_pack: true,
        archived: false,
        fetch_status: 'complete',
        alternates: [],
      });

      // 1. Look up first. Re-adding an item the creator already owns (matched by
      //    url) must reuse its id, not re-POST — the closet has a partial unique
      //    index uq_creator_items_creator_normurl on (creator_id, lower(trim(url)))
      //    so a duplicate insert 409s. This makes back/retry idempotent.
      const selectedUrls = picks
        .map((p) => p.product_url)
        .filter((u): u is string => !!(u && u.trim()));
      const existingByUrl = new Map<string, string>();
      if (selectedUrls.length > 0) {
        const { data: existing } = await supabase
          .from('creator_items')
          .select('id, url')
          .eq('creator_id', creatorId)
          .in('url', selectedUrls);
        for (const row of (existing ?? []) as { id: string; url: string | null }[]) {
          const k = norm(row.url);
          if (k && !existingByUrl.has(k)) existingByUrl.set(k, String(row.id));
        }
      }

      // 2. Resolve every selected piece to an id: reuse existing, else insert,
      //    else (on a raced 409) re-query and reuse. A 409 means the row already
      //    exists — that's success, not a failure. One item never blocks another.
      const resolveOne = async (p: PickerItem): Promise<string | null> => {
        const k = norm(p.product_url);
        if (k && existingByUrl.has(k)) return existingByUrl.get(k) ?? null;
        const { data: ins, error } = await supabase
          .from('creator_items')
          .insert(toPayload(p))
          .select('id')
          .single();
        if (!error && ins?.id) return String(ins.id);
        if (k && (error as { code?: string } | null)?.code === '23505') {
          const { data: rows } = await supabase
            .from('creator_items')
            .select('id')
            .eq('creator_id', creatorId)
            .ilike('url', p.product_url as string)
            .limit(1);
          const id = (rows as { id: string }[] | null)?.[0]?.id;
          if (id) return String(id);
        }
        console.warn('[pick-three] could not resolve item:', error?.message);
        return null;
      };

      const resolved = await Promise.all(picks.map(resolveOne));
      const resolvedIds = resolved.filter((id): id is string => !!id);

      // 3. Gate on having an id for every selected piece (pre-existing OR new) —
      //    not on fresh inserts. Only a genuine resolve failure blocks here.
      if (resolvedIds.length < picks.length) {
        console.warn('[pick-three] add-to-closet incomplete:', resolvedIds.length, '/', picks.length);
        Alert.alert('That didn’t save', 'Please try again in a moment.');
        return;
      }

      setPickedItemIds(resolvedIds);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      router.push({
        pathname: '/collage-builder',
        params: { firstLook: 'true', itemIds: resolvedIds.join(',') },
      } as any);
    } catch (e: any) {
      console.warn('[pick-three] handleContinue threw:', e?.message ?? e);
      Alert.alert('That didn’t save', 'Please try again in a moment.');
    } finally {
      setAdding(false);
    }
  }, [canContinue, adding, creatorId, selectedIds, byId, setPickedItemIds]);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  return (
    <SafeAreaView className="flex-1 bg-[#F7F4F0]" edges={['top', 'bottom']} testID="onboarding-pick-three-screen">
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: GRID_PAD, paddingTop: 24, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => router.back()}
          className="w-10 h-10 rounded-full bg-white items-center justify-center mb-5 active:opacity-80"
          style={{ shadowColor: '#1A1210', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}
          hitSlop={8}
          testID="onboarding-pick-three-back"
        >
          <ArrowLeft size={20} color="#1A1210" />
        </Pressable>
        <Text className="text-[28px] text-[#1A1210]" style={{ fontFamily: 'DMSans_700Bold', lineHeight: 34 }} testID="onboarding-pick-three-title">
          Pick 3–5 to style
        </Text>
        <Text className="text-[15px] text-[#6B5E58] mt-2" style={{ fontFamily: 'DMSans_400Regular', lineHeight: 21 }}>
          Tap the pieces you love — we refresh these every few days.
        </Text>

        {isLoading ? (
          <View className="items-center justify-center py-20" testID="pick-three-loading">
            <ActivityIndicator color="#B87063" />
          </View>
        ) : null}

        {!isLoading && items.length > 0 ? (
          <View className="flex-row flex-wrap mt-6" style={{ gap: GRID_GAP }}>
            {items.map((item) => {
              const isSelected = selectedIds.includes(item.ref_id);
              const img = item.cutout_url || item.photo_url || null;
              return (
                <Pressable
                  key={item.ref_id}
                  onPress={() => toggleItem(item.ref_id)}
                  className="bg-white rounded-2xl active:opacity-90"
                  style={{ width: TILE_SIZE, borderWidth: isSelected ? 2 : 1, borderColor: isSelected ? '#B87063' : '#E8E0D8', overflow: 'hidden' }}
                  testID={`pick-three-tile-${item.ref_id}`}
                >
                  <View style={{ width: '100%', height: TILE_SIZE, backgroundColor: '#FBF6EF' }}>
                    {img ? (
                      <Image source={{ uri: img }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={200} />
                    ) : null}
                    {isSelected ? (
                      <View style={{ position: 'absolute', top: 8, right: 8 }}>
                        <CheckCircle2 size={24} color="#B87063" fill="#FFFFFF" strokeWidth={2.25} />
                      </View>
                    ) : null}
                  </View>
                  <View className="px-2.5 py-2">
                    <Text numberOfLines={1} className="text-[13px] text-[#1A1210]" style={{ fontFamily: 'DMSans_500Medium' }}>
                      {item.name}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {!isLoading && items.length === 0 ? (
          <View className="mt-10 items-center" testID="pick-three-empty">
            <Text className="text-[15px] text-[#6B5E58] text-center" style={{ fontFamily: 'DMSans_400Regular', lineHeight: 22 }}>
              Couldn&apos;t load pieces right now. You can add your own from a brand.
            </Text>
            <Pressable
              onPress={() => router.push('/(tabs)/brands' as any)}
              className="bg-[#B87063] rounded-full mt-6 px-6 items-center justify-center"
              style={{ height: 50 }}
              testID="pick-three-browse-brands"
            >
              <Text className="text-white text-[15px]" style={{ fontFamily: 'DMSans_500Medium' }}>Browse brands</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <View className="px-6 pb-4">
        <Pressable
          onPress={handleContinue}
          disabled={!canContinue || adding}
          className={
            canContinue && !adding
              ? 'bg-[#B87063] rounded-full flex-row items-center justify-center active:opacity-85'
              : 'bg-[#D5CDC7] rounded-full flex-row items-center justify-center'
          }
          style={{ height: 52 }}
          testID="pick-three-continue"
        >
          {adding ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Text className={canContinue ? 'text-white text-[15px]' : 'text-[#6B5E58] text-[15px]'} style={{ fontFamily: 'DMSans_500Medium' }}>
                {canContinue ? `Style ${selectedIds.length} piece${selectedIds.length > 1 ? 's' : ''}` : `Pick ${Math.max(0, MIN_PICK - selectedIds.length)} more`}
              </Text>
              {canContinue ? <ArrowRight size={18} color="#FFFFFF" style={{ marginLeft: 6 }} /> : null}
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
