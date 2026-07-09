// Post-first-look "Complete your profile" bottom sheet.
//
// Fires automatically from the celebration screen after a creator publishes
// their first look (guarded by `completeProfileSheetShown_{user_id}` in
// AsyncStorage so it only shows once per creator). Also openable manually
// from the More (Settings) tab — manual opens still bypass the auto-show
// suppression because we only check the key on auto-trigger paths.
//
// Save-as-you-go: each field has a ~500ms debounce that flushes the value
// to Supabase via the existing profileStore setters (so we never block on
// the network and never lose typed input). Save & continue forces an
// immediate flush of any pending debounced writes.
//
// NO new DB columns — every field maps to an existing creator_profiles
// column. See the migration `20260504161307_creator_measurements_and_body_type_tags.sql`.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Dimensions } from 'react-native';
import { ChevronDown, ChevronUp, X, ArrowRight, Camera as CameraIcon, Check } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import useAuthStore from '@/lib/state/authStore';
import useProfileStore, { type MeasurementUnit } from '@/lib/state/profileStore';
import useCreatorStore from '@/lib/state/creatorStore';
import { supabase } from '@/lib/supabase';
import { persistPickedPhoto } from '@/lib/utils/persistPickedPhoto';
import PinterestConnectCard from '@/components/PinterestConnectCard';

export const COMPLETE_PROFILE_SHEET_KEY_PREFIX = 'completeProfileSheetShown_';

const BIO_LIMIT = 240;
const DEBOUNCE_MS = 500;

