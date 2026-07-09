import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { X, Star } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ClothingItem } from '@/lib/state/lookStore';

/** Photoroom Virtual Model layering preference — dress/top first so the
 *  generated model wears the correct garment as the primary apparel anchor.
 *  Items beyond #1 stack as additional_product_urls (capped at 4 total). */
const CATEGORY_PRIORITY: Record<string, number> = {
  Dress: 1,
  Top: 2,
  Outerwear: 3,
  Pants: 4,
  Shoes: 5,
  Bag: 6,
  Accessory: 7,
  Jewelry: 7,
  Other: 8,
};
function priorityOf(cat?: string | null): number {
  return CATEGORY_PRIORITY[cat ?? 'Other'] ?? 8;
}

/** Photoroom empirical cap: 1 primary + up to 3 additional_product_urls.
 *  5+ items returns HTTP 500 ("An error occurred during Virtual Model processing").
 *  EF v4 enforces this server-side too and returns truncated_additional + dropped_additional_count. */
const MAX_ITEMS = 4;

function itemUrl(it: ClothingItem | undefined | null): string | null {
  if (!it) return null;
  return it.cutout_photo_url ?? it.photoUri ?? null;
}

export const VIRTUAL_MODEL_MODELS = [
  'avery', 'sam', 'taylor', 'kendall', 'jordan', 'casey', 'maya', 'reece',
  'lena', 'julia', 'jackson', 'sophia', 'emma', 'ava', 'zoe', 'fiona',
] as const;

export const VIRTUAL_MODEL_SCENES = [
  'random', 'street', 'bedroom', 'sunset', 'studio', 'coloredstudio',
  'concretestudio', 'beach', 'tropical', 'library', 'forest',
  'businessdistrict', 'countryside', 'flowers', 'goldenlight', 'mountain',
  'pool', 'latincity', 'cafe', 'asiancity', 'nightlights', 'desert', 'factory',
] as const;

export const VIRTUAL_MODEL_POSES = [
  'random', 'standing', '34turn', 'powerstance', 'walkingforward',
  'handinpocket', 'crossedarms', 'back', 'overtheshoulder', 'seated',
  'adjustingclothing', 'playfulspin',
] as const;

type ModelPreset = typeof VIRTUAL_MODEL_MODELS[number];
type ScenePreset = typeof VIRTUAL_MODEL_SCENES[number];
type PosePreset = typeof VIRTUAL_MODEL_POSES[number];

interface QuickPreset {
  id: string;
  label: string;
  model: ModelPreset;
  scene: ScenePreset;
  pose: PosePreset;
}

const QUICK_PRESETS: QuickPreset[] = [
  { id: 'editorial-studio', label: 'Editorial Studio', model: 'taylor', scene: 'studio', pose: 'standing' },
  { id: 'street-style',     label: 'Street Style',     model: 'avery',  scene: 'street', pose: 'crossedarms' },
  { id: 'beach-vibe',       label: 'Beach Vibe',       model: 'sam',    scene: 'beach',  pose: 'walkingforward' },
  { id: 'cafe-sit',         label: 'Cafe Sit',         model: 'emma',   scene: 'cafe',   pose: 'seated' },
];

interface RecentVirtualModel {
  id: string;
  imageUrl: string;
  modelPreset: string | null;
  scenePreset: string | null;
  pose: string | null;
  aspectRatio?: number;
}

function pickRowImageUrl(row: any): string | null {
  return (
    row?.image_url ??
    row?.url ??
    row?.photo_url ??
    row?.result_url ??
    null
  );
}

interface TryOnModelSheetProps {
  visible: boolean;
  onClose: () => void;
  /** All apparel items currently on the canvas. Sheet picks a primary via
   *  category priority and lets the creator add up to 4 more. */
  items: ClothingItem[];
  creatorId: string | null;
  onGenerated: (
    url: string,
    opts: { cached: boolean; aspectRatio?: number; noBackground?: boolean },
  ) => void;
}

