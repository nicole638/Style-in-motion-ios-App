import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  StyleSheet,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Animated,
  ActivityIndicator,
  Share,
  Alert,
  ActionSheetIOS,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { decodeHtmlEntities } from '@/lib/decode-entities';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Check, Camera, Pencil, Info, ShoppingBag, Plus, Scissors } from 'lucide-react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import useLookStore, { ClothingItem, Look, AlternateItem, MAX_ALTERNATES, type TextLayerItem, type StyleLayout } from '@/lib/state/lookStore';
import { TryOnModelSheet } from '@/components/TryOnModelSheet';
import { StyleLookCanvas } from '@/components/StyleLookCanvas';
import { Checkerboard } from '@/components/Checkerboard';
import { TEXT_FONT_OPTIONS, TEXT_COLOR_OPTIONS, DEFAULT_TEXT_LAYER } from '@/lib/constants/textLayerOptions';
import { exportCollage } from '@/lib/utils/exportCollage';
import useHashtagStore from '@/lib/state/hashtagStore';
import HashtagEditor from '@/components/HashtagEditor';
import BrandSelector from '@/components/BrandSelector';
import { fetchProductInfo } from '@/lib/utils/fetchProductInfo';
import { normalizeUrlInput } from '@/lib/utils/normalizeUrlInput';
import { buildShareText, savePhotosToAlbum, shareLook, buildLookShareUrl } from '@/lib/utils/shareLook';
import { shareToTikTok } from '@/lib/utils/shareToTikTok';
import { TikTokPostShareNudge } from '@/components/TikTokPostShareNudge';
import useBrandStore from '@/lib/state/brandStore';
import useDraftLookStore from '@/lib/state/draftLookStore';
import { ClosetPickerSheet } from '@/components/ClosetPickerSheet';
import { cloneItemsToDraft } from '@/lib/utils/cloneItem';
import { persistPickedPhoto } from '@/lib/utils/persistPickedPhoto';
import { openShopLink } from '@/lib/analytics/openShopLink';
import PhotoEditor from '@/components/PhotoEditor';
import useAuthStore from '@/lib/state/authStore';
import useProfileStore from '@/lib/state/profileStore';
import useCategoryStore from '@/lib/state/categoryStore';
import { ShareActionsBlock } from '@/components/ShareActionsBlock';
import { BackdropPicker, BackdropPick } from '@/components/BackdropPicker';
import { requestRemoveBg, requestSwapBg, ensurePublicPhotoUrl, uploadItemPhoto, VtoError } from '@/lib/api/vto';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import ReAnimated, { useSharedValue, useAnimatedStyle, withTiming, clamp } from 'react-native-reanimated';
import { COLORS, FONTS } from '@/constants/theme';
import PillButton from '@/components/PillButton';

const { width, height: screenHeight } = Dimensions.get('window');

const FEATURE_COLLAGE = process.env.EXPO_PUBLIC_FEATURE_COLLAGE === 'true';

type LayoutId = 'clean-grid' | 'minimal-luxury' | 'cozy-neutral' | 'bold-influencer';
type Category = ClothingItem['category'];

const CATEGORIES: { label: string; emoji: string; value: Category }[] = [
  { label: 'Top', emoji: '👕', value: 'Top' },
  { label: 'Pants', emoji: '👖', value: 'Pants' },
  { label: 'Dress', emoji: '👗', value: 'Dress' },
  { label: 'Shoes', emoji: '👟', value: 'Shoes' },
  { label: 'Bag', emoji: '👜', value: 'Bag' },
  { label: 'Jewelry', emoji: '💎', value: 'Jewelry' },
  { label: 'Accessory', emoji: '🧣', value: 'Accessory' },
  { label: 'Outerwear', emoji: '🧥', value: 'Outerwear' },
  { label: 'Other', emoji: '🛍️', value: 'Other' },
];

// Free-text size placeholder hint, varies by category. Never gates input —
// creators can type anything (M, 27, 8.5, 32B, "fits oversized", etc.).
function sizePlaceholderForCategory(category: Category | null): string {
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
    case 'Bag':
    case 'Jewelry':
    case 'Accessory':
    case 'Other':
    default:
      return 'optional';
  }
}

const LAYOUTS: { id: LayoutId; name: string; description: string; color: string }[] = [
  { id: 'clean-grid', name: 'Clean Grid', description: 'Minimal white space, editorial feel', color: '#F5F5F5' },
  { id: 'minimal-luxury', name: 'Minimal Luxury', description: 'Centered photo, items below', color: '#F7F4F0' },
  { id: 'cozy-neutral', name: 'Cozy Neutral', description: 'Warm beige tones, stacked layout', color: '#EDE8E0' },
  { id: 'bold-influencer', name: 'Bold Influencer', description: 'High contrast, full-width photo', color: '#1A1210' },
];

function generateCaption(items: ClothingItem[]): string {
  const priceItems = items.filter((i) => i.price.length > 0);
  let caption = 'Loving this outfit combo 🖤 Everything linked in bio!\n\n';
  if (priceItems.length > 0) {
    priceItems.forEach((item) => {
      caption += `${item.emoji} ${item.name || item.category} — $${item.price}\n`;
    });
    caption += '\n';
  }
  return caption;
}

