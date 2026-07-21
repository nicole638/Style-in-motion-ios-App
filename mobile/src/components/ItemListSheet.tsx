import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  Linking,
  Dimensions,
  StyleSheet,
  Share,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image as RNImage,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { decodeHtmlEntities } from '@/lib/decode-entities';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { savePhotosToAlbum, buildShareText, buildLookShareUrl } from '@/lib/utils/shareLook';
import { savePhotoToLibrary } from '@/lib/utils/savePhotoToLibrary';
import { shareToTikTok } from '@/lib/utils/shareToTikTok';
import { TikTokPostShareNudge } from '@/components/TikTokPostShareNudge';
import FollowPromptSheet from '@/components/FollowPromptSheet';
import SignUpNudgeSheet from '@/components/SignUpNudgeSheet';
import PillButton from '@/components/PillButton';
import * as MediaLibrary from 'expo-media-library';
import { ShareActionsBlock } from '@/components/ShareActionsBlock';
import useLookStore, { Look, ClothingItem } from '@/lib/state/lookStore';
import useProfileStore from '@/lib/state/profileStore';
import { CLICK_SOURCE } from '@/lib/analytics/source';
import useAuthStore from '@/lib/state/authStore';
import useFollowStore from '@/lib/state/followStore';
import useLikeStore from '@/lib/state/likeStore';
import useCommentStore from '@/lib/state/commentStore';
import useSavedItemsStore from '@/lib/state/savedItemsStore';
import useSavedLooksStore from '@/lib/state/savedLooksStore';
import useAnalyticsStore from '@/lib/state/analyticsStore';
import { logClickEvent } from '@/lib/analytics/clickEvents';
import { openShopLink } from '@/lib/analytics/openShopLink';
import { isShoppable, NOT_SHOPPABLE_LABEL } from '@/lib/shoppable';
import { useBrandIdentity } from '@/lib/queries/storefront';
import { supabase } from '@/lib/supabase';
import { Bookmark, Sparkles, UserPlus, UserCheck, Heart } from 'lucide-react-native';
import { router } from 'expo-router';
import { FEATURE_FLAGS } from '@/lib/feature-flags';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ItemListSheetProps {
  look: Look | null;
  onClose: () => void;
  onEditLook?: () => void;
  testIDPrefix?: string;
}

