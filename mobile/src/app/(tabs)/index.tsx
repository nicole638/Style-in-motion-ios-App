import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Dimensions,
  StyleSheet,
  Modal,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useFonts } from 'expo-font';
import {
  CormorantGaramond_600SemiBold,
} from '@expo-google-fonts/cormorant-garamond';
import {
  DMSans_400Regular,
  DMSans_500Medium,
} from '@expo-google-fonts/dm-sans';
import * as Haptics from 'expo-haptics';
import { decodeHtmlEntities } from '@/lib/decode-entities';
import { Eye, Archive as ArchiveIcon, Share2, Pencil, Trash2, ChevronRight } from 'lucide-react-native';
import { ActionRow } from '@/components/ActionRow';
import { ItemDetailSheet } from '@/components/ItemDetailSheet';
import { ShareLookSheet } from '@/components/ShareLookSheet';
import useLookStore, { Look, ClothingItem } from '@/lib/state/lookStore';
import useProfileStore from '@/lib/state/profileStore';
import useLikeStore from '@/lib/state/likeStore';
import { useCreatorEarnings, formatEarnings } from '@/lib/queries/creatorEarnings';
import useAuthStore from '@/lib/state/authStore';
import { useAppFollowerCount } from '@/lib/queries/creatorStats';
import useDraftLookStore from '@/lib/state/draftLookStore';
import { ActiveCampaignsRow } from '@/components/ActiveCampaignsRow';
import { PayoutSetupBanner } from '@/components/PayoutSetupBanner';
import { PerformanceCard } from '@/components/PerformanceCard';
import { FoundingCreatorMonthRail } from '@/components/FoundingCreatorMonthRail';
import { FoundingCreatorPill } from '@/components/FoundingCreatorPill';
import { InviteCreatorSheet } from '@/components/InviteCreatorSheet';
import { openShopLink } from '@/lib/analytics/openShopLink';
import StorefrontSwitcher from '@/components/StorefrontSwitcher';

const { width, height: screenHeight } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

