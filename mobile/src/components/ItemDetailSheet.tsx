import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  Dimensions,
  StyleSheet,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { ExternalLink, Pencil, Copy, Archive as ArchiveIcon, ArchiveRestore, Trash2, MinusCircle, ListPlus, Sparkles, BadgeCheck } from 'lucide-react-native';
import { ActionRow } from '@/components/ActionRow';
import { LookPickerSheet } from '@/components/LookPickerSheet';
import { ConsignmentModal } from '@/components/ConsignmentModal';
import useLookStore, { ClothingItem } from '@/lib/state/lookStore';
import useDraftLookStore from '@/lib/state/draftLookStore';
import useAuthStore from '@/lib/state/authStore';
import { cloneItemToDraft } from '@/lib/utils/cloneItem';
import { decodeHtmlEntities } from '@/lib/decode-entities';
import { consignEligibility, type ConsignEligibility } from '@/lib/consignment/eligibility';
import { supabase } from '@/lib/supabase';
import { logClickEvent } from '@/lib/analytics/clickEvents';
import { CLICK_SOURCE } from '@/lib/analytics/source';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

function ConsigningRow({ testID }: { testID?: string }) {
  return (
    <View style={consigningStyles.row} testID={testID}>
      <View style={consigningStyles.inner}>
        <BadgeCheck size={18} color="#B87063" strokeWidth={1.75} />
        <Text style={consigningStyles.label}>Consigning ✓</Text>
      </View>
    </View>
  );
}

const consigningStyles = StyleSheet.create({
  row: {
    minHeight: 56,
    backgroundColor: '#FDF5F3',
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  label: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#B87063',
  },
});

interface ItemDetailSheetProps {
  item: (ClothingItem & { lookId?: string }) | null;
  onClose: () => void;
  onItemRemoved?: () => void;
  testIDPrefix?: string;
}

type PendingDelete = {
  id: string;
  mode: 'delete' | 'deleteForever';
};