export default function CreateScreen() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const { editLookId, editItemId } = useLocalSearchParams<{ editLookId?: string; editItemId?: string }>();
  const editItemIdConsumedRef = useRef<string | null>(null);

  const currentStep = useDraftLookStore((s) => s.currentStep);
  const setCurrentStep = useDraftLookStore((s) => s.setCurrentStep);
  const photoUri = useDraftLookStore((s) => s.photoUri);
  const setPhotoUri = useDraftLookStore((s) => s.setPhotoUri);
  const items = useDraftLookStore((s) => s.items);
  const setItems = useDraftLookStore((s) => s.setItems);
  const textLayers = useDraftLookStore((s) => s.textLayers);
  const setTextLayers = useDraftLookStore((s) => s.setTextLayers);
  const setHeroAspectRatio = useDraftLookStore((s) => s.setHeroAspectRatio);
  const heroAspectRatio = useDraftLookStore((s) => s.heroAspectRatio);
  const heroTransparent = useDraftLookStore((s) => s.heroTransparent);
  const setHeroTransparent = useDraftLookStore((s) => s.setHeroTransparent);
  const [showItemForm, setShowItemForm] = useState<boolean>(true);
  const [activeCategory, setActiveCategory] = useState<Category | null>(CATEGORIES[0].value);
  const [itemName, setItemName] = useState<string>('');
  const [itemPrice, setItemPrice] = useState<string>('');
  const [itemLink, setItemLink] = useState<string>('');
  const [itemCanonicalUrl, setItemCanonicalUrl] = useState<string | null>(null);
  const [itemPhotoUri, setItemPhotoUri] = useState<string>('');
  const [itemOriginalPhotoUri, setItemOriginalPhotoUri] = useState<string | undefined>(undefined);
  const [itemBrand, setItemBrand] = useState<string | null>(null);
  const [itemWornSize, setItemWornSize] = useState<string>('');
  const [itemDefaultWornSize, setItemDefaultWornSize] = useState<string | null>(null);
  const [primaryNote, setPrimaryNote] = useState<string>('');
  const [alternateDrafts, setAlternateDrafts] = useState<AlternateItem[]>([]);
  const [fetchingAltIdx, setFetchingAltIdx] = useState<number | null>(null);
  const [altFetchErrors, setAltFetchErrors] = useState<(string | null)[]>([]);
  const [altPhotoSuggestions, setAltPhotoSuggestions] = useState<(string | null)[]>([]);
  const selectedLayout = useDraftLookStore((s) => s.selectedLayout);
  const setSelectedLayout = useDraftLookStore((s) => s.setSelectedLayout);
  const caption = useDraftLookStore((s) => s.caption);
  const setCaption = useDraftLookStore((s) => s.setCaption);
  const [editingCaption, setEditingCaption] = useState<boolean>(false);
  const [lookSaved, setLookSaved] = useState<boolean>(false);
  const [showDiscardModal, setShowDiscardModal] = useState<boolean>(false);
  const [showClosetPicker, setShowClosetPicker] = useState<boolean>(false);
  const [posted, setPosted] = useState<boolean>(false);
  // Step 0 starts as a flow chooser (Collage vs Look); set once the creator picks "Style a Look".
  const [lookFlowChosen, setLookFlowChosen] = useState<boolean>(false);
  // Try-on-Model sheet (virtual model hero) — mounted at CreateScreen level.
  const [showTryOnModel, setShowTryOnModel] = useState<boolean>(false);
  // Style-a-Look text editor state. The canvas ref is flattened at save time.
  const styleCanvasRef = useRef<View>(null);
  const [selectedTextLayerId, setSelectedTextLayerId] = useState<string | null>(null);
  const [editingTextLayerId, setEditingTextLayerId] = useState<string | null>(null);
  const [exportingCanvas, setExportingCanvas] = useState<boolean>(false);
  const [textLayerDraft, setTextLayerDraft] = useState<string>('');
  const [textFontDraft, setTextFontDraft] = useState<string>('serif');
  const [textSizeDraft, setTextSizeDraft] = useState<number>(96);
  const [textColorDraft, setTextColorDraft] = useState<string>('#FFFFFF');
  const [showSaveOverlay, setShowSaveOverlay] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  // Sync lock — survives the same render closure that breaks the React-state guard.
  const isPublishingRef = useRef<boolean>(false);
  const creatorUsername = useProfileStore((s) => s.username);
  const creatorId = useAuthStore((s) => s.creatorId);
  const selectedHashtags = useDraftLookStore((s) => s.selectedHashtags);
  const setSelectedHashtags = useDraftLookStore((s) => s.setSelectedHashtags);
  const lookTitle = useDraftLookStore((s) => s.lookTitle);
  const setLookTitle = useDraftLookStore((s) => s.setLookTitle);
  const lookCategory = useDraftLookStore((s) => s.lookCategory);
  const setLookCategory = useDraftLookStore((s) => s.setLookCategory);
  const lookTags = useDraftLookStore((s) => s.lookTags);
  const setLookTags = useDraftLookStore((s) => s.setLookTags);
  const clearDraft = useDraftLookStore((s) => s.clearDraft);
  const editingLookIdFromStore = useDraftLookStore((s) => s.editingLookId);
  const clearEditingLookId = useDraftLookStore((s) => s.clearEditingLookId);

  const handleItemLinkChange = useCallback((raw: string) => {
    const normalized = normalizeUrlInput(raw);
    if (normalized && normalized !== raw.trim()) {
      setItemLink(normalized);
    } else {
      setItemLink(raw);
    }
  }, []);

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

  // Scroll flag — ref so onContentSizeChange always reads the latest value
  const needsScrollToEndRef = useRef<boolean>(false);

  // PhotoEditor state (Step 0)
  const [showPhotoEditor, setShowPhotoEditor] = useState<boolean>(false);
  const [originalPhotoUri, setOriginalPhotoUri] = useState<string>('');

  // Item color editor state (Step 1)
  const [showItemColorEditor, setShowItemColorEditor] = useState<boolean>(false);
  const [pendingItemPhotoUri, setPendingItemPhotoUri] = useState<string | null>(null);
  const [itemColorBrightness, setItemColorBrightness] = useState<number>(0);
  const [itemColorContrast, setItemColorContrast] = useState<number>(1);
  const [itemColorSaturation, setItemColorSaturation] = useState<number>(1);
  const [isProcessingItemPhoto, setIsProcessingItemPhoto] = useState<boolean>(false);

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [editingLookId, setEditingLookId] = useState<string | null>(null);
  const [isEditingDraft, setIsEditingDraft] = useState<boolean>(false);
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);

  // Link auto-fetch state
  const [isFetchingProduct, setIsFetchingProduct] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchSuccess, setFetchSuccess] = useState<boolean>(false);
  const [showPhotoSuggestion, setShowPhotoSuggestion] = useState<boolean>(false);
  const [suggestedPhotoUrl, setSuggestedPhotoUrl] = useState<string | null>(null);
  const [igCaptionCopied, setIgCaptionCopied] = useState<boolean>(false);
  const [tkCaptionCopied, setTkCaptionCopied] = useState<boolean>(false);
  const [savedPhotosCount, setSavedPhotosCount] = useState<number | null>(null);
  const [publishedLookId, setPublishedLookId] = useState<string | null>(null);
  const [storyShareMessage, setStoryShareMessage] = useState<string | null>(null);
  const [tikTokNudgeUrl, setTikTokNudgeUrl] = useState<string | null>(null);

  const updateLook = useLookStore((s) => s.updateLook);
  // After publish, clearDraft() empties the draft store but the share buttons
  // on the Posted! screen still need cover photo + items. Source those from
  // the freshly-saved look in the global store, falling back to the draft.
  const publishedLook = useLookStore((s) =>
    publishedLookId ? s.looks.find((l) => l.id === publishedLookId) : undefined
  );
  const sharePhotoUri = publishedLook?.photoUri || photoUri;
  const shareItems = publishedLook?.items ?? items;
  const captionRef = useRef<TextInput | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const checkmarkScale = useRef(new Animated.Value(0));
  const insets = useSafeAreaInsets();

  // Initialize edit mode — prefer store-carried intent (survives native tab param drops),
  // fall back to URL param. Fetch looks and retry once if not yet in store.
  useEffect(() => {
    const effectiveEditId = editingLookIdFromStore ?? editLookId ?? null;

    const populateFromLook = (look: Look) => {
      setPhotoUri(look.photoUri);
      setItems(look.items);
      setSelectedLayout(look.layout);
      setCaption(look.caption);
      setSelectedHashtags(look.hashtags ?? []);
      setLookTitle(look.title ?? '');
      setLookCategory(look.category ?? '');
      setLookTags((look.tags ?? []).join(', '));
      setIsEditMode(true);
      setEditingLookId(look.id);
      setIsEditingDraft(look.publishedAt === null);
      // Hydrate Style-a-Look text blocks. Legacy looks (no styleLayout) load empty.
      setTextLayers(look.styleLayout?.text ?? []);
      setHeroAspectRatio(look.styleLayout?.heroAspectRatio ?? null);
      // Loaded looks carry a rendered/opaque hero — not a transparent try-on PNG.
      setHeroTransparent(false);
      if (look.items.length > 0) {
        setShowItemForm(false);
      }
    };

    const findInStore = (id: string): Look | undefined => {
      const state = useLookStore.getState();
      const fromLooks = state.looks.find((l) => l.id === id);
      if (fromLooks) return fromLooks;
      for (const arr of Object.values(state.draftLooksByCreator)) {
        const hit = arr.find((l) => l.id === id);
        if (hit) return hit;
      }
      return undefined;
    };

    if (effectiveEditId) {
      const look = findInStore(effectiveEditId);
      if (look) {
        populateFromLook(look);
      } else {
        const creatorId = useAuthStore.getState().creatorId;
        if (creatorId) {
          // Try both published and draft fetches; whichever resolves first wins.
          Promise.all([
            useLookStore.getState().fetchLooksByCreator(creatorId).catch(() => {}),
            useLookStore.getState().fetchDraftLooksByCreator(creatorId).catch(() => {}),
          ]).then(() => {
            const refetched = findInStore(effectiveEditId);
            if (refetched) populateFromLook(refetched);
          });
        }
      }
    } else {
      setIsEditMode(false);
      setEditingLookId(null);
      setIsEditingDraft(false);
      // Only pre-populate hashtags when there's no in-progress draft
      if (!useDraftLookStore.getState().hasDraft()) {
        const saved = useHashtagStore.getState().savedHashtags;
        setSelectedHashtags(saved.slice(0, 4));
      }
    }
  }, [editingLookIdFromStore, editLookId]);

  // Prefetch closet items so the picker has data without visiting the Shop tab first
  useEffect(() => {
    const creatorId = useAuthStore.getState().creatorId;
    if (creatorId) {
      useLookStore.getState().loadClosetItems(creatorId);
    }
  }, []);

  // Scroll when item color editor opens
  useEffect(() => {
    if (showItemColorEditor) {
      needsScrollToEndRef.current = true;
    }
  }, [showItemColorEditor]);

  // Scroll when photo suggestion banner appears
  useEffect(() => {
    if (showPhotoSuggestion) {
      needsScrollToEndRef.current = true;
    }
  }, [showPhotoSuggestion]);

  // Consume editItemId URL param once items are loaded (entry from ItemDetailSheet)
  useEffect(() => {
    if (!editItemId) return;
    if (editItemIdConsumedRef.current === editItemId) return;
    if (!isEditMode) return;
    const idx = items.findIndex((it) => it.id === editItemId);
    if (idx < 0) return;
    const target = items[idx];
    editItemIdConsumedRef.current = editItemId;
    setItemName(target.name);
    setItemPrice(target.price);
    setItemLink(target.link);
    setItemPhotoUri(target.photoUri || '');
    setItemOriginalPhotoUri(target.originalPhotoUri);
    setItemBrand(target.brand || null);
    setItemWornSize(target.wornSize ?? target.defaultWornSize ?? '');
    setItemDefaultWornSize(target.defaultWornSize ?? null);
    setActiveCategory(target.category);
    setEditingItemIndex(idx);
    setShowItemForm(true);
    setPendingItemPhotoUri(null);
    setShowItemColorEditor(false);
    const drafts: AlternateItem[] = Array.isArray(target.alternates)
      ? target.alternates.slice(0, MAX_ALTERNATES)
      : [];
    if (drafts.length === 0 && target.alternateLink) {
      drafts.push({
        brand: null,
        category: null,
        label: target.alternateLabel || null,
        link: target.alternateLink,
        name: null,
        photo_url: null,
        price: null,
      });
    }
    setAlternateDrafts(drafts);
    setAltFetchErrors(drafts.map(() => null));
    setAltPhotoSuggestions(drafts.map(() => null));
    setFetchingAltIdx(null);
    setPrimaryNote(target.primaryNote || '');
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }, 100);
  }, [editItemId, items, isEditMode]);

  const handleClosetItemsSelected = useCallback((selectedItems: ClothingItem[]) => {
    const cloned = cloneItemsToDraft(selectedItems);
    const existingIds = new Set(items.map((i) => i.id));
    const newOnly = cloned.filter((c) => !existingIds.has(c.id));
    if (newOnly.length > 0) {
      setItems((prev) => [...prev, ...newOnly]);
      setShowItemForm(false);
    }
    setShowClosetPicker(false);
  }, [items, setItems]);

  const [isUploadingItemPhoto, setIsUploadingItemPhoto] = useState<boolean>(false);

  const overrideItemPhotoFromUri = useCallback(async (localUri: string) => {
    setIsUploadingItemPhoto(true);
    try {
      // Preserve scraper's photo as the debug record only if we don't already
      // have an originalPhotoUri (i.e. the merchant CDN URL captured at fetch).
      if (!itemOriginalPhotoUri && itemPhotoUri) {
        setItemOriginalPhotoUri(itemPhotoUri);
      }
      setItemPhotoUri(localUri);
      const publicUrl = await uploadItemPhoto(localUri);
      setItemPhotoUri(publicUrl);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e: any) {
      Alert.alert('Photo upload failed', e?.message ?? 'Please try again.');
    } finally {
      setIsUploadingItemPhoto(false);
    }
  }, [itemOriginalPhotoUri, itemPhotoUri]);

  const handleTakeItemPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera permission needed', 'Allow camera access in Settings to take a photo.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!res.canceled && res.assets[0]) {
      const stableUri = await persistPickedPhoto(res.assets[0].uri);
      await overrideItemPhotoFromUri(stableUri);
    }
  }, [overrideItemPhotoFromUri]);

  const handlePickItemPhotoFromLibrary = useCallback(async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!res.canceled && res.assets[0]) {
      const stableUri = await persistPickedPhoto(res.assets[0].uri);
      await overrideItemPhotoFromUri(stableUri);
    }
  }, [overrideItemPhotoFromUri]);

  const handleChangeItemPhoto = useCallback(() => {
    Haptics.selectionAsync();
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Take Photo', 'Choose from Library', 'Cancel'],
          cancelButtonIndex: 2,
        },
        (idx) => {
          if (idx === 0) handleTakeItemPhoto();
          else if (idx === 1) handlePickItemPhotoFromLibrary();
        }
      );
      return;
    }
    Alert.alert('Change photo', undefined, [
      { text: 'Take Photo', onPress: () => { handleTakeItemPhoto(); } },
      { text: 'Choose from Library', onPress: () => { handlePickItemPhotoFromLibrary(); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [handleTakeItemPhoto, handlePickItemPhotoFromLibrary]);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  const scrollTop = () => scrollRef.current?.scrollTo({ y: 0, animated: false });

  const handlePickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const pickedUri = await persistPickedPhoto(result.assets[0].uri);
      setOriginalPhotoUri(pickedUri);
      setPhotoUri(pickedUri);
      setHeroTransparent(false);
      setShowPhotoEditor(true);
    }
  };

  const handleClearItemPhoto = () => setItemPhotoUri('');

  const handlePickItemPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      const stableUri = await persistPickedPhoto(result.assets[0].uri);
      setItemPhotoUri(stableUri);
    }
  };

  const handlePickAltPhoto = async (idx: number) => {
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
  };

  const setAltFetchErrorAt = (idx: number, value: string | null) => {
    setAltFetchErrors((prev) => {
      const next = [...prev];
      while (next.length <= idx) next.push(null);
      next[idx] = value;
      return next;
    });
  };

  const setAltPhotoSuggestionAt = (idx: number, value: string | null) => {
    setAltPhotoSuggestions((prev) => {
      const next = [...prev];
      while (next.length <= idx) next.push(null);
      next[idx] = value;
      return next;
    });
  };

  const handleAltLinkSubmit = async (idx: number) => {
    const draft = alternateDrafts[idx];
    if (!draft) return;
    const url = (draft.link ?? '').trim();
    if (!url) {
      setAltFetchErrorAt(idx, null);
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      setAltFetchErrorAt(idx, 'Add a full URL starting with https://');
      return;
    }
    if (fetchingAltIdx !== null) return;

    setFetchingAltIdx(idx);
    setAltFetchErrorAt(idx, null);
    setAltPhotoSuggestionAt(idx, null);

    try {
      const info = await fetchProductInfo(url);
      setFetchingAltIdx(null);

      if (info.name && !(draft.name ?? '').trim()) {
        updateAlternate(idx, 'name', decodeHtmlEntities(info.name));
      }
      if (info.price && !(draft.price ?? '').trim()) {
        const cleanPrice = info.price.replace(/^\$/, '').trim();
        updateAlternate(idx, 'price', cleanPrice);
      }
      if (info.imageUrl && !draft.photo_url) {
        setAltPhotoSuggestionAt(idx, info.imageUrl);
      }
      if (info.siteName && !draft.brand) {
        const shortUrlBrands: Record<string, string> = {
          'a.co': 'Amazon',
          'amzn.to': 'Amazon',
          'amzn.com': 'Amazon',
        };
        let brandMatched = false;
        try {
          const hostname = new URL(url).hostname.replace(/^www\./, '');
          if (shortUrlBrands[hostname]) {
            const mappedBrand = shortUrlBrands[hostname];
            const allBrands = useBrandStore.getState().getAllBrands();
            const match = allBrands.find(
              (b) => b.toLowerCase() === mappedBrand.toLowerCase()
            );
            if (match) {
              updateAlternate(idx, 'brand', match);
              brandMatched = true;
            }
          }
        } catch {}
        if (!brandMatched) {
          const siteNameClean = info.siteName.toLowerCase().replace(/\.com|\.net|\.org|\.co/g, '').trim();
          const allBrands = useBrandStore.getState().getAllBrands();
          const match = allBrands.find(
            (b) => b.toLowerCase() === siteNameClean || siteNameClean.includes(b.toLowerCase())
          );
          if (match) {
            updateAlternate(idx, 'brand', match);
          }
        }
      }
    } catch (error) {
      setFetchingAltIdx(null);
      setAltFetchErrorAt(idx, 'Could not fetch product info');
    }
  };

  const handleApplyItemColorAdjustments = async () => {
    if (!pendingItemPhotoUri) return;
    setIsProcessingItemPhoto(true);
    try {
      // NOTE: expo-image-manipulator does not support
      // brightness/contrast/saturation filters directly.
      // Slider values are recorded for future use.
      // TODO: Apply actual filters when SDK supports it
      // or when backend image processing is available.
      const manipResult = await ImageManipulator.manipulateAsync(
        pendingItemPhotoUri,
        [],
        {
          compress: 0.85,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: false,
        }
      );
      setItemPhotoUri(manipResult.uri);
      setIsProcessingItemPhoto(false);
      setShowItemColorEditor(false);
      setPendingItemPhotoUri(null);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setIsProcessingItemPhoto(false);
      setItemPhotoUri(pendingItemPhotoUri);
      setShowItemColorEditor(false);
      setPendingItemPhotoUri(null);
    }
  };

  const handleUseItemAsIs = () => {
    if (!pendingItemPhotoUri) return;
    setItemPhotoUri(pendingItemPhotoUri);
    setShowItemColorEditor(false);
    setPendingItemPhotoUri(null);
  };

  const handleLinkSubmit = async () => {
    const url = itemLink.trim();

    if (!url) {
      setFetchError(null);
      setFetchSuccess(false);
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      setFetchError('Add a full URL starting with https://');
      return;
    }

    if (isFetchingProduct) return;

    setIsFetchingProduct(true);
    setFetchError(null);
    setFetchSuccess(false);
    setShowPhotoSuggestion(false);

    try {
      const info = await fetchProductInfo(url);
      setIsFetchingProduct(false);

      if (info.canonicalUrl) setItemCanonicalUrl(info.canonicalUrl);

      if (info.name && !itemName.trim()) {
        setItemName(decodeHtmlEntities(info.name));
      }

      if (info.price && !itemPrice.trim()) {
        // Strip leading $ if present (price field expects plain number)
        const cleanPrice = info.price.replace(/^\$/, '').trim();
        setItemPrice(cleanPrice);
      }

      if (info.imageUrl && !itemPhotoUri) {
        setSuggestedPhotoUrl(info.imageUrl);
        setItemOriginalPhotoUri(info.originalImageUrl ?? undefined);
        setShowPhotoSuggestion(true);
      }

      if (info.siteName && !itemBrand) {
        // Known short URL domains → real brand names
        const shortUrlBrands: Record<string, string> = {
          'a.co': 'Amazon',
          'amzn.to': 'Amazon',
          'amzn.com': 'Amazon',
        };

        let brandMatched = false;

        // Check short URL mappings first
        try {
          const hostname = new URL(url).hostname.replace(/^www\./, '');
          if (shortUrlBrands[hostname]) {
            const mappedBrand = shortUrlBrands[hostname];
            const allBrands = useBrandStore.getState().getAllBrands();
            const match = allBrands.find(
              (b) => b.toLowerCase() === mappedBrand.toLowerCase()
            );
            if (match) {
              setItemBrand(match);
              brandMatched = true;
            }
          }
        } catch {}

        // Fall back to siteName matching if no short URL match
        if (!brandMatched) {
          const siteNameClean = info.siteName
            .toLowerCase()
            .replace(/\.com$/, '')
            .replace(/\.co$/, '')
            .replace(/\.net$/, '')
            .replace(/\.org$/, '')
            .trim();

          // Skip matching if site name is too short
          // (e.g., "a" from a.co — matches everything)
          if (siteNameClean.length >= 3) {
            const allBrands = useBrandStore.getState().getAllBrands();
            const matchedBrand = allBrands.find((b) => {
              const brandLower = b.toLowerCase();
              return (
                brandLower.includes(siteNameClean) ||
                siteNameClean.includes(brandLower)
              );
            });
            if (matchedBrand) {
              setItemBrand(matchedBrand);
            }
          }
        }
      }

      if (!info.name && !info.price) {
        setFetchError("Couldn't read this page — fill in manually");
      } else {
        setFetchSuccess(true);
      }

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setIsFetchingProduct(false);
      setFetchError("Couldn't reach this link — try again");
    }
  };

  const handleAddItem = () => {
    if (!activeCategory) {
      return;
    }
    const cat = CATEGORIES.find((c) => c.value === activeCategory);
    // Auto-commit pending photo if user hasn't used color editor buttons
    const finalPhotoUri = itemPhotoUri || pendingItemPhotoUri || '';

    const cleanedAlternates: AlternateItem[] = alternateDrafts
      .filter((a) => (a?.link ?? '').trim().length > 0)
      .slice(0, MAX_ALTERNATES);
    const firstAlt = cleanedAlternates[0];

    // Worn size: free-text per-look value. If creator typed a size that
    // differs from the canonical default, "learn" it as the new default
    // (one-way — newest size sticks). If they cleared it, leave the
    // canonical default untouched (defaultWornSize: undefined → no write).
    const trimmedSize = itemWornSize.trim();
    const wornSize: string | null = trimmedSize.length > 0 ? trimmedSize : null;
    const defaultWornSizeForSave: string | null | undefined =
      wornSize !== null && wornSize !== (itemDefaultWornSize ?? null)
        ? wornSize
        : undefined;

    if (editingItemIndex !== null) {
      // Edit mode: update existing item, preserving original id
      const originalId = items[editingItemIndex].id;
      const updatedItem: ClothingItem = {
        id: originalId,
        category: activeCategory,
        name: itemName,
        price: itemPrice,
        link: itemLink,
        canonicalUrl: itemCanonicalUrl ?? undefined,
        emoji: cat?.emoji ?? '🛍️',
        photoUri: finalPhotoUri || undefined,
        originalPhotoUri: itemOriginalPhotoUri,
        brand: itemBrand,
        wornSize,
        ...(defaultWornSizeForSave !== undefined ? { defaultWornSize: defaultWornSizeForSave } : {}),
        alternates: cleanedAlternates,
        primaryNote: cleanedAlternates.length > 0 ? primaryNote || undefined : undefined,
        // Backward compat for display code (Part B will remove)
        alternateLink: firstAlt?.link || undefined,
        alternateLabel: firstAlt?.label || undefined,
      };
      const updated = items.map((item, i) =>
        i === editingItemIndex ? updatedItem : item
      );
      setItems(updated);
    } else {
      // Add mode: skip if user tapped Save without typing a name or brand —
      // don't append a blank placeholder to items state.
      const nameTrimmed = (itemName ?? '').trim();
      const brandTrimmed = (itemBrand ?? '').trim();
      if (!nameTrimmed && !brandTrimmed) {
        return;
      }
      const newItem: ClothingItem = {
        id: String(Date.now()),
        category: activeCategory,
        name: itemName,
        price: itemPrice,
        link: itemLink,
        canonicalUrl: itemCanonicalUrl ?? undefined,
        emoji: cat?.emoji ?? '🛍️',
        photoUri: finalPhotoUri || undefined,
        originalPhotoUri: itemOriginalPhotoUri,
        brand: itemBrand,
        wornSize,
        ...(defaultWornSizeForSave !== undefined ? { defaultWornSize: defaultWornSizeForSave } : {}),
        alternates: cleanedAlternates,
        primaryNote: cleanedAlternates.length > 0 ? primaryNote || undefined : undefined,
        alternateLink: firstAlt?.link || undefined,
        alternateLabel: firstAlt?.label || undefined,
      };
      setItems((prev) => [...prev, newItem]);
    }

    setActiveCategory(null);
    setItemName('');
    setItemPrice('');
    setItemLink('');
    setItemCanonicalUrl(null);
    setItemPhotoUri('');
    setItemOriginalPhotoUri(undefined);
    setItemBrand(null);
    setItemWornSize('');
    setItemDefaultWornSize(null);
    setAlternateDrafts([]);
    setAltFetchErrors([]);
    setAltPhotoSuggestions([]);
    setFetchingAltIdx(null);
    setPrimaryNote('');
    setShowItemForm(false);
    setShowItemColorEditor(false);
    setPendingItemPhotoUri(null);
    setItemColorBrightness(0);
    setItemColorContrast(1);
    setItemColorSaturation(1);
    setIsProcessingItemPhoto(false);
    setEditingItemIndex(null);
    setIsFetchingProduct(false);
    setFetchError(null);
    setFetchSuccess(false);
    setShowPhotoSuggestion(false);
    setSuggestedPhotoUrl(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    // If we were editing this item, exit edit mode
    if (editingItemIndex !== null) {
      const removedItem = items[editingItemIndex];
      if (removedItem && removedItem.id === id) {
        setEditingItemIndex(null);
        setShowItemForm(false);
      }
    }
  };

  const handleEditItem = (index: number) => {
    const item = items[index];
    if (!item) return;
    setItemName(item.name);
    setItemPrice(item.price);
    setItemLink(item.link);
    setItemCanonicalUrl(item.canonicalUrl ?? null);
    setItemPhotoUri(item.photoUri || '');
    setItemOriginalPhotoUri(item.originalPhotoUri);
    setItemBrand(item.brand || null);
    setItemWornSize(item.wornSize ?? item.defaultWornSize ?? '');
    setItemDefaultWornSize(item.defaultWornSize ?? null);
    setActiveCategory(item.category);
    setEditingItemIndex(index);
    setShowItemForm(true);
    setPendingItemPhotoUri(null);
    setShowItemColorEditor(false);
    const drafts: AlternateItem[] = Array.isArray(item.alternates)
      ? item.alternates.slice(0, MAX_ALTERNATES)
      : [];
    if (drafts.length === 0 && item.alternateLink) {
      drafts.push({
        brand: null,
        category: null,
        label: item.alternateLabel || null,
        link: item.alternateLink,
        name: null,
        photo_url: null,
        price: null,
      });
    }
    setAlternateDrafts(drafts);
    setAltFetchErrors(drafts.map(() => null));
    setAltPhotoSuggestions(drafts.map(() => null));
    setFetchingAltIdx(null);
    setPrimaryNote(item.primaryNote || '');
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }, 100);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleGenerate = () => {
    if (!caption.trim()) {
      setCaption(generateCaption(items));
    }
    setCurrentStep(3);
  };

  // ---- Style-a-Look movable text handlers ----
  const handleAddText = () => {
    const maxZ = textLayers.reduce((m, l) => Math.max(m, l.zIndex), 0);
    const newLayer: TextLayerItem = {
      id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: DEFAULT_TEXT_LAYER.text,
      fontSize: DEFAULT_TEXT_LAYER.fontSize,
      color: DEFAULT_TEXT_LAYER.color,
      fontFamily: DEFAULT_TEXT_LAYER.fontFamily,
      x: 540,
      y: 720,
      scale: DEFAULT_TEXT_LAYER.scale,
      rotation: DEFAULT_TEXT_LAYER.rotation,
      zIndex: maxZ + 1,
    };
    setTextLayers((prev) => [...prev, newLayer]);
    setSelectedTextLayerId(newLayer.id);
    setTextLayerDraft(newLayer.text);
    setTextFontDraft(newLayer.fontFamily);
    setTextSizeDraft(newLayer.fontSize);
    setTextColorDraft(newLayer.color);
    setEditingTextLayerId(newLayer.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const handleOpenTextEditor = (id: string) => {
    const layer = textLayers.find((l) => l.id === id);
    if (!layer) return;
    setTextLayerDraft(layer.text);
    setTextFontDraft(layer.fontFamily);
    setTextSizeDraft(layer.fontSize);
    setTextColorDraft(layer.color);
    setEditingTextLayerId(id);
  };

  const handleTextLayerSave = () => {
    if (!editingTextLayerId) return;
    setTextLayers((prev) =>
      prev.map((l) =>
        l.id === editingTextLayerId
          ? {
              ...l,
              text: textLayerDraft || 'Tap to edit',
              fontFamily: textFontDraft,
              fontSize: textSizeDraft,
              color: textColorDraft,
            }
          : l
      )
    );
    setEditingTextLayerId(null);
  };

  const handleTextLayerCancel = () => {
    setEditingTextLayerId(null);
  };

  const handleDeleteTextLayer = () => {
    if (!selectedTextLayerId) return;
    setTextLayers((prev) => prev.filter((l) => l.id !== selectedTextLayerId));
    setSelectedTextLayerId(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const handleCommitTextLayer = (
    id: string,
    next: { x: number; y: number; scale: number; rotation: number }
  ) => {
    setTextLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...next } : l)));
  };

  const handleSaveLook = async (mode: 'publish' | 'draft' = 'publish') => {
    // Sync guard — second tap returns immediately, regardless of render closure
    if (isPublishingRef.current) {
      console.log('[create] publish already in flight, ignoring duplicate tap');
      return;
    }
    if (lookSaved) return;

    // Username is required to publish but not to save a draft.
    if (mode === 'publish' && (!creatorUsername || !creatorUsername.trim())) {
      Alert.alert(
        'Set your username first',
        'You need a username before publishing. Open your profile to set one.',
        [
          { text: 'Cancel' },
          { text: 'Open Profile', onPress: () => router.push('/creator-account' as any) },
        ]
      );
      return;
    }

    isPublishingRef.current = true;
    setIsPublishing(true);

    // Strip blank placeholder items before save.
    // An item is "blank" if both name AND brand are empty/whitespace.
    const cleanedItems = items.filter((i) => {
      const name = (i?.name ?? '').trim();
      const brand = (i?.brand ?? '').trim();
      return name.length > 0 || brand.length > 0;
    });

    const findOriginalLook = (id: string): Look | undefined => {
      const state = useLookStore.getState();
      return (
        state.looks.find((l) => l.id === id) ??
        Object.values(state.draftLooksByCreator).flat().find((l) => l.id === id)
      );
    };

    // Style-a-Look flatten: when there are text blocks, bake them into the hero
    // by capturing the StyleLookCanvas at 1080×1440. The flattened file URI
    // becomes the cover photo. With no text blocks, the cover is unchanged.
    let coverPhotoUri = photoUri;
    let styleLayout: StyleLayout | null = null;
    if (textLayers.length > 0 && styleCanvasRef.current) {
      // Deselect so the gold selection box isn't baked in, then wait for the
      // exporting re-render to commit (double rAF) before the snapshot.
      setSelectedTextLayerId(null);
      setExportingCanvas(true);
      try {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
        coverPhotoUri = await exportCollage(styleCanvasRef.current, { width: 1080, height: 1440 });
      } catch (flattenErr) {
        console.warn('[create] style-a-look flatten failed, keeping original photo', flattenErr);
      } finally {
        setExportingCanvas(false);
      }
      styleLayout = {
        text: textLayers,
        heroAspectRatio: heroAspectRatio ?? undefined,
        canvasWidth: 1080,
        canvasHeight: 1440,
      };
    }

    let publishedOk = false;
    try {
      if (isEditMode && editingLookId) {
        // Find original look to preserve createdAt and clicks (check drafts too).
        const originalLook = findOriginalLook(editingLookId);
        const nextPublishedAt =
          mode === 'draft'
            ? null
            : (originalLook?.publishedAt ?? new Date().toISOString());
        const updatedLook: Look = {
          id: editingLookId,
          title: lookTitle || undefined,
          photoUri: coverPhotoUri,
          items: cleanedItems,
          layout: selectedLayout,
          caption,
          hashtags: selectedHashtags,
          createdAt: originalLook?.createdAt ?? new Date().toISOString(),
          clicks: originalLook?.clicks ?? 0,
          creatorId: originalLook?.creatorId ?? useAuthStore.getState().creatorId ?? undefined,
          category: lookCategory || undefined,
          tags: lookTags ? lookTags.split(',').map((t: string) => t.trim()).filter(Boolean) : [],
          archived: originalLook?.archived ?? false,
          publishedAt: nextPublishedAt,
          // Style-a-Look text layers (null when there are none).
          styleLayout,
        };
        await updateLook(updatedLook);
        setPublishedLookId(editingLookId);
        clearEditingLookId();
        publishedOk = true;
      } else {
        const result = await useLookStore.getState().addLook(
          {
            title: lookTitle || undefined,
            photoUri: coverPhotoUri,
            items: cleanedItems,
            layout: selectedLayout,
            caption,
            hashtags: selectedHashtags,
            creatorId: useAuthStore.getState().creatorId ?? undefined,
            category: lookCategory || undefined,
            tags: lookTags ? lookTags.split(',').map((t: string) => t.trim()).filter(Boolean) : [],
            archived: false,
            // Style-a-Look text layers (null when there are none).
            styleLayout,
          },
          { asDraft: mode === 'draft' }
        );
        if (!result) {
          const failTitle = mode === 'draft' ? 'Save Failed' : 'Upload Failed';
          const failBody =
            mode === 'draft'
              ? "Couldn't save your draft. Please try again."
              : "Couldn't publish your look. Please try again — if it keeps failing, sign out and back in.";
          Alert.alert(failTitle, failBody);
          return;
        }
        setPublishedLookId(result.id);
        publishedOk = true;
      }
    } catch (err: any) {
      console.error('[create] publish failed', err);

      // Silent suppression for store-layer duplicate guard
      if (err?.message === 'publish_already_in_flight') {
        return;
      }

      // Map error codes/shapes to user-facing messages
      let title = 'Upload Failed';
      let body = "Couldn't publish your look. Please try again.";

      const msg = (err?.message ?? '').toString();
      const lower = msg.toLowerCase();

      if (lower.includes('username')) {
        Alert.alert(
          'Set a username first',
          'You need a username before publishing. Open your profile to set one.',
          [
            { text: 'Cancel' },
            { text: 'Open Profile', onPress: () => router.push('/creator-account' as any) },
          ]
        );
        return;
      } else if (err?.code === 'PGRST301' || err?.code === '42501') {
        title = 'Session expired';
        body = 'Try signing out and back in to refresh your session.';
      } else if (lower.includes('network') || lower.includes('fetch')) {
        title = 'Network error';
        body = 'Check your connection and try again.';
      } else if (err?.code === '23505') {
        title = 'Duplicate look';
        body = "Looks like this was already saved. Pull to refresh and check your studio.";
      } else if (msg) {
        body = msg;
      }

      Alert.alert(title, body);
      return;
    } finally {
      isPublishingRef.current = false;
      setIsPublishing(false);
    }

    if (!publishedOk) return;

    clearDraft();

    // Drafts: skip the "Posted!" overlay + Share step. Hop back to where the
    // creator came from with a quick haptic + Drafts toast.
    if (mode === 'draft') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved as draft', "We've kept this look in your Drafts.", [
        {
          text: 'OK',
          onPress: () => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/creator-account' as any);
            }
          },
        },
      ]);
      return;
    }

    setLookSaved(true);
    setPosted(true);
    setShowSaveOverlay(true);
    checkmarkScale.current.setValue(0);
    Animated.spring(checkmarkScale.current, {
      toValue: 1,
      friction: 5,
      tension: 40,
      useNativeDriver: true,
    }).start();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => {
      setShowSaveOverlay(false);
      setCurrentStep(4);
    }, 1200);
  };

  const handleSaveToRoll = async () => {
    if (!photoUri) return;
    const { status } = await MediaLibrary.requestPermissionsAsync(true);
    if (status === 'granted') {
      await MediaLibrary.saveToLibraryAsync(photoUri);
    }
  };

  const handleCopyCaption = async () => {
    await Clipboard.setStringAsync(caption);
  };

  const handleShare = async () => {
    await shareLook({
      id: publishedLookId,
      caption,
      items: shareItems,
      hashtags: selectedHashtags,
    });
  };

  const handleShareInstagram = async () => {
    const shareText = buildShareText({ caption, items: shareItems, hashtags: selectedHashtags });

    // 1. Copy caption first — this must never fail
    await Clipboard.setStringAsync(shareText);
    setIgCaptionCopied(true);
    setTimeout(() => setIgCaptionCopied(false), 3000);

    // 2. Try to save photos — failures here must not block Instagram opening
    let photoCount = 0;
    try {
      if (sharePhotoUri) {
        photoCount = await savePhotosToAlbum({ coverPhotoUri: sharePhotoUri, items: shareItems });
      }
    } catch (error) {
      console.warn('Photo save failed:', error);
    }

    // 3. Open Instagram — always runs regardless of photo save result
    const message = photoCount > 0
      ? `${photoCount} photo${photoCount !== 1 ? 's' : ''} saved to your Styled in Motion album. Caption copied!\n\nIn Instagram, tap + and select your photos for a carousel post.`
      : `Caption copied to clipboard! Paste it into your Instagram post.`;
    Linking.openURL('instagram://app').catch(() => {});
    // Show tip after opening
    setTimeout(() => {
      Alert.alert('Caption Copied!', message, [{ text: 'Got it' }]);
    }, 500);
  };

  const handleShareTikTok = async () => {
    if (!sharePhotoUri) {
      Alert.alert('Add a cover photo first', 'TikTok needs a cover image to share.');
      return;
    }

    setTkCaptionCopied(true);
    setTimeout(() => setTkCaptionCopied(false), 3000);

    const outcome = await shareToTikTok({
      id: publishedLookId,
      title: publishedLook?.title || caption || 'New look',
      caption,
      shortCode: publishedLook?.shortCode ?? null,
      hashtags: selectedHashtags,
      photoUri: sharePhotoUri,
    });

    if (outcome.stage === 'shared' || outcome.stage === 'cancelled') {
      setTikTokNudgeUrl(outcome.clipboardUrl);
    } else if (outcome.stage === 'sdk-unavailable') {
      // Native module isn't linked (e.g. running in Expo Go). Fall back to
      // the legacy URL-scheme nudge so the creator still lands in TikTok.
      Linking.openURL('tiktok://').catch(() => {});
    } else if (outcome.stage === 'missing-photo') {
      Alert.alert('Add a cover photo first', 'TikTok needs a cover image to share.');
    } else if (outcome.stage === 'error') {
      console.warn('[handleShareTikTok] error:', outcome.message);
      Alert.alert('TikTok share failed', outcome.message || 'Please try again.');
    }
  };

  const handleSaveAllPhotos = async () => {
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
      if (sharePhotoUri) {
        await MediaLibrary.saveToLibraryAsync(sharePhotoUri);
        count++;
      }
      for (const item of shareItems) {
        if (item.photoUri) {
          await MediaLibrary.saveToLibraryAsync(item.photoUri);
          count++;
        }
      }
      setSavedPhotosCount(count);
    } catch (e: any) {
      Alert.alert('Couldn\u2019t save photos', e?.message ?? 'An unexpected error occurred.');
    }
  };

  const handleShareToStory = async () => {
    const shareUrl = buildLookShareUrl(publishedLookId);
    if (!shareUrl) return;

    // 1. Copy URL (not caption) — must always succeed
    try {
      await Clipboard.setStringAsync(shareUrl);
    } catch (error) {
      console.warn('Clipboard copy failed:', error);
    }

    // 2. Save cover photo only — items: [] so nothing else is persisted
    let photoSaved = true;
    try {
      if (sharePhotoUri) {
        await savePhotosToAlbum({ coverPhotoUri: sharePhotoUri, items: [] });
      } else {
        photoSaved = false;
      }
    } catch (error) {
      console.warn('Cover photo save failed:', error);
      photoSaved = false;
    }

    // 3. Inline confirmation banner (no Alert)
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
  };

  const handleCreateAnother = () => {
    clearDraft();
    setShowItemForm(true);
    setActiveCategory(CATEGORIES[0].value);
    setItemName('');
    setItemPrice('');
    setItemLink('');
    setItemCanonicalUrl(null);
    setItemPhotoUri('');
    setItemOriginalPhotoUri(undefined);
    setItemBrand(null);
    setItemWornSize('');
    setItemDefaultWornSize(null);
    setAlternateDrafts([]);
    setAltFetchErrors([]);
    setAltPhotoSuggestions([]);
    setFetchingAltIdx(null);
    setPrimaryNote('');
    setEditingCaption(false);
    setLookSaved(false);
    setPosted(false);
    setShowSaveOverlay(false);
    setShowItemColorEditor(false);
    setPendingItemPhotoUri(null);
    setItemColorBrightness(0);
    setItemColorContrast(1);
    setItemColorSaturation(1);
    setIsProcessingItemPhoto(false);
    setIsEditMode(false);
    setEditingLookId(null);
    setEditingItemIndex(null);
    setIsFetchingProduct(false);
    setFetchError(null);
    setFetchSuccess(false);
    setShowPhotoSuggestion(false);
    setSuggestedPhotoUrl(null);
    setIgCaptionCopied(false);
    setSavedPhotosCount(null);
    setPublishedLookId(null);
    setStoryShareMessage(null);
    setLookFlowChosen(false);
    setShowTryOnModel(false);
    setSelectedTextLayerId(null);
    setEditingTextLayerId(null);
    setExportingCanvas(false);
    scrollTop();
  };

  const STEP_LABELS = ['Items', 'Photo', 'Layout', 'Preview', 'Share'];

  // The Collage-vs-Look chooser gates the very first step for brand-new looks.
  // Once chosen (or in edit mode, or once a photo/items exist) the Items step shows.
  const showFlowChooser =
    FEATURE_COLLAGE && !isEditMode && !photoUri && items.length === 0 && !lookFlowChosen;

  const hasFormData = useDraftLookStore.getState().hasDraft();

  const handleBackPress = () => {
    if (currentStep === 0) {
      router.back();
    } else if (hasFormData) {
      setShowDiscardModal(true);
    } else {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleDiscard = () => {
    setShowDiscardModal(false);
    handleCreateAnother();
    router.back();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="create-screen">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Step progress + back button */}
        <View style={styles.progressContainer}>
          {currentStep === 0 ? (
            <Pressable
              onPress={() => {
                if (hasFormData) {
                  setShowDiscardModal(true);
                } else if (lookFlowChosen) {
                  // Return to the Collage / Look chooser instead of leaving Create.
                  setLookFlowChosen(false);
                } else {
                  router.back();
                }
              }}
              style={styles.backButton}
              testID="step0-cancel-button"
            >
              <ArrowLeft size={18} color="#3D3330" />
            </Pressable>
          ) : currentStep > 0 && currentStep < 4 ? (
            <Pressable
              onPress={handleBackPress}
              style={styles.backButton}
              testID="step-back-button"
            >
              <ArrowLeft size={18} color="#3D3330" />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => {
                if (posted) {
                  router.back();
                } else {
                  setCurrentStep(3);
                }
              }}
              style={styles.backButton}
              testID="step4-back-button"
            >
              <ArrowLeft size={18} color="#3D3330" />
            </Pressable>
          )}
          <View style={styles.dotsRow}>
            {STEP_LABELS.map((label, idx) => (
              <View key={label} style={styles.stepItem}>
                <View
                  style={[
                    styles.stepDot,
                    idx <= currentStep && styles.stepDotActive,
                    idx === currentStep && styles.stepDotCurrent,
                  ]}
                >
                  {idx < currentStep ? (
                    <Text style={styles.stepDotCheck}>✓</Text>
                  ) : (
                    <Text style={[styles.stepDotNumber, idx === currentStep && styles.stepDotNumberActive]}>
                      {idx + 1}
                    </Text>
                  )}
                </View>
                {idx < STEP_LABELS.length - 1 && (
                  <View style={[styles.stepLine, idx < currentStep && styles.stepLineActive]} />
                )}
              </View>
            ))}
          </View>
          <View style={styles.backButtonPlaceholder} />
        </View>

        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            if (needsScrollToEndRef.current) {
              scrollRef.current?.scrollToEnd({ animated: false });
              needsScrollToEndRef.current = false;
            }
          }}
        >
          {currentStep === 0 && (
          showFlowChooser ? (
            <StepChooseFlow
              onChooseCollage={() => router.push('/collage-builder')}
              onChooseLook={() => { setLookFlowChosen(true); scrollTop(); }}
            />
          ) : (
            <StepAddItems
              items={items}
              showForm={showItemForm}
              onSetShowForm={setShowItemForm}
              activeCategory={activeCategory}
              itemName={itemName}
              itemPrice={itemPrice}
              itemLink={itemLink}
              itemPhotoUri={itemPhotoUri}
              itemBrand={itemBrand}
              itemWornSize={itemWornSize}
              onSelectCategory={setActiveCategory}
              onChangeName={setItemName}
              onChangePrice={setItemPrice}
              onChangeWornSize={setItemWornSize}
              onChangeLink={handleItemLinkChange}
              onClearPhoto={handleClearItemPhoto}
              onPickItemPhoto={handlePickItemPhoto}
              onAddItem={handleAddItem}
              onRemoveItem={handleRemoveItem}
              onEditItem={handleEditItem}
              onScrollToTop={scrollTop}
              onChangeBrand={setItemBrand}
              editingItemIndex={editingItemIndex}
              onSetEditingItemIndex={setEditingItemIndex}
              showItemColorEditor={showItemColorEditor}
              pendingItemPhotoUri={pendingItemPhotoUri}
              itemColorBrightness={itemColorBrightness}
              itemColorContrast={itemColorContrast}
              itemColorSaturation={itemColorSaturation}
              isProcessingItemPhoto={isProcessingItemPhoto}
              onSetItemColorBrightness={setItemColorBrightness}
              onSetItemColorContrast={setItemColorContrast}
              onSetItemColorSaturation={setItemColorSaturation}
              onUseItemAsIs={handleUseItemAsIs}
              onApplyItemAdjustments={handleApplyItemColorAdjustments}
              isFetchingProduct={isFetchingProduct}
              fetchError={fetchError}
              fetchSuccess={fetchSuccess}
              showPhotoSuggestion={showPhotoSuggestion}
              suggestedPhotoUrl={suggestedPhotoUrl}
              onLinkSubmit={handleLinkSubmit}
              onSetShowPhotoSuggestion={setShowPhotoSuggestion}
              onSetItemPhotoUri={setItemPhotoUri}
              onSetSuggestedPhotoUrl={setSuggestedPhotoUrl}
              alternateDrafts={alternateDrafts}
              fetchingAltIdx={fetchingAltIdx}
              altFetchErrors={altFetchErrors}
              altPhotoSuggestions={altPhotoSuggestions}
              primaryNote={primaryNote}
              onChangePrimaryNote={setPrimaryNote}
              onUpdateAlternate={updateAlternate}
              onChangeAltLink={handleAltLinkChange}
              onAddAlternateSlot={addAlternateSlot}
              onRemoveAlternateSlot={removeAlternateSlot}
              onAltLinkSubmit={handleAltLinkSubmit}
              onPickAltPhoto={handlePickAltPhoto}
              onAcceptAltPhotoSuggestion={(idx) => {
                const url = altPhotoSuggestions[idx];
                if (url) updateAlternate(idx, 'photo_url', url);
                setAltPhotoSuggestionAt(idx, null);
              }}
              onDismissAltPhotoSuggestion={(idx) => setAltPhotoSuggestionAt(idx, null)}
              onScrollToEnd={() => {
                setTimeout(() => {
                  scrollRef.current?.scrollToEnd({ animated: true });
                }, 300);
              }}
              onOpenClosetPicker={() => setShowClosetPicker(true)}
              onChangeItemPhoto={handleChangeItemPhoto}
              isUploadingItemPhoto={isUploadingItemPhoto}
            />
          )
          )}

          {currentStep === 1 && (
            <StepUploadPhoto
              photoUri={photoUri}
              onPickPhoto={handlePickPhoto}
              onNext={() => { setCurrentStep(2); scrollTop(); }}
              isEditMode={isEditMode}
              lookTitle={lookTitle}
              onLookTitleChange={setLookTitle}
              showPhotoEditor={showPhotoEditor}
              onSetShowPhotoEditor={setShowPhotoEditor}
              originalPhotoUri={originalPhotoUri}
              hasItems={items.length > 0}
              onOpenTryOnModel={() => setShowTryOnModel(true)}
              onPhotoEditorSave={async (editedUri: string) => {
                try {
                  const resized = await ImageManipulator.manipulateAsync(
                    editedUri,
                    [{ resize: { width: 1200, height: 1600 } }],
                    { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
                  );
                  setPhotoUri(resized.uri);
                } catch {
                  setPhotoUri(editedUri);
                }
                // Editor output is a flattened JPEG — no longer transparent.
                setHeroTransparent(false);
                setShowPhotoEditor(false);
              }}
              onResetPhoto={() => {
                if (originalPhotoUri) {
                  setPhotoUri(originalPhotoUri);
                }
              }}
              onApplyBackdropOutput={(outputUrl: string) => {
                setPhotoUri(outputUrl);
                // A backdrop was composited in, so the hero is opaque again.
                setHeroTransparent(false);
              }}
            />
          )}

          {currentStep === 2 && (
            <StepChooseLayout
              selectedLayout={selectedLayout}
              onSelectLayout={setSelectedLayout}
            />
          )}

          {currentStep === 3 && (
            <StepPreview
              photoUri={photoUri}
              items={items}
              styleCanvasRef={styleCanvasRef}
              textLayers={textLayers}
              selectedTextLayerId={selectedTextLayerId}
              exportingCanvas={exportingCanvas}
              onSelectTextLayer={setSelectedTextLayerId}
              onCommitTextLayer={handleCommitTextLayer}
              onAddText={handleAddText}
              onEditText={handleOpenTextEditor}
              onDeleteText={handleDeleteTextLayer}
              caption={caption}
              editingCaption={editingCaption}
              captionRef={captionRef}
              selectedLayout={selectedLayout}
              selectedHashtags={selectedHashtags}
              lookTitle={lookTitle}
              onLookTitleChange={setLookTitle}
              lookCategory={lookCategory}
              onLookCategoryChange={setLookCategory}
              lookTags={lookTags}
              onLookTagsChange={setLookTags}
              onEditCaption={() => {
                setEditingCaption(true);
                setTimeout(() => captionRef.current?.focus(), 100);
              }}
              onChangeCaption={setCaption}
              onPublish={() => { handleSaveLook('publish'); scrollTop(); }}
              onSaveDraft={() => { handleSaveLook('draft'); scrollTop(); }}
              isEditMode={isEditMode}
              isEditingDraft={isEditingDraft}
              onHashtagsChange={setSelectedHashtags}
              isPublishing={isPublishing}
              transparentBg={heroTransparent}
            />
          )}

          {currentStep === 4 && posted === true && (
            <View style={styles.stepContainer}>
              <View style={styles.successIndicator}>
                <Text style={styles.successEmoji}>✓</Text>
              </View>
              <Text style={[styles.stepTitle, { textAlign: 'center' }]}>
                {isEditMode ? 'Look Updated!' : 'Posted!'}
              </Text>
              <Text style={[styles.stepSubtitle, { textAlign: 'center' }]}>
                {isEditMode
                  ? 'Your look has been updated.'
                  : 'Your look has been saved successfully'}
              </Text>

              {igCaptionCopied ? (
                <View style={{ backgroundColor: '#E8F5E9', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, marginTop: 8, marginBottom: 4 }}>
                  <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#2E7D32', textAlign: 'center' }}>Caption copied! Paste it in your Instagram post.</Text>
                </View>
              ) : null}

              {tkCaptionCopied ? (
                <View style={{ backgroundColor: '#E8F5E9', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, marginTop: 8, marginBottom: 4 }}>
                  <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#2E7D32', textAlign: 'center' }}>Caption copied! Paste it in your TikTok post.</Text>
                </View>
              ) : null}

<View style={{ width: '100%', marginTop: 32, gap: 0 }}>
                <ShareActionsBlock
                  onShareLook={handleShare}
                  onSaveAllPhotos={handleSaveAllPhotos}
                  onShareToStory={handleShareToStory}
                  onShareInstagram={handleShareInstagram}
                  onShareTikTok={handleShareTikTok}
                  savedPhotosCount={savedPhotosCount}
                  storyShareMessage={storyShareMessage}
                  testIDPrefix="posted"
                />

                {/* Divider */}
                <View style={{ height: 1, backgroundColor: '#E8E0D8', marginVertical: 16 }} />

                {/* Back to Home */}
                <Pressable
                  style={{ width: '100%', height: 48, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D4C8C2', borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}
                  onPress={() => {
                    handleCreateAnother();
                    if (!isEditMode) {
                      router.replace('/(tabs)');
                    }
                  }}
                  testID="success-go-home"
                >
                  <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 15, fontWeight: '500', color: '#1A1210' }}>
                    {isEditMode ? 'Done' : 'Back to Home'}
                  </Text>
                </Pressable>

                {/* Create Another — text link */}
                {!isEditMode ? (
                  <Pressable
                    style={{ alignItems: 'center', paddingVertical: 8, marginTop: 4 }}
                    onPress={handleCreateAnother}
                    testID="success-create-another"
                  >
                    <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 15, fontWeight: '500', color: '#B87063', textAlign: 'center' }}>Create Another</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          )}

          {currentStep === 4 && posted !== true && (
            <StepExport
              onShareLook={handleShare}
              onSaveAllPhotos={handleSaveAllPhotos}
              onShareToStory={handleShareToStory}
              onShareInstagram={handleShareInstagram}
              onShareTikTok={handleShareTikTok}
              savedPhotosCount={savedPhotosCount}
              storyShareMessage={storyShareMessage}
              onCopyCaption={handleCopyCaption}
              onCreateAnother={handleCreateAnother}
              onGoHome={() => router.push('/(tabs)')}
            />
          )}
        </ScrollView>

        {/* Fixed footer for step 0 (Items) — contextual action */}
        {currentStep === 0 && !showItemForm && !showFlowChooser && (
          <View style={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 16) + 60, paddingTop: 8, backgroundColor: '#F7F4F0', borderTopWidth: 1, borderTopColor: '#E8E0D8' }}>
            {items.length === 0 ? (
              <View>
                <PillButton
                  label="Next: Add Photo →"
                  variant="primary"
                  fullWidth
                  disabled
                  onPress={() => {}}
                  testID="step1-next"
                />
                <Text style={styles.itemsHintText}>Add at least one item to continue</Text>
              </View>
            ) : (
              <PillButton
                label={`Next: Add Photo (${items.length} piece${items.length !== 1 ? 's' : ''}) →`}
                variant="primary"
                fullWidth
                onPress={() => { setCurrentStep(1); scrollTop(); }}
                testID="step1-next"
              />
            )}
          </View>
        )}

        {/* Fixed footer for step 2 */}
        {currentStep === 2 && (
          <View style={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 16) + 60, paddingTop: 8, backgroundColor: '#F7F4F0', borderTopWidth: 1, borderTopColor: '#E8E0D8' }}>
            <PillButton
              label={isEditMode ? 'Next: Preview →' : 'Generate My Post ✨'}
              variant="primary"
              fullWidth
              onPress={() => { handleGenerate(); scrollTop(); }}
              testID="step2-next"
            />
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Try on Model — virtual model hero generation (reused from collage flow) */}
      <TryOnModelSheet
        visible={showTryOnModel}
        onClose={() => setShowTryOnModel(false)}
        items={items}
        creatorId={creatorId ?? null}
        onGenerated={(url, { aspectRatio, noBackground }) => {
          // Returned URL is an https Supabase URL — set directly, no re-upload.
          setPhotoUri(url);
          setHeroAspectRatio(aspectRatio ?? null);
          // No-bg results are transparent PNGs — flag them so the canvas/preview
          // render them over a checkerboard instead of a solid card.
          setHeroTransparent(!!noBackground);
          setShowTryOnModel(false);
        }}
      />

      {/* Style-a-Look text-edit modal (text / font / size / color / Done) */}
      {editingTextLayerId != null ? (
        <Modal visible transparent animationType="fade">
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
              <View style={{ backgroundColor: '#FBF7F4', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 }}>
                <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 16, color: '#1A1210', marginBottom: 12 }}>Edit text</Text>
                <TextInput
                  value={textLayerDraft}
                  onChangeText={setTextLayerDraft}
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderWidth: 1.5,
                    borderColor: '#E0D8D0',
                    borderRadius: 10,
                    padding: 12,
                    fontSize: 16,
                    fontFamily: 'DMSans_400Regular',
                    color: '#1A1210',
                    minHeight: 80,
                    marginBottom: 16,
                  }}
                  multiline
                  autoFocus
                  cursorColor="#2C2C2C"
                  selectionColor="rgba(44, 44, 44, 0.3)"
                  testID="style-text-layer-input"
                />

                {/* Live preview swatch */}
                <View
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: 10,
                    borderWidth: 1.5,
                    borderColor: '#E0D8D0',
                    paddingVertical: 18,
                    paddingHorizontal: 16,
                    minHeight: 72,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 16,
                  }}
                  testID="style-text-layer-preview"
                >
                  <Text
                    numberOfLines={2}
                    style={{
                      fontFamily: TEXT_FONT_OPTIONS.find((o) => o.token === textFontDraft)?.family
                        ?? 'CormorantGaramond_600SemiBold',
                      fontSize: Math.max(18, Math.min(textSizeDraft * 0.38, 44)),
                      color: textColorDraft,
                      textAlign: 'center',
                    }}
                  >
                    {textLayerDraft || 'Tap to edit'}
                  </Text>
                </View>

                {/* Font picker */}
                <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#6B5E58', marginBottom: 6 }}>Font</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                  {TEXT_FONT_OPTIONS.map((opt) => {
                    const selected = textFontDraft === opt.token;
                    return (
                      <Pressable
                        key={opt.token}
                        onPress={() => setTextFontDraft(opt.token)}
                        testID={`style-text-font-${opt.token}`}
                        style={{
                          flex: 1,
                          paddingVertical: 12,
                          borderRadius: 10,
                          borderWidth: 1.5,
                          borderColor: selected ? '#B87063' : '#E0D8D0',
                          backgroundColor: selected ? '#FBE9E3' : '#FFFFFF',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ fontFamily: opt.family, fontSize: 22, color: '#1A1210' }}>Aa</Text>
                        <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#6B5E58', marginTop: 2 }}>{opt.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Size stepper */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#6B5E58' }}>Size</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Pressable
                      onPress={() => setTextSizeDraft((s) => Math.max(24, s - 8))}
                      testID="style-text-size-minus"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        borderWidth: 1.5,
                        borderColor: '#1A1210',
                        backgroundColor: '#FFFFFF',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 18, color: '#1A1210', lineHeight: 20 }}>−</Text>
                    </Pressable>
                    <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#1A1210', minWidth: 32, textAlign: 'center' }}>
                      {textSizeDraft}
                    </Text>
                    <Pressable
                      onPress={() => setTextSizeDraft((s) => Math.min(160, s + 8))}
                      testID="style-text-size-plus"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        borderWidth: 1.5,
                        borderColor: '#1A1210',
                        backgroundColor: '#FFFFFF',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 18, color: '#1A1210', lineHeight: 20 }}>+</Text>
                    </Pressable>
                  </View>
                </View>

                {/* Color row */}
                <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#6B5E58', marginBottom: 6 }}>Color</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
                  {TEXT_COLOR_OPTIONS.map((c) => {
                    const selected = textColorDraft.toUpperCase() === c.toUpperCase();
                    return (
                      <Pressable
                        key={c}
                        onPress={() => setTextColorDraft(c)}
                        testID={`style-text-color-${c.replace('#', '')}`}
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 17,
                          backgroundColor: c,
                          borderWidth: selected ? 2.5 : 1.5,
                          borderColor: selected ? '#B87063' : '#D8CFC7',
                        }}
                      />
                    );
                  })}
                </View>

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable
                    className="bg-white rounded-full py-3.5 px-5 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
                    style={{ flex: 1 }}
                    onPress={handleTextLayerCancel}
                    testID="style-text-layer-cancel"
                  >
                    <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#1A1210' }}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
                    style={{ flex: 1 }}
                    onPress={handleTextLayerSave}
                    testID="style-text-layer-save"
                  >
                    <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFFFFF' }}>Done</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}

      {/* Discard confirmation modal */}
      <Modal
        visible={showDiscardModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDiscardModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Discard this look?</Text>
            <Text style={styles.modalMessage}>You have unsaved changes that will be lost.</Text>
            <PillButton
              label="Keep Editing"
              variant="primary"
              fullWidth
              onPress={() => setShowDiscardModal(false)}
              testID="discard-modal-keep"
            />
            <Pressable
              style={({ pressed }) => [styles.ghostButton, pressed && { opacity: 0.6 }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                handleDiscard();
              }}
              testID="discard-modal-discard"
            >
              <Text style={[styles.ghostButtonText, { color: '#C4A882' }]}>Discard</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Publishing overlay — shown while uploading to Supabase */}
      {isPublishing ? (
        <View style={styles.saveOverlay}>
          <View style={styles.saveOverlayCard}>
            <ActivityIndicator size="large" color="#1A1210" testID="publishing-indicator" />
            <Text style={styles.saveOverlayTitle}>Publishing...</Text>
            <Text style={styles.saveOverlaySubtitle}>Uploading your look</Text>
          </View>
        </View>
      ) : null}

      {/* Save overlay — shown briefly after saving look */}
      {showSaveOverlay ? (
        <View style={styles.saveOverlay}>
          <View style={styles.saveOverlayCard}>
            <Animated.View style={{ transform: [{ scale: checkmarkScale.current }] }}>
              <View style={styles.checkCircle}>
                <Check size={32} color="#FFFFFF" />
              </View>
            </Animated.View>
            <Text style={styles.saveOverlayTitle}>
              {isEditMode ? 'Look Updated!' : 'Look Saved!'}
            </Text>
            <Text style={styles.saveOverlaySubtitle}>
              {isEditMode ? 'Your changes have been saved' : 'Now choose how to share it'}
            </Text>
          </View>
        </View>
      ) : null}
      <TikTokPostShareNudge
        visible={tikTokNudgeUrl !== null}
        shopUrl={tikTokNudgeUrl}
        onDismiss={() => setTikTokNudgeUrl(null)}
      />
      <ClosetPickerSheet
        visible={showClosetPicker}
        existingItemIds={items.map((i) => i.id)}
        onClose={() => setShowClosetPicker(false)}
        onItemsSelected={handleClosetItemsSelected}
      />
    </SafeAreaView>
  );
}