export function ItemListSheet({
  look,
  onClose,
  onEditLook,
  testIDPrefix = 'item-list-sheet',
}: ItemListSheetProps) {
  const incrementClicks = useLookStore((s) => s.incrementClicks);
  const profiles = useProfileStore((s) => s.profiles);
  const lookCreatorId = look?.creatorId ?? null;

  const publicUser = useAuthStore((s) => s.publicUser);
  const userType = useAuthStore((s) => s.userType);
  const publicUserId = useAuthStore((s) => s.creatorId ?? s.publicUser?.email ?? null);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  // Guest (deep-link look viewer) sign-up nudge — shared by the Follow and
  // Save-item actions. nudgeContext tailors the headline to whichever fired.
  const [showSignUpNudge, setShowSignUpNudge] = useState(false);
  const [nudgeContext, setNudgeContext] = useState<string>('to follow creators');

  // Lazy-fetch the creator's profile if it's not already in the store. Without
  // this the byline fell back to a hardcoded "Creator" string for any look
  // opened via deep-link (search, share, push notification) because the
  // profile cache is keyed per session and won't have been warmed.
  useEffect(() => {
    if (!lookCreatorId) return;
    if (profiles[lookCreatorId]) return;
    useProfileStore.getState().fetchProfile(lookCreatorId).catch(() => {});
  }, [lookCreatorId, profiles]);

  // Brand-aware identity: when the look's creator is an account_type='partner_brand'
  // row (e.g. Golden Bear Garage), this resolves to the brand mark + name + slug
  // and the byline switches to "by Golden Bear Garage" with the brand logo.
  // Returns null for normal creators, who fall through to the @username byline.
  const { identity: brandIdentity } = useBrandIdentity(lookCreatorId ?? undefined);
  const isBrand = brandIdentity?.isPartnerBrand === true;

  const creatorProfile = lookCreatorId ? profiles[lookCreatorId] : undefined;
  const displayName = isBrand
    ? (brandIdentity?.brandName ?? 'Brand')
    : creatorProfile?.firstName
      ? `${creatorProfile.firstName}${creatorProfile.lastName ? ' ' + creatorProfile.lastName : ''}`
      : creatorProfile?.username
        ? `@${creatorProfile.username}`
        : 'Creator';
  const displayPhoto = isBrand
    ? (brandIdentity?.brandLogoUrl ?? null)
    : (creatorProfile?.photoUri ?? null);
  const displayInitial = (displayName.replace(/^@/, '')[0] ?? 'C').toUpperCase();

  // Follow store + state (DB-backed 2026-06-09). Disabled for brand profiles
  // (brands use /storefront/<slug> as their "follow" affordance) and for the
  // creator viewing their own look.
  const toggleFollow = useFollowStore((s) => s.toggleFollow);
  const followedIds = useFollowStore((s) => s.followedIds);
  const isFollowing = lookCreatorId ? followedIds.includes(lookCreatorId) : false;
  // Cross-social follow prompt — same sheet the creator profile shows. Fires
  // on a fresh follow from the byline so shoppers get nudged to follow the
  // creator on IG/TikTok/Pinterest too (Phase 6 of the follow system).
  const [followPromptCreatorId, setFollowPromptCreatorId] = useState<string | null>(null);

  // Like-the-look state + handler. Heart pill in the sheet header lets
  // shoppers express look-level interest (separate signal from item clicks
  // and from follows). Uses existing useLikeStore — same store the feed
  // card heart, look/[id] heart, and saved tab read from.
  const toggleLike = useLikeStore((s) => s.toggleLike);
  const likedLookIds = useLikeStore((s) => s.likedLookIds);
  const lookLikeCount = useLikeStore((s) =>
    look ? (s.likeCounts[look.id] ?? look.likesCount ?? 0) : 0,
  );
  const isLiked = look ? likedLookIds.includes(look.id) : false;
  const handleLikePress = useCallback(() => {
    if (!look) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    toggleLike(look.id);
  }, [look, toggleLike]);

  // Save-the-whole-look state + handler. DB-backed via savedLooksStore — the
  // look-level parallel to the per-item bookmark, and distinct from the like
  // heart above (a public count). This is the private collection entry that
  // drives Saved → Looks. Subscribing to the array keeps the bookmark fill
  // reactive. We carry a denormalized byline snapshot so Saved → Looks renders
  // without depending on lookStore.looks (which only holds the creator's OWN
  // looks — the reason shopper-saved looks used to vanish from Saved).
  const toggleSaveLook = useSavedLooksStore((s) => s.toggleSaveLook);
  const savedLooksList = useSavedLooksStore((s) => s.savedLooks);
  const isThisLookSaved = useMemo(
    () => (look ? savedLooksList.some((l) => l.id === look.id) : false),
    [savedLooksList, look],
  );
  const handleSaveLook = useCallback(() => {
    if (!look) return;
    // Guest → nudge to sign up instead of a silent no-op.
    if (!isLoggedIn) {
      setNudgeContext('to save looks');
      setShowSignUpNudge(true);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const willSave = !isThisLookSaved;
    void toggleSaveLook({
      lookId: look.id,
      creatorId: look.creatorId ?? null,
      title: look.title ?? null,
      coverPhotoUri: look.photoUri ?? null,
      itemCount: look.items?.length ?? 0,
      creatorName: displayName,
      creatorPhotoUrl: displayPhoto,
      isBrand,
      brandName: brandIdentity?.brandName ?? null,
      brandSlug: brandIdentity?.brandSlug ?? null,
      brandLogoUrl: brandIdentity?.brandLogoUrl ?? null,
    });
    // Keep the public like count in step with the save state (saved == liked),
    // but don't double-toggle when they're already aligned.
    if (willSave !== isLiked) toggleLike(look.id);
  }, [look, isLoggedIn, isThisLookSaved, isLiked, toggleSaveLook, toggleLike, displayName, displayPhoto, isBrand, brandIdentity]);

  // The currently-signed-in creator's id (null when the viewer is a
  // signed-in shopper / audience user). Used below to gate the creator
  // share-actions block so we only ever show "share to story / TikTok"
  // for looks the current creator actually owns. Without this gate a
  // creator opening a deep-link to another creator's look (e.g. via an
  // IG link-in-bio) would see the share UI as if it were their own.
  const currentCreatorId = useAuthStore((s) => s.creatorId);
  const isOwnLook = userType === 'creator' && !!look?.creatorId && look.creatorId === currentCreatorId;

  // DB-backed view tracking. Fires once per (sheet open × look) so opening
  // the same look twice in the same session bumps views twice (matches the
  // click-events pattern — every interaction counts). RPC is SECURITY
  // DEFINER so anon shoppers can call it without RLS on looks letting them
  // write. Skip when the viewer IS the creator of this look — would
  // otherwise let any creator inflate their own stats just by re-opening
  // their own sheet.
  useEffect(() => {
    if (!look?.id) return;
    if (isOwnLook) return;
    supabase
      .rpc('increment_look_views', { p_look_id: look.id })
      .then(({ error }) => {
        if (error) console.warn('[ItemListSheet] increment_look_views error:', error.message);
      });
  }, [look?.id, isOwnLook]);
  const addComment = useCommentStore((s) => s.addComment);
  const allComments = useCommentStore((s) => s.comments);
  const deleteComment = useCommentStore((s) => s.deleteComment);

  const comments = look ? (allComments[look.id] ?? []) : [];
  const [commentText, setCommentText] = useState<string>('');
  const [storyShareMessage, setStoryShareMessage] = useState<string | null>(null);
  const [savedPhotosCount, setSavedPhotosCount] = useState<number | null>(null);
  const [tikTokNudgeUrl, setTikTokNudgeUrl] = useState<string | null>(null);
  const [coverAspect, setCoverAspect] = useState<number | null>(null);
  const commentInputRef = useRef<TextInput>(null);

  // Reset cover aspect when look identity changes so a stale aspect from
  // a previous look can't bleed into the current one. Then probe the real
  // dimensions via Image.getSize — expo-image's onLoad event has been
  // dropping width on iOS, so we can't rely on it alone.
  useEffect(() => {
    setCoverAspect(null);
    console.log('[ItemListSheet] mount/look-change', { lookId: look?.id, hasCollageLayout: !!look?.collageLayout });
    const uri = look?.photoUri;
    let cancelled = false;
    if (uri) {
      RNImage.getSize(
        uri,
        (w, h) => {
          if (cancelled) return;
          console.log('[ItemListSheet] getSize ok', { lookId: look?.id, w, h });
          if (w > 0 && h > 0) setCoverAspect(w / h);
        },
        (err) => {
          console.warn('[ItemListSheet] getSize fail', { lookId: look?.id, err: String(err) });
        }
      );
    }
    return () => {
      cancelled = true;
      console.log('[ItemListSheet] unmount/look-change-cleanup', { lookId: look?.id });
    };
  }, [look?.id, look?.photoUri]);

  const toggleSaveItem = useSavedItemsStore((s) => s.toggleSaveItem);
  // Subscribe to the saved list itself (not just the action) so the bookmark
  // icon re-renders the moment a save toggles. Deriving a Set keeps the
  // per-item lookup in the render O(1).
  const savedItems = useSavedItemsStore((s) => s.savedItems);
  const savedIdSet = useMemo(() => new Set(savedItems.map((it) => it.id)), [savedItems]);

  // Swipe-to-dismiss gesture
  const translateY = useSharedValue(0);
  const dismissSheet = useCallback(() => { onClose(); }, [onClose]);
  // v3 2026-06-08: require 15px of movement before the pan claims the
  // gesture. Without this minDistance, the GestureDetector intercepts
  // every touch on the sheet header and the byline / Share / Heart
  // Pressables can't fire. With it, short taps (under 15px) fall through
  // to the inner Pressables; only intentional drags become a pan.
  const panGesture = Gesture.Pan()
    .minDistance(15)
    .onUpdate((e) => {
      if (e.translationY > 0) {
        translateY.value = e.translationY;
      }
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

  const handleShop = useCallback(
    async (item: ClothingItem, index: number) => {
      if (!look) return;
      // Linkless piece (vintage/personal) — no /api/shop call, no analytics.
      // The row isn't pressable for these, but guard anyway.
      if (!isShoppable(item)) return;
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      incrementClicks(look.id);
      useAnalyticsStore.getState().trackItemClick(look.id, look.creatorId ?? '', item.name, index);

      const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
      const useEf = !!(baseUrl && item.lookItemId && look.id);
      const shopUrl = useEf
        ? `${baseUrl}/api/shop?lookId=${encodeURIComponent(look.id)}&itemId=${encodeURIComponent(item.lookItemId!)}&source=${CLICK_SOURCE}`
        : (item.affiliate_url || item.link);
      if (shopUrl && shopUrl !== '#') {
        // /api/shop writes the click row server-side (full 3-tier tag
        // resolution + source='ios' from the query param). Only log
        // directly on the bypass path so we don't double-write.
        if (!useEf) {
          void logClickEvent({
            lookId: look.id,
            itemId: item.lookItemId ?? null,
            creatorId: look.creatorId ?? null,
            itemUrl: item.link,
            redirectUrl: shopUrl,
            wasAffiliated: !!item.affiliate_url,
            affiliateNetwork: null,
          });
        }
        await WebBrowser.openBrowserAsync(shopUrl, {
          toolbarColor: '#B87063',
          controlsColor: '#FFFFFF',
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC,
          dismissButtonStyle: 'done',
        });
      }
    },
    [look, incrementClicks]
  );

  const handleShareLook = useCallback(async () => {
    if (!look) return;
    const itemsText = look.items.map(item => {
      let line = `${item.emoji} ${item.name}`;
      if (item.price) line += ` — $${item.price}`;
      if (item.brand) line += ` (${item.brand})`;
      if (item.primaryNote) line += ` (${item.primaryNote})`;
      if (item.link) line += `\n${item.link}`;
      for (const alt of (item.alternates ?? [])) {
        if (!alt?.link) continue;
        let altLine = alt.label ? `  ↳ ${alt.label}: ` : '  ↳ ';
        altLine += alt.name || 'Alternative';
        if (alt.price) altLine += ` — $${alt.price}`;
        if (alt.brand) altLine += ` (${alt.brand})`;
        altLine += `\n     ${alt.link}`;
        line += `\n${altLine}`;
      }
      return line;
    }).join('\n\n');
    const hashtagsText = look.hashtags?.map(h => h.startsWith('#') ? h : '#' + h).join(' ') || '';
    const shareText = `${look.caption || ''}\n\n${itemsText}\n\n${hashtagsText}`.trim();
    try { await Share.share({ message: shareText, url: look.photoUri }); } catch (e) { console.error(e); }
  }, [look]);

  const handleShareToStory = useCallback(async () => {
    if (!look) return;
    const shareUrl = `https://app.styledinmotion.app/look/${look.id}`;

    // 1. Copy URL (not caption) to clipboard
    try {
      await Clipboard.setStringAsync(shareUrl);
    } catch (error) {
      console.warn('Clipboard copy failed:', error);
    }

    // 2. Save only the cover photo
    let photoSaved = true;
    try {
      await savePhotosToAlbum({ coverPhotoUri: look.photoUri, items: [] });
    } catch (error) {
      console.warn('Cover photo save failed:', error);
      photoSaved = false;
    }

    // 3. Inline confirmation banner
    setStoryShareMessage(
      photoSaved
        ? 'Link copied! In Instagram: tap + \u2192 Story \u2192 pick this look\'s cover photo \u2192 add a Link sticker \u2192 paste.'
        : 'Link copied, but we couldn\'t save the cover photo. You can still open Instagram and share manually.'
    );
    setTimeout(() => setStoryShareMessage(null), 5000);

    // 4. Open Instagram — swallow errors per Rule 90
    Linking.openURL('instagram://app').catch(() => {
      setStoryShareMessage(
        'Instagram not installed. Cover photo saved to your Photos app, link copied \u2014 share manually.'
      );
      setTimeout(() => setStoryShareMessage(null), 5000);
    });
  }, [look]);

  const handleSaveAllPhotos = useCallback(async () => {
    if (!look) return;
    const { status } = await MediaLibrary.requestPermissionsAsync(true);
    if (status !== 'granted') {
      Alert.alert(
        'Photos Access Needed',
        'Enable Photos access in Settings \u203A Styled in Motion to save photos.',
        [{ text: 'OK' }]
      );
      return;
    }
    try {
      let count = 0;
      if (look.photoUri) {
        if (await savePhotoToLibrary(look.photoUri)) count++;
      }
      for (const item of look.items) {
        if (item.photoUri) {
          if (await savePhotoToLibrary(item.photoUri)) count++;
        }
      }
      setSavedPhotosCount(count);
    } catch (e: any) {
      Alert.alert('Couldn\u2019t save photos', e?.message ?? 'An unexpected error occurred.');
    }
  }, [look]);

  const handleShareInstagram = useCallback(async () => {
    if (!look) return;
    const shareText = buildShareText({
      caption: look.caption || '',
      items: look.items,
      hashtags: look.hashtags,
    });
    await Clipboard.setStringAsync(shareText);
    let photoCount = 0;
    try {
      photoCount = await savePhotosToAlbum({ coverPhotoUri: look.photoUri, items: look.items });
    } catch {}
    Linking.openURL('instagram://app').catch(() => {});
  }, [look]);

  const handleShareTikTok = useCallback(async () => {
    if (!look) return;
    if (!look.photoUri) {
      Alert.alert('Add a cover photo first', 'TikTok needs a cover image to share.');
      return;
    }
    const outcome = await shareToTikTok({
      id: look.id,
      title: look.title || look.caption || 'New look',
      caption: look.caption,
      shortCode: look.shortCode ?? null,
      hashtags: look.hashtags,
      photoUri: look.photoUri,
    });

    if (outcome.stage === 'shared' || outcome.stage === 'cancelled') {
      setTikTokNudgeUrl(outcome.clipboardUrl);
    } else if (outcome.stage === 'sdk-unavailable') {
      Linking.openURL('tiktok://').catch(() => {});
    } else if (outcome.stage === 'missing-photo') {
      Alert.alert('Add a cover photo first', 'TikTok needs a cover image to share.');
    } else if (outcome.stage === 'error') {
      console.warn('[handleShareTikTok] error:', outcome.message);
      Alert.alert('TikTok share failed', outcome.message || 'Please try again.');
    }
  }, [look]);

  const handlePostComment = useCallback(() => {
    if (!look || !commentText.trim()) return;
    const authorName = publicUser?.name || 'Guest';
    const authorEmail = publicUser?.email || 'guest';
    addComment(look.id, authorName, authorEmail, commentText.trim());
    setCommentText('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [look, commentText, publicUser, addComment]);

  // #66 fix: don't unmount the Modal mid-slide-out. iOS RN Modal leaves a
  // stale touch overlay if the component unmounts before the dismiss animation
  // finishes — re-tapping the same look afterward did nothing because the ghost
  // overlay was eating the press. Keep the last non-null look around so we can
  // continue rendering content during the slide-out, and let the Modal's
  // `visible` prop drive the animation lifecycle properly.
  const lastLookRef = useRef<Look | null>(null);
  if (look) lastLookRef.current = look;
  const renderLook = look ?? lastLookRef.current;

  if (!renderLook) return null;

  return (
    <>
    <Modal
      visible={!!look}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID={testIDPrefix}
    >
      {look ? (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.backdrop}>
          <Pressable style={styles.backdropTouch} onPress={onClose} />
          <Animated.View style={[styles.sheet, sheetAnimatedStyle]}>
            {/* v2 2026-06-08: widened the swipe-down hit zone from just
                the dragHandle (a tiny ~6px bar) to the entire sheet header
                area — title row + byline + Share/Heart. The original tiny
                handle was nearly impossible to grab; users were forced to
                scroll the items list all the way to the bottom and try
                to close from there. The header doesn't need its own
                tap-to-dismiss behavior, so wrapping it in the gesture
                detector is safe. */}
            <GestureDetector gesture={panGesture}>
              <Animated.View>
                <View style={styles.dragHandle} />
                <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetTitle}>Shop This Look</Text>
                  {/* Byline row — "by [avatar] Display Name [Follow]" all on
                      ONE line. v3 2026-06-08: "by" was previously inside the
                      tappable Pressable and got pushed to its own line on
                      certain widths (Nicole observed Kerri Daly stacking
                      below 'by'). Pulled outside the Pressable + made the
                      bylineHit a tight flex-row that wraps only the avatar
                      and name so the inline layout is bulletproof. */}
                  {lookCreatorId ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 }}>
                      <Text style={styles.bylineByText}>by</Text>
                      <Pressable
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          flexShrink: 1,
                        }}
                        onPress={() => {
                          // Close the sheet BEFORE navigating. The sheet is a
                          // Modal — without onClose() it stays mounted on top
                          // of whatever route we push to, so the destination
                          // (creator-profile / storefront) renders hidden
                          // underneath. Nicole reported this as the
                          // "sheet covers the creator profile" bug in the
                          // 06-08 21:17 test video.
                          onClose();
                          // Tiny defer so the sheet's exit animation gets a
                          // frame before the navigation transition kicks in —
                          // smoother than collapsing both into the same tick.
                          requestAnimationFrame(() => {
                            if (isBrand && brandIdentity?.brandSlug) {
                              router.push(`/storefront/${brandIdentity.brandSlug}` as any);
                            } else {
                              router.push({
                                pathname: '/creator-profile' as any,
                                params: { creatorId: lookCreatorId },
                              });
                            }
                          });
                        }}
                        hitSlop={4}
                        testID={`${testIDPrefix}-byline`}
                      >
                        {displayPhoto ? (
                          <Image
                            source={{ uri: displayPhoto }}
                            style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#F0EBE5' }}
                            contentFit="cover"
                          />
                        ) : (
                          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#F0EBE5', alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={styles.bylineAvatarInitial}>{displayInitial}</Text>
                          </View>
                        )}
                        <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#1A1210', flexShrink: 1 }} numberOfLines={1}>
                          {displayName}
                        </Text>
                      </Pressable>
                      {/* Follow button — shopper-only, never for brand profiles
                          (use the storefront tab instead), never on own look. */}
                      {!isOwnLook && !isBrand ? (
                        <Pressable
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 4,
                            paddingHorizontal: 10,
                            paddingVertical: 4,
                            borderRadius: 999,
                            backgroundColor: isFollowing ? '#FFFFFF' : '#1A1210',
                            borderWidth: isFollowing ? 1 : 0,
                            borderColor: '#E8E0D8',
                          }}
                          onPress={async () => {
                            if (!lookCreatorId) return;
                            // Guest → nudge to sign up instead of no-op.
                            if (!isLoggedIn) {
                              setNudgeContext(
                                displayName && displayName !== 'Creator'
                                  ? `to follow ${displayName}`
                                  : 'to follow creators',
                              );
                              setShowSignUpNudge(true);
                              return;
                            }
                            Haptics.selectionAsync().catch(() => {});
                            const nowFollowing = await toggleFollow(lookCreatorId);
                            // Fresh follow → surface the cross-social prompt.
                            if (nowFollowing) setFollowPromptCreatorId(lookCreatorId);
                          }}
                          hitSlop={6}
                          testID={`${testIDPrefix}-follow`}
                        >
                          {isFollowing ? (
                            <UserCheck size={12} color="#1A1210" strokeWidth={2} />
                          ) : (
                            <UserPlus size={12} color="#FFFFFF" strokeWidth={2} />
                          )}
                          <Text
                            style={{
                              fontFamily: 'DMSans_500Medium',
                              fontSize: 11,
                              color: isFollowing ? '#1A1210' : '#FFFFFF',
                            }}
                          >
                            {isFollowing ? 'Following' : 'Follow'}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
                {/* Header actions: Share only. The look's Save control lives in
                    the scrollable body below (the "Save this look" bar under the
                    cover) — NOT here. This whole header sits inside the
                    swipe-to-dismiss GestureDetector, which on iOS intercepts taps
                    on small header buttons (the heart/save here registered no
                    taps in testing while the body's item bookmarks worked fine).
                    Moving Save to the body makes it reliable AND declutters. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <Pressable
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                    onPress={handleShareLook}
                    testID={`${testIDPrefix}-share`}
                  >
                    <Text style={styles.shareLabelText}>Share</Text>
                  </Pressable>
                  {onEditLook ? (
                    <Pressable
                      style={styles.editButton}
                      onPress={onEditLook}
                      testID={`${testIDPrefix}-edit`}
                    >
                      <Text style={styles.editButtonText}>Edit Look</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
              </Animated.View>
            </GestureDetector>

            <ScrollView
              style={styles.itemsList}
              contentContainerStyle={styles.itemsContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Image
                key={look.id}
                source={{ uri: look.photoUri }}
                style={[styles.sheetPhoto, coverAspect ? { aspectRatio: coverAspect } : null]}
                contentFit="contain"
                onLoad={(e) => {
                  const w = e?.source?.width;
                  const h = e?.source?.height;
                  console.log('[ItemListSheet] cover onLoad', {
                    lookId: look.id,
                    width: w,
                    height: h,
                    photoUri: look.photoUri,
                  });
                  if (w && h && w > 0 && h > 0) {
                    setCoverAspect(w / h);
                  }
                }}
              />

              {/* Save this look — the primary look-level save. Lives here in the
                  scroll body (a reliable tap zone) rather than the gesture-
                  wrapped header. A compact pill on the RIGHT, heart inline with
                  the label (Nicole's polish note). Uses PillButton because in
                  this build a <Pressable> styled with StyleSheet renders
                  unstyled (the documented "invisible button" bug — which is
                  exactly why this looked stacked/left-aligned). Heart matches
                  the Saved tab. Hidden on your own look (share tools show
                  instead). Writes saved_looks and keeps the public like in
                  sync. */}
              {!isOwnLook ? (
                <View className="flex-row justify-end mt-3">
                  <PillButton
                    label={isThisLookSaved ? 'Saved to your looks' : 'Save this look'}
                    onPress={handleSaveLook}
                    variant={isThisLookSaved ? 'primary' : 'outline'}
                    size="sm"
                    haptic={false}
                    testID={`${testIDPrefix}-save-look`}
                    icon={
                      <Heart
                        size={16}
                        color={isThisLookSaved ? '#FFFFFF' : '#B87063'}
                        fill={isThisLookSaved ? '#FFFFFF' : 'transparent'}
                        strokeWidth={2}
                      />
                    }
                  />
                </View>
              ) : null}

              {isOwnLook ? (
                <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
                  <ShareActionsBlock
                    onShareLook={handleShareLook}
                    onSaveAllPhotos={handleSaveAllPhotos}
                    onShareToStory={handleShareToStory}
                    onShareInstagram={handleShareInstagram}
                    onShareTikTok={handleShareTikTok}
                    pinToPinterest={{
                      lookId: look.id,
                      hasCoverPhoto: !!look.photoUri,
                      coverPhotoUrl: look.photoUri,
                      caption: look.caption,
                      title: look.title,
                      hashtags: look.hashtags,
                    }}
                    savedPhotosCount={savedPhotosCount}
                    storyShareMessage={storyShareMessage}
                    testIDPrefix={`${testIDPrefix}-actions`}
                    variant="list"
                  />
                </View>
              ) : null}

              {FEATURE_FLAGS.vtoShopperButton && (userType === 'audience' || userType === 'creator') && look?.photoUri ? (
                <View className="px-4 mt-3">
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      // Close this sheet first so we never stack two RN Modals
                      // on top of the feed. Stacked modals leave an orphan
                      // touch layer on iOS when the upper one dismisses,
                      // which is what was freezing feed scroll after a try-on.
                      const garmentUrl = look.photoUri;
                      const lookIdParam = look.id;
                      onClose();
                      // Defer the next modal a tick so the dismiss animation
                      // completes before we push.
                      setTimeout(() => {
                        router.push({
                          pathname: '/try-on-flow',
                          params: { garment_url: garmentUrl, look_id: lookIdParam },
                        } as any);
                      }, 350);
                    }}
                    className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
                    style={{ shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}
                    testID={`${testIDPrefix}-try-on`}
                  >
                    <Sparkles size={18} color="#FFFFFF" strokeWidth={2} />
                    <Text className="ml-2 text-white text-[15px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>Try It On</Text>
                  </Pressable>
                </View>
              ) : null}

              {look.items.filter(i => !i.archived).map((item, itemIndex) => {
                const hasLink = isShoppable(item);
                const alternates = (item.alternates ?? []).filter(a => a?.link && a.link.trim());
                const hasAlternate = alternates.length > 0;
                const rowContent = (
                  <View style={hasLink ? styles.itemRow : [styles.itemRow, styles.itemRowUnshoppable]}>
                    {item.photoUri ? (
                      <Image
                        source={{ uri: item.photoUri }}
                        style={styles.itemThumb}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={styles.itemEmojiPlaceholder}>
                        <Text style={{ fontSize: 22 }}>{item.emoji}</Text>
                      </View>
                    )}
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemName} numberOfLines={1}>
                        {decodeHtmlEntities(item.name)}
                      </Text>
                      {item.brand ? (
                        <Text style={styles.itemBrand}>{decodeHtmlEntities(item.brand)}</Text>
                      ) : null}
                      {item.price ? (
                        <Text style={styles.itemPrice}>${item.price}</Text>
                      ) : null}
                      {item.wornSize ? (
                        <Text style={styles.itemWornSize}>Size: {item.wornSize}</Text>
                      ) : null}
                      {hasAlternate && item.primaryNote ? (
                        <Text style={styles.primaryNoteText}>{item.primaryNote}</Text>
                      ) : null}
                    </View>
                    <Pressable
                      onPress={() => {
                        // Guest → nudge to sign up instead of a silent no-op.
                        if (!isLoggedIn) {
                          setNudgeContext('to save items');
                          setShowSignUpNudge(true);
                          return;
                        }
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                        void toggleSaveItem(item, look.id, look.photoUri, look.creatorId ?? null);
                      }}
                      hitSlop={6}
                      testID={`${testIDPrefix}-save-${item.id}`}
                      style={{ padding: 4, marginLeft: 8 }}
                    >
                      <Bookmark
                        size={18}
                        color={savedIdSet.has(item.id) ? '#B87063' : '#8C8580'}
                        fill={savedIdSet.has(item.id) ? '#B87063' : 'none'}
                      />
                    </Pressable>
                    {hasLink ? (
                      <Text style={styles.shopLabel}>Shop →</Text>
                    ) : (
                      <Text style={styles.soonLabel}>{NOT_SHOPPABLE_LABEL}</Text>
                    )}
                  </View>
                );
                return (
                  <View key={item.id}>
                    {hasLink ? (
                      <Pressable
                        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                        onPress={() => handleShop(item, itemIndex)}
                        testID={`${testIDPrefix}-shop-${item.id}`}
                      >
                        {rowContent}
                      </Pressable>
                    ) : (
                      <View testID={`${testIDPrefix}-not-shoppable-${item.id}`}>{rowContent}</View>
                    )}
                    {alternates.map((alt, altIdx) => (
                      <Pressable
                        key={`${item.id}-alt-${altIdx}`}
                        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                        onPress={() => {
                          if (look) {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            incrementClicks(look.id);
                          }
                          // Alternate link → route through /api/shop with the raw
                          // url plus look/item context for attribution.
                          void openShopLink({
                            url: alt.link,
                            lookId: look?.id ?? undefined,
                            itemId: item.lookItemId ?? undefined,
                            creatorId: look?.creatorId ?? undefined,
                          });
                        }}
                        testID={`${testIDPrefix}-alt-${item.id}-${altIdx}`}
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
                            <Text style={styles.shopLabel}>Shop →</Text>
                          </View>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                );
              })}

              <View
                style={styles.disclosureBanner}
                testID={`${testIDPrefix}-affiliate-disclosure`}
              >
                <Text style={styles.disclosureText}>
                  This page may contain affiliate links. As an Amazon Associate, {isBrand ? displayName : displayName.replace(/^@/, '')} earns from qualifying purchases.
                </Text>
              </View>

              {/* Comments section */}
              <View style={styles.commentsSection} testID={`${testIDPrefix}-comments`}>
                <Text style={styles.commentsSectionTitle}>
                  Comments{comments.length > 0 ? ` (${comments.length})` : null}
                </Text>
                {comments.length === 0 ? (
                  <Text style={styles.noCommentsText}>No comments yet. Be the first!</Text>
                ) : (
                  comments.map((c) => (
                    <View key={c.id} style={styles.commentRow}>
                      <View style={styles.commentAvatar}>
                        <Text style={styles.commentAvatarText}>
                          {(c.authorName || 'G').slice(0, 1).toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.commentContent}>
                        <Text style={styles.commentAuthor}>{c.authorName || 'Guest'}</Text>
                        <Text style={styles.commentText}>{c.text}</Text>
                        <Text style={styles.commentTime}>
                          {new Date(c.createdAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </Text>
                      </View>
                      {publicUser?.email === c.authorEmail ? (
                        <Pressable
                          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}
                          onPress={() => deleteComment(look.id, c.id)}
                          testID={`${testIDPrefix}-delete-comment-${c.id}`}
                        >
                          <Text style={styles.commentDelete}>✕</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))
                )}
              </View>
            </ScrollView>

            {/* Comment input bar */}
            <View style={styles.commentInputBar}>
              <TextInput
                ref={commentInputRef}
                style={styles.commentInput}
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Add a comment..."
                placeholderTextColor="#8C8580"
                cursorColor="#1A1210"
                selectionColor="rgba(26,18,16,0.3)"
                returnKeyType="send"
                onSubmitEditing={handlePostComment}
                testID={`${testIDPrefix}-comment-input`}
              />
              <Pressable
                style={({ pressed }) => [
                  styles.commentSendBtn,
                  !commentText.trim() && { opacity: 0.4 },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={handlePostComment}
                disabled={!commentText.trim()}
                testID={`${testIDPrefix}-comment-send`}
              >
                <Text style={styles.commentSendText}>Post</Text>
              </Pressable>
            </View>

            <Pressable
              style={styles.closeButton}
              onPress={onClose}
              testID={`${testIDPrefix}-close`}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
      ) : null}
    </Modal>
    <TikTokPostShareNudge
      visible={tikTokNudgeUrl !== null}
      shopUrl={tikTokNudgeUrl}
      onDismiss={() => setTikTokNudgeUrl(null)}
    />
    {/* Cross-social follow prompt — fires on a fresh follow from the byline. */}
    {followPromptCreatorId ? (
      <FollowPromptSheet
        visible={followPromptCreatorId !== null}
        creatorId={followPromptCreatorId}
        onDismiss={() => setFollowPromptCreatorId(null)}
      />
    ) : null}
    {/* Guest sign-up nudge — fires when a not-signed-in viewer taps Follow or
        Save. nudgeContext tailors the headline to whichever action fired. */}
    <SignUpNudgeSheet
      visible={showSignUpNudge}
      onDismiss={() => setShowSignUpNudge(false)}
      context={nudgeContext}
    />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: SCREEN_HEIGHT * 0.92,
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
  sheetHeader: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8E0D8',
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sheetTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
  },
  sheetSubtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    marginTop: 2,
  },
  // ─── Byline row (creator / brand mark + Follow) ────────────────────────
  bylineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  bylineHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  bylineByText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
  },
  bylineAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#F0EBE5',
  },
  bylineAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  bylineAvatarInitial: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    color: '#6B5E58',
  },
  bylineName: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
    flexShrink: 1,
  },
  bylineFollow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#1A1210',
  },
  bylineFollowActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  bylineFollowText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#FFFFFF',
  },
  bylineFollowTextActive: { color: '#1A1210' },
  // Heart pill next to Share in the sheet header. v2 (2026-06-08):
  // bumped icon size 16→20, swapped subtle-ink for rose accent, gave
  // active state a rose fill so it reads as a clear toggle. Width grows
  // with the count so the pill stays balanced at 0/1/10/100 likes.
  likePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#B87063',
    backgroundColor: '#FBF4EE',
  },
  likePillActive: {
    backgroundColor: '#B87063',
    borderColor: '#B87063',
  },
  likePillCount: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 13,
    color: '#B87063',
    minWidth: 12,
    textAlign: 'center',
  },
  likePillCountActive: {
    color: '#FFFFFF',
  },
  // Save-look pill — same rose language as the like heart, but a bookmark +
  // "Save"/"Saved" label so it reads unmistakably as "save the whole look"
  // (matching the per-item bookmark control).
  savePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#B87063',
    backgroundColor: '#FBF4EE',
  },
  savePillActive: {
    backgroundColor: '#B87063',
    borderColor: '#B87063',
  },
  savePillText: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 13,
    color: '#B87063',
  },
  savePillTextActive: {
    color: '#FFFFFF',
  },
  // (The "Save this look" control is a <PillButton> — styled via NativeWind
  // className, not StyleSheet, because StyleSheet on a Pressable renders
  // unstyled in this build. No StyleSheet block here on purpose.)
  editButton: {
    backgroundColor: '#F0EBE5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  editButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
  },
  shareLabelText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    fontWeight: '600',
    color: '#B87063',
  },
  itemsList: {
    flex: 1,
  },
  itemsContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  sheetPhoto: {
    width: '100%',
    aspectRatio: 4 / 5,
    maxHeight: SCREEN_HEIGHT * 0.6,
    borderRadius: 16,
    backgroundColor: '#F5EFE8',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E8E0D8',
  },
  itemThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  itemEmojiPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#E0D8D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfo: {
    flex: 1,
    marginLeft: 12,
  },
  itemName: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
  },
  itemBrand: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginTop: 1,
  },
  itemPrice: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#B87063',
    marginTop: 2,
  },
  itemWornSize: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#6B5E58',
    marginTop: 2,
  },
  primaryNoteText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#6B5E58',
    marginTop: 2,
    fontStyle: 'italic',
  },
  shopLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    fontWeight: '600',
    color: '#B87063',
    marginLeft: 12,
  },
  soonLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginLeft: 12,
  },
  // Web parity (look page renders linkless cards at opacity-70): visible but
  // clearly de-emphasised — these pieces are styled, not sold.
  itemRowUnshoppable: {
    opacity: 0.7,
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
  // Comments section
  commentsSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 0.5,
    borderTopColor: '#E8E0D8',
  },
  commentsSectionTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    marginBottom: 12,
  },
  noCommentsText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#8C8580',
    textAlign: 'center',
    paddingVertical: 16,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
    gap: 10,
  },
  commentAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#D4C8C2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentAvatarText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#3D3330',
  },
  commentContent: {
    flex: 1,
  },
  commentAuthor: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
  },
  commentText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#3D3330',
    marginTop: 2,
    lineHeight: 18,
  },
  commentTime: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#8C8580',
    marginTop: 4,
  },
  commentDelete: {
    fontSize: 12,
    color: '#8C8580',
  },
  // Comment input bar
  commentInputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 0.5,
    borderTopColor: '#E8E0D8',
    backgroundColor: '#FFFFFF',
    gap: 10,
  },
  commentInput: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
    backgroundColor: '#F0EBE5',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    maxHeight: 80,
  },
  commentSendBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  commentSendText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#B87063',
    fontWeight: '600',
  },
  storyShareBanner: {
    backgroundColor: '#2E7D52',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  storyShareBannerText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  shareStoryButton: {
    width: '100%',
    height: 48,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#B87063',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  shareStoryButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    fontWeight: '600',
    color: '#B87063',
  },
  shareStoryHelper: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    textAlign: 'center',
    marginBottom: 12,
  },
  disclosureBanner: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  disclosureText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 16,
  },
});
