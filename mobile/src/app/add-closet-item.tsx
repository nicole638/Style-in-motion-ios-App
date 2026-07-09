import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { decodeHtmlEntities } from '@/lib/decode-entities';
import * as Clipboard from 'expo-clipboard';
import { X, Link as LinkIcon, ClipboardPaste, Plus, Info, Camera, ImagePlus, Wand2, RefreshCw, Sparkles, ExternalLink, Zap, Check } from 'lucide-react-native';
import { CampaignMatchBanner } from '@/components/CampaignMatchBanner';
import { AwinMatchBanner } from '@/components/AwinMatchBanner';
import { ActiveOfferPanel } from '@/components/ActiveOfferPanel';
import useAwinMerchantsStore from '@/lib/state/awinMerchantsStore';
import { hostFromUrl } from '@/lib/awin/wrap';
import { detectFortressDomain } from '@/lib/awin/fortressDomains';
import { cleanBrandLabel } from '@/lib/awin/cleanProductName';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import useCampaignsStore, { extractAsin } from '@/lib/state/campaignsStore';
import * as ImagePicker from 'expo-image-picker';
import useLookStore, { ClothingItem, ItemCategory, AlternateItem, MAX_ALTERNATES, uploadPhoto } from '@/lib/state/lookStore';
import PhotoEditor from '@/components/PhotoEditor';
import { PhotoCandidatePicker } from '@/components/PhotoCandidatePicker';
import { EarningSuggestionSheet } from '@/components/EarningSuggestionSheet';
import { suggestAffiliateMatches, type AffiliateMatch } from '@/lib/queries/affiliateSuggestions';

function safeName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const brand = host.split('.')[0];
    return brand.charAt(0).toUpperCase() + brand.slice(1) + ' item';
  } catch {
    return 'Item';
  }
}
import useAuthStore from '@/lib/state/authStore';
import { openShopLink } from '@/lib/analytics/openShopLink';
import { fetchProductInfo } from '@/lib/utils/fetchProductInfo';
import { normalizeUrlInput } from '@/lib/utils/normalizeUrlInput';
import { persistPickedPhoto } from '@/lib/utils/persistPickedPhoto';
import BrandSelector from '@/components/BrandSelector';
import PillButton from '@/components/PillButton';
import { removeBackground, pickCutoutMode, pickCutoutPrompt } from '@/lib/utils/removeBackground';
import { CATEGORIES } from '@/lib/constants/categories';

function sizePlaceholderForCategory(category: ItemCategory): string {
  switch (category) {
    case 'Top':
    case 'Outerwear':
      return 'M';
    case 'Pants':
      return '27';
    case 'Dress':
      return 'S';
    case 'Shoes':
      return '8.5';
    default:
      return 'optional';
  }
}