// ---- Step 0: Upload Photo ----
// ---- Step 0: Choose flow (Collage vs Look) ----
function StepChooseFlow({
  onChooseCollage,
  onChooseLook,
}: {
  onChooseCollage: () => void;
  onChooseLook: () => void;
}) {
  // NOTE: cards are styled via NativeWind className, not StyleSheet on <Pressable> —
  // StyleSheet/function-form styles on Pressable render unreliably here (see CLAUDE.md).
  // className must be an inline string literal so NativeWind can compile it.
  const cardShadow = { shadowColor: '#1A1210', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 };
  return (
    <View style={[styles.chooseContainer, { minHeight: screenHeight * 0.7 }]}>
      <Text style={styles.chooseTitle}>What are you creating?</Text>
      <Text style={styles.chooseSubtitle}>Choose how you want to build this look.</Text>

      <View style={styles.choiceCardsWrap}>
        <Pressable
          className="bg-white rounded-[22px] border border-[#E8E0D8] px-5 py-6 active:opacity-90"
          style={cardShadow}
          onPress={() => { Haptics.selectionAsync(); onChooseCollage(); }}
          testID="choose-collage"
        >
          <View style={styles.choiceHeader}>
            <View style={[styles.choiceIcon, { backgroundColor: COLORS.ink }]}>
              <Scissors size={24} color={COLORS.bg} />
            </View>
            <Text style={styles.choiceCardTitle}>Build a Collage</Text>
          </View>
          <Text style={styles.choiceCardSub}>
            Cut out clothing and arrange your own editorial layout — the stylist&apos;s canvas.
          </Text>
        </Pressable>

        <Pressable
          className="bg-white rounded-[22px] border border-[#E8E0D8] px-5 py-6 active:opacity-90"
          style={cardShadow}
          onPress={() => { Haptics.selectionAsync(); onChooseLook(); }}
          testID="choose-look"
        >
          <View style={styles.choiceHeader}>
            <View style={[styles.choiceIcon, { backgroundColor: COLORS.rose }]}>
              <Camera size={24} color="#FFFFFF" />
            </View>
            <Text style={styles.choiceCardTitle}>Style a Look</Text>
          </View>
          <Text style={styles.choiceCardSub}>
            Upload a single photo and tag the items you&apos;re wearing.
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function StepUploadPhoto({
  photoUri,
  onPickPhoto,
  onNext,
  isEditMode,
  lookTitle,
  onLookTitleChange,
  showPhotoEditor,
  onSetShowPhotoEditor,
  originalPhotoUri,
  onPhotoEditorSave,
  onResetPhoto,
  onApplyBackdropOutput,
  hasItems,
  onOpenTryOnModel,
}: {
  photoUri: string;
  onPickPhoto: () => void;
  onNext: () => void;
  isEditMode: boolean;
  lookTitle: string;
  onLookTitleChange: (v: string) => void;
  showPhotoEditor: boolean;
  onSetShowPhotoEditor: (v: boolean) => void;
  originalPhotoUri: string;
  onPhotoEditorSave: (editedUri: string) => void;
  onResetPhoto: () => void;
  onApplyBackdropOutput: (outputUrl: string) => void;
  hasItems: boolean;
  onOpenTryOnModel: () => void;
}) {
  const hasPhoto = !!photoUri && photoUri.length > 0;
  const displayUri = photoUri;
  const userType = useAuthStore((s) => s.userType);
  const isCreator = userType === 'creator';
  const [showBackdropPicker, setShowBackdropPicker] = useState<boolean>(false);
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [backdropError, setBackdropError] = useState<string | null>(null);

  const handleBackdropPick = useCallback(async (pick: BackdropPick) => {
    if (!photoUri) return;
    setShowBackdropPicker(false);
    setBackdropError(null);
    setIsRendering(true);
    try {
      const sourceUrl = await ensurePublicPhotoUrl(photoUri);
      const res = pick === 'remove'
        ? await requestRemoveBg(sourceUrl)
        : await requestSwapBg(sourceUrl, pick);
      onApplyBackdropOutput(res.output_url);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      const friendly =
        e instanceof VtoError && e.code === 'daily_quota_exceeded'
          ? "You've hit today's limit. Try again tomorrow."
          : e instanceof VtoError && e.code === 'photoroom_failed'
            ? "Couldn't apply that backdrop. Try a different one."
            : 'Something went wrong applying the backdrop.';
      setBackdropError(friendly);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsRendering(false);
    }
  }, [photoUri, onApplyBackdropOutput]);

  // Gesture state for pinch-to-zoom and pan
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Container dimensions for clamp (3/4 aspect ratio, full width minus 40px padding)
  const containerWidth = width - 40;
  const containerHeight = containerWidth * (4 / 3);

  // Reset transforms when photo changes
  React.useEffect(() => {
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [displayUri]);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = clamp(savedScale.value * e.scale, 1, 3);
      const maxX = (scale.value - 1) * containerWidth / 2;
      const maxY = (scale.value - 1) * containerHeight / 2;
      translateX.value = clamp(translateX.value, -maxX, maxX);
      translateY.value = clamp(translateY.value, -maxY, maxY);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      const maxX = (scale.value - 1) * containerWidth / 2;
      const maxY = (scale.value - 1) * containerHeight / 2;
      translateX.value = clamp(savedTranslateX.value + e.translationX, -maxX, maxX);
      translateY.value = clamp(savedTranslateY.value + e.translationY, -maxY, maxY);
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const composed = Gesture.Simultaneous(pinchGesture, panGesture);

  const photoAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const isResetDisabled = photoUri === originalPhotoUri;

  return (
    <View style={styles.step0Container}>
      {/* Header */}
      <View style={styles.step0Header}>
        <Text style={styles.stepTitle}>{isEditMode ? 'Edit Look' : 'Your Outfit'}</Text>
        <Text style={styles.stepSubtitle}>{hasItems ? 'Upload your photo or try it on a model' : 'Upload a photo of your look'}</Text>
        <TextInput
          style={styles.titleInput}
          value={lookTitle}
          onChangeText={onLookTitleChange}
          placeholder="Name this look..."
          placeholderTextColor="#A89990"
          cursorColor="#2C2C2C"
          selectionColor="rgba(44, 44, 44, 0.3)"
          testID="look-title-input"
        />
      </View>

      {/* Image area — 3:4 portrait aspect ratio for full outfits */}
      <Pressable
        style={styles.step0PhotoArea}
        onPress={onPickPhoto}
        testID="photo-upload-area"
      >
        {displayUri ? (
          <View style={{ width: '100%', aspectRatio: 3 / 4, overflow: 'hidden', borderRadius: 16, backgroundColor: '#F7F4F0' }}>
            <GestureDetector gesture={composed}>
              <ReAnimated.View style={[{ width: '100%', height: '100%' }, photoAnimatedStyle]}>
                <Image source={{ uri: displayUri }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
              </ReAnimated.View>
            </GestureDetector>
          </View>
        ) : (
          <View style={[styles.photoPlaceholder, { width: '100%', aspectRatio: 3 / 4 }]}>
            <Text style={styles.cameraIcon}>📷</Text>
            <Text style={styles.photoPlaceholderText}>Tap to upload your look</Text>
            <Text style={styles.photoPlaceholderSub}>Choose from your library</Text>
          </View>
        )}
      </Pressable>

      {/* Try on Model — generate a virtual model hero from the tagged items.
          Gated on having at least one item (the sheet needs items). */}
      {hasItems ? (
        <View style={{ paddingHorizontal: 4, paddingTop: 12 }}>
          <Pressable
            className="bg-white rounded-full py-3.5 px-5 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
            onPress={() => {
              Haptics.selectionAsync();
              onOpenTryOnModel();
            }}
            testID="try-on-model-button"
          >
            <Text className="ml-2 text-[#1A1210] text-[15px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
              {hasPhoto ? 'Try on Model again' : 'Try on Model'}
            </Text>
          </Pressable>
          <Text style={{ fontSize: 12, color: '#6B5E58', fontFamily: 'DMSans_400Regular', textAlign: 'center', marginTop: 6 }}>
            Generate a virtual model wearing your items
          </Text>
        </View>
      ) : null}

      {/* Adjust Photo / Change Photo / Reset controls row */}
      {hasPhoto ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-evenly', paddingVertical: 12 }}>
          <Pressable onPress={() => onSetShowPhotoEditor(true)} testID="adjust-photo-button">
            <Text style={{ color: '#B87063', fontSize: 13, fontFamily: 'DMSans_500Medium' }}>Adjust Photo</Text>
          </Pressable>
          <Pressable onPress={onPickPhoto} testID="change-photo-button">
            <Text style={{ color: '#B87063', fontSize: 13, fontFamily: 'DMSans_500Medium' }}>Change Photo</Text>
          </Pressable>
          <Pressable
            onPress={onResetPhoto}
            style={{ opacity: isResetDisabled ? 0.4 : 1 }}
            disabled={isResetDisabled}
            testID="reset-photo-button"
          >
            <Text style={{ color: '#B87063', fontSize: 13, fontFamily: 'DMSans_500Medium' }}>{isResetDisabled ? 'Reset' : 'Undo'}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Backdrop swap — creator only, requires a photo */}
      {hasPhoto && isCreator ? (
        <View style={{ paddingHorizontal: 4, paddingBottom: 8 }}>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setBackdropError(null);
              setShowBackdropPicker(true);
            }}
            disabled={isRendering}
            style={({ pressed }) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: 14,
                borderWidth: 1.5,
                borderColor: '#D4C8C2',
                backgroundColor: '#FFFFFF',
                opacity: isRendering ? 0.6 : 1,
              },
              pressed && { opacity: 0.85 },
            ]}
            testID="try-backdrop-button"
          >
            {isRendering ? (
              <ActivityIndicator size="small" color="#B87063" />
            ) : null}
            <Text style={{ color: '#1A1210', fontSize: 14, fontFamily: 'DMSans_500Medium', fontWeight: '600' }}>
              {isRendering ? 'Applying backdrop…' : 'Try a backdrop'}
            </Text>
          </Pressable>
          {backdropError ? (
            <Text
              style={{ color: '#B87063', fontSize: 12, fontFamily: 'DMSans_400Regular', marginTop: 8, textAlign: 'center' }}
              testID="backdrop-error"
            >
              {backdropError}
            </Text>
          ) : null}
        </View>
      ) : null}

      <BackdropPicker
        visible={showBackdropPicker}
        onClose={() => setShowBackdropPicker(false)}
        onSelect={handleBackdropPick}
      />

      {/* PhotoEditor modal */}
      <PhotoEditor
        visible={showPhotoEditor}
        uri={originalPhotoUri || photoUri}
        aspectRatio={[3, 4]}
        title="Crop Your Look"
        helpText="Crop so your full outfit is visible — head to shoes."
        onSave={onPhotoEditorSave}
        onCancel={() => onSetShowPhotoEditor(false)}
      />

      {/* Remove Background toggle — commented out for App Store submission (feature not implemented). */}
      {/* Implement before publishing if you want this feature. */}
      {/*
      <Pressable
        style={[styles.toggleRow, { opacity: 0.45 }]}
        onPress={() => Linking.openURL('https://remove.bg')}
        testID="remove-bg-toggle"
      >
        <View style={styles.toggleInfo}>
          <Text style={styles.toggleLabel}>Remove Background</Text>
          <Text style={{ fontSize: 11, color: '#6B5E58', fontFamily: 'DMSans_400Regular', marginTop: 2 }}>
            Coming soon · tap to learn more
          </Text>
        </View>
        <View style={styles.toggleTrack}>
          <View style={styles.toggleThumb} />
        </View>
      </Pressable>
      */}

      {/* Next button — always visible at the bottom */}
      <PillButton
        label={hasPhoto ? 'Next: Choose Layout →' : 'Upload a photo to continue'}
        variant="primary"
        fullWidth
        disabled={!hasPhoto}
        onPress={onNext}
        testID="step0-next"
      />
    </View>
  );
}