export function TryOnModelSheet({
  visible,
  onClose,
  items,
  creatorId,
  onGenerated,
}: TryOnModelSheetProps) {
  const [selectedModel, setSelectedModel] = useState<ModelPreset>('avery');
  /** Favorited model presets (per-creator, RLS-scoped). Local-optimistic: the
   *  Set updates instantly on tap; the DB write is fire-and-forget and reverts
   *  the Set only if it fails. Favorited models sort to the front of the picker
   *  so the creator's go-to is one tap away (no re-generation to rediscover). */
  const [favoriteModels, setFavoriteModels] = useState<Set<string>>(new Set());
  const [selectedScene, setSelectedScene] = useState<ScenePreset>('street');
  const [selectedPose, setSelectedPose] = useState<PosePreset>('standing');
  /** When ON, the model + items are rendered on a transparent background and
   *  the scene picker is hidden (there's no scene to choose). Sends
   *  no_background:true, which the EF also uses as part of its cache key so
   *  no-bg results bucket separately from scened ones. Default OFF. */
  const [noBackground, setNoBackground] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** IDs of selected items in tap order. The first one with the highest
   *  category priority is the "primary" (coral border); the rest stack as
   *  additional_product_urls in the order they were tapped. */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** Lightweight transient toast (cap-reached, truncation warning). */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, duration = 1200) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), duration);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // Reset state when sheet opens for a new session. Auto-pick the
  // highest-priority item as primary so the creator can hit Generate
  // immediately without any extra taps for the common single-item case.
  useEffect(() => {
    if (!visible) return;
    setErrorMsg(null);
    setGenerating(false);
    setToast(null);
    setNoBackground(false);
    if (items.length > 0) {
      const sorted = [...items].sort(
        (a, b) => priorityOf(a.category) - priorityOf(b.category)
      );
      // Pre-select every item on the canvas (capped at MAX_ITEMS) so a creator
      // who taps Generate immediately gets a multi-item composition. Previously
      // only the primary was auto-selected, which silently dropped bag/shoes/
      // accessories from the Photoroom call.
      const preselected = sorted
        .filter((i) => !!itemUrl(i))
        .slice(0, MAX_ITEMS)
        .map((i) => i.id);
      setSelectedIds(preselected);
    } else {
      setSelectedIds([]);
    }
  }, [visible, items]);

  // Strip order is also category-priority so the layering hint reads left→right.
  const stripItems = useMemo<ClothingItem[]>(() => {
    return [...items].sort((a, b) => priorityOf(a.category) - priorityOf(b.category));
  }, [items]);

  // Primary = highest-priority selected item (coral border).
  const primaryId = useMemo<string | null>(() => {
    if (selectedIds.length === 0) return null;
    const sorted = [...selectedIds].sort((aId, bId) => {
      const a = items.find((i) => i.id === aId);
      const b = items.find((i) => i.id === bId);
      return priorityOf(a?.category) - priorityOf(b?.category);
    });
    return sorted[0] ?? null;
  }, [selectedIds, items]);

  const primaryItem = useMemo<ClothingItem | null>(() => {
    if (!primaryId) return null;
    return items.find((i) => i.id === primaryId) ?? null;
  }, [primaryId, items]);

  const primaryUrl = itemUrl(primaryItem);

  // Other selected items, preserved in tap order — drives additional_product_urls.
  const additionalUrls = useMemo<string[]>(() => {
    const out: string[] = [];
    for (const id of selectedIds) {
      if (id === primaryId) continue;
      const i = items.find((x) => x.id === id);
      const url = itemUrl(i);
      if (url) out.push(url);
    }
    return out;
  }, [selectedIds, primaryId, items]);

  const selectedCount = selectedIds.length;
  const canGenerate = !!creatorId && !!primaryItem && !!primaryUrl && !generating;

  const toggleItem = (id: string) => {
    const target = items.find((i) => i.id === id);
    if (!target || !itemUrl(target)) return;
    const isCurrentlySelected = selectedIds.includes(id);
    // Block 4th additional (5th total) — Photoroom hard-fails past this.
    if (!isCurrentlySelected && selectedIds.length >= MAX_ITEMS) {
      showToast(`Max ${MAX_ITEMS} items per look`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        // Never let the strip end up empty — keep at least one selection.
        if (prev.length === 1) return prev;
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
    Haptics.selectionAsync().catch(() => {});
  };

  const recentQuery = useQuery({
    queryKey: ['virtualModel', 'recent', creatorId ?? ''],
    enabled: visible && !!creatorId,
    queryFn: async (): Promise<RecentVirtualModel[]> => {
      const { data, error } = await supabase
        .from('creator_virtual_models')
        .select('*')
        .eq('creator_id', creatorId)
        .order('created_at', { ascending: false })
        .limit(6);
      if (error) {
        console.warn('[TryOnModelSheet] recent fetch error:', error.message);
        return [];
      }
      return (data ?? [])
        .map((row: any): RecentVirtualModel | null => {
          const url = pickRowImageUrl(row);
          if (!url) return null;
          return {
            id: String(row.id ?? `${row.created_at ?? ''}-${url}`),
            imageUrl: url,
            modelPreset: row.model_preset ?? null,
            scenePreset: row.scene_preset ?? null,
            pose: row.pose ?? null,
            aspectRatio: typeof row.aspect_ratio === 'number' ? row.aspect_ratio : undefined,
          };
        })
        .filter((r): r is RecentVirtualModel => r !== null);
    },
    staleTime: 1000 * 30,
  });

  const recentLooks = recentQuery.data ?? [];

  // Load this creator's favorite models whenever the sheet opens. RLS scopes
  // the read to their own rows, so no creator ever sees another's favorites.
  useEffect(() => {
    if (!visible || !creatorId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('creator_favorite_models')
        .select('model_preset')
        .eq('creator_id', creatorId);
      if (cancelled) return;
      if (error) {
        console.warn('[TryOnModelSheet] favorites fetch error:', error.message);
        return;
      }
      setFavoriteModels(new Set((data ?? []).map((r: any) => String(r.model_preset))));
    })();
    return () => { cancelled = true; };
  }, [visible, creatorId]);

  // Toggle a model favorite — optimistic Set update first (never block the UI),
  // then a fire-and-forget DB write that reverts only on failure.
  const toggleFavorite = useCallback((model: ModelPreset) => {
    if (!creatorId) return;
    Haptics.selectionAsync().catch(() => {});
    const wasFavorite = favoriteModels.has(model);

    setFavoriteModels((prev) => {
      const next = new Set(prev);
      if (wasFavorite) next.delete(model);
      else next.add(model);
      return next;
    });

    (async () => {
      try {
        if (wasFavorite) {
          const { error } = await supabase
            .from('creator_favorite_models')
            .delete()
            .eq('creator_id', creatorId)
            .eq('model_preset', model);
          if (error) throw error;
        } else {
          // upsert with ignoreDuplicates sends Prefer: resolution=ignore-duplicates,
          // so re-tapping an already-favorited model is a safe no-op.
          const { error } = await supabase
            .from('creator_favorite_models')
            .upsert(
              { creator_id: creatorId, model_preset: model },
              { onConflict: 'creator_id,model_preset', ignoreDuplicates: true },
            );
          if (error) throw error;
        }
      } catch (e: any) {
        console.warn('[TryOnModelSheet] favorite write failed:', e?.message ?? e);
        // Revert the optimistic change.
        setFavoriteModels((prev) => {
          const next = new Set(prev);
          if (wasFavorite) next.add(model);
          else next.delete(model);
          return next;
        });
      }
    })();
  }, [creatorId, favoriteModels]);

  // Favorited models sort to the front (original order preserved within each
  // group), so the creator's go-to models lead the picker.
  const orderedModels = useMemo<ModelPreset[]>(() => {
    const favs = VIRTUAL_MODEL_MODELS.filter((m) => favoriteModels.has(m));
    const rest = VIRTUAL_MODEL_MODELS.filter((m) => !favoriteModels.has(m));
    return [...favs, ...rest];
  }, [favoriteModels]);

  const handlePreset = (p: QuickPreset) => {
    setSelectedModel(p.model);
    setSelectedScene(p.scene);
    setSelectedPose(p.pose);
    // A preset defines a scene, so it only makes sense with a background.
    setNoBackground(false);
    Haptics.selectionAsync().catch(() => {});
  };

  const handleGenerate = async () => {
    if (!canGenerate || !primaryItem || !primaryUrl || !creatorId) return;
    setGenerating(true);
    setErrorMsg(null);

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      // Virtual-model attempts stay scoped to the signed-in human even in
      // storefront context — these are exploratory try-ons that may or may
      // not become published content. The eventual look published *out of*
      // this try-on still goes through lookStore.addLook, which DOES respect
      // writeAs (so the look itself lands in the brand storefront if Kerri
      // publishes from a brand context).
      const { data, error } = await supabase.functions.invoke('photoroom-virtual-model', {
        body: {
          creator_id: creatorId,
          item_id: primaryItem.id,
          image_url: primaryUrl,
          additional_product_urls: additionalUrls,
          model_preset: selectedModel,
          scene_preset: selectedScene,
          pose: selectedPose,
          size: 'PORTRAIT_HD_3_2',
          // When ON, the server ignores scene_preset and returns a transparent
          // PNG. This flag is part of the EF cache key, so no-bg results are
          // cached separately from scened ones — passing it here hits the right
          // bucket. Omitted-vs-false is equivalent server-side.
          ...(noBackground ? { no_background: true } : {}),
        },
      });
      if (error) {
        // EF returns JSON like { error: 'photoroom_500', hint: 'Try fewer items …' }
        // in non-2xx bodies. Pull the hint so creators see actionable copy instead
        // of "Edge Function returned a non-2xx status code."
        let friendly: string | null = null;
        try {
          const ctx: any = (error as any).context;
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            friendly = body?.hint ?? body?.error_message ?? body?.message ?? null;
          }
        } catch {}
        throw new Error(friendly ?? error.message ?? 'Generation failed');
      }
      const payload = data as {
        ok?: boolean;
        url?: string;
        cached?: boolean;
        aspect_ratio?: number;
        truncated_additional?: boolean;
        dropped_additional_count?: number;
      } | null;
      if (!payload?.ok || !payload.url) {
        throw new Error('No image returned');
      }
      onGenerated(payload.url, {
        cached: !!payload.cached,
        aspectRatio: typeof payload.aspect_ratio === 'number' ? payload.aspect_ratio : undefined,
        noBackground,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      void recentQuery.refetch();
      // If EF dropped extras due to the 4-item cap, hold the sheet open briefly
      // so the toast is actually readable before we hand control back to the canvas.
      if (payload.truncated_additional) {
        showToast('Photoroom kept the first 4 items; the rest were skipped', 2200);
        setTimeout(() => onClose(), 2200);
      } else {
        onClose();
      }
    } catch (e: any) {
      console.warn('[TryOnModelSheet] generate failed:', e);
      setErrorMsg(e?.message ?? 'Could not generate. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setGenerating(false);
    }
  };

  const handleRecentTap = (look: RecentVirtualModel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onGenerated(look.imageUrl, { cached: true, aspectRatio: look.aspectRatio });
    onClose();
  };

  const itemPreviewUrl = primaryUrl;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      testID="try-on-model-sheet"
    >
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Try on a Model</Text>
            {primaryItem?.name ? (
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {selectedCount > 1
                  ? `${primaryItem.name} + ${selectedCount - 1} more`
                  : primaryItem.name}
              </Text>
            ) : null}
          </View>
          <Pressable onPress={onClose} hitSlop={10} testID="try-on-close">
            <X size={22} color="#1A1210" strokeWidth={2} />
          </Pressable>
        </View>

        {generating ? (
          <View style={styles.loadingOverlay} testID="try-on-loading">
            {itemPreviewUrl ? (
              <Image
                source={{ uri: itemPreviewUrl }}
                style={styles.loadingItemImage}
                contentFit="contain"
              />
            ) : null}
            <ActivityIndicator size="large" color="#B87063" style={{ marginTop: 16 }} />
            <Text style={styles.loadingTitle}>
              {selectedCount > 1
                ? `Composing your look with ${selectedCount} pieces…`
                : 'Styling your model…'}
            </Text>
            <Text style={styles.loadingBody}>
              30–60s. We{'’'}ll add it to your canvas when ready.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Items in this look — multi-select. Primary (coral) is the
             *  highest-priority selected garment; up to 3 more (ink) stack
             *  as additional_product_urls. Photoroom caps at 4 total. */}
            {stripItems.length > 0 ? (
              <>
                <View style={styles.itemsLabelRow}>
                  <Text style={styles.sectionLabel}>ITEMS IN THIS LOOK</Text>
                  <Text style={styles.itemsCount}>{selectedCount}/{MAX_ITEMS}</Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.itemsRowContent}
                  style={styles.row}
                  testID="try-on-items-strip"
                >
                  {stripItems.map((it) => {
                    const url = itemUrl(it);
                    const isSelected = selectedIds.includes(it.id);
                    const isPrimary = isSelected && it.id === primaryId;
                    return (
                      <Pressable
                        key={it.id}
                        onPress={() => toggleItem(it.id)}
                        disabled={!url}
                        style={[
                          styles.itemTile,
                          isPrimary
                            ? styles.itemTilePrimary
                            : isSelected
                              ? styles.itemTileAdditional
                              : styles.itemTileIdle,
                          !url ? { opacity: 0.4 } : null,
                        ]}
                        testID={`try-on-item-${it.id}`}
                      >
                        {url ? (
                          <Image
                            source={{ uri: url }}
                            style={styles.itemTileImage}
                            contentFit="cover"
                          />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Text style={styles.sectionHint}>
                  Tap to add up to {MAX_ITEMS - 1} more pieces. The primary item is auto-picked by category.
                </Text>
              </>
            ) : null}

            {/* Quick presets */}
            <Text style={styles.sectionLabel}>QUICK PRESETS</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rowContent}
              style={styles.row}
            >
              {QUICK_PRESETS.map((p) => {
                const active =
                  selectedModel === p.model &&
                  selectedScene === p.scene &&
                  selectedPose === p.pose;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => handlePreset(p)}
                    style={[styles.presetChip, active && styles.presetChipActive]}
                    testID={`try-on-preset-${p.id}`}
                  >
                    <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Model picker — favorited models lead the row; tap the star to
             *  save a go-to model so it's always one tap away (no re-generation). */}
            <Text style={styles.sectionLabel}>MODEL</Text>
            <Text style={styles.sectionHint}>Tap the star to save a model — favorites stay up front.</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rowContent}
              style={styles.row}
            >
              {orderedModels.map((m) => {
                const active = selectedModel === m;
                const favorite = favoriteModels.has(m);
                return (
                  <Pressable
                    key={m}
                    onPress={() => {
                      setSelectedModel(m);
                      Haptics.selectionAsync().catch(() => {});
                    }}
                    style={[styles.swatch, styles.modelSwatch, active && styles.swatchActive]}
                    testID={`try-on-model-${m}`}
                  >
                    {/* Star = touch-only nested Pressable; tapping it toggles the
                     *  favorite without selecting the model. */}
                    <Pressable
                      onPress={() => toggleFavorite(m)}
                      hitSlop={10}
                      testID={`try-on-model-fav-${m}`}
                    >
                      <Star
                        size={13}
                        color={favorite ? '#E6B800' : active ? '#FFFFFF' : '#B8AEA6'}
                        fill={favorite ? '#E6B800' : 'transparent'}
                        strokeWidth={2}
                      />
                    </Pressable>
                    <Text style={[styles.swatchText, active && styles.swatchTextActive]}>{m}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Background — the "No background" chip sits alongside the scene
             *  picker. When ON, the model + items come back on a transparent
             *  background and the scene picker is hidden (no scene to choose). */}
            <Text style={styles.sectionLabel}>BACKGROUND</Text>
            <View style={styles.bgRow}>
              <Pressable
                onPress={() => {
                  setNoBackground((prev) => !prev);
                  Haptics.selectionAsync().catch(() => {});
                }}
                style={[styles.presetChip, noBackground && styles.presetChipActive]}
                testID="try-on-no-background"
              >
                <Text style={[styles.presetChipText, noBackground && styles.presetChipTextActive]}>
                  No background
                </Text>
              </Pressable>
            </View>

            {/* Scene picker — labels passed to photoroom-virtual-model. Hidden
             *  while "No background" is ON since scene_preset is ignored. */}
            {!noBackground ? (
              <>
                <Text style={styles.sectionLabel}>SCENE</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.rowContent}
                  style={styles.row}
                >
                  {VIRTUAL_MODEL_SCENES.map((s) => {
                    const active = selectedScene === s;
                    return (
                      <Pressable
                        key={s}
                        onPress={() => {
                          setSelectedScene(s);
                          Haptics.selectionAsync().catch(() => {});
                        }}
                        style={[styles.swatch, active && styles.swatchActive]}
                        testID={`try-on-scene-${s}`}
                      >
                        <Text style={[styles.swatchText, active && styles.swatchTextActive]}>{s}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            ) : (
              <Text style={styles.sectionHint}>
                Your model and items will come back on a transparent background.
              </Text>
            )}

            {/* Pose picker */}
            <Text style={styles.sectionLabel}>POSE</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rowContent}
              style={styles.row}
            >
              {VIRTUAL_MODEL_POSES.map((p) => {
                const active = selectedPose === p;
                return (
                  <Pressable
                    key={p}
                    onPress={() => {
                      setSelectedPose(p);
                      Haptics.selectionAsync().catch(() => {});
                    }}
                    style={[styles.swatch, active && styles.swatchActive]}
                    testID={`try-on-pose-${p}`}
                  >
                    <Text style={[styles.swatchText, active && styles.swatchTextActive]}>{p}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Recent looks */}
            {recentLooks.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>RECENT LOOKS</Text>
                <Text style={styles.sectionHint}>Tap to reuse — no wait, no cost.</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.recentRowContent}
                  style={styles.row}
                >
                  {recentLooks.map((r) => (
                    <Pressable
                      key={r.id}
                      onPress={() => handleRecentTap(r)}
                      style={styles.recentCard}
                      testID={`try-on-recent-${r.id}`}
                    >
                      <Image
                        source={{ uri: r.imageUrl }}
                        style={styles.recentImage}
                        contentFit="cover"
                      />
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}

            {errorMsg ? (
              <View style={styles.errorBox} testID="try-on-error">
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}
          </ScrollView>
        )}

        {!generating ? (
          <View style={styles.footer}>
            <Pressable
              onPress={handleGenerate}
              disabled={!canGenerate}
              className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
              style={{
                shadowColor: '#1A1210',
                shadowOpacity: 0.12,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
                elevation: 2,
                opacity: canGenerate ? 1 : 0.5,
              }}
              testID="try-on-generate"
            >
              <Text
                className="text-white text-[15px] font-semibold"
                style={{ fontFamily: 'DMSans_500Medium' }}
              >
                Generate
              </Text>
            </Pressable>
          </View>
        ) : null}

        {toast ? (
          <View style={styles.toast} pointerEvents="none" testID="try-on-toast">
            <Text style={styles.toastText} numberOfLines={2}>{toast}</Text>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
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
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE6DF',
  },
  headerTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
  },
  headerSubtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginTop: 2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: 16,
    paddingBottom: 24,
  },
  sectionLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    letterSpacing: 1.5,
    color: '#B87063',
    paddingHorizontal: 18,
    marginTop: 18,
    marginBottom: 8,
  },
  sectionHint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#8C8580',
    paddingHorizontal: 18,
    marginBottom: 8,
  },
  row: {
    flexGrow: 0,
  },
  rowContent: {
    paddingHorizontal: 18,
    gap: 8,
    alignItems: 'center',
  },
  bgRow: {
    flexDirection: 'row',
    paddingHorizontal: 18,
    gap: 8,
    alignItems: 'center',
  },
  presetChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#1A1210',
  },
  presetChipActive: {
    backgroundColor: '#1A1210',
  },
  presetChipText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
  },
  presetChipTextActive: {
    color: '#FFFFFF',
  },
  swatch: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E0D8',
    minWidth: 64,
    alignItems: 'center',
  },
  swatchActive: {
    backgroundColor: '#B87063',
    borderColor: '#B87063',
  },
  // MODEL swatches lay out star + name in a row (scene/pose swatches stay text-only).
  modelSwatch: {
    flexDirection: 'row',
    gap: 5,
  },
  swatchText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#3D3330',
    textTransform: 'capitalize',
  },
  swatchTextActive: {
    color: '#FFFFFF',
  },
  itemsLabelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    marginTop: 18,
    marginBottom: 8,
  },
  itemsCount: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#8C8580',
    letterSpacing: 0.5,
  },
  itemsRowContent: {
    paddingHorizontal: 18,
    gap: 8,
    alignItems: 'center',
  },
  itemTile: {
    width: 48,
    height: 48,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  itemTileIdle: {
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  itemTileAdditional: {
    borderWidth: 2,
    borderColor: '#1A1210',
  },
  itemTilePrimary: {
    borderWidth: 2,
    borderColor: '#B87063',
  },
  itemTileImage: {
    width: '100%',
    height: '100%',
  },
  recentRowContent: {
    paddingHorizontal: 18,
    gap: 10,
  },
  recentCard: {
    width: 96,
    height: 128,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EDE6DF',
  },
  recentImage: {
    width: '100%',
    height: '100%',
  },
  footer: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#EDE6DF',
    backgroundColor: '#F7F4F0',
  },
  loadingOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 6,
  },
  loadingItemImage: {
    width: 140,
    height: 140,
    opacity: 0.85,
  },
  loadingTitle: {
    marginTop: 12,
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
    textAlign: 'center',
  },
  loadingBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    textAlign: 'center',
  },
  errorBox: {
    marginHorizontal: 18,
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(199,48,43,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(199,48,43,0.3)',
  },
  errorText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#C7302B',
  },
  toast: {
    position: 'absolute',
    bottom: 96,
    left: 24,
    right: 24,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(26,18,16,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