export default function AddClosetItemScreen() {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetHeight = (windowHeight - insets.top) * 0.92;
  const { editItemId, prefillUrl, campaignAsin } = useLocalSearchParams<{ editItemId?: string; prefillUrl?: string; campaignAsin?: string }>();
  const creatorId = useAuthStore((s) => s.creatorId);
  const closetItems = useLookStore((s) => s.closetItems);
  const addStandaloneClosetItem = useLookStore((s) => s.addStandaloneClosetItem);
  const updateItem = useLookStore((s) => s.updateItem);
  const findByAsin = useCampaignsStore((s) => s.findByAsin);
  const campaignsLoaded = useCampaignsStore((s) => s.loaded);
  const awinFindByHost = useAwinMerchantsStore((s) => s.findByHost);
  const awinLoaded = useAwinMerchantsStore((s) => s.loaded);
  const awinFetchActive = useAwinMerchantsStore((s) => s.fetchActive);
  useEffect(() => {
    if (!awinLoaded) void awinFetchActive();
  }, [awinLoaded, awinFetchActive]);

  const editingItem = editItemId ? closetItems.find(i => i.id === editItemId) : null;

  const [url, setUrl] = useState(prefillUrl ?? editingItem?.link ?? '');
  const [name, setName] = useState(editingItem?.name ?? '');
  const [brand, setBrand] = useState(editingItem?.brand ?? '');
  const [price, setPrice] = useState(editingItem?.price ?? '');
  const [category, setCategory] = useState<ItemCategory>(editingItem?.category ?? 'Other');
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(editingItem?.photoUri);
  const [originalPhotoUrl, setOriginalPhotoUrl] = useState<string | undefined>(editingItem?.originalPhotoUri);
  const [photoLoadError, setPhotoLoadError] = useState(false);
  const [candidatePhotoUrls, setCandidatePhotoUrls] = useState<string[]>(editingItem?.candidatePhotoUrls ?? []);
  const [pickingCandidateUrl, setPickingCandidateUrl] = useState<string | null>(null);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [recutting, setRecutting] = useState(false);
  const [recutNotice, setRecutNotice] = useState<string | null>(null);
  const recutNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (recutNoticeTimerRef.current) clearTimeout(recutNoticeTimerRef.current);
    };
  }, []);
  const [showReplaceSheet, setShowReplaceSheet] = useState(false);
  const [replacingPhoto, setReplacingPhoto] = useState(false);
  const [replaceNotice, setReplaceNotice] = useState<string | null>(null);
  const replaceNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showPhotoEditorForReplace, setShowPhotoEditorForReplace] = useState(false);
  // Add-time "You could be earning" suggestion (Surface 1). Populated after a
  // non-monetized manual add resolves a high/medium affiliate match.
  const [earnMatches, setEarnMatches] = useState<AffiliateMatch[]>([]);
  const [earnItemId, setEarnItemId] = useState<string | null>(null);
  const [showEarnSheet, setShowEarnSheet] = useState(false);
  const [replaceEditorUri, setReplaceEditorUri] = useState('');
  useEffect(() => {
    return () => {
      if (replaceNoticeTimerRef.current) clearTimeout(replaceNoticeTimerRef.current);
    };
  }, []);
  const [saving, setSaving] = useState(false);

  const initialAlternateDrafts: AlternateItem[] = (() => {
    const drafts: AlternateItem[] = Array.isArray(editingItem?.alternates)
      ? editingItem!.alternates.slice(0, MAX_ALTERNATES)
      : [];
    if (drafts.length === 0 && editingItem?.alternateLink) {
      drafts.push({
        brand: null,
        category: null,
        label: editingItem.alternateLabel || null,
        link: editingItem.alternateLink,
        name: null,
        photo_url: null,
        price: null,
      });
    }
    return drafts;
  })();
  const [alternateDrafts, setAlternateDrafts] = useState<AlternateItem[]>(initialAlternateDrafts);
  const [fetchingAltIdx, setFetchingAltIdx] = useState<number | null>(null);
  const [altFetchErrors, setAltFetchErrors] = useState<(string | null)[]>(initialAlternateDrafts.map(() => null));
  const [altPhotoSuggestions, setAltPhotoSuggestions] = useState<(string | null)[]>(initialAlternateDrafts.map(() => null));
  const [primaryNote, setPrimaryNote] = useState<string>(editingItem?.primaryNote ?? '');
  const [defaultWornSize, setDefaultWornSize] = useState<string>(editingItem?.defaultWornSize ?? '');

  // Two-stage add flow: 'url' (paste + fetch) → 'review' (editable form).
  // Edit mode bypasses this entirely — the full form is always shown.
  const [addStage, setAddStage] = useState<'url' | 'review'>('url');
  // Clipboard auto-detect (Layer 3): a product URL already on the clipboard
  // when Add Item opens → offer a one-tap add so the creator never pastes.
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);
  const [fetching, setFetching] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [missingFields, setMissingFields] = useState<string[]>([]);

  // Fortress domain detection: some merchants (Dick's, Aritzia, Macy's, Nordstrom,
  // Bloomingdale's, Ulta, Sephora) actively block scraping. Detect at paste-time
  // (debounced 350ms to match AwinMatchBanner) and route creators straight to
  // manual entry so they don't wait for a doomed scrape.
  const [debouncedUrlForFortress, setDebouncedUrlForFortress] = useState<string>('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedUrlForFortress(url), 350);
    return () => clearTimeout(t);
  }, [url]);
  const fortressDomain = React.useMemo(() => {
    const trimmed = (debouncedUrlForFortress ?? '').trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
    return detectFortressDomain(trimmed);
  }, [debouncedUrlForFortress]);

  // Fortress premium-fetch (scrape-fortress Edge Function) state.
  const [fortressFetching, setFortressFetching] = useState<boolean>(false);
  const [fortressLoadingSeconds, setFortressLoadingSeconds] = useState<number>(0);
  const [fortressError, setFortressError] = useState<string | null>(null);
  const [fortressFetched, setFortressFetched] = useState<boolean>(false);
  const fortressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Stale-guard: stores the URL the in-flight fetch was issued for. If `url`
  // changes mid-flight, the resolver compares and bails out.
  const fortressFetchUrlRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (fortressTimerRef.current) clearInterval(fortressTimerRef.current);
    };
  }, []);

  // Campaign auto-fill flow (tap from campaign tile)
  const [campaignResolving, setCampaignResolving] = useState<boolean>(!!campaignAsin);
  const [campaignAutoFillApplied, setCampaignAutoFillApplied] = useState<boolean>(false);
  const [campaignSwapNotice, setCampaignSwapNotice] = useState<string | null>(null);
  const campaignSwapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [openProductTipSeen, setOpenProductTipSeen] = useState<boolean>(true);
  const markOpenProductTipSeen = useCallback(() => {
    setOpenProductTipSeen(true);
    void AsyncStorage.setItem('tip:seen:open-product-page', '1');
  }, []);
  useEffect(() => {
    AsyncStorage.getItem('tip:seen:open-product-page').then((v) => setOpenProductTipSeen(v === '1'));
  }, []);

  useEffect(() => {
    return () => {
      if (campaignSwapTimerRef.current) clearTimeout(campaignSwapTimerRef.current);
    };
  }, []);

  // Campaign-asin flow: resolve product + campaign data on mount, skip URL stage.
  useEffect(() => {
    if (!campaignAsin) return;
    let cancelled = false;
    (async () => {
      setCampaignResolving(true);
      const today = new Date().toISOString().slice(0, 10);
      const { data: campaignRow } = await supabase
        .from('campaigns')
        .select('*')
        .contains('asins', [campaignAsin])
        .lte('start_date', today)
        .gte('end_date', today)
        .is('archived_at', null)
        .order('commission_rate_pct', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;

      let { data: cached } = await supabase
        .from('amazon_product_cache')
        .select('asin,title,image_url,detail_page_url,fetch_status,last_fetched_at')
        .eq('asin', campaignAsin)
        .maybeSingle();

      const needsEnrich = !cached || cached.fetch_status !== 'complete' || !cached.title;
      if (needsEnrich) {
        try {
          await Promise.race([
            supabase.functions.invoke('enrich-amazon-asin', { body: { asins: [campaignAsin] } }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
          ]);
          const { data: refreshed } = await supabase
            .from('amazon_product_cache')
            .select('asin,title,image_url,detail_page_url,fetch_status,last_fetched_at')
            .eq('asin', campaignAsin)
            .maybeSingle();
          if (refreshed) cached = refreshed;
        } catch (e) {
          console.warn('[add] enrich timed out, rendering with what we have', e);
        }
      }

      if (cancelled) return;
      const asinLinksMap = (campaignRow?.asin_links as Record<string, string> | null) ?? {};
      const campaignUrl = asinLinksMap[campaignAsin] ?? `https://www.amazon.com/dp/${campaignAsin}`;

      setName(cached?.title ?? '');
      setBrand((campaignRow?.brand_name as string | null) ?? '');
      setUrl(campaignUrl);
      if (cached?.image_url) {
        setPhotoUrl(cached.image_url);
        setOriginalPhotoUrl(cached.image_url);
        setPhotoLoadError(false);
      }
      setAddStage('review');
      setCampaignAutoFillApplied(!!campaignRow);
      setCampaignResolving(false);
    })();
    return () => { cancelled = true; };
  }, [campaignAsin]);

  // URL paste auto-swap: if the pasted URL's ASIN is in a campaign with a tagged URL, swap silently.
  useEffect(() => {
    if (campaignResolving || editingItem || addStage !== 'url') return;
    if (!url || !/amazon\.com|a\.co|amzn\./i.test(url)) return;
    const asin = extractAsin(url);
    if (!asin || !campaignsLoaded) return;
    const campaign = findByAsin(asin);
    if (!campaign) return;
    const campaignUrl = campaign.asinLinks[asin];
    if (!campaignUrl || campaignUrl === url) return;
    setUrl(campaignUrl);
    const notice = `Swapped to the ${campaign.brandName} campaign URL so commissions attribute.`;
    setCampaignSwapNotice(notice);
    if (campaignSwapTimerRef.current) clearTimeout(campaignSwapTimerRef.current);
    campaignSwapTimerRef.current = setTimeout(() => setCampaignSwapNotice(null), 5000);
  }, [url, addStage, editingItem, campaignResolving, campaignsLoaded, findByAsin]);

  // Fortress-domain flow: no auto-advance. Creators must tap the Premium fetch
  // button explicitly to trigger the scrape-fortress Edge Function. If `url`
  // changes mid-flight, the resolver bails via the fortressFetchUrlRef guard.

  const updateAlternate = useCallback(
    <K extends keyof AlternateItem>(idx: number, field: K, value: AlternateItem[K]) => {
      setAlternateDrafts((prev) =>
        prev.map((alt, i) => (i === idx ? { ...alt, [field]: value } : alt))
      );
    },
    []
  );

  const addAlternateSlot = useCallback(() => {
    setAlternateDrafts((prev) => {
      if (prev.length >= MAX_ALTERNATES) return prev;
      const empty: AlternateItem = {
        brand: null,
        category: null,
        label: null,
        link: '',
        name: null,
        photo_url: null,
        price: null,
      };
      return [...prev, empty];
    });
    setAltFetchErrors((prev) => [...prev, null]);
    setAltPhotoSuggestions((prev) => [...prev, null]);
  }, []);

  const removeAlternateSlot = useCallback((idx: number) => {
    setAlternateDrafts((prev) => prev.filter((_, i) => i !== idx));
    setAltFetchErrors((prev) => prev.filter((_, i) => i !== idx));
    setAltPhotoSuggestions((prev) => prev.filter((_, i) => i !== idx));
    setFetchingAltIdx((cur) => (cur === idx ? null : cur));
  }, []);

  const handleAltLinkChange = useCallback(
    (idx: number, raw: string) => {
      const normalized = normalizeUrlInput(raw);
      const next = normalized && normalized !== raw.trim() ? normalized : raw;
      updateAlternate(idx, 'link', next);
    },
    [updateAlternate]
  );

  const setAltFetchErrorAt = useCallback((idx: number, value: string | null) => {
    setAltFetchErrors((prev) => {
      const next = [...prev];
      while (next.length <= idx) next.push(null);
      next[idx] = value;
      return next;
    });
  }, []);

  const setAltPhotoSuggestionAt = useCallback((idx: number, value: string | null) => {
    setAltPhotoSuggestions((prev) => {
      const next = [...prev];
      while (next.length <= idx) next.push(null);
      next[idx] = value;
      return next;
    });
  }, []);

  const handleAltLinkSubmit = useCallback(async (idx: number) => {
    const draft = alternateDrafts[idx];
    if (!draft) return;
    const link = (draft.link ?? '').trim();
    if (!link) {
      setAltFetchErrorAt(idx, null);
      return;
    }
    if (!link.startsWith('http://') && !link.startsWith('https://')) {
      setAltFetchErrorAt(idx, 'Add a full URL starting with https://');
      return;
    }
    if (fetchingAltIdx !== null) return;

    setFetchingAltIdx(idx);
    setAltFetchErrorAt(idx, null);
    setAltPhotoSuggestionAt(idx, null);

    try {
      const info = await fetchProductInfo(link, creatorId);
      setFetchingAltIdx(null);
      if (info.name && !(draft.name ?? '').trim()) {
        updateAlternate(idx, 'name', decodeHtmlEntities(info.name));
      }
      if (info.price && !(draft.price ?? '').trim()) {
        updateAlternate(idx, 'price', info.price.replace(/^\$/, '').trim());
      }
      if (info.brand && !draft.brand) {
        updateAlternate(idx, 'brand', info.brand);
      }
      if (info.imageUrl && !draft.photo_url) {
        setAltPhotoSuggestionAt(idx, info.imageUrl);
      }
    } catch {
      setFetchingAltIdx(null);
      setAltFetchErrorAt(idx, 'Could not fetch product info');
    }
  }, [alternateDrafts, fetchingAltIdx, creatorId, setAltFetchErrorAt, setAltPhotoSuggestionAt, updateAlternate]);

  const handlePickAltPhoto = useCallback(async (idx: number) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      const stableUri = await persistPickedPhoto(result.assets[0].uri);
      updateAlternate(idx, 'photo_url', stableUri);
    }
  }, [updateAlternate]);

  const handlePickPhoto = useCallback(async () => {
    if (pickingPhoto) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    setPickingPhoto(true);
    try {
      const stableUri = await persistPickedPhoto(result.assets[0].uri);
      setPhotoUrl(stableUri);
      setOriginalPhotoUrl(undefined);
      setPhotoLoadError(false);
    } finally {
      setPickingPhoto(false);
    }
  }, [pickingPhoto]);

  /**
   * Re-cutout: re-runs Photoroom on the existing photo with the now-correct
   * mode (category-aware via pickCutoutMode). Used to fix items whose
   * cached cutout_photo_url was generated before the mode-by-category fix
   * (when everything used 'ghostMannequin' regardless of category, which
   * dropped pants from top+pants model photos and broke compound jewelry).
   *
   * Only enabled when the photo is on Supabase Storage (https URL) — local
   * file:// URIs aren't reachable by the backend.
   */
  const handleRecut = useCallback(async () => {
    if (!editingItem || recutting) return;
    if (!photoUrl || !photoUrl.startsWith('http')) {
      setRecutNotice('Save the item first so we have a hosted photo to work from.');
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    setRecutting(true);
    setRecutNotice(null);
    try {
      const mode = pickCutoutMode(category);
      const prompt = pickCutoutPrompt(category);
      const cutout = await removeBackground(photoUrl, mode, prompt);
      if (cutout && cutout !== photoUrl) {
        await updateItem(editingItem.id, { cutout_photo_url: cutout });
        setRecutNotice('Cutout refreshed.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        setRecutNotice('Cutout failed — try changing the photo and trying again.');
      }
    } catch (e) {
      console.warn('[handleRecut] error', e);
      setRecutNotice('Cutout failed — try again later.');
    } finally {
      setRecutting(false);
      if (recutNoticeTimerRef.current) clearTimeout(recutNoticeTimerRef.current);
      recutNoticeTimerRef.current = setTimeout(() => setRecutNotice(null), 4000);
    }
  }, [editingItem, recutting, photoUrl, category, updateItem]);

  const handlePickCandidate = useCallback(async (pickedUrl: string) => {
    if (pickedUrl === photoUrl) return;

    // Apply a candidate swap, optionally invoking the cutout EF. "Cut" runs
    // background removal (the seg+ghost pipeline for apparel, etc.) and
    // shows the polished cutout. "Keep as is" leaves the raw image in
    // place — used when the creator wants the full-body / lifestyle look,
    // not the floating-garment look.
    const applySwap = async (runCutout: boolean) => {
      setPickingCandidateUrl(pickedUrl);
      setPhotoUrl(pickedUrl);
      setOriginalPhotoUrl(pickedUrl);
      setPhotoLoadError(false);
      try {
        if (editingItem) {
          // Persist the swap. Clear any stale cutout_photo_url so the UI
          // doesn't render the previous photo's cutout in the meantime.
          // When runCutout=true, cutout-item-photo will replace it with a
          // fresh result. When runCutout=false, we leave it null so the
          // canvas falls back to the raw photo.
          await updateItem(editingItem.id, {
            photoUri: pickedUrl,
            originalPhotoUri: pickedUrl,
            cutout_photo_url: undefined,
          });
          if (runCutout) {
            supabase.functions
              .invoke('cutout-item-photo', { body: { item_id: editingItem.id } })
              .catch((err) => console.warn('cutout-item-photo failed (non-blocking):', err));
          }
        }
      } catch (e) {
        console.warn('[handlePickCandidate] error', e);
      } finally {
        setPickingCandidateUrl(null);
      }
    };

    // Prompt the creator. Some photos (clean product shots) benefit from
    // background removal; others (lifestyle shots they explicitly want
    // model-included) shouldn't be cut. Default action is Cut since that's
    // the polish path most outfit collages want.
    Alert.alert(
      'Remove background?',
      'Cut out just the item for a clean collage look, or keep this photo as-is for a lifestyle / full-body shot.',
      [
        { text: 'Keep as is', style: 'default', onPress: () => { void applySwap(false); } },
        { text: 'Cut out item', style: 'default', onPress: () => { void applySwap(true); } },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true },
    );
  }, [photoUrl, editingItem, updateItem]);

  const handleReplaceConfirmed = useCallback(async (localUri: string) => {
    if (!editingItem || !creatorId) return;
    setShowReplaceSheet(false);
    setReplacingPhoto(true);
    setReplaceNotice(null);
    try {
      const path = `closet/${creatorId}/${editingItem.id}-replace-${Date.now()}.jpg`;
      const uploadedUrl = await uploadPhoto(localUri, 'item-photos', path);
      setPhotoUrl(uploadedUrl);
      setOriginalPhotoUrl(uploadedUrl);
      await updateItem(editingItem.id, { photoUri: uploadedUrl, originalPhotoUri: uploadedUrl });
      const mode = pickCutoutMode(category);
      const prompt = pickCutoutPrompt(category);
      const cutout = await removeBackground(uploadedUrl, mode, prompt);
      if (cutout && cutout !== uploadedUrl) {
        await updateItem(editingItem.id, { cutout_photo_url: cutout });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setReplaceNotice('Photo replaced.');
    } catch (e) {
      console.warn('[handleReplaceConfirmed] error', e);
      setReplaceNotice('Failed — try again.');
    } finally {
      setReplacingPhoto(false);
      if (replaceNoticeTimerRef.current) clearTimeout(replaceNoticeTimerRef.current);
      replaceNoticeTimerRef.current = setTimeout(() => setReplaceNotice(null), 4000);
    }
  }, [editingItem, creatorId, category, updateItem]);

  const handleReplaceFromCamera = useCallback(async () => {
    setShowReplaceSheet(false);
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (!result.canceled && result.assets[0]) {
      const stableUri = await persistPickedPhoto(result.assets[0].uri);
      await handleReplaceConfirmed(stableUri);
    }
  }, [handleReplaceConfirmed]);

  const handleReplaceFromLibrary = useCallback(async () => {
    setShowReplaceSheet(false);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (!result.canceled && result.assets[0]) {
      const stableUri = await persistPickedPhoto(result.assets[0].uri);
      await handleReplaceConfirmed(stableUri);
    }
  }, [handleReplaceConfirmed]);

  const handleCropExisting = useCallback(() => {
    const source = originalPhotoUrl || photoUrl;
    if (!source) return;
    setShowReplaceSheet(false);
    setReplaceEditorUri(source);
    setShowPhotoEditorForReplace(true);
  }, [originalPhotoUrl, photoUrl]);

  const handleFetchDetails = useCallback(async (overrideUrl?: string) => {
    const trimmedUrl = (typeof overrideUrl === 'string' ? overrideUrl : url).trim();
    if (!trimmedUrl || !trimmedUrl.startsWith('http') || fetching) return;
    if (detectFortressDomain(trimmedUrl)) {
      setFetchError(null);
      return;
    }
    setFetching(true);
    setFetchError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const info = await fetchProductInfo(trimmedUrl, creatorId);
      if (!info.name && !info.imageUrl) {
        setFetchError(
          "Scraper returned 200 but no product details. The page might require login, be a search result, or be blocked by the merchant. Try the canonical product page URL."
        );
        return;
      }
      if (info.name) setName(decodeHtmlEntities(info.name));
      if (info.brand) setBrand(info.brand);
      if (info.price) setPrice(info.price.replace(/^\$/, '').trim());
      if (info.imageUrl) {
        setPhotoUrl(info.imageUrl);
        setOriginalPhotoUrl(info.imageUrl);
        setPhotoLoadError(false);
      }
      setCandidatePhotoUrls(Array.isArray(info.imageUrls) ? info.imageUrls.slice(0, 6) : []);
      const missing: string[] = [];
      if (!info.name) missing.push('name');
      if (!info.price) missing.push('price');
      if (!info.imageUrl) missing.push('photo');
      setMissingFields(missing);
      setAddStage('review');
    } catch {
      setFetchError('Could not fetch product details. You can fill them in manually.');
    } finally {
      setFetching(false);
    }
  }, [url, fetching, creatorId]);

  // On open (new item only), peek the clipboard for a product URL and surface a
  // one-tap "Add copied link?" so the creator never has to paste.
  useEffect(() => {
    if (editingItem || prefillUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await Clipboard.getStringAsync();
        const norm = normalizeUrlInput(raw ?? '');
        if (!cancelled && norm && norm.startsWith('http')) setClipboardUrl(norm);
      } catch {
        // clipboard unavailable / denied — no banner, no harm
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUseClipboard = useCallback(() => {
    if (!clipboardUrl) return;
    Haptics.selectionAsync().catch(() => {});
    const target = clipboardUrl;
    setUrl(target);
    setClipboardUrl(null);
    void handleFetchDetails(target);
  }, [clipboardUrl, handleFetchDetails]);

  // Premium fortress fetch: calls the scrape-fortress Edge Function (verify_jwt:false,
  // ~20s typical latency). Gated on detectFortressDomain(url) !== null so we never
  // pay the proxy cost for non-fortress URLs.
  const handleFortressFetch = useCallback(async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || !trimmedUrl.startsWith('http')) return;
    if (!fortressDomain) return;
    if (fortressFetching) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    setFortressFetching(true);
    setFortressError(null);
    setFortressFetched(false);
    setFortressLoadingSeconds(0);
    fortressFetchUrlRef.current = trimmedUrl;
    if (fortressTimerRef.current) clearInterval(fortressTimerRef.current);
    fortressTimerRef.current = setInterval(() => {
      setFortressLoadingSeconds((s) => s + 1);
    }, 1000);

    const stopTimer = () => {
      if (fortressTimerRef.current) {
        clearInterval(fortressTimerRef.current);
        fortressTimerRef.current = null;
      }
    };

    try {
      const fetchPromise = supabase.functions.invoke('scrape-fortress', { body: { url: trimmedUrl } });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), 60000)
      );
      const result: any = await Promise.race([fetchPromise, timeoutPromise]);

      // Stale-guard: if URL changed mid-flight, ignore the response.
      if (fortressFetchUrlRef.current !== trimmedUrl) {
        stopTimer();
        return;
      }

      const payload = result?.data;
      const ok = payload?.ok === true && payload?.fields?.name;
      if (!ok) {
        stopTimer();
        setFortressFetching(false);
        setFortressError(
          `Couldn't auto-fill from ${fortressDomain.name} this time. You can fill in details manually below — uploading a photo only takes 20 seconds.`
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        return;
      }

      const f = payload.fields as {
        name?: string | null;
        brand?: string | null;
        price?: string | number | null;
        imageUrl?: string | null;
        imageUrls?: string[] | null;
        currency?: string | null;
        inStock?: boolean | null;
      };

      if (f.name) setName(decodeHtmlEntities(f.name));
      const cleanedBrand = cleanBrandLabel(f.brand ?? null);
      if (cleanedBrand) setBrand(cleanedBrand);
      if (f.price !== null && f.price !== undefined && `${f.price}`.trim() !== '') {
        const priceStr = `${f.price}`.replace(/^\$/, '').trim();
        setPrice(priceStr);
      }
      if (f.imageUrl) {
        setPhotoUrl(f.imageUrl);
        setOriginalPhotoUrl(f.imageUrl);
        setPhotoLoadError(false);
      }
      if (Array.isArray(f.imageUrls)) {
        setCandidatePhotoUrls(f.imageUrls.slice(0, 6));
      }

      const missing: string[] = [];
      if (!f.name) missing.push('name');
      if (f.price === null || f.price === undefined || `${f.price}`.trim() === '') missing.push('price');
      if (!f.imageUrl) missing.push('photo');
      setMissingFields(missing);

      stopTimer();
      setFortressFetching(false);
      setFortressFetched(true);
      setAddStage('review');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      if (fortressFetchUrlRef.current !== trimmedUrl) {
        stopTimer();
        return;
      }
      stopTimer();
      setFortressFetching(false);
      const isTimeout = (e as Error)?.message === 'TIMEOUT';
      setFortressError(
        isTimeout
          ? `${fortressDomain.name} took too long to respond. You can fill in details manually below — uploading a photo only takes 20 seconds.`
          : `Couldn't auto-fill from ${fortressDomain.name} this time. You can fill in details manually below — uploading a photo only takes 20 seconds.`
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
  }, [url, fortressDomain, fortressFetching]);

  // If URL changes (or fortress detection clears), abort any in-flight fortress fetch.
  useEffect(() => {
    const trimmed = url.trim();
    if (fortressFetchUrlRef.current && fortressFetchUrlRef.current !== trimmed) {
      // The in-flight resolver will see this mismatch and bail; clear UI state now.
      if (fortressTimerRef.current) {
        clearInterval(fortressTimerRef.current);
        fortressTimerRef.current = null;
      }
      setFortressFetching(false);
      setFortressLoadingSeconds(0);
      setFortressError(null);
    }
  }, [url]);

  const handleStartOver = useCallback(() => {
    setAddStage('url');
    setFetchError(null);
    setMissingFields([]);
    setName('');
    setBrand('');
    setPrice('');
    setPhotoUrl(undefined);
    setOriginalPhotoUrl(undefined);
    setPhotoLoadError(false);
    setCandidatePhotoUrls([]);
    setDefaultWornSize('');
    setCategory('Other');
    setAlternateDrafts([]);
    setAltFetchErrors([]);
    setAltPhotoSuggestions([]);
    setPrimaryNote('');
  }, []);

  const handleUrlChange = useCallback((raw: string) => {
    const normalized = normalizeUrlInput(raw);
    if (normalized && normalized !== raw.trim()) {
      setUrl(normalized);
    } else {
      setUrl(raw);
    }
    setFetchError(null);
  }, []);

  const handlePasteLink = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    const normalized = normalizeUrlInput(text);
    if (normalized) {
      setUrl(normalized);
    }
  }, []);

  const handleRefetchAsync = useCallback(async () => {
    if (!editingItem) return;
    await updateItem(editingItem.id, {
      fetchStatus: 'pending',
      fetchStartedAt: null,
      fetchCompletedAt: null,
      fetchError: null,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [editingItem, updateItem]);

  const handleSave = useCallback(async () => {
    if (!creatorId || !category) return;
    Keyboard.dismiss();
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const cleanedAlternates: AlternateItem[] = alternateDrafts
      .filter((a) => (a?.link ?? '').trim().length > 0)
      .slice(0, MAX_ALTERNATES);
    const firstAlt = cleanedAlternates[0];

    const trimmedDefaultSize = defaultWornSize.trim();
    const defaultWornSizeForSave: string | null = trimmedDefaultSize.length > 0 ? trimmedDefaultSize : null;

    if (editingItem) {
      await updateItem(editingItem.id, {
        name,
        brand: brand || null,
        price,
        link: url,
        category,
        photoUri: photoUrl,
        originalPhotoUri: originalPhotoUrl,
        alternates: cleanedAlternates,
        primaryNote: cleanedAlternates.length > 0 ? primaryNote || undefined : undefined,
        alternateLink: firstAlt?.link || undefined,
        alternateLabel: firstAlt?.label || undefined,
        defaultWornSize: defaultWornSizeForSave,
      });
      markOpenProductTipSeen();
      setSaving(false);
      router.back();
      return;
    }

    // Review form save — commit a complete row, skipping the async scrape trigger.
    const item: ClothingItem = {
      id: String(Date.now()),
      name: name || category,
      brand: brand || null,
      price,
      link: url,
      category,
      emoji: CATEGORIES.find(c => c.value === category)?.emoji ?? '🛍️',
      photoUri: photoUrl,
      originalPhotoUri: originalPhotoUrl,
      alternates: cleanedAlternates,
      primaryNote: cleanedAlternates.length > 0 ? primaryNote || undefined : undefined,
      alternateLink: firstAlt?.link || undefined,
      alternateLabel: firstAlt?.label || undefined,
      defaultWornSize: defaultWornSizeForSave,
      fetchStatus: 'complete',
      fetchError: null,
    };
    const newItemId = await addStandaloneClosetItem(creatorId, item);

    markOpenProductTipSeen();

    // Surface 1: a manual add never resolves an affiliate link, so check the
    // live matcher. If we carry the same product at a joined merchant with
    // high/medium confidence, surface the "you could be earning" card before
    // leaving. Best-effort — never block the save on the matcher.
    if (newItemId && (brand ?? '').trim()) {
      try {
        const matches = await suggestAffiliateMatches({ brand, name, price });
        const good = matches.filter((m) => m.confidence !== 'low');
        if (good.length > 0) {
          setEarnMatches(good);
          setEarnItemId(newItemId);
          setShowEarnSheet(true);
          setSaving(false);
          return; // the sheet's onDone navigates back
        }
      } catch {
        // ignore — fall through to the normal back-out
      }
    }

    setSaving(false);
    router.back();
  }, [creatorId, editingItem, name, brand, price, url, category, photoUrl, originalPhotoUrl, alternateDrafts, primaryNote, updateItem, addStandaloneClosetItem, markOpenProductTipSeen]);

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
      <SafeAreaView style={[styles.container, { height: sheetHeight }]} edges={['bottom']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>{editingItem ? 'Edit Item' : campaignAutoFillApplied ? 'Tag this product.' : 'Add to Closet'}</Text>
              {!editingItem && addStage === 'review' ? (
                <Pressable onPress={handleStartOver} className="py-1 active:opacity-70" testID="closet-item-start-over">
                  <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#B87063', textDecorationLine: 'underline' }}>← Start over</Text>
                </Pressable>
              ) : null}
            </View>
            <Pressable onPress={() => router.back()} hitSlop={8} testID="closet-item-close">
              <X size={22} color="#3D3330" />
            </Pressable>
          </View>

          {/* Campaign resolving spinner */}
          {campaignResolving ? (
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}>
              <ActivityIndicator size="large" color="#B87063" />
              <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#8C8580', marginTop: 12 }}>
                Loading product details…
              </Text>
            </View>
          ) : null}

          {/* URL Input */}
          {!campaignResolving ? (
          <View style={styles.section}>
            <Text style={styles.label}>Product Link</Text>
            <View style={styles.urlRow}>
              <View style={styles.urlInputWrap}>
                <LinkIcon size={16} color="#8C8580" />
                <TextInput
                  style={styles.urlInput}
                  value={url}
                  onChangeText={handleUrlChange}
                  placeholder="https://..."
                  placeholderTextColor="#B0A8A2"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="url"
                  textContentType="URL"
                  spellCheck={false}
                  keyboardType="url"
                  returnKeyType={!editingItem && addStage === 'url' ? 'go' : 'done'}
                  onSubmitEditing={!editingItem && addStage === 'url' ? () => handleFetchDetails() : undefined}
                  autoFocus={!editingItem && addStage === 'url'}
                  testID="closet-item-url"
                />
              </View>
              <PillButton
                label="Paste"
                variant="dark"
                size="sm"
                icon={<ClipboardPaste size={16} color="#FFFFFF" />}
                onPress={handlePasteLink}
                testID="closet-item-paste"
              />
            </View>
            {editingItem && url.startsWith('http') ? (
              <PillButton
                label="Re-fetch metadata"
                variant="tertiary"
                onPress={handleRefetchAsync}
                testID="closet-item-refetch"
              />
            ) : null}
            {/* Clipboard auto-detect (Layer 3): one-tap add of a copied link */}
            {!editingItem && addStage === 'url' && clipboardUrl && !url.trim() ? (
              <Pressable
                onPress={handleUseClipboard}
                className="flex-row items-center gap-3 mt-2 px-3.5 py-3 rounded-2xl bg-[#FAF1EE] border border-[#EAD7D0] active:opacity-80"
                testID="closet-clipboard-suggest"
              >
                <ClipboardPaste size={16} color="#B87063" />
                <View style={{ flex: 1 }}>
                  <Text
                    className="text-[#1A1210] text-[14px]"
                    style={{ fontFamily: 'DMSans_500Medium', fontWeight: '600' }}
                  >
                    Add copied link?
                  </Text>
                  <Text
                    className="text-[#9B8B82] text-[12px]"
                    numberOfLines={1}
                    style={{ fontFamily: 'DMSans_400Regular' }}
                  >
                    {(() => { try { return new URL(clipboardUrl).hostname.replace(/^www\./, ''); } catch { return clipboardUrl; } })()}
                  </Text>
                </View>
                <View className="rounded-full bg-[#B87063] px-4 py-1.5">
                  <Text
                    className="text-white text-[13px]"
                    style={{ fontFamily: 'DMSans_500Medium', fontWeight: '600' }}
                  >
                    Add
                  </Text>
                </View>
              </Pressable>
            ) : null}
            {/* Campaign banner: on URL stage for new items, always for edit */}
            {(editingItem || addStage === 'url') ? <CampaignMatchBanner url={url} /> : null}
            {/* Fortress domain: tan banner replaced by the Premium fetch CTA in the
                footer. The CTA + subcopy convey the slow-but-worth-it expectation. */}
            {/* Awin auto-wrap banner: only on the Add URL stage, hidden for
                fortress domains. Auto-rewrites the URL field to the
                awin1.com/cread.php form so the click attributes to this
                creator on /api/shop. */}
            {!editingItem && addStage === 'url' && !fortressDomain ? (
              <AwinMatchBanner
                url={url}
                creatorId={creatorId}
                onAutoWrap={(wrapped) => setUrl(wrapped)}
              />
            ) : null}
            {editingItem ? (
              <ActiveOfferPanel itemId={editingItem.id} url={url} />
            ) : null}
            {editingItem ? (() => {
              const host = hostFromUrl(url);
              const merchant = host ? awinFindByHost(host) : null;
              if (!merchant?.clickThroughUrl) return null;
              return (
                <View style={{ paddingHorizontal: 20, marginTop: 8 }}>
                  <Pressable
                    onPress={async () => {
                      try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                      try {
                        await WebBrowser.openBrowserAsync(merchant.clickThroughUrl as string);
                      } catch (e) {
                        console.warn('[add-closet-item] openBrowserAsync failed:', e);
                      }
                    }}
                    className="flex-row items-center justify-center gap-1.5 py-2 px-3 active:opacity-70"
                    testID="visit-merchant-edit-link"
                  >
                    <Text
                      className="text-[#6B5E58] text-sm font-medium"
                      style={{ fontFamily: 'DMSans_500Medium' }}
                    >
                      {`Visit ${merchant.name} on the web →`}
                    </Text>
                  </Pressable>
                </View>
              );
            })() : null}
            {campaignSwapNotice ? (
              <View style={{ marginTop: 8, backgroundColor: '#F8E5E0', borderRadius: 10, padding: 10 }}>
                <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#B87063', lineHeight: 16 }}>
                  {campaignSwapNotice}
                </Text>
              </View>
            ) : null}
            {/* Fetch state feedback on URL stage */}
            {!editingItem && addStage === 'url' ? (
              <>
                {fetching ? (
                  <View style={[styles.fetchingRow, { marginTop: 12 }]}>
                    <ActivityIndicator size="small" color="#B87063" />
                    <Text style={styles.fetchingText}>Looking up product details…</Text>
                  </View>
                ) : null}
                {fetchError && !fetching && !fortressDomain ? (
                  <View style={{ marginTop: 8 }}>
                    <View style={[styles.fetchingRow, { gap: 6 }]}>
                      <Info size={14} color="#B87063" />
                      <Text style={[styles.errorText, { marginTop: 0 }]}>{fetchError}</Text>
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}
          </View>
          ) : null}

          {(editingItem || addStage === 'review') ? (<>
            {!editingItem && fortressDomain && fortressFetched ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  marginHorizontal: 20,
                  marginBottom: 8,
                }}
                testID="fortress-premium-success-badge"
              >
                <Check size={14} color="#2E7D32" strokeWidth={2.5} />
                <Text
                  style={{
                    fontFamily: 'DMSans_500Medium',
                    fontSize: 12,
                    color: '#2E7D32',
                  }}
                >
                  Fetched via premium proxy
                </Text>
              </View>
            ) : null}
            {!editingItem && missingFields.length > 0 ? (
              <View style={{ marginHorizontal: 20, marginBottom: 4, backgroundColor: '#FFF8F0', borderRadius: 10, padding: 12 }}>
                <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#8C5E30', lineHeight: 18 }}>
                  {`Couldn't get ${missingFields.join(', ')} — fill ${missingFields.length === 1 ? 'it' : 'them'} in below.`}
                </Text>
              </View>
            ) : null}

            {/* Campaign auto-fill intro + badge */}
            {!editingItem && campaignAutoFillApplied ? (
              <View style={{ paddingHorizontal: 20, marginBottom: 8 }}>
                <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#6B5E58', lineHeight: 18, marginBottom: 10 }}>
                  {'We pulled the photo and title from '}
                  <Text style={{ fontFamily: 'DMSans_500Medium', color: '#1A1210' }}>{brand || 'this campaign'}</Text>
                  {"'s campaign. Review the details below, then save\u2009—\u2009your closet item will use the campaign-tagged URL so commissions attribute correctly."}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F8E5E0', borderColor: '#E8C9C1', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' }}>
                  <Sparkles size={12} color="#B87063" />
                  <Text style={{ fontSize: 11, color: '#B87063', fontFamily: 'DMSans_500Medium' }}>Campaign auto-fill applied</Text>
                </View>
              </View>
            ) : null}

            {/* Open product page link */}
            {/^https?:\/\//i.test(url.trim()) ? (
              <Pressable
                onPress={() => {
                  markOpenProductTipSeen();
                  const trimmed = url.trim();
                  // Route through /api/shop so even a previewed Amazon page is
                  // affiliate-tagged and logged server-side (source=ios).
                  void openShopLink({
                    url: trimmed,
                    creatorItemId: editingItem?.id ?? undefined,
                    creatorId: creatorId ?? undefined,
                  });
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, paddingHorizontal: 20 }}
                testID="closet-item-open-url"
              >
                <ExternalLink size={12} color="#B87063" />
                <Text style={{ fontSize: 12, color: '#B87063', fontFamily: 'DMSans_400Regular' }}>
                  Open product page
                </Text>
              </Pressable>
            ) : null}
            {!openProductTipSeen && !editingItem && addStage === 'review' && (!price.trim() || !defaultWornSize.trim()) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F8E5E0', borderColor: '#E8C9C1', borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, marginHorizontal: 20, marginBottom: 12 }}>
                <Text style={{ flex: 1, fontSize: 12, color: '#B87063', lineHeight: 16, fontFamily: 'DMSans_400Regular' }}>
                  Tap here to grab price, size, or category from Amazon — your form stays put.
                </Text>
                <Pressable onPress={markOpenProductTipSeen} hitSlop={8} testID="open-product-tip-dismiss">
                  <X size={12} color="#B87063" />
                </Pressable>
              </View>
            ) : null}

          {/* Photo */}
          <View style={styles.section}>
            <Text style={styles.label}>Photo</Text>
            {photoUrl && !photoLoadError ? (
              <>
                <Pressable
                  onPress={handlePickPhoto}
                  disabled={pickingPhoto}
                  style={styles.photoImageWrap}
                  testID="primary-photo-thumb"
                  accessibilityRole="button"
                >
                  <Image
                    source={{ uri: photoUrl }}
                    style={styles.photoImage}
                    contentFit="contain"
                    onError={() => setPhotoLoadError(true)}
                  />
                </Pressable>
                <View className="flex-row items-center justify-center gap-1">
                  <Pressable
                    onPress={handlePickPhoto}
                    disabled={pickingPhoto}
                    className="flex-row items-center justify-center gap-1.5 py-2 px-3 active:opacity-70"
                    testID="primary-photo-change-pill"
                  >
                    {pickingPhoto ? (
                      <ActivityIndicator size="small" color="#6B5E58" />
                    ) : (
                      <Camera size={16} color="#6B5E58" />
                    )}
                    <Text className="text-[#6B5E58] text-sm font-medium" style={{ fontFamily: 'DMSans_500Medium' }}>
                      {pickingPhoto ? 'Loading…' : 'Change photo'}
                    </Text>
                  </Pressable>
                  {editingItem ? (
                    <Pressable
                      onPress={() => setShowReplaceSheet(true)}
                      disabled={replacingPhoto}
                      className="flex-row items-center justify-center gap-1.5 py-2 px-3 active:opacity-70"
                      testID="primary-photo-replace-pill"
                    >
                      {replacingPhoto ? (
                        <ActivityIndicator size="small" color="#6B5E58" />
                      ) : (
                        <RefreshCw size={16} color="#6B5E58" />
                      )}
                      <Text className="text-[#6B5E58] text-sm font-medium" style={{ fontFamily: 'DMSans_500Medium' }}>
                        {replacingPhoto ? 'Replacing…' : 'Replace source image'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                {replaceNotice ? (
                  <Text
                    className="text-center text-xs text-[#6B5E58] mt-1"
                    style={{ fontFamily: 'DMSans_400Regular' }}
                  >
                    {replaceNotice}
                  </Text>
                ) : null}
                {recutNotice ? (
                  <Text
                    className="text-center text-xs text-[#6B5E58] mt-1"
                    style={{ fontFamily: 'DMSans_400Regular' }}
                  >
                    {recutNotice}
                  </Text>
                ) : null}
                <PhotoCandidatePicker
                  candidates={candidatePhotoUrls}
                  selected={photoUrl}
                  onSelect={handlePickCandidate}
                  loadingUrl={pickingCandidateUrl}
                />
              </>
            ) : (
              <Pressable
                onPress={handlePickPhoto}
                disabled={pickingPhoto}
                style={styles.photoEmptyBtn}
                testID="primary-photo-add"
                accessibilityRole="button"
              >
                <View style={styles.photoEmptyPlaceholder}>
                  {pickingPhoto ? (
                    <ActivityIndicator size="small" color="#8C8580" />
                  ) : (
                    <ImagePlus size={28} color="#8C8580" />
                  )}
                  <Text style={styles.photoEmptyText}>
                    {pickingPhoto ? 'Loading…' : 'Add photo'}
                  </Text>
                  <Text style={styles.photoEmptySub}>Tap to choose from library</Text>
                </View>
              </Pressable>
            )}
          </View>

          {/* Category */}
          <View style={styles.section}>
            <Text style={styles.label}>Category</Text>
            <View style={styles.categoryGrid}>
              {CATEGORIES.map((cat) => (
                <Pressable
                  key={cat.value}
                  style={[styles.categoryPill, category === cat.value && styles.categoryPillActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setCategory(cat.value);
                  }}
                  testID={`closet-item-cat-${cat.value.toLowerCase()}`}
                >
                  <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
                  <Text style={[styles.categoryText, category === cat.value && styles.categoryTextActive]}>
                    {cat.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Name */}
          <View style={styles.section}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.textInput}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Oversized Linen Blazer"
              placeholderTextColor="#B0A8A2"
              testID="closet-item-name"
            />
          </View>

          {/* Brand */}
          <View style={styles.section}>
            <Text style={styles.label}>Brand</Text>
            <BrandSelector
              selectedBrand={brand || null}
              onBrandSelect={(b) => setBrand(b ?? '')}
            />
          </View>

          {/* Price */}
          <View style={styles.section}>
            <Text style={styles.label}>Price</Text>
            <TextInput
              style={styles.textInput}
              value={price}
              onChangeText={setPrice}
              placeholder="49.99"
              placeholderTextColor="#B0A8A2"
              keyboardType="decimal-pad"
              testID="closet-item-price"
            />
          </View>

          {/* My Usual Size */}
          <View style={styles.section}>
            <Text style={styles.label}>My Usual Size</Text>
            <TextInput
              style={styles.textInput}
              value={defaultWornSize}
              onChangeText={setDefaultWornSize}
              placeholder={sizePlaceholderForCategory(category)}
              placeholderTextColor="#B0A8A2"
              autoCapitalize="characters"
              autoCorrect={false}
              testID="closet-item-default-size"
            />
          </View>

          {/* Alternates */}
          <View style={styles.section}>
            <Text style={styles.label}>Alternates</Text>

            {alternateDrafts.length > 0 ? (
              <View style={{ marginBottom: 10 }}>
                <Text style={{ fontSize: 12, color: '#6B5E58', marginBottom: 6, fontFamily: 'DMSans_400Regular' }}>
                  Why show alternate?
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(['Limited sizes', 'Higher price point', 'Selling fast'] as const).map((note) => (
                    <Pressable
                      key={note}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 8,
                        backgroundColor: primaryNote === note ? '#B87063' : '#F0EBE5',
                      }}
                      onPress={() => setPrimaryNote(primaryNote === note ? '' : note)}
                      testID={`closet-primary-note-${note.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <Text style={{ fontSize: 12, color: primaryNote === note ? '#FFFFFF' : '#3D3330' }}>{note}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {alternateDrafts.map((alt, idx) => {
              const isFetchingThis = fetchingAltIdx === idx;
              const errorThis = altFetchErrors[idx] ?? null;
              const suggestionThis = altPhotoSuggestions[idx] ?? null;
              const altLinkValue = alt.link ?? '';
              return (
                <View key={`alt-slot-${idx}`} style={styles.altCard}>
                  <View style={styles.altHeader}>
                    <Text style={styles.altHeaderText}>
                      Alternate {alternateDrafts.length > 1 ? `#${idx + 1}` : ''}
                    </Text>
                    <Pressable
                      onPress={() => {
                        removeAlternateSlot(idx);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }}
                      style={styles.altRemoveBtn}
                      testID={`closet-alt-remove-${idx}`}
                    >
                      <X size={14} color="#FFFFFF" />
                    </Pressable>
                  </View>

                  {/* Alt link + fetch */}
                  <View style={styles.urlRow}>
                    <View style={styles.urlInputWrap}>
                      <LinkIcon size={16} color="#8C8580" />
                      <TextInput
                        style={styles.urlInput}
                        value={altLinkValue}
                        onChangeText={(raw) => handleAltLinkChange(idx, raw)}
                        placeholder="https://..."
                        placeholderTextColor="#B0A8A2"
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        returnKeyType="done"
                        onSubmitEditing={() => handleAltLinkSubmit(idx)}
                        testID={`closet-alt-link-${idx}`}
                      />
                    </View>
                    <Pressable
                      style={[
                        styles.altFetchBtn,
                        (!altLinkValue.trim() || isFetchingThis) && { opacity: 0.5 },
                      ]}
                      disabled={!altLinkValue.trim() || isFetchingThis}
                      onPress={() => handleAltLinkSubmit(idx)}
                      testID={`closet-alt-fetch-${idx}`}
                    >
                      {isFetchingThis ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.pasteBtnText}>Fetch</Text>
                      )}
                    </Pressable>
                  </View>

                  {isFetchingThis ? (
                    <View style={styles.fetchingRow}>
                      <ActivityIndicator size="small" color="#B87063" />
                      <Text style={styles.fetchingText}>Looking up product...</Text>
                    </View>
                  ) : null}
                  {errorThis && !isFetchingThis ? (
                    <View style={[styles.fetchingRow, { gap: 6 }]}>
                      <Info size={14} color="#B87063" />
                      <Text style={[styles.errorText, { marginTop: 0 }]}>{errorThis}</Text>
                    </View>
                  ) : null}

                  {/* Alt name */}
                  <Text style={[styles.altFieldLabel, { marginTop: 12 }]}>Name</Text>
                  <TextInput
                    style={styles.textInput}
                    value={alt.name ?? ''}
                    onChangeText={(v) => updateAlternate(idx, 'name', v)}
                    placeholder="Item name"
                    placeholderTextColor="#B0A8A2"
                    testID={`closet-alt-name-${idx}`}
                  />

                  {/* Alt brand */}
                  <Text style={[styles.altFieldLabel, { marginTop: 10 }]}>Brand</Text>
                  <TextInput
                    style={styles.textInput}
                    value={alt.brand ?? ''}
                    onChangeText={(v) => updateAlternate(idx, 'brand', v || null)}
                    placeholder="e.g. Zara"
                    placeholderTextColor="#B0A8A2"
                    testID={`closet-alt-brand-${idx}`}
                  />

                  {/* Alt price */}
                  <Text style={[styles.altFieldLabel, { marginTop: 10 }]}>Price</Text>
                  <TextInput
                    style={styles.textInput}
                    value={alt.price ?? ''}
                    onChangeText={(v) => updateAlternate(idx, 'price', v.replace(/^\$/, '') || null)}
                    placeholder="49.99"
                    placeholderTextColor="#B0A8A2"
                    keyboardType="decimal-pad"
                    testID={`closet-alt-price-${idx}`}
                  />

                  {/* Alt photo */}
                  <Text style={[styles.altFieldLabel, { marginTop: 10 }]}>Photo</Text>
                  <Pressable
                    style={styles.altPhotoBtn}
                    onPress={() => handlePickAltPhoto(idx)}
                    testID={`closet-alt-photo-${idx}`}
                  >
                    {alt.photo_url ? (
                      <View style={{ position: 'relative', width: '100%', aspectRatio: 1 }}>
                        <Image source={{ uri: alt.photo_url }} style={styles.altPhotoImage} contentFit="cover" />
                        <Pressable
                          onPress={() => updateAlternate(idx, 'photo_url', null)}
                          style={styles.altPhotoRemoveBtn}
                          testID={`closet-alt-photo-remove-${idx}`}
                        >
                          <X size={14} color="#FFFFFF" />
                        </Pressable>
                      </View>
                    ) : (
                      <View style={styles.altPhotoPlaceholder}>
                        <Text style={{ fontSize: 24 }}>📷</Text>
                        <Text style={styles.altPhotoPlaceholderText}>Tap to add photo</Text>
                      </View>
                    )}
                  </Pressable>

                  {suggestionThis ? (
                    <View style={styles.altSuggestionRow}>
                      <Image source={{ uri: suggestionThis }} style={styles.altSuggestionThumb} contentFit="cover" />
                      <Text style={styles.altSuggestionText}>Product image found. Use it?</Text>
                      <Pressable onPress={() => setAltPhotoSuggestionAt(idx, null)} testID={`closet-alt-suggestion-skip-${idx}`}>
                        <Text style={{ fontSize: 13, color: '#6B5E58' }}>Skip</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          const u = altPhotoSuggestions[idx];
                          if (u) updateAlternate(idx, 'photo_url', u);
                          setAltPhotoSuggestionAt(idx, null);
                        }}
                        testID={`closet-alt-suggestion-use-${idx}`}
                      >
                        <Text style={{ fontSize: 13, color: '#B87063', fontFamily: 'DMSans_500Medium' }}>Use Photo</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {/* Alt label */}
                  <Text style={[styles.altFieldLabel, { marginTop: 10 }]}>Label</Text>
                  <TextInput
                    style={styles.textInput}
                    value={alt.label ?? ''}
                    onChangeText={(v) => updateAlternate(idx, 'label', v || null)}
                    placeholder="e.g. Budget option, Different color"
                    placeholderTextColor="#B0A8A2"
                    testID={`closet-alt-label-${idx}`}
                  />
                </View>
              );
            })}

            {alternateDrafts.length < MAX_ALTERNATES ? (
              <Pressable
                onPress={() => {
                  addAlternateSlot();
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                style={styles.addAltBtn}
                testID={alternateDrafts.length === 0 ? 'closet-add-alternate-btn' : 'closet-add-another-alternate-btn'}
              >
                <Plus size={16} color="#B87063" />
                <Text style={styles.addAltBtnText}>
                  {alternateDrafts.length === 0 ? 'Add an alternate' : 'Add another alternate'}
                </Text>
              </Pressable>
            ) : null}
          </View>
          </>) : null}
        </ScrollView>

        {/* Footer: URL stage shows Fetch + Add manually; Review/Edit shows Save */}
        <View style={styles.footer}>
          {campaignResolving ? (
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
              <ActivityIndicator size="small" color="#B87063" />
            </View>
          ) : !editingItem && addStage === 'url' ? (
            fortressDomain ? (
              <>
                {!fortressError ? (
                  <>
                    <Pressable
                      className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
                      onPress={handleFortressFetch}
                      disabled={fortressFetching || !url.trim() || !url.trim().startsWith('http')}
                      style={[
                        { marginBottom: 6 },
                        (fortressFetching || !url.trim() || !url.trim().startsWith('http')) ? { opacity: 0.5 } : undefined,
                      ]}
                      testID="fortress-premium-fetch"
                    >
                      <Zap size={16} color="#FFFFFF" strokeWidth={2.5} />
                      <Text
                        style={{ fontFamily: 'DMSans_500Medium' }}
                        className="ml-2 text-white text-[15px] font-semibold"
                      >
                        {`Premium fetch (${fortressDomain.name} — ~20s)`}
                      </Text>
                    </Pressable>
                    {!fortressFetching ? (
                      <Text
                        style={{
                          fontFamily: 'DMSans_400Regular',
                          fontSize: 12,
                          color: '#6B5E58',
                          textAlign: 'center',
                          paddingHorizontal: 8,
                          marginTop: 2,
                          lineHeight: 16,
                        }}
                      >
                        These brands take a bit longer to scrape. Worth the wait — auto-fills your closet item.
                      </Text>
                    ) : (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          marginTop: 8,
                        }}
                        testID="fortress-premium-progress"
                      >
                        <ActivityIndicator size="small" color="#B87063" />
                        <Text
                          style={{
                            fontFamily: 'DMSans_500Medium',
                            fontSize: 13,
                            color: '#1A1210',
                          }}
                        >
                          {fortressLoadingSeconds < 10
                            ? `Connecting to ${fortressDomain.name}...`
                            : fortressLoadingSeconds < 20
                            ? 'Reading product details...'
                            : 'Almost done...'}
                        </Text>
                      </View>
                    )}
                  </>
                ) : (
                  <>
                    <View
                      style={{
                        marginBottom: 10,
                        backgroundColor: '#F0EBE5',
                        borderColor: '#E8E0D8',
                        borderWidth: 1,
                        borderRadius: 12,
                        padding: 12,
                        flexDirection: 'row',
                        alignItems: 'flex-start',
                        gap: 10,
                      }}
                      testID="fortress-premium-error"
                    >
                      <Info size={16} color="#6B5E58" style={{ marginTop: 1 }} />
                      <Text
                        style={{
                          flex: 1,
                          fontFamily: 'DMSans_400Regular',
                          fontSize: 13,
                          color: '#6B5E58',
                          lineHeight: 18,
                        }}
                      >
                        {fortressError}
                      </Text>
                    </View>
                    <Pressable
                      className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
                      onPress={() => {
                        setFortressError(null);
                        setFetchError(null);
                        setAddStage('review');
                      }}
                      testID="fortress-manual-fallback"
                    >
                      <Text
                        style={{ fontFamily: 'DMSans_500Medium' }}
                        className="text-white text-[15px] font-semibold"
                      >
                        Continue to manual entry
                      </Text>
                    </Pressable>
                  </>
                )}
              </>
            ) : (
              <>
                <Pressable
                  className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
                  onPress={() => handleFetchDetails()}
                  disabled={fetching || !url.trim() || !url.trim().startsWith('http')}
                  style={[{ marginBottom: 8 }, (fetching || !url.trim() || !url.trim().startsWith('http')) ? { opacity: 0.5 } : undefined]}
                  testID="closet-item-fetch-details"
                >
                  {fetching ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={{ fontFamily: 'DMSans_500Medium' }} className="text-white text-[15px] font-semibold">Fetch details</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => { setFetchError(null); setAddStage('review'); }}
                  className="flex-row items-center justify-center py-2 px-3 active:opacity-70"
                  testID="closet-item-add-manually"
                >
                  <Text style={{ fontFamily: 'DMSans_400Regular' }} className="text-[#6B5E58] text-sm">Or add manually</Text>
                </Pressable>
              </>
            )
          ) : (
            <PillButton
              label={editingItem ? 'Save Changes' : 'Add to Closet'}
              variant="dark"
              fullWidth
              loading={saving}
              onPress={handleSave}
              testID="closet-item-save"
            />
          )}
        </View>
      </SafeAreaView>

      {/* Replace source image action sheet */}
      <Modal
        visible={showReplaceSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowReplaceSheet(false)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setShowReplaceSheet(false)}>
          <View style={styles.sheetContainer}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Replace source image</Text>

            <Pressable
              onPress={handleReplaceFromCamera}
              className="flex-row items-center gap-3 py-4 px-4 active:opacity-70"
              testID="replace-photo-camera"
            >
              <Camera size={20} color="#1A1210" />
              <Text style={styles.sheetOptionText}>Take Photo</Text>
            </Pressable>

            <View style={styles.sheetDivider} />

            <Pressable
              onPress={handleReplaceFromLibrary}
              className="flex-row items-center gap-3 py-4 px-4 active:opacity-70"
              testID="replace-photo-library"
            >
              <ImagePlus size={20} color="#1A1210" />
              <Text style={styles.sheetOptionText}>Choose from Library</Text>
            </Pressable>

            {(originalPhotoUrl || photoUrl) ? (
              <>
                <View style={styles.sheetDivider} />
                <Pressable
                  onPress={handleCropExisting}
                  className="flex-row items-center gap-3 py-4 px-4 active:opacity-70"
                  testID="replace-photo-crop"
                >
                  <Wand2 size={20} color="#1A1210" />
                  <Text style={styles.sheetOptionText}>Crop existing photo</Text>
                </Pressable>
              </>
            ) : null}

            <Pressable
              onPress={() => setShowReplaceSheet(false)}
              className="flex-row items-center justify-center py-4 px-4 mt-2 active:opacity-70"
              testID="replace-photo-cancel"
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* PhotoEditor for crop-existing path */}
      <PhotoEditor
        visible={showPhotoEditorForReplace}
        uri={replaceEditorUri}
        onSave={async (editedUri: string) => {
          setShowPhotoEditorForReplace(false);
          setReplaceEditorUri('');
          const stableUri = await persistPickedPhoto(editedUri);
          await handleReplaceConfirmed(stableUri);
        }}
        onCancel={() => {
          setShowPhotoEditorForReplace(false);
          setReplaceEditorUri('');
        }}
      />

      {/* Surface 1 — add-time "You could be earning" card */}
      {showEarnSheet && earnItemId && creatorId ? (
        <EarningSuggestionSheet
          visible={showEarnSheet}
          creatorId={creatorId}
          creatorItemId={earnItemId}
          itemName={name}
          itemBrand={brand || null}
          itemPhotoUri={photoUrl ?? null}
          matches={earnMatches}
          onDone={() => {
            setShowEarnSheet(false);
            router.back();
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F4F0',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 360,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 26,
    color: '#1A1210',
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  label: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#6B5E58',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  urlRow: {
    flexDirection: 'row',
    gap: 10,
  },
  urlInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    paddingHorizontal: 12,
    height: 48,
    gap: 8,
  },
  urlInput: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
    height: 48,
  },
  pasteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1A1210',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
  },
  pasteBtnText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#FFFFFF',
  },
  fetchBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  fetchBtnText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#B87063',
  },
  fetchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  fetchingText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#8C8580',
  },
  errorText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#C0392B',
    marginTop: 6,
  },
  photoPreview: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  photoImageWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#F0EBE5',
  },
  photoImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: '#F0EBE5',
    padding: 8,
  },
  photoEmptyBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8DEDB',
    borderStyle: 'dashed',
    overflow: 'hidden',
  },
  photoEmptyPlaceholder: {
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoEmptyText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#3D3330',
  },
  photoEmptySub: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#8C8580',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  categoryPillActive: {
    backgroundColor: '#1A1210',
    borderColor: '#1A1210',
  },
  categoryEmoji: {
    fontSize: 14,
  },
  categoryText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#3D3330',
  },
  categoryTextActive: {
    color: '#FFFFFF',
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    paddingHorizontal: 14,
    height: 48,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 0.5,
    borderTopColor: '#E8E0D8',
    backgroundColor: '#F7F4F0',
  },
  saveBtn: {
    height: 52,
    backgroundColor: '#1A1210',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#F7F4F0',
  },
  altCard: {
    backgroundColor: '#F0EBE5',
    borderWidth: 1,
    borderColor: '#D4C8C2',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  altHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  altHeaderText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#B87063',
  },
  altRemoveBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1A1210',
    alignItems: 'center',
    justifyContent: 'center',
  },
  altFetchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#B87063',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
  },
  altFieldLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginBottom: 6,
  },
  altPhotoBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    overflow: 'hidden',
  },
  altPhotoImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
  },
  altPhotoRemoveBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#1A1210',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  altPhotoPlaceholder: {
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  altPhotoPlaceholderText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#8C8580',
  },
  altSuggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
    gap: 10,
  },
  altSuggestionThumb: {
    width: 48,
    height: 48,
    borderRadius: 6,
  },
  altSuggestionText: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#3D3330',
  },
  addAltBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D4C8C2',
    borderStyle: 'dashed',
    backgroundColor: '#FFFFFF',
    gap: 8,
  },
  addAltBtnText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#B87063',
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D4CCC6',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  sheetTitle: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 16,
    color: '#1A1210',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  sheetOptionText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#1A1210',
  },
  sheetDivider: {
    height: 1,
    backgroundColor: '#EDE8E3',
    marginHorizontal: 20,
  },
  sheetCancelText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#6B5E58',
  },
});