export default function HomeScreen() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const allLooks = useLookStore((s) => s.looks);
  const looksHasHydrated = useLookStore((s) => s._hasHydrated);
  const creatorId = useAuthStore((s) => s.creatorId);
  const looks = allLooks.filter(l => l.creatorId === creatorId);
  const draftCount = useLookStore((s) =>
    creatorId ? (s.draftLooksByCreator[creatorId]?.length ?? 0) : 0
  );
  const deleteLook = useLookStore((s) => s.deleteLook);
  const archiveLook = useLookStore((s) => s.archiveLook);
  const unarchiveLook = useLookStore((s) => s.unarchiveLook);
  const incrementClicks = useLookStore((s) => s.incrementClicks);
  const getLikeCount = useLikeStore((s) => s.getLikeCount);
  const likeCounts = useLikeStore((s) => s.likeCounts);
  // Per-look earnings map ({lookId -> sum(creator_share)}). 5-min stale.
  const { data: earningsByLook } = useCreatorEarnings(creatorId);

  // Refetch this creator's looks on every focus so Home reflects fresh data
  // after login (where _layout.tsx's hydration-gated effect fired with a null
  // creatorId) and after edits from other surfaces.
  useFocusEffect(
    useCallback(() => {
      if (creatorId) {
        useLookStore.getState().fetchLooksByCreator(creatorId);
        useLookStore.getState().fetchDraftLooksByCreator(creatorId).catch(() => {});
      }
    }, [creatorId])
  );

  const totalClicks = looks.reduce((sum, l) => sum + l.clicks, 0);
  const totalItems = looks.reduce((sum, l) => sum + l.items.length, 0);
  const totalLikes = looks.reduce((sum, l) => sum + (likeCounts[l.id] ?? 0), 0);

  const followerCount = useAppFollowerCount(creatorId ?? null).data ?? 0;

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedLook, setSelectedLook] = useState<Look | null>(null);
  const [selectedItem, setSelectedItem] = useState<(ClothingItem & { lookId: string }) | null>(null);
  const [shareLookTarget, setShareLookTarget] = useState<Look | null>(null);
  const [inviteSheetOpen, setInviteSheetOpen] = useState<boolean>(false);

  const profileUsername = useProfileStore((s) => s.username);
  const profilePhotoUri = useProfileStore((s) => s.photoUri);
  const isFoundingCreator = useProfileStore((s) => s.isFoundingCreator);
  const displayName = profileUsername.trim() || 'Y';
  const initials = displayName.slice(0, 2).toUpperCase();

  const handleLookPress = useCallback((look: Look) => {
    setSelectedLook(look);
  }, []);

  const handleDeleteConfirm = () => {
    if (deleteId) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      deleteLook(deleteId);
      setDeleteId(null);
    }
  };

  const handleEditLook = useCallback((look: Look) => {
    setSelectedLook(null);
    // Phase 2 collage edit — looks tagged 'collage' with a saved layout edit
    // in the collage builder. Pre-Phase-2 collage looks have NULL layout and
    // are filtered out before the edit button is shown.
    if (look.tags?.includes('collage') && look.collageLayout) {
      setTimeout(() => {
        router.push({
          pathname: '/collage-builder',
          params: { lookId: look.id },
        });
      }, 300);
      return;
    }
    useDraftLookStore.getState().setEditingLookId(look.id);
    setTimeout(() => {
      router.push({
        pathname: '/(tabs)/create',
        params: { editLookId: look.id },
      });
    }, 300);
  }, []);

  const handleShareLook = useCallback((look: Look) => {
    setSelectedLook(null);
    setTimeout(() => setShareLookTarget(look), 300);
  }, []);

  const handleToggleArchive = useCallback(async (look: Look) => {
    setSelectedLook(null);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (look.archived) {
      await unarchiveLook(look.id);
    } else {
      await archiveLook(look.id);
    }
  }, [archiveLook, unarchiveLook]);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="home-screen">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.logo} testID="home-logo">STYLED</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
              <Text style={styles.subtitle}>Welcome back, {displayName.split(' ')[0] || 'Creator'}</Text>
              {isFoundingCreator ? (
                <View style={{ width: 6 }} />
              ) : null}
              {isFoundingCreator ? (
                <View style={{ marginTop: 2 }}>
                  <FoundingCreatorPill testID="home-header-founding-pill" />
                </View>
              ) : null}
            </View>
          </View>
          <Pressable
            onPress={() => router.push('/creator-account')}
            testID="header-avatar"
            style={({ pressed }) => [styles.avatarCircle, pressed && { opacity: 0.8 }]}
          >
            {profilePhotoUri ? (
              <Image source={{ uri: profilePhotoUri }} style={styles.avatarCircle} contentFit="cover" />
            ) : (
              <Text style={styles.avatarInitial}>{initials}</Text>
            )}
          </Pressable>
        </View>

        {/* Storefront context switcher — only renders for creators with at
            least one active brand_memberships row. Lets a stylist switch
            "Posting as you" ↔ "Posting as <Brand>". See
            lib/state/contextStore.ts for the access model. */}
        <StorefrontSwitcher />

        {/* Your performance hero card — first 30 days after signup only,
            auto-hides after 10+ click events. See PerformanceCard for the
            three sub-states (no looks / no clicks / some clicks). */}
        <PerformanceCard />

        {/* Founding Creator monthly bonus rail — only renders for accounts
            where is_founding_creator = true. Counts published looks this
            calendar month against a 4-look target. Read-only — no claim. */}
        <FoundingCreatorMonthRail />

        {/* Stats strip */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={styles.statsStrip}
          testID="stats-strip"
        >
          <StatCard label="Looks" value={String(looks.length)} />
          <StatCard label="Link Clicks" value={String(totalClicks)} />
          <StatCard label="Items Tagged" value={String(totalItems)} />
          <StatCard label="Likes" value={String(totalLikes)} />
          <StatCard label="Followers" value={String(followerCount)} />
        </ScrollView>

        {/* Switch into shopper-view — opens the public Discover masonry so
            creators can browse what other creators are posting + see what's
            doing well, without having to sign out + back in. Stays signed in
            the whole time. The reciprocal pill on the public Feed tab brings
            them back here. */}
        <View className="px-5 pt-4">
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/(public-tabs)/feed' as any);
            }}
            className="bg-white rounded-full py-3 px-5 flex-row items-center justify-between border-[1.5px] border-[#1A1210] active:opacity-85"
            testID="home-browse-shopper-view-pill"
          >
            <View className="flex-row items-center">
              <Eye size={16} color="#1A1210" strokeWidth={1.8} />
              <Text
                className="ml-2 text-[#1A1210] text-[14px] font-semibold"
                style={{ fontFamily: 'DMSans_500Medium' }}
              >
                See what shoppers see
              </Text>
            </View>
            <ChevronRight size={16} color="#1A1210" strokeWidth={1.8} />
          </Pressable>
        </View>

        {/* Drafts shortcut — only shows when the creator has saved drafts */}
        {draftCount > 0 ? (
          <View className="px-5 pt-5">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/drafts' as any);
              }}
              className="bg-white rounded-full py-3.5 px-5 flex-row items-center justify-between border-[1.5px] border-[#1A1210] active:opacity-85"
              testID="home-drafts-pill"
            >
              <View className="flex-row items-center gap-2">
                <Text
                  className="text-[#1A1210] text-[15px] font-semibold"
                  style={{ fontFamily: 'DMSans_500Medium' }}
                >
                  Drafts
                </Text>
                <View className="bg-[#B87063] rounded-full px-2 py-0.5 min-w-[22px] items-center justify-center">
                  <Text
                    className="text-white text-[13px]"
                    style={{ fontFamily: 'DMSans_500Medium' }}
                    testID="home-drafts-pill-count"
                  >
                    {draftCount}
                  </Text>
                </View>
              </View>
              <ChevronRight size={18} color="#1A1210" strokeWidth={1.8} />
            </Pressable>
          </View>
        ) : null}

        {/* Payout setup nudge — only shows when creator has earned commissions
            but has no payout_email set. Auto-hides once email is saved. */}
        <View style={{ paddingTop: 12 }}>
          <PayoutSetupBanner />
        </View>

        {/* Active brand campaigns — pulls from same `campaigns` table the
            web admin (Nicole/Kerri) opt into via /admin/campaigns. Renders
            nothing when no active campaigns exist. */}
        <ActiveCampaignsRow />

        {/* Section heading */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Looks</Text>
        </View>

        {/* Grid, loader, or empty state */}
        {looks.length === 0 ? (
          !looksHasHydrated ? (
            <View style={styles.loadingContainer} testID="looks-loading">
              <ActivityIndicator size="large" color="#1A1210" />
            </View>
          ) : (
            <EmptyState />
          )
        ) : (
          <View style={styles.grid}>
            {looks.map((look) => (
              <LookCard
                key={look.id}
                look={look}
                likeCount={likeCounts[look.id] ?? 0}
                earned={earningsByLook?.[look.id] ?? 0}
                onPress={() => handleLookPress(look)}
                onDelete={() => setDeleteId(look.id)}
                onShare={() => handleShareLook(look)}
              />
            ))}
          </View>
        )}

        {/* Invite-a-creator entry row — sits at the very bottom of the Closet
            tab so it doesn't compete with the creator's own looks. Opens the
            InviteCreatorSheet which lazily issues a referral code on demand. */}
        <View style={{ paddingHorizontal: 20, paddingTop: 28, paddingBottom: 8 }}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              setInviteSheetOpen(true);
            }}
            className="bg-white rounded-2xl border border-[#E8E0D8] active:opacity-85"
            style={{
              paddingVertical: 16,
              paddingHorizontal: 16,
              flexDirection: 'row',
              alignItems: 'center',
              shadowColor: '#C4A882',
              shadowOpacity: 0.1,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 3 },
              elevation: 3,
            }}
            testID="home-invite-creator-row"
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: 'DMSans_500Medium',
                  fontSize: 16,
                  color: '#1A1210',
                }}
              >
                Invite a creator → unlock perks
              </Text>
              <Text
                style={{
                  fontFamily: 'DMSans_400Regular',
                  fontSize: 13,
                  color: '#6B5E58',
                  marginTop: 4,
                  lineHeight: 18,
                }}
              >
                Refer a friend to Styled in Motion. When they publish 3 looks, you both get a multi-Reel spotlight on @styled.in.motion and priority access to paid brand partnerships.
              </Text>
            </View>
            <ChevronRight size={18} color="#9A8E88" strokeWidth={2} style={{ marginLeft: 12 }} />
          </Pressable>
        </View>
      </ScrollView>

      {/* Floating + button */}
      <Pressable
        className="absolute bottom-6 right-6 w-14 h-14 rounded-full bg-[#1A1210] items-center justify-center active:opacity-85"
        style={{ shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}
        onPress={() => router.push('/(tabs)/create')}
        testID="fab-create"
      >
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>

      {/* Delete confirmation modal */}
      <Modal visible={deleteId !== null} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setDeleteId(null)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete this look?</Text>
            <Text style={styles.modalSubtitle}>This cannot be undone.</Text>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancel}
                onPress={() => setDeleteId(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.modalDelete}
                onPress={handleDeleteConfirm}
                testID="confirm-delete"
              >
                <Text style={styles.modalDeleteText}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Look detail modal */}
      <Modal
        visible={selectedLook !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedLook(null)}
        testID="look-detail-modal"
      >
        <View style={styles.detailBackdrop}>
          <Pressable style={styles.detailBackdropTouch} onPress={() => setSelectedLook(null)} />
          <View style={[styles.detailSheet, { height: screenHeight * 0.88 }]}>
            {/* Drag handle */}
            <View style={styles.detailDragHandle} />

            {/* X close button */}
            <Pressable
              style={styles.detailXClose}
              onPress={() => setSelectedLook(null)}
              testID="detail-x-close"
            >
              <Text style={{ fontSize: 14, color: '#FFFFFF' }}>✕</Text>
            </Pressable>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.detailScrollContent}
            >
              {/* Look photo */}
              {selectedLook?.photoUri ? (
                <DetailCover key={selectedLook.id} uri={selectedLook.photoUri} />
              ) : (
                <View style={[styles.detailPhoto, { backgroundColor: '#E0D8D0', alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 40 }}>👗</Text>
                </View>
              )}

              {/* Meta: title + creator */}
              <View style={styles.detailMeta}>
                <Text style={styles.detailTitle}>Shop This Look</Text>
                <View style={styles.detailCreatorRow}>
                  <View style={styles.detailAvatar}>
                    <Text style={styles.detailAvatarText}>{initials.slice(0, 2)}</Text>
                  </View>
                  <Text style={styles.detailCreatorName}>by {displayName.split(' ')[0] || 'Creator'}</Text>
                </View>
              </View>

              {/* Items list */}
              {(selectedLook?.items ?? []).map((item) => {
                const hasLink = item.link && item.link !== '#' && item.link !== '';
                const alternates = (item.alternates ?? []).filter(a => a?.link && a.link.trim());
                const hasAlternate = alternates.length > 0;
                return (
                  <View key={item.id}>
                    <Pressable
                      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        if (selectedLook) setSelectedItem({ ...item, lookId: selectedLook.id });
                      }}
                      testID={`detail-item-row-${item.id}`}
                    >
                      <View style={styles.detailItemRow}>
                        {item.photoUri ? (
                          <Image
                            source={{ uri: item.photoUri }}
                            style={styles.detailItemPhoto}
                            contentFit="cover"
                          />
                        ) : (
                          <View style={styles.detailItemPlaceholder}>
                            <Text style={{ fontSize: 20 }}>{item.emoji}</Text>
                          </View>
                        )}
                        <View style={styles.detailItemInfo}>
                          <Text style={styles.detailItemName} numberOfLines={1}>{decodeHtmlEntities(item.name) || item.category}</Text>
                          {item.brand ? (
                            <Text style={styles.detailItemBrand}>{decodeHtmlEntities(item.brand)}</Text>
                          ) : null}
                          {item.price ? (
                            <Text style={styles.detailItemPrice}>${item.price}</Text>
                          ) : null}
                          {hasAlternate && item.primaryNote ? (
                            <Text style={{ fontSize: 11, color: '#6B5E58', marginTop: 2, fontStyle: 'italic' }}>{item.primaryNote}</Text>
                          ) : null}
                        </View>
                        {hasLink ? (
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation();
                              if (selectedLook) incrementClicks(selectedLook.id);
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              // Route through /api/shop so the tag is stamped and
                              // the click row is written server-side (source=ios).
                              const hasLookContext = !!(selectedLook?.id && item.lookItemId);
                              void openShopLink({
                                lookId: hasLookContext ? selectedLook!.id : undefined,
                                itemId: hasLookContext ? item.lookItemId : undefined,
                                creatorId: selectedLook?.creatorId ?? undefined,
                                url: !hasLookContext ? item.link : undefined,
                              });
                            }}
                            hitSlop={8}
                            testID={`detail-shop-${item.id}`}
                          >
                            <Text style={styles.detailShopLabel}>Shop →</Text>
                          </Pressable>
                        ) : (
                          <Text style={styles.detailSoonLabel}>Soon</Text>
                        )}
                      </View>
                    </Pressable>
                    {alternates.map((alt, altIdx) => (
                      <Pressable
                        key={`${item.id}-alt-${altIdx}`}
                        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                        onPress={() => {
                          if (selectedLook) incrementClicks(selectedLook.id);
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          // Alternate link → route through /api/shop with the raw
                          // url plus look/item context for attribution.
                          void openShopLink({
                            url: alt.link,
                            lookId: selectedLook?.id ?? undefined,
                            itemId: item.lookItemId ?? undefined,
                            creatorId: selectedLook?.creatorId ?? undefined,
                          });
                        }}
                        testID={`detail-alt-${item.id}-${altIdx}`}
                      >
                        <View style={styles.altCard}>
                          {alt.label ? (
                            <Text style={styles.altLabel}>{alt.label}</Text>
                          ) : null}
                          <View style={styles.altCardRow}>
                            {alt.photo_url ? (
                              <Image
                                source={{ uri: alt.photo_url }}
                                style={styles.altThumb}
                                contentFit="cover"
                              />
                            ) : null}
                            <View style={{ flex: 1 }}>
                              <Text style={styles.altName} numberOfLines={1}>{alt.name || 'Alternative'}</Text>
                              {alt.brand ? (
                                <Text style={styles.altBrand}>{alt.brand}</Text>
                              ) : null}
                              {alt.price ? (
                                <Text style={styles.altPrice}>${alt.price}</Text>
                              ) : null}
                            </View>
                            <Text style={styles.detailShopLabel}>Shop →</Text>
                          </View>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                );
              })}

              {/* Action rows */}
              <View style={styles.detailActionList}>
                <ActionRow
                  icon={Share2}
                  label="Share Look"
                  onPress={() => selectedLook && handleShareLook(selectedLook)}
                  variant="accent"
                  testID="detail-share-button"
                />
                {selectedLook?.tags?.includes('collage') && !selectedLook.collageLayout ? null : (
                  <ActionRow
                    icon={Pencil}
                    label="Edit Look"
                    onPress={() => selectedLook && handleEditLook(selectedLook)}
                    testID="detail-edit-button"
                  />
                )}
                <ActionRow
                  icon={ArchiveIcon}
                  label={selectedLook?.archived ? 'Unarchive Look' : 'Archive Look'}
                  onPress={() => selectedLook && handleToggleArchive(selectedLook)}
                  testID="detail-archive-button"
                />
                <ActionRow
                  icon={Trash2}
                  label="Delete Look"
                  onPress={() => {
                    const pending = selectedLook;
                    setSelectedLook(null);
                    setTimeout(() => {
                      if (pending) setDeleteId(pending.id);
                    }, 300);
                  }}
                  variant="destructive"
                  isLast
                  testID="detail-delete-button"
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <ItemDetailSheet
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        testIDPrefix="home-item-detail-sheet"
      />

      <ShareLookSheet
        look={shareLookTarget}
        visible={shareLookTarget !== null}
        onClose={() => setShareLookTarget(null)}
        testIDPrefix="home-share-look-sheet"
      />

      <InviteCreatorSheet
        visible={inviteSheetOpen}
        onClose={() => setInviteSheetOpen(false)}
        testIDPrefix="home-invite-creator-sheet"
      />

    </SafeAreaView>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * Detail-modal cover — captures the image's native aspect on load and applies
 * it to the container so collage covers (1:1) don't get clipped by the default
 * 2:3 portrait aspect. Keyed by look.id by the parent so a fresh selection
 * re-mounts and re-measures.
 */