const TOP_SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const BOTTOM_SIZE_OPTIONS = ['0', '2', '4', '6', '8', '10', '12', '14', '16'];
const DRESS_SIZE_OPTIONS = ['0', '2', '4', '6', '8', '10', '12', '14', '16'];
const SHOE_SIZE_OPTIONS = ['5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '13'];
const BRA_SIZE_OPTIONS = ['32A', '32B', '32C', '32D', '34A', '34B', '34C', '34D', '34DD', '36A', '36B', '36C', '36D', '36DD', '38B', '38C', '38D'];
const BODY_TYPE_TAGS = ['petite', 'curvy', 'athletic', 'hourglass', 'pear', 'apple', 'rectangle', 'plus-size'];

interface CompleteProfileSheetProps {
  visible: boolean;
  onClose: () => void;
  triggerSource?: 'auto' | 'manual';
  testIDPrefix?: string;
}

export function CompleteProfileSheet({
  visible,
  onClose,
  triggerSource = 'manual',
  testIDPrefix = 'complete-profile-sheet',
}: CompleteProfileSheetProps) {
  const creatorId = useAuthStore((s) => s.creatorId);

  // Pull current values from profile store (these reflect what's already saved).
  const photoUri = useProfileStore((s) => s.photoUri);
  const setPhotoUriStore = useProfileStore((s) => s.setPhotoUri);
  const lastName = useProfileStore((s) => s.lastName);
  const firstName = useProfileStore((s) => s.firstName);
  const bio = useProfileStore((s) => s.bio);
  const setBioStore = useProfileStore((s) => s.setBio);
  const location = useProfileStore((s) => s.location);
  const setLocationStore = useProfileStore((s) => s.setLocation);
  const measurementUnit = useProfileStore((s) => s.measurementUnit);
  const topSize = useProfileStore((s) => s.topSize);
  const bottomSize = useProfileStore((s) => s.bottomSize);
  const dressSize = useProfileStore((s) => s.dressSize);
  const shoeSize = useProfileStore((s) => s.shoeSize);
  const braSize = useProfileStore((s) => s.braSize);
  const bodyTypeSelfTags = useProfileStore((s) => s.bodyTypeSelfTags);
  const profileCompletedAt = useProfileStore((s) => s.profileCompletedAt);
  const setMeasurements = useProfileStore((s) => s.setMeasurements);

  const handles = useCreatorStore((s) => s.handles);
  const updateHandle = useCreatorStore((s) => s.updateHandle);

  const igHandle = useMemo(() => handles.find((h) => h.id === 'instagram')?.handle ?? '', [handles]);
  const ttHandle = useMemo(() => handles.find((h) => h.id === 'tiktok')?.handle ?? '', [handles]);

  // Draft state — typed input lives here. On every change we schedule a
  // debounced flush to the DB. Save & continue forces flushing.
  const [draftLastName, setDraftLastName] = useState<string>('');
  const [draftBio, setDraftBio] = useState<string>('');
  const [draftLocation, setDraftLocation] = useState<string>('');
  const [draftInstagram, setDraftInstagram] = useState<string>('');
  const [draftTiktok, setDraftTiktok] = useState<string>('');

  // Sync drafts from store when the sheet becomes visible or store changes
  useEffect(() => { setDraftLastName(lastName ?? ''); }, [lastName, visible]);
  useEffect(() => { setDraftBio(bio ?? ''); }, [bio, visible]);
  useEffect(() => { setDraftLocation(location ?? ''); }, [location, visible]);
  useEffect(() => { setDraftInstagram(igHandle ?? ''); }, [igHandle, visible]);
  useEffect(() => { setDraftTiktok(ttHandle ?? ''); }, [ttHandle, visible]);

  // Collapsed sections
  const [sizingOpen, setSizingOpen] = useState<boolean>(false);
  const [bodyTagsOpen, setBodyTagsOpen] = useState<boolean>(false);

  // Local size selection state (mirror of store; lets us avoid double-write)
  const [selectedTop, setSelectedTop] = useState<string>('');
  const [selectedBottom, setSelectedBottom] = useState<string>('');
  const [selectedDress, setSelectedDress] = useState<string>('');
  const [selectedShoe, setSelectedShoe] = useState<string>('');
  const [selectedBra, setSelectedBra] = useState<string>('');
  const [unit, setUnit] = useState<MeasurementUnit>('us');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => { setSelectedTop(topSize ?? ''); }, [topSize, visible]);
  useEffect(() => { setSelectedBottom(bottomSize ?? ''); }, [bottomSize, visible]);
  useEffect(() => { setSelectedDress(dressSize ?? ''); }, [dressSize, visible]);
  useEffect(() => { setSelectedShoe(shoeSize ?? ''); }, [shoeSize, visible]);
  useEffect(() => { setSelectedBra(braSize ?? ''); }, [braSize, visible]);
  useEffect(() => { setUnit(measurementUnit); }, [measurementUnit, visible]);
  useEffect(() => { setSelectedTags(bodyTypeSelfTags ?? []); }, [bodyTypeSelfTags, visible]);

  // Avatar upload state
  const [photoUploading, setPhotoUploading] = useState<boolean>(false);

  // Debounce timer refs — one per field. Each holds the latest pending write
  // so flushPending can clear & invoke them on Save & continue.
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});
  const pendingFlushersRef = useRef<Record<string, () => void>>({});

  const scheduleDebounce = useCallback((key: string, fn: () => void) => {
    if (debounceRefs.current[key]) {
      clearTimeout(debounceRefs.current[key]!);
    }
    pendingFlushersRef.current[key] = fn;
    debounceRefs.current[key] = setTimeout(() => {
      const flusher = pendingFlushersRef.current[key];
      if (flusher) {
        try { flusher(); } catch (e) { console.warn('[CompleteProfileSheet] debounced write failed:', e); }
        delete pendingFlushersRef.current[key];
      }
      debounceRefs.current[key] = null;
    }, DEBOUNCE_MS);
  }, []);

  const flushAllPending = useCallback(() => {
    const keys = Object.keys(pendingFlushersRef.current);
    for (const k of keys) {
      const flusher = pendingFlushersRef.current[k];
      if (debounceRefs.current[k]) {
        clearTimeout(debounceRefs.current[k]!);
        debounceRefs.current[k] = null;
      }
      if (flusher) {
        try { flusher(); } catch (e) { console.warn('[CompleteProfileSheet] flush write failed:', e); }
      }
      delete pendingFlushersRef.current[k];
    }
  }, []);

  // Cleanup any pending timers on unmount.
  useEffect(() => {
    return () => {
      const refs = debounceRefs.current;
      Object.keys(refs).forEach((k) => {
        if (refs[k]) clearTimeout(refs[k]!);
      });
    };
  }, []);

  // Field change handlers ---------------------------------------------------

  const onChangeLastName = (v: string) => {
    setDraftLastName(v);
    scheduleDebounce('lastName', () => {
      const next = v.trim() === '' ? null : v.trim();
      setMeasurements({ lastName: next }).catch((e) => console.warn('lastName save failed:', e));
    });
  };

  const onChangeBio = (v: string) => {
    const trimmed = v.slice(0, BIO_LIMIT);
    setDraftBio(trimmed);
    scheduleDebounce('bio', () => {
      setBioStore(trimmed.trim());
    });
  };

  const onChangeLocation = (v: string) => {
    setDraftLocation(v);
    scheduleDebounce('location', () => {
      const next = v.trim() === '' ? null : v.trim();
      setLocationStore(next);
    });
  };

  const onChangeInstagram = (v: string) => {
    setDraftInstagram(v);
    scheduleDebounce('instagram', () => {
      updateHandle('instagram', v.trim());
    });
  };

  const onChangeTiktok = (v: string) => {
    setDraftTiktok(v);
    scheduleDebounce('tiktok', () => {
      updateHandle('tiktok', v.trim());
    });
  };

  const onSelectSize = (kind: 'top' | 'bottom' | 'dress' | 'shoe' | 'bra', value: string) => {
    Haptics.selectionAsync().catch(() => {});
    if (kind === 'top') {
      const next = selectedTop === value ? '' : value;
      setSelectedTop(next);
      setMeasurements({ topSize: next || null }).catch((e) => console.warn('topSize save failed:', e));
    } else if (kind === 'bottom') {
      const next = selectedBottom === value ? '' : value;
      setSelectedBottom(next);
      setMeasurements({ bottomSize: next || null }).catch((e) => console.warn('bottomSize save failed:', e));
    } else if (kind === 'dress') {
      const next = selectedDress === value ? '' : value;
      setSelectedDress(next);
      setMeasurements({ dressSize: next || null }).catch((e) => console.warn('dressSize save failed:', e));
    } else if (kind === 'shoe') {
      const next = selectedShoe === value ? '' : value;
      setSelectedShoe(next);
      setMeasurements({ shoeSize: next || null }).catch((e) => console.warn('shoeSize save failed:', e));
    } else if (kind === 'bra') {
      const next = selectedBra === value ? '' : value;
      setSelectedBra(next);
      setMeasurements({ braSize: next || null }).catch((e) => console.warn('braSize save failed:', e));
    }
  };

  const onToggleUnit = (next: MeasurementUnit) => {
    Haptics.selectionAsync().catch(() => {});
    if (next === unit) return;
    setUnit(next);
    setMeasurements({ measurementUnit: next }).catch((e) => console.warn('unit save failed:', e));
  };

  const onToggleTag = (tag: string) => {
    Haptics.selectionAsync().catch(() => {});
    const next = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];
    setSelectedTags(next);
    setMeasurements({ bodyTypeSelfTags: next }).catch((e) => console.warn('tags save failed:', e));
  };

  // Photo upload ------------------------------------------------------------

  const pickAndUploadPhoto = async () => {
    if (photoUploading) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled || !result.assets[0]) return;
      setPhotoUploading(true);
      const stableUri = await persistPickedPhoto(result.assets[0].uri);
      await setPhotoUriStore(stableUri);
    } catch (err) {
      console.warn('[CompleteProfileSheet] photo upload failed:', err);
      Alert.alert(
        'Photo failed to upload',
        'Try again from Settings.',
      );
    } finally {
      setPhotoUploading(false);
    }
  };

  // Stamp profile_completed_at if any "complete-able" field is non-empty.
  // Only stamps if not already stamped (don't overwrite).
  const stampCompletedIfEligible = useCallback(async () => {
    if (!creatorId) return;
    if (profileCompletedAt) return; // already stamped
    const anyFilled =
      (photoUri && photoUri.length > 0) ||
      (draftBio.trim().length > 0) ||
      (draftInstagram.trim().length > 0) ||
      (draftTiktok.trim().length > 0) ||
      (draftLocation.trim().length > 0);
    if (!anyFilled) return;
    try {
      const iso = new Date().toISOString();
      const { error } = await supabase
        .from('creator_profiles')
        .update({ profile_completed_at: iso })
        .eq('creator_id', creatorId)
        .is('profile_completed_at', null);
      if (error) console.warn('profile_completed_at stamp failed:', error);
      else {
        // Refetch to keep the store in sync
        await useProfileStore.getState().fetchProfile(creatorId);
      }
    } catch (e) {
      console.warn('profile_completed_at stamp exception:', e);
    }
  }, [creatorId, profileCompletedAt, photoUri, draftBio, draftInstagram, draftTiktok, draftLocation]);

  // Dismiss --------------------------------------------------------------

  const handleDismiss = useCallback(async (opts: { flushFirst: boolean }) => {
    if (opts.flushFirst) {
      flushAllPending();
    } else {
      // Don't fire pending debounces — just drop them silently for
      // "I'll do it later" / backdrop tap. (Already-flushed writes stay.)
      const refs = debounceRefs.current;
      Object.keys(refs).forEach((k) => {
        if (refs[k]) clearTimeout(refs[k]!);
        refs[k] = null;
        delete pendingFlushersRef.current[k];
      });
    }
    // Set AsyncStorage key (always — both auto and manual).
    if (creatorId) {
      try {
        await AsyncStorage.setItem(`${COMPLETE_PROFILE_SHEET_KEY_PREFIX}${creatorId}`, 'true');
      } catch (e) {
        console.warn('[CompleteProfileSheet] could not set seen key:', e);
      }
    }
    // Try to stamp profile_completed_at — non-blocking
    stampCompletedIfEligible().catch(() => {});
    onClose();
  }, [creatorId, flushAllPending, stampCompletedIfEligible, onClose]);

  const handleSaveAndContinue = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    handleDismiss({ flushFirst: true });
  }, [handleDismiss]);

  const handleLater = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    handleDismiss({ flushFirst: false });
  }, [handleDismiss]);

  // Render helpers -------------------------------------------------------

  const displayInitial = (firstName?.[0] ?? '?').toUpperCase();
  const sheetHeight = Math.round(Dimensions.get('window').height * 0.88);

  // Avoid emitting a triggerSource-dependent UI change but use it for
  // testability / future hooks. Currently no diff in behavior — we always
  // write the key on dismiss (the brief settles on this in the "Done"
  // discussion).
  // (No-op reference so the prop isn't unused.)
  void triggerSource;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleLater}
      testID={`${testIDPrefix}-modal`}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={handleLater}
          testID={`${testIDPrefix}-backdrop`}
        />
        <View style={[styles.sheet, { height: sheetHeight }]} testID={`${testIDPrefix}-sheet`}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Text style={styles.title} testID={`${testIDPrefix}-title`}>
              Almost there 🖤
            </Text>
            <Pressable
              onPress={handleLater}
              hitSlop={10}
              style={styles.closeBtn}
              testID={`${testIDPrefix}-close`}
            >
              <X size={18} color="#1A1210" strokeWidth={2} />
            </Pressable>
          </View>

          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
          >
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.lead}>
                A few extras unlock features:
              </Text>
              <View style={styles.bullets}>
                <BulletRow text="Connect IG/TikTok → live follower count + bigger spotlight reach" />
                <BulletRow text="Add a photo + bio → creators with profile photos get 3× more profile visits" />
                <BulletRow text="Sizes → so we can recommend items that actually fit" />
              </View>

              {/* Profile photo */}
              <Pressable
                onPress={pickAndUploadPhoto}
                style={styles.avatarRow}
                testID={`${testIDPrefix}-avatar`}
              >
                {photoUri && photoUri.length > 0 ? (
                  <Image source={{ uri: photoUri }} style={styles.avatarCircle} contentFit="cover" />
                ) : (
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarInitial}>{displayInitial}</Text>
                  </View>
                )}
                <View style={styles.avatarBadge}>
                  {photoUploading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <CameraIcon size={14} color="#FFFFFF" strokeWidth={2} />
                  )}
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={styles.fieldLabel}>Profile photo</Text>
                  <Text style={styles.helperSm}>
                    {photoUploading ? 'Uploading…' : 'Tap to upload a photo.'}
                  </Text>
                </View>
              </Pressable>

              {/* Last name */}
              <View style={styles.fieldCard}>
                <Text style={styles.fieldLabel}>Last name</Text>
                <TextInput
                  value={draftLastName}
                  onChangeText={onChangeLastName}
                  placeholder="Patel"
                  placeholderTextColor="#A0938D"
                  style={styles.input}
                  cursorColor="#2C2C2C"
                  selectionColor="rgba(44,44,44,0.3)"
                  testID={`${testIDPrefix}-last-name`}
                />
              </View>

              {/* Bio */}
              <View style={styles.fieldCard}>
                <View style={styles.bioHeaderRow}>
                  <Text style={styles.fieldLabel}>Bio</Text>
                  <Text style={styles.bioCounter}>{draftBio.length}/{BIO_LIMIT}</Text>
                </View>
                <TextInput
                  value={draftBio}
                  onChangeText={onChangeBio}
                  placeholder="A few words about your style"
                  placeholderTextColor="#A0938D"
                  multiline
                  style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]}
                  cursorColor="#2C2C2C"
                  selectionColor="rgba(44,44,44,0.3)"
                  testID={`${testIDPrefix}-bio`}
                />
              </View>

              {/* Instagram */}
              <View style={styles.fieldCard}>
                <Text style={styles.fieldLabel}>Instagram</Text>
                <View style={styles.handleInputRow}>
                  <Text style={styles.atSign}>@</Text>
                  <TextInput
                    value={draftInstagram}
                    onChangeText={onChangeInstagram}
                    placeholder="yourhandle"
                    placeholderTextColor="#A0938D"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, { flex: 1 }]}
                    cursorColor="#2C2C2C"
                    selectionColor="rgba(44,44,44,0.3)"
                    testID={`${testIDPrefix}-instagram`}
                  />
                </View>
                <Text style={styles.helperSm}>
                  Manual handle entry — Instagram OAuth isn{`'`}t available yet.
                </Text>
              </View>

              {/* TikTok */}
              <View style={styles.fieldCard}>
                <Text style={styles.fieldLabel}>TikTok</Text>
                <View style={styles.handleInputRow}>
                  <Text style={styles.atSign}>@</Text>
                  <TextInput
                    value={draftTiktok}
                    onChangeText={onChangeTiktok}
                    placeholder="yourhandle"
                    placeholderTextColor="#A0938D"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, { flex: 1 }]}
                    cursorColor="#2C2C2C"
                    selectionColor="rgba(44,44,44,0.3)"
                    testID={`${testIDPrefix}-tiktok`}
                  />
                </View>
                <Text style={styles.helperSm}>
                  Manual handle entry — TikTok OAuth isn{`'`}t available yet.
                </Text>
              </View>

              {/* Pinterest (real OAuth available) */}
              <View style={{ marginTop: 4, marginBottom: 10 }}>
                <PinterestConnectCard creatorId={creatorId} />
              </View>

              {/* Location */}
              <View style={styles.fieldCard}>
                <Text style={styles.fieldLabel}>Location</Text>
                <TextInput
                  value={draftLocation}
                  onChangeText={onChangeLocation}
                  placeholder="City, country"
                  placeholderTextColor="#A0938D"
                  style={styles.input}
                  cursorColor="#2C2C2C"
                  selectionColor="rgba(44,44,44,0.3)"
                  testID={`${testIDPrefix}-location`}
                />
              </View>

              {/* Sizing — collapsed */}
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setSizingOpen((v) => !v);
                }}
                style={styles.collapsibleHeader}
                testID={`${testIDPrefix}-sizing-toggle`}
              >
                <Text style={styles.collapsibleHeaderText}>Sizing — for fit recommendations</Text>
                {sizingOpen ? <ChevronUp size={18} color="#1A1210" /> : <ChevronDown size={18} color="#1A1210" />}
              </Pressable>
              {sizingOpen ? (
                <View style={styles.collapsibleBody} testID={`${testIDPrefix}-sizing-body`}>
                  <SizeRow
                    label="Top size"
                    options={TOP_SIZE_OPTIONS}
                    selected={selectedTop}
                    onSelect={(v) => onSelectSize('top', v)}
                    testIDPrefix={`${testIDPrefix}-top`}
                  />
                  <SizeRow
                    label="Bottom size"
                    options={BOTTOM_SIZE_OPTIONS}
                    selected={selectedBottom}
                    onSelect={(v) => onSelectSize('bottom', v)}
                    testIDPrefix={`${testIDPrefix}-bottom`}
                  />
                  <SizeRow
                    label="Dress size"
                    options={DRESS_SIZE_OPTIONS}
                    selected={selectedDress}
                    onSelect={(v) => onSelectSize('dress', v)}
                    testIDPrefix={`${testIDPrefix}-dress`}
                  />
                  <SizeRow
                    label="Shoe size"
                    options={SHOE_SIZE_OPTIONS}
                    selected={selectedShoe}
                    onSelect={(v) => onSelectSize('shoe', v)}
                    testIDPrefix={`${testIDPrefix}-shoe`}
                  />
                  <SizeRow
                    label="Bra size"
                    options={BRA_SIZE_OPTIONS}
                    selected={selectedBra}
                    onSelect={(v) => onSelectSize('bra', v)}
                    testIDPrefix={`${testIDPrefix}-bra`}
                  />
                  {/* Measurement unit */}
                  <View style={{ marginTop: 8 }}>
                    <Text style={styles.fieldLabel}>Measurement unit</Text>
                    <View style={styles.unitRow}>
                      <Pressable
                        onPress={() => onToggleUnit('us')}
                        className={
                          unit === 'us'
                            ? 'bg-[#B87063] rounded-full py-2 px-4 flex-row items-center justify-center active:opacity-85'
                            : 'bg-white rounded-full py-2 px-4 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85'
                        }
                        testID={`${testIDPrefix}-unit-us`}
                      >
                        <Text
                          className={unit === 'us' ? 'text-white text-[13px] font-semibold' : 'text-[#1A1210] text-[13px] font-semibold'}
                          style={{ fontFamily: 'DMSans_500Medium' }}
                        >
                          Imperial
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => onToggleUnit('metric')}
                        className={
                          unit === 'metric'
                            ? 'bg-[#B87063] rounded-full py-2 px-4 flex-row items-center justify-center active:opacity-85'
                            : 'bg-white rounded-full py-2 px-4 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85'
                        }
                        testID={`${testIDPrefix}-unit-metric`}
                      >
                        <Text
                          className={unit === 'metric' ? 'text-white text-[13px] font-semibold' : 'text-[#1A1210] text-[13px] font-semibold'}
                          style={{ fontFamily: 'DMSans_500Medium' }}
                        >
                          Metric
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ) : null}

              {/* Body-type tags — collapsed */}
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setBodyTagsOpen((v) => !v);
                }}
                style={styles.collapsibleHeader}
                testID={`${testIDPrefix}-bodytype-toggle`}
              >
                <Text style={styles.collapsibleHeaderText}>Body type tags</Text>
                {bodyTagsOpen ? <ChevronUp size={18} color="#1A1210" /> : <ChevronDown size={18} color="#1A1210" />}
              </Pressable>
              {bodyTagsOpen ? (
                <View style={styles.collapsibleBody} testID={`${testIDPrefix}-bodytype-body`}>
                  <View style={styles.chipWrap}>
                    {BODY_TYPE_TAGS.map((tag) => {
                      const selected = selectedTags.includes(tag);
                      return (
                        <Pressable
                          key={tag}
                          onPress={() => onToggleTag(tag)}
                          className={
                            selected
                              ? 'bg-[#B87063] rounded-full py-2 px-4 flex-row items-center justify-center active:opacity-85'
                              : 'bg-white rounded-full py-2 px-4 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85'
                          }
                          testID={`${testIDPrefix}-tag-${tag}`}
                        >
                          {selected ? <Check size={14} color="#FFFFFF" strokeWidth={2.5} style={{ marginRight: 6 }} /> : null}
                          <Text
                            className={selected ? 'text-white text-[13px] font-semibold' : 'text-[#1A1210] text-[13px] font-semibold'}
                            style={{ fontFamily: 'DMSans_500Medium' }}
                          >
                            {tag}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              <View style={{ height: 24 }} />
            </ScrollView>
          </KeyboardAvoidingView>

          {/* Footer */}
          <View style={styles.footer}>
            <Pressable
              onPress={handleSaveAndContinue}
              className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
              style={{
                shadowColor: '#1A1210',
                shadowOpacity: 0.12,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
                elevation: 2,
              }}
              testID={`${testIDPrefix}-save`}
            >
              <Text
                className="text-white text-[15px] font-semibold"
                style={{ fontFamily: 'DMSans_500Medium' }}
              >
                Save and continue
              </Text>
              <ArrowRight size={18} color="#FFFFFF" style={{ marginLeft: 6 }} />
            </Pressable>
            <Pressable
              onPress={handleLater}
              className="flex-row items-center justify-center gap-1.5 py-3 px-3 active:opacity-70"
              style={{ marginTop: 6 }}
              testID={`${testIDPrefix}-later`}
            >
              <Text
                className="text-[#6B5E58] text-sm font-medium"
                style={{ fontFamily: 'DMSans_500Medium' }}
              >
                I{`'`}ll do it later
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function BulletRow({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

function SizeRow({
  label,
  options,
  selected,
  onSelect,
  testIDPrefix,
}: {
  label: string;
  options: string[];
  selected: string;
  onSelect: (v: string) => void;
  testIDPrefix: string;
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: 8, paddingVertical: 4, paddingRight: 8 }}
      >
        {options.map((opt) => {
          const isSelected = selected === opt;
          return (
            <Pressable
              key={opt}
              onPress={() => onSelect(opt)}
              className={
                isSelected
                  ? 'bg-[#B87063] rounded-full py-2 px-4 flex-row items-center justify-center active:opacity-85'
                  : 'bg-white rounded-full py-2 px-4 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85'
              }
              testID={`${testIDPrefix}-${opt}`}
            >
              <Text
                className={isSelected ? 'text-white text-[13px] font-semibold' : 'text-[#1A1210] text-[13px] font-semibold'}
                style={{ fontFamily: 'DMSans_500Medium' }}
              >
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FAF7F3',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 0,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#E0D6CC',
    marginTop: 4,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 26,
    color: '#1A1210',
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0EBE5',
  },
  scrollContent: {
    paddingBottom: 8,
  },
  lead: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#3D3330',
    lineHeight: 20,
    marginBottom: 8,
  },
  bullets: {
    marginBottom: 16,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 4,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#B87063',
    marginTop: 8,
    marginRight: 10,
  },
  bulletText: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#3D3330',
    lineHeight: 19,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE6DF',
    marginBottom: 10,
    position: 'relative',
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#C4A882',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  avatarBadge: {
    position: 'absolute',
    left: 12 + 56 - 18,
    top: 12 + 56 - 18,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1A1210',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  fieldCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EDE6DF',
  },
  fieldLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#6B5E58',
    marginBottom: 6,
  },
  input: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    color: '#1A1210',
    paddingVertical: 4,
  },
  helperSm: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#8C8580',
    marginTop: 6,
  },
  bioHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  bioCounter: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#A0938D',
  },
  handleInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  atSign: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    color: '#8C8580',
  },
  collapsibleHeader: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#EDE6DF',
    marginBottom: 10,
  },
  collapsibleHeaderText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
  },
  collapsibleBody: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#EDE6DF',
    marginBottom: 10,
    marginTop: -6,
  },
  unitRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  footer: {
    paddingTop: 10,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: '#EDE6DF',
    backgroundColor: '#FAF7F3',
  },
});

export default CompleteProfileSheet;