// ---- Step 1: Add Items ----
function StepAddItems({
  items,
  showForm,
  onSetShowForm,
  activeCategory,
  itemName,
  itemPrice,
  itemLink,
  itemPhotoUri,
  itemBrand,
  itemWornSize,
  onSelectCategory,
  onChangeName,
  onChangePrice,
  onChangeWornSize,
  onChangeLink,
  onClearPhoto,
  onPickItemPhoto,
  onAddItem,
  onRemoveItem,
  onEditItem,
  onScrollToTop,
  onChangeBrand,
  editingItemIndex,
  onSetEditingItemIndex,
  showItemColorEditor,
  pendingItemPhotoUri,
  itemColorBrightness,
  itemColorContrast,
  itemColorSaturation,
  isProcessingItemPhoto,
  onSetItemColorBrightness,
  onSetItemColorContrast,
  onSetItemColorSaturation,
  onUseItemAsIs,
  onApplyItemAdjustments,
  isFetchingProduct,
  fetchError,
  fetchSuccess,
  showPhotoSuggestion,
  suggestedPhotoUrl,
  onLinkSubmit,
  onSetShowPhotoSuggestion,
  onSetItemPhotoUri,
  onSetSuggestedPhotoUrl,
  alternateDrafts,
  fetchingAltIdx,
  altFetchErrors,
  altPhotoSuggestions,
  primaryNote,
  onChangePrimaryNote,
  onUpdateAlternate,
  onChangeAltLink,
  onAddAlternateSlot,
  onRemoveAlternateSlot,
  onAltLinkSubmit,
  onPickAltPhoto,
  onAcceptAltPhotoSuggestion,
  onDismissAltPhotoSuggestion,
  onScrollToEnd,
  onOpenClosetPicker,
  onChangeItemPhoto,
  isUploadingItemPhoto,
}: {
  items: ClothingItem[];
  showForm: boolean;
  onSetShowForm: (v: boolean) => void;
  activeCategory: Category | null;
  itemName: string;
  itemPrice: string;
  itemLink: string;
  itemPhotoUri: string;
  itemBrand: string | null;
  itemWornSize: string;
  onSelectCategory: (c: Category) => void;
  onChangeName: (v: string) => void;
  onChangePrice: (v: string) => void;
  onChangeWornSize: (v: string) => void;
  onChangeLink: (v: string) => void;
  onClearPhoto: () => void;
  onPickItemPhoto: () => void;
  onAddItem: () => void;
  onRemoveItem: (id: string) => void;
  onEditItem: (index: number) => void;
  onScrollToTop?: () => void;
  onChangeBrand: (brand: string | null) => void;
  editingItemIndex: number | null;
  onSetEditingItemIndex: (v: number | null) => void;
  showItemColorEditor: boolean;
  pendingItemPhotoUri: string | null;
  itemColorBrightness: number;
  itemColorContrast: number;
  itemColorSaturation: number;
  isProcessingItemPhoto: boolean;
  onSetItemColorBrightness: (v: number) => void;
  onSetItemColorContrast: (v: number) => void;
  onSetItemColorSaturation: (v: number) => void;
  onUseItemAsIs: () => void;
  onApplyItemAdjustments: () => void;
  isFetchingProduct: boolean;
  fetchError: string | null;
  fetchSuccess: boolean;
  showPhotoSuggestion: boolean;
  suggestedPhotoUrl: string | null;
  onLinkSubmit: () => void;
  onSetShowPhotoSuggestion: (v: boolean) => void;
  onSetItemPhotoUri: (v: string) => void;
  onSetSuggestedPhotoUrl: (v: string | null) => void;
  alternateDrafts: AlternateItem[];
  fetchingAltIdx: number | null;
  altFetchErrors: (string | null)[];
  altPhotoSuggestions: (string | null)[];
  primaryNote: string;
  onChangePrimaryNote: (v: string) => void;
  onUpdateAlternate: <K extends keyof AlternateItem>(idx: number, field: K, value: AlternateItem[K]) => void;
  onChangeAltLink: (idx: number, raw: string) => void;
  onAddAlternateSlot: () => void;
  onRemoveAlternateSlot: (idx: number) => void;
  onAltLinkSubmit: (idx: number) => void;
  onPickAltPhoto: (idx: number) => void;
  onAcceptAltPhotoSuggestion: (idx: number) => void;
  onDismissAltPhotoSuggestion: (idx: number) => void;
  onScrollToEnd?: () => void;
  onOpenClosetPicker: () => void;
  onChangeItemPhoto: () => void;
  isUploadingItemPhoto: boolean;
}) {
  const handleCategorySelect = (cat: Category) => {
    onSelectCategory(cat);
    onSetShowForm(true);
    onScrollToTop?.();
  };

  const slotCount = Math.min(Math.max(items.length, 2), 4);
  const slots = Array.from({ length: slotCount });

  const displayItemUri = showItemColorEditor && pendingItemPhotoUri ? pendingItemPhotoUri : itemPhotoUri;
  const itemSlidersAtDefault = itemColorBrightness === 0 && itemColorContrast === 1 && itemColorSaturation === 1;

  const formatItemBrightness = (v: number) => {
    if (v === 0) return '0';
    return v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
  };

  return (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Piece Photos</Text>
      <Text style={styles.stepSubtitle}>
        Photo each item you're wearing — top, pants, shoes, bag &amp; more
      </Text>

      {/* Collage preview strip */}
      <View style={styles.collageStrip}>
        {slots.map((_, idx) => {
          const item = items[idx];
          if (item && item.photoUri) {
            return (
              <Image
                key={idx}
                source={{ uri: item.photoUri }}
                style={styles.collageSlot}
                contentFit="contain"
              />
            );
          }
          return (
            <View key={idx} style={[styles.collageSlot, styles.collageSlotEmpty]}>
              <Camera size={20} color="#6B5E58" />
            </View>
          );
        })}
      </View>

      {/* Added pieces as photo grid */}
      {items.length > 0 && (
        <View style={styles.pieceGrid}>
          {items.map((item, index) => (
            <Pressable
              key={item.id}
              style={styles.pieceCard}
              onPress={() => onEditItem(index)}
              testID={`item-row-${item.id}`}
            >
              {item.photoUri ? (
                <Image source={{ uri: item.photoUri }} style={styles.pieceCardPhoto} contentFit="contain" />
              ) : (
                <View style={styles.pieceCardNoPhoto}>
                  <Text style={{ fontSize: 26 }}>{item.emoji}</Text>
                </View>
              )}
              <View style={styles.pieceCardLabel}>
                <Text style={styles.pieceCardLabelText} numberOfLines={1}>
                  {decodeHtmlEntities(item.name) || item.category}
                </Text>
                {item.price ? <Text style={styles.pieceCardPrice}>${item.price}</Text> : null}
                {item.brand ? <Text style={styles.pieceCardBrand}>{decodeHtmlEntities(item.brand)}</Text> : null}
              </View>
              <View style={styles.pieceCardEditHint}>
                <Pencil size={14} color="#6B5E58" />
              </View>
              <Pressable
                style={styles.pieceCardRemove}
                onPress={(e) => { e.stopPropagation(); onRemoveItem(item.id); }}
                testID={`remove-item-${item.id}`}
              >
                <Text style={styles.pieceCardRemoveText}>✕</Text>
              </Pressable>
            </Pressable>
          ))}
        </View>
      )}

      {/* Action pills row — left-aligned under the piece cards */}
      <View style={styles.actionPillsRow}>
        {!showForm && (
          <PillButton
            label="Add Item"
            variant="outline"
            size="sm"
            icon={<Plus size={16} color="#B87063" />}
            onPress={() => { onSetEditingItemIndex(null); onSetShowForm(true); }}
            testID="add-piece-btn"
          />
        )}

        <PillButton
          label="Add from Closet"
          variant="outline"
          size="sm"
          icon={<ShoppingBag size={16} color="#B87063" />}
          onPress={onOpenClosetPicker}
          testID="add-from-closet-btn"
        />
      </View>

      {/* Piece form */}
      {showForm === true && (
        <View style={styles.itemForm}>
          {/* Category picker */}
          <Text style={styles.itemFormTitle}>{editingItemIndex !== null ? 'Edit Item' : 'Select a category'}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, marginBottom: 2 }}
            contentContainerStyle={{ gap: 8 }}
          >
            {CATEGORIES.map((cat) => (
              <Pressable
                key={cat.value}
                style={[styles.categoryChip, activeCategory === cat.value && styles.categoryChipActive]}
                onPress={() => handleCategorySelect(cat.value)}
                testID={`category-${cat.value}`}
              >
                <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
                <Text style={[styles.categoryLabel, activeCategory === cat.value && styles.categoryLabelActive]}>
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {showForm ? (
            <Text style={{ fontSize: 11, color: '#6B5E58', marginTop: 2, marginBottom: 8 }}>Tap to change category</Text>
          ) : null}

          {/* Brand selector */}
          <BrandSelector
            selectedBrand={itemBrand}
            onBrandSelect={onChangeBrand}
          />

          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0, color: '#1A1210' }]}
              placeholder="Paste shop link to auto-fill…"
              placeholderTextColor="#6B5E58"
              cursorColor="#2C2C2C"
              selectionColor="rgba(44, 44, 44, 0.3)"
              value={itemLink}
              onChangeText={onChangeLink}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={onLinkSubmit}
              testID="item-link-input"
            />
            <Pressable
              style={{
                height: 44,
                backgroundColor: '#B87063',
                borderRadius: 10,
                paddingHorizontal: 14,
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: 8,
                opacity: !itemLink.trim() ? 0.4 : 1,
              }}
              disabled={!itemLink.trim() || isFetchingProduct}
              onPress={onLinkSubmit}
              testID="fetch-product-button"
            >
              {isFetchingProduct ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>Fetch</Text>
              )}
            </Pressable>
          </View>

          {isFetchingProduct ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <ActivityIndicator size="small" color="#B87063" />
              <Text style={{ fontSize: 12, color: '#6B5E58', marginLeft: 8 }}>
                Looking up product…
              </Text>
            </View>
          ) : null}

          {fetchSuccess && !isFetchingProduct ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <Check size={14} color="#2E7D52" />
              <Text style={{ fontSize: 12, color: '#2E7D52', marginLeft: 6 }}>
                Product info found — review below
              </Text>
            </View>
          ) : null}

          {fetchError && !isFetchingProduct ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <Info size={14} color="#B87063" />
              <Text style={{ fontSize: 12, color: '#B87063', marginLeft: 6 }}>
                {fetchError}
              </Text>
            </View>
          ) : null}

          <TextInput
            style={[styles.input, { color: '#1A1210' }]}
            placeholder="Item name (optional)"
            placeholderTextColor="#6B5E58"
            cursorColor="#2C2C2C"
            selectionColor="rgba(44, 44, 44, 0.3)"
            value={itemName}
            onChangeText={onChangeName}
            testID="item-name-input"
          />

          <View style={styles.priceRow}>
            <Text style={styles.priceDollar}>$</Text>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0, color: '#1A1210' }]}
              placeholder="Price (optional)"
              placeholderTextColor="#6B5E58"
              cursorColor="#2C2C2C"
              selectionColor="rgba(44, 44, 44, 0.3)"
              value={itemPrice}
              onChangeText={onChangePrice}
              keyboardType="decimal-pad"
              testID="item-price-input"
            />
          </View>

          <TextInput
            style={[styles.input, { color: '#1A1210' }]}
            placeholder={`Size worn — ${sizePlaceholderForCategory(activeCategory)}`}
            placeholderTextColor="#6B5E58"
            cursorColor="#2C2C2C"
            selectionColor="rgba(44, 44, 44, 0.3)"
            value={itemWornSize}
            onChangeText={onChangeWornSize}
            autoCapitalize="characters"
            autoCorrect={false}
            testID="item-worn-size-input"
          />

          {/* Photo upload — square aspect ratio */}
          <Pressable
            style={styles.itemPhotoUploadSquare}
            onPress={!showItemColorEditor ? onPickItemPhoto : undefined}
            testID="item-photo-upload"
          >
            {displayItemUri ? (
              <View style={{ position: 'relative', width: '100%', aspectRatio: 1 }}>
                <Image source={{ uri: displayItemUri }} style={styles.itemPhotoPreviewSquare} contentFit="contain" />
                {!showItemColorEditor ? (
                  <>
                    <Pressable
                      onPress={() => {
                        onSetItemPhotoUri('');
                        onSetShowPhotoSuggestion(false);
                      }}
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        backgroundColor: '#1A1210',
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      testID="item-photo-remove"
                    >
                      <Text style={{ color: '#FFFFFF', fontSize: 14 }}>✕</Text>
                    </Pressable>
                    <Pressable
                      onPress={onPickItemPhoto}
                      style={{
                        position: 'absolute',
                        bottom: 8,
                        right: 8,
                        backgroundColor: '#1A1210',
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 8,
                      }}
                      testID="item-photo-change"
                    >
                      <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>Change</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            ) : (
              <View style={styles.itemPhotoPlaceholder}>
                <Text style={{ fontSize: 28 }}>📷</Text>
                <Text style={styles.itemPhotoPlaceholderText}>Tap to add photo</Text>
                <Text style={[styles.itemPhotoPlaceholderText, { fontSize: 11, marginTop: 2 }]}>optional</Text>
              </View>
            )}
          </Pressable>

          {displayItemUri && !showItemColorEditor ? (
            <Pressable
              onPress={onChangeItemPhoto}
              disabled={isUploadingItemPhoto}
              className="flex-row items-center justify-center gap-1.5 py-2 px-3 active:opacity-70"
              testID="item-photo-change-pill"
            >
              {isUploadingItemPhoto ? (
                <ActivityIndicator size="small" color="#6B5E58" />
              ) : (
                <Camera size={16} color="#6B5E58" />
              )}
              <Text className="text-[#6B5E58] text-sm font-medium" style={{ fontFamily: 'DMSans_500Medium' }}>
                {isUploadingItemPhoto ? 'Uploading…' : 'Change photo'}
              </Text>
            </Pressable>
          ) : null}

          {showPhotoSuggestion ? (
            <View style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 10,
              padding: 12,
              marginBottom: 8,
              borderWidth: 0.5,
              borderColor: '#E8E0D8',
            }}>
              <Text style={{ fontSize: 13, color: '#1A1210' }}>
                Product image found. Use it?
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <Pressable
                  style={{
                    paddingHorizontal: 16, height: 34,
                    borderWidth: 1, borderColor: '#D4C8C2',
                    borderRadius: 8, justifyContent: 'center',
                  }}
                  onPress={() => onSetShowPhotoSuggestion(false)}
                  testID="photo-suggestion-skip"
                >
                  <Text style={{ fontSize: 13, color: '#3D3330' }}>Skip</Text>
                </Pressable>
                <Pressable
                  style={{
                    paddingHorizontal: 16, height: 34,
                    backgroundColor: '#B87063',
                    borderRadius: 8, justifyContent: 'center',
                  }}
                  onPress={() => {
                    onSetItemPhotoUri(suggestedPhotoUrl || '');
                    onSetShowPhotoSuggestion(false);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  testID="photo-suggestion-use"
                >
                  <Text style={{ fontSize: 13, color: '#FFFFFF' }}>Use Photo</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {/* Primary note chips — visible when at least one alternate slot exists */}
          {alternateDrafts.length > 0 ? (
            <View style={{ marginBottom: 10, marginTop: 4 }}>
              <Text style={{ fontSize: 12, color: '#6B5E58', marginBottom: 6 }}>Why show alternate?</Text>
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
                    onPress={() => onChangePrimaryNote(primaryNote === note ? '' : note)}
                    testID={`primary-note-${note.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Text style={{ fontSize: 12, color: primaryNote === note ? '#FFFFFF' : '#3D3330' }}>{note}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {/* Alternate slot cards */}
          {alternateDrafts.map((alt, idx) => {
            const isFetchingThis = fetchingAltIdx === idx;
            const errorThis = altFetchErrors[idx] ?? null;
            const suggestionThis = altPhotoSuggestions[idx] ?? null;
            const altLinkValue = alt.link ?? '';
            const altCategoryValue = (alt.category ?? null) as Category | null;
            return (
              <View
                key={`alt-slot-${idx}`}
                style={{
                  backgroundColor: '#F0EBE5',
                  borderWidth: 1,
                  borderColor: '#D4C8C2',
                  borderRadius: 12,
                  padding: 14,
                  marginBottom: 10,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#B87063' }}>
                    Alternate Item {alternateDrafts.length > 1 ? `#${idx + 1}` : ''}
                  </Text>
                  <Pressable
                    onPress={() => {
                      onRemoveAlternateSlot(idx);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: '#1A1210',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    testID={`alt-remove-slot-${idx}`}
                  >
                    <Text style={{ color: '#FFFFFF', fontSize: 14 }}>✕</Text>
                  </Pressable>
                </View>

                {/* Alt link + fetch */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0, color: '#1A1210', backgroundColor: '#FFFFFF' }]}
                    placeholder="Paste shop link to auto-fill…"
                    placeholderTextColor="#6B5E58"
                    cursorColor="#2C2C2C"
                    selectionColor="rgba(44, 44, 44, 0.3)"
                    value={altLinkValue}
                    onChangeText={(raw) => onChangeAltLink(idx, raw)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="go"
                    onSubmitEditing={() => onAltLinkSubmit(idx)}
                    testID={`alt-link-input-${idx}`}
                  />
                  <Pressable
                    style={{
                      height: 44,
                      backgroundColor: '#B87063',
                      borderRadius: 10,
                      paddingHorizontal: 14,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginLeft: 8,
                      opacity: !altLinkValue.trim() ? 0.4 : 1,
                    }}
                    disabled={!altLinkValue.trim() || isFetchingThis}
                    onPress={() => onAltLinkSubmit(idx)}
                    testID={`alt-fetch-button-${idx}`}
                  >
                    {isFetchingThis ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>Fetch</Text>
                    )}
                  </Pressable>
                </View>

                {isFetchingThis ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <ActivityIndicator size="small" color="#B87063" />
                    <Text style={{ fontSize: 12, color: '#6B5E58', marginLeft: 8 }}>Looking up product…</Text>
                  </View>
                ) : null}

                {errorThis && !isFetchingThis ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Info size={14} color="#B87063" />
                    <Text style={{ fontSize: 12, color: '#B87063', marginLeft: 6 }}>{errorThis}</Text>
                  </View>
                ) : null}

                {/* Alt category chips */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ flexGrow: 0, marginBottom: 8 }}
                  contentContainerStyle={{ gap: 8 }}
                >
                  {CATEGORIES.map((cat) => (
                    <Pressable
                      key={cat.value}
                      style={[styles.categoryChip, altCategoryValue === cat.value && styles.categoryChipActive]}
                      onPress={() => onUpdateAlternate(idx, 'category', cat.value)}
                      testID={`alt-category-${idx}-${cat.value}`}
                    >
                      <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
                      <Text style={[styles.categoryLabel, altCategoryValue === cat.value && styles.categoryLabelActive]}>
                        {cat.label}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {/* Alt brand */}
                <BrandSelector
                  selectedBrand={alt.brand}
                  onBrandSelect={(b) => onUpdateAlternate(idx, 'brand', b)}
                />

                {/* Alt name */}
                <TextInput
                  style={[styles.input, { color: '#1A1210', backgroundColor: '#FFFFFF' }]}
                  placeholder="Item name"
                  placeholderTextColor="#6B5E58"
                  cursorColor="#2C2C2C"
                  selectionColor="rgba(44, 44, 44, 0.3)"
                  value={alt.name ?? ''}
                  onChangeText={(v) => onUpdateAlternate(idx, 'name', v)}
                  testID={`alt-name-input-${idx}`}
                />

                {/* Alt price */}
                <View style={styles.priceRow}>
                  <Text style={styles.priceDollar}>$</Text>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0, color: '#1A1210', backgroundColor: '#FFFFFF' }]}
                    placeholder="Price"
                    placeholderTextColor="#6B5E58"
                    cursorColor="#2C2C2C"
                    selectionColor="rgba(44, 44, 44, 0.3)"
                    value={alt.price ?? ''}
                    onChangeText={(v) => onUpdateAlternate(idx, 'price', v.replace(/^\$/, ''))}
                    keyboardType="decimal-pad"
                    testID={`alt-price-input-${idx}`}
                  />
                </View>

                {/* Alt photo */}
                <Pressable
                  style={[styles.itemPhotoUploadSquare, { aspectRatio: 1, backgroundColor: '#FFFFFF' }]}
                  onPress={() => onPickAltPhoto(idx)}
                  testID={`alt-photo-upload-${idx}`}
                >
                  {alt.photo_url ? (
                    <View style={{ position: 'relative', width: '100%', aspectRatio: 1 }}>
                      <Image source={{ uri: alt.photo_url }} style={{ width: '100%', aspectRatio: 1, borderRadius: 8 }} contentFit="cover" />
                      <Pressable
                        onPress={() => onUpdateAlternate(idx, 'photo_url', null)}
                        style={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          backgroundColor: '#1A1210',
                          width: 28,
                          height: 28,
                          borderRadius: 14,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        testID={`alt-photo-remove-${idx}`}
                      >
                        <Text style={{ color: '#FFFFFF', fontSize: 14 }}>✕</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.itemPhotoPlaceholder}>
                      <Text style={{ fontSize: 24 }}>📷</Text>
                      <Text style={styles.itemPhotoPlaceholderText}>Tap to add photo</Text>
                      <Text style={[styles.itemPhotoPlaceholderText, { fontSize: 11, marginTop: 2 }]}>optional</Text>
                    </View>
                  )}
                </Pressable>

                {/* Alt photo suggestion */}
                {suggestionThis ? (
                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: '#FFFFFF',
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 10,
                    marginBottom: 10,
                    gap: 10,
                  }}>
                    <Image source={{ uri: suggestionThis }} style={{ width: 48, height: 48, borderRadius: 6 }} contentFit="cover" />
                    <Text style={{ flex: 1, fontSize: 12, color: '#3D3330' }}>Product image found. Use it?</Text>
                    <Pressable onPress={() => onDismissAltPhotoSuggestion(idx)} testID={`alt-photo-suggestion-skip-${idx}`}>
                      <Text style={{ fontSize: 13, color: '#6B5E58' }}>Skip</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onAcceptAltPhotoSuggestion(idx)}
                      testID={`alt-photo-suggestion-use-${idx}`}
                    >
                      <Text style={{ fontSize: 13, color: '#B87063', fontWeight: '600' }}>Use Photo</Text>
                    </Pressable>
                  </View>
                ) : null}

                {/* Alt label */}
                <TextInput
                  style={[styles.input, { color: '#1A1210', backgroundColor: '#FFFFFF', marginTop: 10 }]}
                  placeholder="Label (e.g., Budget option, Different color)"
                  placeholderTextColor="#6B5E58"
                  cursorColor="#2C2C2C"
                  selectionColor="rgba(44, 44, 44, 0.3)"
                  value={alt.label ?? ''}
                  onChangeText={(v) => onUpdateAlternate(idx, 'label', v)}
                  testID={`alt-label-input-${idx}`}
                />
              </View>
            );
          })}

          {/* Add alternate button (capped at MAX_ALTERNATES) */}
          {alternateDrafts.length < MAX_ALTERNATES ? (
            <Pressable
              onPress={() => {
                onAddAlternateSlot();
                onScrollToEnd?.();
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              style={{
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
                marginBottom: 10,
                gap: 8,
              }}
              testID={alternateDrafts.length === 0 ? 'add-alternate-btn' : 'add-another-alternate-btn'}
            >
              <Plus size={16} color="#B87063" />
              <Text style={{ fontSize: 13, color: '#B87063', fontFamily: 'DMSans_500Medium' }}>
                {alternateDrafts.length === 0 ? 'Add an alternate' : 'Add another alternate'}
              </Text>
            </Pressable>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <PillButton
                label={editingItemIndex !== null ? 'Update' : 'Save'}
                variant="dark"
                fullWidth
                onPress={onAddItem}
                testID="add-item-button"
              />
            </View>
            {(items.length > 0 || editingItemIndex !== null) && (
              <View style={{ flex: 1 }}>
                <PillButton
                  label="Cancel"
                  variant="secondary"
                  fullWidth
                  onPress={() => {
                    onSetEditingItemIndex(null);
                    onSetShowForm(false);
                  }}
                />
              </View>
            )}
          </View>
        </View>
      )}

    </View>
  );
}