function DetailCover({ uri }: { uri: string }) {
  const [aspect, setAspect] = useState<number | null>(null);
  return (
    <Image
      source={{ uri }}
      style={[styles.detailPhoto, aspect ? { aspectRatio: aspect } : null]}
      contentFit="cover"
      onLoad={(event: any) => {
        const w = event?.source?.width;
        const h = event?.source?.height;
        if (w && h && w > 0 && h > 0) setAspect(w / h);
      }}
    />
  );
}

function LookCard({ look, likeCount, earned, onPress, onDelete, onShare }: { look: Look; likeCount: number; earned: number; onPress: () => void; onDelete: () => void; onShare: () => void }) {
  const isPublished = !!look.publishedAt;
  return (
    <Pressable
      style={({ pressed }) => [styles.lookCard, pressed && styles.lookCardPressed]}
      onPress={onPress}
      testID={`look-card-${look.id}`}
    >
      {look.photoUri ? (
        <Image
          source={{ uri: look.photoUri }}
          style={styles.lookPhoto}
          contentFit="cover"
        />
      ) : (
        <View style={styles.lookPhotoPlaceholder}>
          <Text style={styles.lookPhotoEmoji}>👗</Text>
        </View>
      )}
      <View style={styles.lookCardFooter}>
        <View style={styles.itemsBadge}>
          <Text style={styles.itemsBadgeText}>{look.items.length} items</Text>
        </View>
        <Text style={styles.clicksLabel}>
          {look.clicks} clicks{' \u00B7 \u2764\uFE0F '}{likeCount}
          {earned > 0 ? ` \u00B7 ${formatEarnings(earned)}` : null}
        </Text>
      </View>
      {/* Delete button */}
      <Pressable
        style={styles.lookCardDelete}
        onPress={onDelete}
        testID={`delete-look-${look.id}`}
        hitSlop={8}
      >
        <Text style={styles.lookCardDeleteText}>✕</Text>
      </Pressable>
      {/* Share button — only for published looks */}
      {isPublished ? (
        <Pressable
          style={styles.lookCardShare}
          onPress={(e) => { e.stopPropagation(); onShare(); }}
          testID={`share-look-${look.id}`}
          hitSlop={8}
        >
          <Share2 size={11} color="#FFFFFF" strokeWidth={2} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function EmptyState() {
  return (
    <View style={styles.emptyState} testID="empty-state">
      <View style={styles.emptyIllustration}>
        <Text style={styles.emptyEmoji}>✨</Text>
        <View style={styles.emptyLine} />
        <View style={[styles.emptyLine, { width: 80, opacity: 0.4 }]} />
      </View>
      <Text style={styles.emptyTitle}>No looks yet</Text>
      <Text style={styles.emptySubtitle}>
        Create your first look and start sharing your style
      </Text>
      <Pressable
        onPress={() => router.push('/onboarding/aesthetic')}
        testID="empty-create-button"
      >
        {({ pressed }) => (
          <View style={[styles.emptyButton, { opacity: pressed ? 0.8 : 1 }]}>
            <Text style={styles.emptyButtonText}>Create Your First Look</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F4F0',
  },
  scrollContent: {
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  logo: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 32,
    letterSpacing: 6,
    color: '#1A1210',
  },
  subtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#8C8580',
    marginTop: 2,
    letterSpacing: 0.3,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#C4A882',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#FFFFFF',
  },
  statsStrip: {
    paddingHorizontal: 20,
    gap: 12,
    paddingBottom: 4,
  },
  statCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: '#C4A882',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    minWidth: 100,
  },
  statValue: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 28,
    color: '#1A1210',
  },
  statLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#8C8580',
    marginTop: 2,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 16,
  },
  sectionTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 16,
  },
  lookCard: {
    width: CARD_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#C4A882',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  lookCardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  lookPhoto: {
    width: CARD_WIDTH,
    height: CARD_WIDTH,
  },
  lookPhotoPlaceholder: {
    width: CARD_WIDTH,
    height: CARD_WIDTH,
    backgroundColor: '#F5F0EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lookPhotoEmoji: {
    fontSize: 48,
  },
  lookCardFooter: {
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemsBadge: {
    backgroundColor: '#1A1210',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  itemsBadgeText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  clicksLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#8C8580',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 40,
  },
  emptyIllustration: {
    width: 120,
    height: 120,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    shadowColor: '#C4A882',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    gap: 8,
  },
  emptyEmoji: {
    fontSize: 40,
  },
  emptyLine: {
    width: 60,
    height: 3,
    backgroundColor: '#F5F0EB',
    borderRadius: 2,
  },
  emptyTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 26,
    color: '#1A1210',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#8C8580',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  emptyButton: {
    backgroundColor: '#DCDCDC',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderWidth: 1.5,
    borderColor: '#999999',
  },
  emptyButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#1A1210',
    letterSpacing: 0.3,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1A1210',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.94 }],
  },
  fabIcon: {
    fontSize: 28,
    color: '#FFFFFF',
    lineHeight: 32,
    marginTop: -2,
  },
  lookCardDelete: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lookCardDeleteText: {
    fontSize: 10,
    color: '#FFFFFF',
  },
  lookCardShare: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    width: 300,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  modalTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
    marginBottom: 6,
  },
  modalSubtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#8C8580',
    marginBottom: 24,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    alignItems: 'center',
  },
  modalCancelText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    fontWeight: '500',
    color: '#3D3330',
  },
  modalDelete: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#C0392B',
    alignItems: 'center',
  },
  modalDeleteText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // Look detail modal
  detailBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  detailBackdropTouch: {
    flex: 1,
  },
  detailSheet: {
    backgroundColor: '#F7F4F0',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  detailDragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E8E0D8',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 0,
  },
  detailXClose: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  detailScrollContent: {
    paddingBottom: 40,
  },
  detailPhoto: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 16,
  },
  detailMeta: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  detailTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    marginBottom: 6,
  },
  detailCreatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#8C5A3A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailAvatarText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  detailCreatorName: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    marginLeft: 8,
  },
  detailItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8E0D8',
  },
  detailItemPhoto: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  detailItemPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#E0D8D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailItemInfo: {
    flex: 1,
    marginLeft: 12,
  },
  detailItemName: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    fontWeight: '500',
    color: '#1A1210',
  },
  detailItemBrand: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginTop: 1,
  },
  detailItemPrice: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#B87063',
    marginTop: 2,
  },
  detailShopLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    fontWeight: '600',
    color: '#B87063',
    marginLeft: 12,
  },
  detailSoonLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginLeft: 12,
  },
  detailActionList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE6DF',
    overflow: 'hidden',
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
  },
  altCard: {
    backgroundColor: '#F0EBE5',
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
    marginLeft: 56,
    marginRight: 20,
    marginBottom: 10,
  },
  altLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#6B5E58',
    fontStyle: 'italic',
    marginBottom: 4,
  },
  altCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  altThumb: {
    width: 40,
    height: 40,
    borderRadius: 6,
    marginRight: 8,
  },
  altName: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
  },
  altBrand: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginTop: 1,
  },
  altPrice: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    fontWeight: '600',
    color: '#1A1210',
    marginTop: 2,
  },
  analyticsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 20,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F0EBE5',
  },
  analyticsBtnText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#B87063',
  },
});