export function ItemDetailSheet({
  item,
  onClose,
  onItemRemoved,
  testIDPrefix = 'item-detail-sheet',
}: ItemDetailSheetProps) {
  const archiveItem = useLookStore((s) => s.archiveItem);
  const unarchiveItem = useLookStore((s) => s.unarchiveItem);
  const removeItemFromLook = useLookStore((s) => s.removeItemFromLook);
  const deleteItemPermanently = useLookStore((s) => s.deleteItemPermanently);
  const deleteLook = useLookStore((s) => s.deleteLook);
  const looks = useLookStore((s) => s.looks);
  const isItemInPublishedLook = useLookStore((s) => s.isItemInPublishedLook);
  const setItems = useDraftLookStore((s) => s.setItems);
  const creatorId = useAuthStore((s) => s.creatorId);
  // Shopper mode: hide every creator-only action that would cross into the
  // creator (tabs) shell (Use in New Look → /(tabs)/create, Add to Existing
  // Look, Edit Item → /add-closet-item, Consign). Shoppers get a personal
  // closet sheet: Archive + Delete only.
  const accountType = useAuthStore((s) => s.accountType);
  const isShopper = accountType === 'shopper';

  const parentLook = item?.lookId ? looks.find(l => l.id === item.lookId) ?? null : null;
  const isCollageLook = !!parentLook?.tags?.includes('collage');
  const collageEditable = isCollageLook && !!parentLook?.collageLayout;

  const [confirmType, setConfirmType] = useState<'remove' | 'delete' | 'deleteForever' | 'empty-look' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [pendingLookId, setPendingLookId] = useState<string | null>(null);
  const [showLookPicker, setShowLookPicker] = useState(false);
  const [lookPickerItemId, setLookPickerItemId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showConsignModal, setShowConsignModal] = useState(false);
  // Snapshot the item the Consign flow targets. The detail-sheet `item` prop
  // gets cleared to null by the parent the moment we call onClose() (which we
  // must do to dismiss this sheet before opening the consign modal — RN can't
  // stack two <Modal>s). Holding our own copy keeps the consign modal alive
  // after that dismiss.
  const [consignItem, setConsignItem] = useState<ClothingItem | null>(null);
  const [hasActiveRequest, setHasActiveRequest] = useState(false);
  // Whether this item has been styled + shared (lives in a published look).
  // null = not yet resolved. Consign Now is gated on this being true.
  const [styledShared, setStyledShared] = useState<boolean | null>(null);
  const [showStyleGate, setShowStyleGate] = useState(false);

  const translateY = useSharedValue(0);
  const dismissSheet = useCallback(() => { onClose(); }, [onClose]);
  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > 100 || e.velocityY > 800) {
        runOnJS(dismissSheet)();
      }
      translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
    });
  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const handleShop = useCallback(async () => {
    if (!item?.link || item.link === '#') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
    const useEf = !!(baseUrl && item.lookItemId && item.lookId);
    const url = useEf
      ? `${baseUrl}/api/shop?lookId=${encodeURIComponent(item.lookId!)}&itemId=${encodeURIComponent(item.lookItemId!)}&source=${CLICK_SOURCE}`
      : item.link;
    // /api/shop writes the click row server-side (full 3-tier tag resolution +
    // source='ios' from the query param). Only log directly on the bypass path.
    if (!useEf) {
      void logClickEvent({
        lookId: item.lookId ?? null,
        itemId: item.lookItemId ?? null,
        creatorId: parentLook?.creatorId ?? null,
        itemUrl: item.link,
        redirectUrl: url,
        wasAffiliated: !!item.affiliate_url,
        affiliateNetwork: null,
      });
    }
    await WebBrowser.openBrowserAsync(url, {
      toolbarColor: '#B87063',
      controlsColor: '#FFFFFF',
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC,
      dismissButtonStyle: 'done',
    });
  }, [item]);

  const handleEdit = useCallback(() => {
    if (!item?.id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    // Phase 2 collage edit — route to the collage builder for collage looks
    // with a saved layout. Pre-Phase-2 collage looks (NULL collage_layout)
    // hide the edit button entirely (see render below).
    if (item.lookId && collageEditable) {
      router.push({
        pathname: '/collage-builder',
        params: { lookId: item.lookId },
      });
      return;
    }
    if (item.lookId) {
      router.push({
        pathname: '/(tabs)/create',
        params: { editLookId: item.lookId, editItemId: item.id },
      });
    } else {
      router.push({
        pathname: '/add-closet-item',
        params: { editItemId: item.id },
      });
    }
  }, [item, onClose, collageEditable]);

  const handleClone = useCallback(() => {
    if (!item) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const cloned = cloneItemToDraft(item);
    setItems((prev) => [...prev, cloned]);
    onClose();
    router.push('/(tabs)/create');
  }, [item, setItems, onClose]);

  // "Style & share first" gate → seed a new draft look with this piece and
  // jump into the create flow. Uses the consign snapshot since the sheet's
  // `item` prop is cleared the moment we close it to open the gate.
  const handleStyleInLook = useCallback(() => {
    const it = consignItem;
    if (!it) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowStyleGate(false);
    const cloned = cloneItemToDraft(it);
    setItems((prev) => [...prev, cloned]);
    setTimeout(() => setConsignItem(null), 300);
    router.push('/(tabs)/create');
  }, [consignItem, setItems]);

  const handleStyleGateDismiss = useCallback(() => {
    setShowStyleGate(false);
    setTimeout(() => setConsignItem(null), 300);
  }, []);

  const handleToggleArchive = useCallback(async () => {
    if (!item?.id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const wasArchived = !!item.archived;
    onClose();
    if (wasArchived) {
      await unarchiveItem(item.id);
    } else {
      await archiveItem(item.id);
    }
  }, [item, archiveItem, unarchiveItem, onClose]);

  const handleRemoveFromLookPress = useCallback(() => {
    setConfirmType('remove');
  }, []);

  const handleRemoveFromLookConfirm = useCallback(async () => {
    if (!item?.id || !item.lookId) return;
    setConfirmType(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const lookId = item.lookId;
    onClose();
    onItemRemoved?.();
    const remaining = await removeItemFromLook(lookId, item.id);
    if (remaining === 0) {
      setPendingLookId(lookId);
      setConfirmType('empty-look');
    }
  }, [item, removeItemFromLook, onClose, onItemRemoved]);

  const handleDeleteFromClosetPress = useCallback(() => {
    if (!item?.id) return;
    setPendingDelete({ id: item.id, mode: 'delete' });
    onClose();
  }, [item, onClose]);

  const handleDeleteForeverPress = useCallback(() => {
    if (!item?.id) return;
    setPendingDelete({ id: item.id, mode: 'deleteForever' });
    onClose();
  }, [item, onClose]);

  useEffect(() => {
    if (pendingDelete && confirmType === null) {
      const timer = setTimeout(() => {
        setConfirmType(pendingDelete.mode);
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [pendingDelete, confirmType]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!pendingDelete) return;
    const { id, mode } = pendingDelete;
    setConfirmType(null);
    setPendingDelete(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (mode === 'delete') {
        await archiveItem(id);
      } else {
        await deleteItemPermanently(id);
      }
      onItemRemoved?.();
    } catch (err) {
      console.error('[ItemDetailSheet] confirm action failed', err);
      setToastMessage("Couldn't delete. Try again in a moment.");
      setTimeout(() => setToastMessage(null), 3000);
    }
  }, [pendingDelete, archiveItem, deleteItemPermanently, onItemRemoved]);

  const handleEmptyLookConfirm = useCallback(async () => {
    if (!pendingLookId) return;
    setConfirmType(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await deleteLook(pendingLookId);
    setPendingLookId(null);
  }, [pendingLookId, deleteLook]);

  const handleAddToExistingLook = useCallback(() => {
    if (!item?.id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLookPickerItemId(item.id);
    onClose();
    setTimeout(() => setShowLookPicker(true), 350);
  }, [item, onClose]);

  const handleLookPickerResult = useCallback((result: 'added' | 'already_in_look', lookTitle: string) => {
    const msg = result === 'already_in_look'
      ? `Already in ${lookTitle}`
      : `Added to ${lookTitle}`;
    setToastMessage(msg);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  const handleConfirmCancel = useCallback(() => {
    setConfirmType(null);
    setPendingDelete(null);
    setPendingLookId(null);
  }, []);

  // Compute consign eligibility. Gate is `item.trrEligible` (server-computed
  // against TheRealReal's accepted brand list). Mobile no longer maintains its
  // own luxury allowlist or price floor — see lib/consignment/eligibility.ts.
  const elig = item
    ? consignEligibility(item)
    : null;

  // Check for existing active consignment request on mount / when item changes
  useEffect(() => {
    if (!item?.id || !creatorId || !elig || !elig.eligible) {
      setHasActiveRequest(false);
      return;
    }
    let cancelled = false;
    supabase
      .from('consignment_requests')
      .select('id, status, payout_min_usd, payout_max_usd')
      .eq('item_id', item.id)
      .eq('creator_id', creatorId)
      .in('status', ['submitted', 'accepted', 'authenticated', 'listed'])
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setHasActiveRequest(!!data);
      });
    return () => { cancelled = true; };
  }, [item?.id, creatorId, elig?.eligible]);

  // Resolve whether the item is styled + shared (in a published look). Consign
  // Now is gated on this — only eligible items need the check.
  useEffect(() => {
    if (!item?.id || !elig || !elig.eligible) {
      setStyledShared(null);
      return;
    }
    let cancelled = false;
    setStyledShared(null);
    isItemInPublishedLook(item.id)
      .then((shared) => {
        if (!cancelled) setStyledShared(shared);
      })
      .catch(() => {
        // Fail open — don't block an eligible creator on a query error.
        if (!cancelled) setStyledShared(true);
      });
    return () => { cancelled = true; };
  }, [item?.id, elig?.eligible, isItemInPublishedLook]);

  const hasLink = !!(item?.link && item.link !== '#');
  const isArchived = !!item?.archived;
  const hasLookContext = !!item?.lookId;

  const confirmTitle =
    confirmType === 'remove' ? 'Remove from this look?' :
    confirmType === 'delete' ? 'Delete from Closet?' :
    confirmType === 'deleteForever' ? 'Delete forever?' :
    confirmType === 'empty-look' ? 'This look is now empty' : '';

  const confirmSubtitle =
    confirmType === 'remove' ? 'The item stays in your Closet and can be added to other looks.' :
    confirmType === 'delete' ? 'This item will move to your Archives. You can restore it anytime.' :
    confirmType === 'deleteForever' ? "This item will be removed from your closet and from any looks that include it. This can't be undone." :
    confirmType === 'empty-look' ? 'Would you like to delete it?' : '';

  const confirmButtonText =
    confirmType === 'remove' ? 'Remove' :
    confirmType === 'delete' ? 'Delete' :
    confirmType === 'deleteForever' ? 'Delete Forever' :
    confirmType === 'empty-look' ? 'Delete Look' : '';

  const confirmHandler =
    confirmType === 'remove' ? handleRemoveFromLookConfirm :
    confirmType === 'delete' || confirmType === 'deleteForever' ? handleDeleteConfirm :
    confirmType === 'empty-look' ? handleEmptyLookConfirm : handleConfirmCancel;

  return (
    <>
      {item ? (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={onClose}
          testID={testIDPrefix}
        >
          <View style={styles.backdrop}>
            <Pressable style={styles.backdropTouch} onPress={onClose} />
            <Animated.View style={[styles.sheet, sheetAnimatedStyle]}>
              <GestureDetector gesture={panGesture}>
                <Animated.View>
                  <View style={styles.dragHandle} />
                </Animated.View>
              </GestureDetector>

              <ScrollView
                style={styles.scrollArea}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.preview}>
                  {item.photoUri ? (
                    <Image source={{ uri: item.photoUri }} style={styles.photo} contentFit="cover" />
                  ) : (
                    <View style={[styles.photo, styles.photoPlaceholder]}>
                      <Text style={{ fontSize: 40 }}>{item.emoji}</Text>
                    </View>
                  )}
                  <View style={styles.meta}>
                    <Text style={styles.name} numberOfLines={2}>
                      {decodeHtmlEntities(item.name) || item.category}
                    </Text>
                    {item.brand ? (
                      <Text style={styles.brand}>{decodeHtmlEntities(item.brand)}</Text>
                    ) : null}
                    {item.price ? (
                      <Text style={styles.price}>${item.price}</Text>
                    ) : null}
                    <Text style={styles.category}>{item.category}</Text>
                    {isArchived ? (
                      <View style={styles.archivedPill}>
                        <Text style={styles.archivedPillText}>Archived</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                <View style={styles.actionCard}>
                  {/* Shopper items have no shop link and shoppers don't shop
                      their own closet — hide the Shop row for them. */}
                  {isShopper ? null : (
                    <ActionRow
                      icon={ExternalLink}
                      label={hasLink ? 'Shop' : 'No link yet'}
                      onPress={handleShop}
                      variant="accent"
                      testID={`${testIDPrefix}-shop`}
                    />
                  )}
                  {/* Edit Collage stays for shopper collage looks (routes to the
                      root-level collage builder, no tab bar). Edit Item routes to
                      the creator URL-add screen — hide it for shoppers. */}
                  {isCollageLook && !collageEditable ? null : (collageEditable || !isShopper) ? (
                    <ActionRow
                      icon={Pencil}
                      label={collageEditable ? 'Edit Collage' : 'Edit Item'}
                      onPress={handleEdit}
                      testID={`${testIDPrefix}-edit`}
                    />
                  ) : null}
                  {isShopper ? null : (
                    <ActionRow
                      icon={Copy}
                      label="Use in New Look"
                      onPress={handleClone}
                      testID={`${testIDPrefix}-clone`}
                    />
                  )}
                  {isShopper ? null : (
                    <ActionRow
                      icon={ListPlus}
                      label="Add to Existing Look"
                      onPress={handleAddToExistingLook}
                      testID={`${testIDPrefix}-add-to-look`}
                    />
                  )}
                  <ActionRow
                    icon={isArchived ? ArchiveRestore : ArchiveIcon}
                    label={isArchived ? 'Unarchive Item' : 'Archive Item'}
                    onPress={handleToggleArchive}
                    isLast={isShopper || !elig || !elig.eligible}
                    testID={`${testIDPrefix}-archive`}
                  />
                  {!isShopper && elig && elig.eligible && !hasActiveRequest ? (
                    <ActionRow
                      icon={Sparkles}
                      label="Consign with The RealReal"
                      onPress={async () => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        // Gate: the piece must be styled + shared (in a published
                        // look) before consigning. Use the resolved value if we
                        // have it; otherwise resolve on tap so a slow query never
                        // lets an un-shared item through.
                        const itemId = item.id;
                        let shared = styledShared;
                        if (shared === null) {
                          shared = await isItemInPublishedLook(itemId);
                        }
                        // RN can't stack two <Modal>s — snapshot the item,
                        // close this sheet, then open the next modal after the
                        // dismiss animation.
                        setConsignItem(item);
                        onClose();
                        setTimeout(() => {
                          if (shared) {
                            setShowConsignModal(true);
                          } else {
                            setShowStyleGate(true);
                          }
                        }, 350);
                      }}
                      variant="accent"
                      isLast
                      testID={`${testIDPrefix}-consign`}
                    />
                  ) : null}
                  {!isShopper && elig && elig.eligible && hasActiveRequest ? (
                    <ConsigningRow testID={`${testIDPrefix}-consigning`} />
                  ) : null}
                </View>

                <View style={styles.destructiveSection}>
                  {hasLookContext ? (
                    <View>
                      <Pressable
                        style={styles.removeButton}
                        onPress={handleRemoveFromLookPress}
                        testID={`${testIDPrefix}-remove-from-look`}
                      >
                        <MinusCircle size={18} color="#C0392B" />
                        <Text style={styles.removeButtonText}>Remove from This Look</Text>
                      </Pressable>
                      <Text style={styles.helperText}>Keeps the item in your Closet for other looks</Text>
                    </View>
                  ) : null}
                  {isArchived ? (
                    <Pressable
                      style={styles.deleteButton}
                      onPress={handleDeleteForeverPress}
                      testID={`${testIDPrefix}-delete-forever`}
                    >
                      <Trash2 size={18} color="#FFFFFF" />
                      <Text style={styles.deleteButtonText}>Delete Forever</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={styles.deleteButton}
                      onPress={handleDeleteFromClosetPress}
                      testID={`${testIDPrefix}-delete-from-closet`}
                    >
                      <Trash2 size={18} color="#FFFFFF" />
                      <Text style={styles.deleteButtonText}>Delete from Closet</Text>
                    </Pressable>
                  )}
                </View>
              </ScrollView>

              <Pressable style={styles.closeButton} onPress={onClose} testID={`${testIDPrefix}-close`}>
                <Text style={styles.closeButtonText}>Close</Text>
              </Pressable>
            </Animated.View>
          </View>
        </Modal>
      ) : null}

      <Modal visible={confirmType !== null} transparent animationType="fade">
        <Pressable style={styles.confirmOverlay} onPress={handleConfirmCancel}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{confirmTitle}</Text>
            <Text style={styles.confirmSubtitle}>{confirmSubtitle}</Text>
            <View style={styles.confirmActions}>
              <Pressable
                style={styles.confirmCancel}
                onPress={handleConfirmCancel}
                testID={`${testIDPrefix}-confirm-cancel`}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.confirmDestructive}
                onPress={confirmHandler}
                testID={`${testIDPrefix}-confirm-action`}
              >
                <Text style={styles.confirmDestructiveText}>{confirmButtonText}</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {lookPickerItemId ? (
        <LookPickerSheet
          visible={showLookPicker}
          itemId={lookPickerItemId}
          onClose={() => { setShowLookPicker(false); setLookPickerItemId(null); }}
          onResult={handleLookPickerResult}
        />
      ) : null}

      {toastMessage ? (
        <View style={styles.toast} pointerEvents="none" testID="item-detail-toast">
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}

      <Modal visible={showStyleGate} transparent animationType="fade">
        <Pressable style={styles.confirmOverlay} onPress={handleStyleGateDismiss}>
          <View style={styles.confirmCard}>
            <View style={styles.styleGateIconWrap}>
              <Sparkles size={22} color="#B87063" strokeWidth={2.25} />
            </View>
            <Text style={styles.confirmTitle}>Style this piece first</Text>
            <Text style={styles.confirmSubtitle}>
              Style this piece in a look and share it first, then consign — showing
              it on you helps it sell.
            </Text>
            <Pressable
              onPress={handleStyleInLook}
              className="w-full rounded-full py-3.5 flex-row items-center justify-center bg-[#B87063] active:opacity-85 mt-1"
              style={{
                shadowColor: '#1A1210',
                shadowOpacity: 0.12,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
                elevation: 2,
              }}
              testID={`${testIDPrefix}-style-gate-start`}
            >
              <Text
                className="text-white text-[15px]"
                style={{ fontFamily: 'DMSans_500Medium', fontWeight: '600' }}
              >
                Style in a Look
              </Text>
            </Pressable>
            <Pressable
              onPress={handleStyleGateDismiss}
              className="w-full py-3 items-center justify-center active:opacity-70 mt-1"
              testID={`${testIDPrefix}-style-gate-dismiss`}
            >
              <Text
                className="text-[#6B5E58] text-sm"
                style={{ fontFamily: 'DMSans_500Medium' }}
              >
                Not now
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {consignItem ? (
        <ConsignmentModal
          visible={showConsignModal}
          item={consignItem}
          creatorId={creatorId}
          onClose={() => {
            setShowConsignModal(false);
            // Drop the snapshot after the dismiss animation so the modal stays
            // mounted long enough to slide out cleanly.
            setTimeout(() => setConsignItem(null), 300);
          }}
          onConsigned={() => setHasActiveRequest(true)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  backdropTouch: { flex: 1 },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: SCREEN_HEIGHT * 0.78,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E8E0D8',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  scrollArea: { flexGrow: 0 },
  scrollContent: { paddingBottom: 8 },
  preview: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 16,
  },
  photo: {
    width: 96,
    height: 96,
    borderRadius: 12,
    backgroundColor: '#E0D8D0',
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    flex: 1,
    justifyContent: 'center',
  },
  name: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
  },
  brand: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    marginTop: 2,
  },
  price: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#B87063',
    marginTop: 4,
  },
  category: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#8C8580',
    marginTop: 4,
  },
  archivedPill: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: '#F0EBE5',
  },
  archivedPillText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#6B5E58',
  },
  actionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE6DF',
    overflow: 'hidden',
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 8,
  },
  destructiveSection: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 8,
    gap: 12,
  },
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C0392B',
  },
  removeButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    fontWeight: '600',
    color: '#C0392B',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#C0392B',
  },
  deleteButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  helperText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#8C8580',
    textAlign: 'center',
    marginTop: 4,
  },
  closeButton: {
    width: '100%',
    height: 52,
    backgroundColor: '#F7F4F0',
    borderTopWidth: 0.5,
    borderTopColor: '#E8E0D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#1A1210',
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCard: {
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
  styleGateIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(184,112,99,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  confirmTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
    marginBottom: 6,
    textAlign: 'center',
  },
  confirmSubtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#8C8580',
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 18,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  confirmCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    alignItems: 'center',
  },
  confirmCancelText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    fontWeight: '500',
    color: '#3D3330',
  },
  confirmDestructive: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#C0392B',
    alignItems: 'center',
  },
  confirmDestructiveText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  toast: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: '#1A1210',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  toastText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#FFFFFF',
  },
});