// ---- Step 2: Choose Layout ----
function StepChooseLayout({
  selectedLayout,
  onSelectLayout,
}: {
  selectedLayout: LayoutId;
  onSelectLayout: (id: LayoutId) => void;
}) {
  return (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Pick Your Style</Text>
      <Text style={styles.stepSubtitle}>How should your look be displayed?</Text>

      {LAYOUTS.map((layout) => (
        <Pressable
          key={layout.id}
          style={[styles.layoutCard, selectedLayout === layout.id && styles.layoutCardSelected]}
          onPress={() => onSelectLayout(layout.id)}
          testID={`layout-${layout.id}`}
        >
          {/* Preview thumbnail */}
          <View
            style={[
              styles.layoutPreview,
              { backgroundColor: layout.color },
            ]}
          >
            <View style={styles.layoutPreviewLine} />
            <View style={[styles.layoutPreviewLine, { width: '60%', opacity: 0.5 }]} />
            <View style={[styles.layoutPreviewLine, { width: '75%', opacity: 0.3 }]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.layoutName}>{layout.name}</Text>
            <Text style={styles.layoutDesc}>{layout.description}</Text>
          </View>
          {selectedLayout === layout.id && (
            <View style={styles.layoutCheckmark}>
              <Text style={styles.layoutCheckmarkText}>✓</Text>
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
}

// ---- Layout styles for preview card ----
const LAYOUT_STYLES: Record<LayoutId, {
  cardBackground: string;
  titleColor: string;
  subtitleColor: string;
  chipBackground: string;
  chipTextColor: string;
}> = {
  'clean-grid': {
    cardBackground: '#F8F8F8',
    titleColor: '#1A1210',
    subtitleColor: '#6B5E58',
    chipBackground: '#E0D8D0',
    chipTextColor: '#1A1210',
  },
  'minimal-luxury': {
    cardBackground: '#FDFAF5',
    titleColor: '#2C2218',
    subtitleColor: '#6B5E58',
    chipBackground: '#EAE0CF',
    chipTextColor: '#3D2B1A',
  },
  'cozy-neutral': {
    cardBackground: '#F5EDE0',
    titleColor: '#1A1210',
    subtitleColor: '#6B5E58',
    chipBackground: '#D9C4A8',
    chipTextColor: '#2C1A0E',
  },
  'bold-influencer': {
    cardBackground: '#1A1210',
    titleColor: '#FFFFFF',
    subtitleColor: '#CFC6BF',
    chipBackground: '#3A3A3A',
    chipTextColor: '#FFFFFF',
  },
};

// ---- Step 3: Preview ----
function StepPreview({
  photoUri,
  items,
  styleCanvasRef,
  textLayers,
  selectedTextLayerId,
  exportingCanvas,
  onSelectTextLayer,
  onCommitTextLayer,
  onAddText,
  onEditText,
  onDeleteText,
  caption,
  editingCaption,
  captionRef,
  onEditCaption,
  onChangeCaption,
  onPublish,
  onSaveDraft,
  selectedLayout,
  selectedHashtags,
  isEditMode,
  isEditingDraft,
  onHashtagsChange,
  lookTitle,
  onLookTitleChange,
  lookCategory,
  onLookCategoryChange,
  lookTags,
  onLookTagsChange,
  isPublishing,
  transparentBg,
}: {
  photoUri: string;
  items: ClothingItem[];
  styleCanvasRef: React.RefObject<View | null>;
  textLayers: TextLayerItem[];
  selectedTextLayerId: string | null;
  exportingCanvas: boolean;
  onSelectTextLayer: (id: string | null) => void;
  onCommitTextLayer: (id: string, next: { x: number; y: number; scale: number; rotation: number }) => void;
  onAddText: () => void;
  onEditText: (id: string) => void;
  onDeleteText: () => void;
  caption: string;
  editingCaption: boolean;
  captionRef: React.RefObject<TextInput | null>;
  onEditCaption: () => void;
  onChangeCaption: (v: string) => void;
  onPublish: () => void;
  onSaveDraft: () => void;
  selectedLayout: LayoutId;
  selectedHashtags: string[];
  isEditMode: boolean;
  isEditingDraft: boolean;
  onHashtagsChange: (tags: string[]) => void;
  lookTitle: string;
  onLookTitleChange: (v: string) => void;
  lookCategory: string;
  onLookCategoryChange: (v: string) => void;
  lookTags: string;
  onLookTagsChange: (v: string) => void;
  isPublishing: boolean;
  transparentBg: boolean;
}) {
  const layoutStyle = LAYOUT_STYLES[selectedLayout] ?? LAYOUT_STYLES['clean-grid'];
  const categories = useCategoryStore((s) => s.categories);

  useEffect(() => {
    useCategoryStore.getState().fetchCategories();
  }, []);

  return (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Your Look is Ready</Text>
      <Text style={styles.stepSubtitle}>Review and refine before sharing</Text>

      {/* Movable text editor — only once a hero photo exists. Drag to move,
          pinch to resize, two-finger rotate. Tap a block to select it. */}
      {photoUri ? (
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <StyleLookCanvas
            ref={styleCanvasRef}
            photoUri={photoUri}
            textLayers={textLayers}
            selectedId={selectedTextLayerId}
            displayWidth={width - 40}
            editable
            exporting={exportingCanvas}
            transparentBg={transparentBg}
            onSelect={onSelectTextLayer}
            onCommitLayer={onCommitTextLayer}
          />

          {/* Text controls */}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, width: '100%' }}>
            <Pressable
              className="bg-white rounded-full py-3 px-5 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
              style={{ flex: 1 }}
              onPress={onAddText}
              testID="style-add-text-button"
            >
              <Plus size={16} color="#1A1210" />
              <Text className="ml-2 text-[#1A1210] text-[15px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
                Add text
              </Text>
            </Pressable>
            {selectedTextLayerId ? (
              <>
                <Pressable
                  className="bg-white rounded-full py-3 px-5 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
                  style={{ flex: 1 }}
                  onPress={() => onEditText(selectedTextLayerId)}
                  testID="style-edit-text-button"
                >
                  <Pencil size={16} color="#1A1210" />
                  <Text className="ml-2 text-[#1A1210] text-[15px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
                    Edit
                  </Text>
                </Pressable>
                <Pressable
                  className="bg-white rounded-full py-3 px-4 flex-row items-center justify-center border-[1.5px] border-[#B87063] active:opacity-85"
                  onPress={onDeleteText}
                  testID="style-delete-text-button"
                >
                  <Text className="text-[#B87063] text-[15px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
                    Delete
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Look name input */}
      <TextInput
        style={styles.lookNameInput}
        value={lookTitle}
        onChangeText={onLookTitleChange}
        placeholder="Name your look..."
        placeholderTextColor="#6B5E58"
        cursorColor="#2C2C2C"
        selectionColor="rgba(44, 44, 44, 0.3)"
        testID="look-name-input"
      />

      {/* Category picker */}
      {categories.length > 0 ? (
        <View style={styles.categoryPickerContainer}>
          <Text style={styles.categoryPickerLabel}>Category</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={styles.categoryChipsRow}
          >
            {categories.map((cat) => {
              const isActive = lookCategory === cat.name;
              return (
                <Pressable
                  key={cat.id}
                  style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                  onPress={() => onLookCategoryChange(isActive ? '' : cat.name)}
                  testID={`create-category-${cat.slug}`}
                >
                  <Ionicons name={cat.icon as any} size={14} color={isActive ? '#FFFFFF' : '#6B5E58'} />
                  <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>
                    {cat.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* Tags input */}
      <View style={styles.tagsInputContainer}>
        <Text style={styles.categoryPickerLabel}>Tags (optional)</Text>
        <TextInput
          style={styles.tagsInput}
          value={lookTags}
          onChangeText={onLookTagsChange}
          placeholder="e.g. summer, boho, under $50"
          placeholderTextColor="#A0938D"
          cursorColor="#2C2C2C"
          selectionColor="rgba(44, 44, 44, 0.3)"
          autoCapitalize="none"
          testID="look-tags-input"
        />
      </View>

      {/* Post card preview */}
      <View style={[styles.previewCard, { backgroundColor: layoutStyle.cardBackground }]}>
        {photoUri ? (
          transparentBg ? (
            // Transparent try-on hero: render over a checkerboard, contain-fit
            // so the whole model shows and the transparency is visible.
            <View style={styles.previewPhoto}>
              <Checkerboard style={StyleSheet.absoluteFill} />
              <Image
                source={{ uri: photoUri }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
              />
            </View>
          ) : (
            <Image source={{ uri: photoUri }} style={styles.previewPhoto} contentFit="cover" />
          )
        ) : (
          <View style={styles.previewPhotoPlaceholder}>
            <Text style={{ fontSize: 48 }}>👗</Text>
          </View>
        )}

        <Text style={[styles.previewShopText, { color: layoutStyle.titleColor }]}>Shop this look ↓</Text>

        {/* Item chips */}
        {items.length > 0 && (
          <View style={styles.previewItemsRow}>
            {items.map((item) => {
              const hasLink = item.link && item.link !== '#' && item.link !== '';
              const chipContent = (
                <Text style={[styles.previewItemChipText, { color: layoutStyle.chipTextColor }]}>
                  {item.emoji} {item.brand ? `${decodeHtmlEntities(item.brand)} \u00B7 ` : null}{decodeHtmlEntities(item.name) || item.category}{item.price ? ` $${item.price}` : null}
                </Text>
              );
              return hasLink ? (
                <Pressable
                  key={item.id}
                  style={({ pressed }) => [styles.previewItemChip, { backgroundColor: layoutStyle.chipBackground, borderColor: layoutStyle.chipBackground, opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => {
                    // Route through /api/shop so the affiliate tag is stamped and
                    // the click row is written server-side (source=ios). This is a
                    // draft preview, so we only have the raw link.
                    void openShopLink({ url: item.link });
                  }}
                  testID={`preview-chip-${item.id}`}
                >
                  {chipContent}
                </Pressable>
              ) : (
                <View key={item.id} style={[styles.previewItemChip, { backgroundColor: layoutStyle.chipBackground, borderColor: layoutStyle.chipBackground }]}>
                  {chipContent}
                </View>
              );
            })}
          </View>
        )}

        {/* Caption */}
        <Pressable onPress={onEditCaption} testID="edit-caption-press">
          {editingCaption ? (
            <TextInput
              ref={captionRef}
              style={styles.previewCaptionInput}
              value={caption}
              onChangeText={onChangeCaption}
              multiline
              cursorColor="#2C2C2C"
              selectionColor="rgba(44, 44, 44, 0.3)"
              testID="caption-input"
            />
          ) : (
            <>
              <Text style={[styles.previewCaption, { color: layoutStyle.subtitleColor }]} numberOfLines={4}>{caption}</Text>
              <Text style={{ fontSize: 12, color: '#6B5E58', marginTop: 4, paddingHorizontal: 20, paddingBottom: 10, fontFamily: 'DMSans_400Regular' }}>Tap to edit caption</Text>
            </>
          )}
        </Pressable>

        {/* Hashtags preview text */}
        {selectedHashtags.length > 0 ? (
          <Text style={styles.hashtagPreviewText}>
            {selectedHashtags.join(' ')}
          </Text>
        ) : null}
      </View>

      {/* Hashtag editor */}
      <View style={styles.hashtagCard}>
        <HashtagEditor
          selectedTags={selectedHashtags}
          onTagsChange={onHashtagsChange}
          onHashtagsSaved={() => {}}
        />
      </View>

      {/* CTAs: when editing an already-published look, show only the primary
          "Save Changes" pill. Otherwise (new look or editing a draft) show
          BOTH pills — Save Draft (secondary) + Publish (primary). */}
      {isEditMode && !isEditingDraft ? (
        <Pressable
          className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85 mt-4"
          style={{ shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2, opacity: isPublishing ? 0.6 : 1 }}
          onPress={onPublish}
          disabled={isPublishing}
          testID="save-look-button"
        >
          <Text
            className="ml-2 text-white text-[15px] font-semibold"
            style={{ fontFamily: 'DMSans_500Medium' }}
          >
            {isPublishing ? 'Saving…' : 'Save Changes →'}
          </Text>
        </Pressable>
      ) : (
        <View className="mt-4 gap-3">
          <Pressable
            className="bg-white rounded-full py-3.5 px-5 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
            style={{ opacity: isPublishing ? 0.6 : 1 }}
            onPress={onSaveDraft}
            disabled={isPublishing}
            testID="save-draft-button"
          >
            <Text
              className="ml-2 text-[#1A1210] text-[15px] font-semibold"
              style={{ fontFamily: 'DMSans_500Medium' }}
            >
              {isPublishing ? 'Saving…' : 'Save Draft'}
            </Text>
          </Pressable>
          <Pressable
            className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
            style={{ shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2, opacity: isPublishing ? 0.6 : 1 }}
            onPress={onPublish}
            disabled={isPublishing}
            testID="save-look-button"
          >
            <Text
              className="ml-2 text-white text-[15px] font-semibold"
              style={{ fontFamily: 'DMSans_500Medium' }}
            >
              {isPublishing ? 'Publishing…' : (isEditingDraft ? 'Publish →' : 'Publish & Share →')}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ---- Step 4: Export ----
function StepExport({
  onShareLook,
  onSaveAllPhotos,
  onShareToStory,
  onShareInstagram,
  onShareTikTok,
  savedPhotosCount,
  storyShareMessage,
  onCopyCaption,
  onCreateAnother,
  onGoHome,
}: {
  onShareLook: () => void;
  onSaveAllPhotos: () => void;
  onShareToStory: () => void;
  onShareInstagram: () => void;
  onShareTikTok: () => void;
  savedPhotosCount: number | null;
  storyShareMessage: string | null;
  onCopyCaption: () => void;
  onCreateAnother: () => void;
  onGoHome: () => void;
}) {
  return (
    <View style={styles.stepContainer}>
      <View style={styles.successIndicator}>
        <Text style={styles.successEmoji}>🖤</Text>
      </View>
      <Text style={styles.stepTitle}>Share Your Look</Text>
      <Text style={styles.stepSubtitle}>Your look is saved and ready to share</Text>

      <View style={styles.exportActions}>
        <ShareActionsBlock
          onShareLook={onShareLook}
          onSaveAllPhotos={onSaveAllPhotos}
          onShareToStory={onShareToStory}
          onShareInstagram={onShareInstagram}
          onShareTikTok={onShareTikTok}
          savedPhotosCount={savedPhotosCount}
          storyShareMessage={storyShareMessage}
          testIDPrefix="step-export"
        />

        <PillButton
          label="Copy Caption + Links"
          variant="secondary"
          fullWidth
          onPress={onCopyCaption}
          testID="copy-caption-button"
        />
      </View>

      <View style={{ marginTop: 8 }}>
        <PillButton
          label="Create Another Look"
          variant="primary"
          fullWidth
          onPress={onCreateAnother}
          testID="create-another-button"
        />
      </View>

      <Pressable
        style={({ pressed }) => [styles.ghostButton, pressed && { opacity: 0.6 }]}
        onPress={onGoHome}
        testID="go-home-button"
      >
        <Text style={styles.ghostButtonText}>Back to Home</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F4F0',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  // Progress
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#C4A882',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  backButtonPlaceholder: {
    width: 36,
  },
  dotsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F5F0EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: {
    backgroundColor: '#1A1210',
  },
  stepDotCurrent: {
    backgroundColor: '#1A1210',
    shadowColor: '#1A1210',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  stepDotCheck: {
    fontSize: 12,
    color: '#FFFFFF',
    fontFamily: 'DMSans_500Medium',
  },
  stepDotNumber: {
    fontSize: 11,
    color: '#4A3C38',
    fontFamily: 'DMSans_500Medium',
  },
  stepDotNumberActive: {
    color: '#FFFFFF',
  },
  stepLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#E8E0D8',
    marginHorizontal: 2,
  },
  stepLineActive: {
    backgroundColor: '#1A1210',
  },
  // Step 0 fixed layout
  step0Container: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  step0Header: {
    marginBottom: 16,
  },
  // Step 0 — Collage vs Look chooser
  chooseContainer: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  chooseTitle: {
    fontFamily: FONTS.serif,
    fontSize: 30,
    color: COLORS.ink,
    marginBottom: 4,
  },
  chooseSubtitle: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.inkMid,
    marginBottom: 28,
  },
  choiceCardsWrap: {
    flex: 1,
    justifyContent: 'center',
    gap: 28,
    paddingBottom: 24,
  },
  choiceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  choiceIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceCardTitle: {
    fontFamily: FONTS.serif,
    fontSize: 24,
    color: COLORS.ink,
    flex: 1,
  },
  choiceCardSub: {
    fontFamily: FONTS.body,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.inkMid,
  },
  titleInput: {
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D4C8C2',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    fontWeight: '600',
    color: '#1A1210',
    fontFamily: 'DMSans_500Medium',
  },
  step0PhotoArea: {
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#C4A882',
    overflow: 'hidden',
    marginBottom: 16,
  },
  // Step containers
  stepContainer: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  stepTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 30,
    color: '#1A1210',
    marginBottom: 4,
  },
  stepSubtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    marginBottom: 24,
  },
  lookNameInput: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 22,
    fontWeight: '600',
    color: '#1A1210',
    textAlign: 'center',
    marginBottom: 16,
    paddingVertical: 8,
  },
  // Step 0 — Photo upload
  photoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#F7F4F0',
  },
  cameraIcon: {
    fontSize: 44,
  },
  photoPlaceholderText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#1A1210',
  },
  photoPlaceholderSub: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#7D634A',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#C4A882',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  toggleInfo: {
    flex: 1,
  },
  toggleLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#1A1210',
  },
  toggleTrack: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E8E0D8',
    padding: 3,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
    alignSelf: 'flex-start',
  },
  // Step 1 — Items
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E8E0D8',
    shadowColor: '#C4A882',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  categoryChipActive: {
    borderColor: '#A08060',
    backgroundColor: '#EDE3D8',
    borderWidth: 2,
  },
  categoryEmoji: {
    fontSize: 16,
  },
  categoryLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#6B5E58',
  },
  categoryLabelActive: {
    color: '#1A1210',
  },
  itemForm: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#C4A882',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  itemFormTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    marginBottom: 14,
  },
  input: {
    borderWidth: 1.5,
    borderColor: '#E8E0D8',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
    marginBottom: 12,
    backgroundColor: '#F7F4F0',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  priceDollar: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#6B5E58',
  },
  // Step 2 — Layout
  layoutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#E8E0D8',
    shadowColor: '#C4A882',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  layoutCardSelected: {
    borderColor: '#C4A882',
    backgroundColor: '#FDF9F4',
  },
  layoutPreview: {
    width: 60,
    height: 60,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: 8,
    gap: 6,
    overflow: 'hidden',
  },
  layoutPreviewLine: {
    width: '100%',
    height: 3,
    backgroundColor: '#C4A882',
    borderRadius: 2,
  },
  layoutName: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 17,
    color: '#1A1210',
    marginBottom: 2,
  },
  layoutDesc: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
  },
  layoutCheckmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#C4A882',
    alignItems: 'center',
    justifyContent: 'center',
  },
  layoutCheckmarkText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
  },
  // Step 3 — Preview
  previewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#C4A882',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  previewPhoto: {
    width: '100%',
    aspectRatio: 3 / 4,
  },
  previewPhotoPlaceholder: {
    width: '100%',
    aspectRatio: 3 / 4,
    backgroundColor: '#F5F0EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewShopText: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    textAlign: 'center',
    paddingTop: 16,
    paddingHorizontal: 20,
  },
  previewItemsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    padding: 14,
  },
  previewItemChip: {
    backgroundColor: '#F7F4F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  previewItemChipText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#1A1210',
  },
  previewCaption: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    lineHeight: 20,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  previewCaptionInput: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#1A1210',
    lineHeight: 20,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: '#C4A882',
    margin: 10,
    borderRadius: 8,
    minHeight: 80,
  },
  hashtagPreviewText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    paddingHorizontal: 20,
    paddingBottom: 16,
    marginTop: -6,
  },
  // Step 4 — Export
  successIndicator: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#2E7D52',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 20,
    shadowColor: '#2E7D52',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  successEmoji: {
    fontSize: 36,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  exportActions: {
    gap: 12,
    marginTop: 8,
    marginBottom: 12,
  },
  shopLinkHint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#7D634A',
    textAlign: 'center',
    marginTop: 2,
  },
  ghostButton: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  ghostButtonText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
  },
  // Shared buttons
  primaryButton: {
    backgroundColor: '#DCDCDC',
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: '#999999',
  },
  primaryButtonPressed: {
    backgroundColor: '#E8E0D8',
    transform: [{ scale: 0.98 }],
  },
  primaryButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#1A1210',
    letterSpacing: 0.3,
  },
  hashtagCard: {
    backgroundColor: '#F5F0EB',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    marginBottom: 16,
  },
  saveLookCta: {
    backgroundColor: '#1A1210',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  saveLookCtaPressed: {
    backgroundColor: '#3D3330',
    transform: [{ scale: 0.98 }],
  },
  saveLookCtaDisabled: {
    opacity: 0.5,
  },
  saveLookCtaText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1210',
    letterSpacing: 0.3,
  },
  outlineButton: {
    backgroundColor: '#DCDCDC',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#999999',
  },
  outlineButtonPressed: {
    backgroundColor: '#E8E0D8',
  },
  outlineButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#1A1210',
    letterSpacing: 0.2,
  },
  tanButton: {
    backgroundColor: '#DCDCDC',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: '#999999',
  },
  tanButtonPressed: {
    backgroundColor: '#E8E0D8',
  },
  tanButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#1A1210',
    letterSpacing: 0.2,
  },
  itemPhotoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F7F4F0',
  },
  itemPhotoPlaceholderText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#7D634A',
  },
  // Piece grid (Step 1 redesign)
  pieceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  pieceCard: {
    width: (width - 48 - 10) / 2,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#C4A882',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  pieceCardPhoto: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#F7F4F0',
    padding: 6,
  },
  pieceCardNoPhoto: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#F7F4F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pieceCardLabel: {
    padding: 8,
  },
  pieceCardLabelText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#1A1210',
  },
  pieceCardPrice: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#6B5E58',
    marginTop: 1,
  },
  pieceCardBrand: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#6B5E58',
    marginTop: 1,
  },
  pieceCardRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pieceCardEditHint: {
    position: 'absolute',
    top: 8,
    left: 8,
    opacity: 0.5,
  },
  pieceCardRemoveText: {
    fontSize: 10,
    color: '#FFFFFF',
  },
  actionPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
    paddingBottom: 12,
  },
  addPieceBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: '#B87063',
  },
  addPieceBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addPieceBtnIcon: {
    fontSize: 20,
    color: '#7D634A',
    lineHeight: 22,
  },
  addPieceBtnText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#3D3330',
  },
  addFromClosetBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: '#B87063',
  },
  addFromClosetBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addFromClosetBtnText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#3D3330',
  },
  itemsHintText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    textAlign: 'center',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  modalContent: {
    backgroundColor: '#F7F4F0',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  modalTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 24,
    color: '#1A1210',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalMessage: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    textAlign: 'center',
    marginBottom: 20,
  },
  // Collage strip — Step 1
  collageStrip: {
    flexDirection: 'row',
    height: 90,
    marginBottom: 14,
    borderRadius: 12,
    overflow: 'hidden',
    gap: 2,
  },
  collageSlot: {
    flex: 1,
    height: 90,
    backgroundColor: '#F7F4F0',
    padding: 4,
  },
  collageSlotEmpty: {
    backgroundColor: '#E0D8D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Save overlay
  saveOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.60)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveOverlayCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 32,
    width: width * 0.80,
    alignItems: 'center',
  },
  checkCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#B87063',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveOverlayTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
    marginTop: 16,
    textAlign: 'center',
  },
  saveOverlaySubtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: '#6B5E58',
    marginTop: 6,
    textAlign: 'center',
  },
  colorEditorPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginTop: 10,
    borderWidth: 0.5,
    borderColor: '#E8E0D8',
  },
  itemPhotoUploadSquare: {
    width: '100%',
    aspectRatio: 0.85,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#C4A882',
    overflow: 'hidden',
    marginBottom: 12,
  },
  itemPhotoPreviewSquare: {
    width: '100%',
    aspectRatio: 0.85,
    backgroundColor: '#F7F4F0',
    padding: 8,
  },
  itemColorEditorPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 0.5,
    borderColor: '#E8E0D8',
  },
  categoryPickerContainer: {
    marginBottom: 12,
  },
  categoryPickerLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#6B5E58',
    marginBottom: 8,
  },
  categoryChipsRow: {
    gap: 8,
  },
  categoryChipText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#6B5E58',
  },
  categoryChipTextActive: {
    color: '#FFFFFF',
  },
  tagsInputContainer: {
    marginBottom: 16,
  },
  tagsInput: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    paddingHorizontal: 14,
    paddingVertical: 10,
    height: 44,
  },
});
