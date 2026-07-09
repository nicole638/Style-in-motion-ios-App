import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  StyleSheet,
  Switch,
  Platform,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { ChevronLeft, Plus, X, Camera as CameraIcon, Check } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import useAuthStore from '@/lib/state/authStore';
import useProfileStore, { type BrandSizeExample, type MeasurementUnit } from '@/lib/state/profileStore';
import useCreatorStore from '@/lib/state/creatorStore';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import PhotoEditor from '@/components/PhotoEditor';
import { cmToFtIn, ftInToCm, kgToLb, lbToKg } from '@/lib/utils/units';
import { persistPickedPhoto } from '@/lib/utils/persistPickedPhoto';
import { deriveAutoTags } from '@/lib/utils/profileCompletion';

const SELF_TAG_OPTIONS = [
  'curvy', 'athletic', 'hourglass', 'pear', 'apple', 'rectangle',
  'modest', 'tomboy', 'feminine', 'edgy', 'classic', 'vintage',
  'bohemian', 'minimalist', 'streetwear',
] as const;

const BRAND_EXAMPLE_CATEGORIES = [
  'Top', 'Bottom', 'Dress', 'Outerwear', 'Shoes', 'Other',
] as const;

const SECTION_KEYS = ['1', '2', '3', '4', '5', '6'] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

export default function ProfileSetupScreen() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const userType = useAuthStore((s) => s.userType);
  const params = useLocalSearchParams<{ section?: string }>();

  // Permission gate — creator only
  useEffect(() => {
    if (userType && userType !== 'creator') {
      router.replace('/welcome' as any);
    }
  }, [userType]);

  // Pull from store
  const photoUri = useProfileStore((s) => s.photoUri);
  const setPhotoUri = useProfileStore((s) => s.setPhotoUri);
  const username = useProfileStore((s) => s.username);
  const firstName = useProfileStore((s) => s.firstName);
  const lastName = useProfileStore((s) => s.lastName);
  const bio = useProfileStore((s) => s.bio);
  const setBio = useProfileStore((s) => s.setBio);
  const location = useProfileStore((s) => s.location);
  const setLocation = useProfileStore((s) => s.setLocation);
  const heightCm = useProfileStore((s) => s.heightCm);
  const weightKg = useProfileStore((s) => s.weightKg);
  const measurementUnit = useProfileStore((s) => s.measurementUnit);
  const topSize = useProfileStore((s) => s.topSize);
  const bottomSize = useProfileStore((s) => s.bottomSize);
  const dressSize = useProfileStore((s) => s.dressSize);
  const shoeSize = useProfileStore((s) => s.shoeSize);
  const braSize = useProfileStore((s) => s.braSize);
  const brandSizeExamples = useProfileStore((s) => s.brandSizeExamples);
  const bodyTypeSelfTags = useProfileStore((s) => s.bodyTypeSelfTags);
  const setMeasurements = useProfileStore((s) => s.setMeasurements);

  const handles = useCreatorStore((s) => s.handles);
  const updateHandle = useCreatorStore((s) => s.updateHandle);
  const toggleConnected = useCreatorStore((s) => s.toggleConnected);

  // ----- Local draft state (so we don't fire DB writes on every keystroke) -----
  const [draftFirst, setDraftFirst] = useState<string>(firstName ?? '');
  const [draftLast, setDraftLast] = useState<string>(lastName ?? '');
  const [draftBio, setDraftBio] = useState<string>(bio ?? '');
  const [draftLocation, setDraftLocation] = useState<string>(location ?? '');

  const [unit, setUnit] = useState<MeasurementUnit>(measurementUnit);
  const initFt = useMemo(() => (heightCm ? cmToFtIn(heightCm) : { feet: 0, inches: 0 }), [heightCm]);
  const [feetStr, setFeetStr] = useState<string>(initFt.feet ? String(initFt.feet) : '');
  const [inchesStr, setInchesStr] = useState<string>(initFt.inches ? String(initFt.inches) : '');
  const [cmStr, setCmStr] = useState<string>(heightCm ? String(heightCm) : '');
  const [lbStr, setLbStr] = useState<string>(weightKg ? String(kgToLb(weightKg)) : '');
  const [kgStr, setKgStr] = useState<string>(weightKg ? String(weightKg) : '');

  const [draftTopSize, setDraftTopSize] = useState<string>(topSize ?? '');
  const [draftBottomSize, setDraftBottomSize] = useState<string>(bottomSize ?? '');
  const [draftDressSize, setDraftDressSize] = useState<string>(dressSize ?? '');
  const [draftShoeSize, setDraftShoeSize] = useState<string>(shoeSize ?? '');
  const [draftBraSize, setDraftBraSize] = useState<string>(braSize ?? '');

  const [draftExamples, setDraftExamples] = useState<BrandSizeExample[]>(brandSizeExamples);
  const [draftSelfTags, setDraftSelfTags] = useState<string[]>(bodyTypeSelfTags);
  const [customTagInput, setCustomTagInput] = useState<string>('');

  const [savingSection, setSavingSection] = useState<SectionKey | null>(null);
  const [savedSection, setSavedSection] = useState<SectionKey | null>(null);
  const [showPhotoEditor, setShowPhotoEditor] = useState<boolean>(false);
  const [pickedPhotoUri, setPickedPhotoUri] = useState<string>('');

  // Sync draft state when fresh fetch lands
  useEffect(() => { setDraftFirst(firstName ?? ''); }, [firstName]);
  useEffect(() => { setDraftLast(lastName ?? ''); }, [lastName]);
  useEffect(() => { setDraftBio(bio ?? ''); }, [bio]);
  useEffect(() => { setDraftLocation(location ?? ''); }, [location]);
  useEffect(() => { setUnit(measurementUnit); }, [measurementUnit]);
  useEffect(() => {
    if (heightCm) {
      const { feet, inches } = cmToFtIn(heightCm);
      setFeetStr(String(feet));
      setInchesStr(String(inches));
      setCmStr(String(heightCm));
    }
  }, [heightCm]);
  useEffect(() => {
    if (weightKg) {
      setKgStr(String(weightKg));
      setLbStr(String(kgToLb(weightKg)));
    }
  }, [weightKg]);
  useEffect(() => { setDraftTopSize(topSize ?? ''); }, [topSize]);
  useEffect(() => { setDraftBottomSize(bottomSize ?? ''); }, [bottomSize]);
  useEffect(() => { setDraftDressSize(dressSize ?? ''); }, [dressSize]);
  useEffect(() => { setDraftShoeSize(shoeSize ?? ''); }, [shoeSize]);
  useEffect(() => { setDraftBraSize(braSize ?? ''); }, [braSize]);
  useEffect(() => { setDraftExamples(brandSizeExamples); }, [brandSizeExamples]);
  useEffect(() => { setDraftSelfTags(bodyTypeSelfTags); }, [bodyTypeSelfTags]);

  // ----- Auto-scroll to a section when ?section=N is provided -----
  const scrollRef = useRef<ScrollView | null>(null);
  const sectionPositions = useRef<Record<SectionKey, number>>({
    '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0,
  });
  const requestedSectionRef = useRef<SectionKey | null>(null);
  const requestedScrolledRef = useRef<boolean>(false);

  useEffect(() => {
    const requested = (params.section ?? '').toString();
    if (SECTION_KEYS.includes(requested as SectionKey)) {
      requestedSectionRef.current = requested as SectionKey;
    }
  }, [params.section]);

  const onSectionLayout = (key: SectionKey) => (e: { nativeEvent: { layout: { y: number } } }) => {
    sectionPositions.current[key] = e.nativeEvent.layout.y;
    if (
      requestedSectionRef.current === key &&
      !requestedScrolledRef.current &&
      scrollRef.current
    ) {
      requestedScrolledRef.current = true;
      const y = e.nativeEvent.layout.y;
      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
      }, 80);
    }
  };

  // ----- Computed: auto-derived body type tags -----
  const autoTags = useMemo(
    () => deriveAutoTags({ heightCm, topSize: draftTopSize, dressSize: draftDressSize }),
    [heightCm, draftTopSize, draftDressSize],
  );

  // ----- Photo picker -----
  const pickAvatarPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (!result.canceled && result.assets[0]) {
        const stableUri = await persistPickedPhoto(result.assets[0].uri);
        setPickedPhotoUri(stableUri);
        setShowPhotoEditor(true);
      }
    } catch (e) {
      console.warn('[profile-setup] picker error:', e);
    }
  };
  const handlePhotoEditorSave = async (editedUri: string) => {
    setShowPhotoEditor(false);
    setPickedPhotoUri('');
    try {
      await setPhotoUri(editedUri);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error saving photo';
      Alert.alert("Couldn't save photo", message);
    }
  };
  const handlePhotoEditorCancel = () => {
    setShowPhotoEditor(false);
    setPickedPhotoUri('');
  };

  // ----- Per-section savers -----
  const showSaved = (key: SectionKey) => {
    setSavedSection(key);
    setTimeout(() => setSavedSection((c) => (c === key ? null : c)), 1500);
  };

  const saveSection1 = async () => {
    setSavingSection('1');
    try {
      await setMeasurements({
        firstName: draftFirst.trim() || null,
        lastName: draftLast.trim() || null,
      });
      // bio + location use existing setters (single column update each)
      const trimmedBio = draftBio.trim();
      if (trimmedBio !== (bio ?? '')) setBio(trimmedBio);
      const trimmedLoc = draftLocation.trim();
      const nextLoc = trimmedLoc === '' ? null : trimmedLoc;
      if (nextLoc !== location) setLocation(nextLoc);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      showSaved('1');
    } catch (e) {
      console.warn('[profile-setup] saveSection1 error:', e);
      Alert.alert('Save failed', 'Could not save profile basics. Try again.');
    } finally {
      setSavingSection(null);
    }
  };

  const saveSection2 = async () => {
    setSavingSection('2');
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      showSaved('2');
    } finally {
      setSavingSection(null);
    }
  };

  const computeHeightCm = (): number | null => {
    if (unit === 'us') {
      const f = parseInt(feetStr, 10);
      const i = parseInt(inchesStr, 10);
      if (!Number.isFinite(f) && !Number.isFinite(i)) return null;
      const totalCm = ftInToCm(Number.isFinite(f) ? f : 0, Number.isFinite(i) ? i : 0);
      return totalCm > 0 ? totalCm : null;
    }
    const c = parseInt(cmStr, 10);
    return Number.isFinite(c) && c > 0 ? c : null;
  };

  const computeWeightKg = (): number | null => {
    if (unit === 'us') {
      const lb = parseFloat(lbStr);
      if (!Number.isFinite(lb) || lb <= 0) return null;
      return lbToKg(lb);
    }
    const kg = parseFloat(kgStr);
    return Number.isFinite(kg) && kg > 0 ? kg : null;
  };

  const saveSection3 = async () => {
    setSavingSection('3');
    try {
      const nextHeight = computeHeightCm();
      const nextWeight = computeWeightKg();
      await setMeasurements({
        measurementUnit: unit,
        heightCm: nextHeight,
        weightKg: nextWeight,
        topSize: draftTopSize.trim() || null,
        bottomSize: draftBottomSize.trim() || null,
        dressSize: draftDressSize.trim() || null,
        shoeSize: draftShoeSize.trim() || null,
        braSize: draftBraSize.trim() || null,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      showSaved('3');
    } catch (e) {
      Alert.alert('Save failed', 'Could not save measurements. Try again.');
    } finally {
      setSavingSection(null);
    }
  };

  const saveSection4 = async () => {
    setSavingSection('4');
    try {
      const cleaned = draftExamples
        .map((e) => ({ brand: e.brand.trim(), category: e.category.trim(), size: e.size.trim() }))
        .filter((e) => e.brand.length > 0 || e.size.length > 0 || e.category.length > 0);
      await setMeasurements({ brandSizeExamples: cleaned });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      showSaved('4');
    } catch (e) {
      Alert.alert('Save failed', 'Could not save brand examples. Try again.');
    } finally {
      setSavingSection(null);
    }
  };

  const saveSection5 = async () => {
    setSavingSection('5');
    try {
      await setMeasurements({ bodyTypeSelfTags: draftSelfTags });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      showSaved('5');
    } catch (e) {
      Alert.alert('Save failed', 'Could not save tags. Try again.');
    } finally {
      setSavingSection(null);
    }
  };

  // Compute which required fields are still missing. Used to gate
  // profile_completed_at and to show "X more steps to go".
  const missingRequired = useMemo<string[]>(() => {
    const missing: string[] = [];
    if (!draftFirst.trim()) missing.push('First name');
    if (!username || username.trim().length === 0) missing.push('Username');
    if (!draftBio.trim()) missing.push('Bio');
    if (!photoUri || !photoUri.startsWith('http')) missing.push('Profile photo');
    const hCm = computeHeightCm();
    if (!(typeof hCm === 'number' && hCm > 0)) missing.push('Height');
    const hasAnySize =
      !!draftTopSize.trim() || !!draftBottomSize.trim() || !!draftDressSize.trim();
    if (!hasAnySize) missing.push('At least one size (top, bottom, or dress)');
    return missing;
  // computeHeightCm is stable; recompute on inputs it depends on.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftFirst, username, draftBio, photoUri, draftTopSize, draftBottomSize, draftDressSize, unit, feetStr, inchesStr, cmStr]);

  const saveAll = async () => {
    setSavingSection('6');
    try {
      const nextHeight = computeHeightCm();
      const nextWeight = computeWeightKg();
      const cleanedExamples = draftExamples
        .map((e) => ({ brand: e.brand.trim(), category: e.category.trim(), size: e.size.trim() }))
        .filter((e) => e.brand.length > 0 || e.size.length > 0 || e.category.length > 0);

      const shouldMarkCompleted = missingRequired.length === 0;

      // Single atomic UPDATE for everything. Only stamp profile_completed_at
      // when all required fields are present — otherwise leave it NULL.
      await setMeasurements({
        firstName: draftFirst.trim() || null,
        lastName: draftLast.trim() || null,
        measurementUnit: unit,
        heightCm: nextHeight,
        weightKg: nextWeight,
        topSize: draftTopSize.trim() || null,
        bottomSize: draftBottomSize.trim() || null,
        dressSize: draftDressSize.trim() || null,
        shoeSize: draftShoeSize.trim() || null,
        braSize: draftBraSize.trim() || null,
        brandSizeExamples: cleanedExamples,
        bodyTypeSelfTags: draftSelfTags,
        markCompleted: shouldMarkCompleted,
      });
      // Bio + location are stored via their existing single-column setters;
      // they're not part of the measurement schema columns.
      const trimmedBio = draftBio.trim();
      if (trimmedBio !== (bio ?? '')) setBio(trimmedBio);
      const trimmedLoc = draftLocation.trim();
      const nextLoc = trimmedLoc === '' ? null : trimmedLoc;
      if (nextLoc !== location) setLocation(nextLoc);

      if (shouldMarkCompleted) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showSaved('6');
        setTimeout(() => router.back(), 600);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        const count = missingRequired.length;
        Alert.alert(
          `${count} more ${count === 1 ? 'step' : 'steps'} to go`,
          `We saved what you have. To finish your profile, add:\n\n• ${missingRequired.join('\n• ')}`,
        );
      }
    } catch (e) {
      Alert.alert('Save failed', 'Could not save your profile. Try again.');
    } finally {
      setSavingSection(null);
    }
  };

  // ----- Render helpers -----
  const initials = (firstName?.[0] ?? username?.[0] ?? '?').toUpperCase();

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="profile-setup-screen">
      <View style={styles.headerBar}>
        <Pressable
          onPress={() => router.back()}
          className="flex-row items-center justify-center gap-1.5 py-2 px-3 active:opacity-70"
          hitSlop={8}
          testID="profile-setup-back"
        >
          <ChevronLeft size={20} color="#1A1210" />
          <Text className="text-[#1A1210] text-sm font-medium" style={{ fontFamily: 'DMSans_500Medium' }}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Complete profile</Text>
        <Pressable
          onPress={() => router.back()}
          className="flex-row items-center justify-center gap-1.5 py-2 px-3 active:opacity-70"
          hitSlop={8}
          testID="profile-setup-skip"
        >
          <Text className="text-[#6B5E58] text-sm font-medium" style={{ fontFamily: 'DMSans_500Medium' }}>Skip</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ====== SECTION 1: About you ====== */}
          <View
            onLayout={onSectionLayout('1')}
            style={styles.section}
            testID="profile-setup-section-1"
          >
            <Text style={styles.sectionTitle}>About you</Text>
            <Text style={styles.sectionLead}>The basics shoppers see on your profile.</Text>

            <View style={styles.avatarRow}>
              <Pressable
                onPress={pickAvatarPhoto}
                style={({ pressed }) => [styles.avatarTap, pressed && { opacity: 0.85 }]}
                testID="profile-setup-photo"
              >
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarInitials}>{initials}</Text>
                  </View>
                )}
                <View style={styles.avatarBadge}>
                  <CameraIcon size={14} color="#FFFFFF" strokeWidth={2} />
                </View>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Profile photo</Text>
                <Text style={styles.helperSm}>Tap to upload. JPG or PNG.</Text>
              </View>
            </View>

            <View style={styles.row2}>
              <View style={[styles.fieldCard, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>First name</Text>
                <TextInput
                  value={draftFirst}
                  onChangeText={setDraftFirst}
                  placeholder="Maya"
                  placeholderTextColor="#A0938D"
                  style={styles.input}
                  cursorColor="#2C2C2C"
                  selectionColor="rgba(44,44,44,0.3)"
                  testID="profile-setup-first-name"
                />
              </View>
              <View style={[styles.fieldCard, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>Last name</Text>
                <TextInput
                  value={draftLast}
                  onChangeText={setDraftLast}
                  placeholder="Patel"
                  placeholderTextColor="#A0938D"
                  style={styles.input}
                  cursorColor="#2C2C2C"
                  selectionColor="rgba(44,44,44,0.3)"
                  testID="profile-setup-last-name"
                />
              </View>
            </View>

            <View style={styles.fieldCard}>
              <View style={styles.bioHeaderRow}>
                <Text style={styles.fieldLabel}>Bio</Text>
                <Text style={styles.bioCounter}>{draftBio.length}/200</Text>
              </View>
              <TextInput
                value={draftBio}
                onChangeText={(v) => setDraftBio(v.slice(0, 200))}
                placeholder="A few words about your style"
                placeholderTextColor="#A0938D"
                style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]}
                cursorColor="#2C2C2C"
                selectionColor="rgba(44,44,44,0.3)"
                multiline
                testID="profile-setup-bio"
              />
            </View>

            <View style={[styles.fieldCard, { zIndex: 10 }]}>
              <Text style={styles.fieldLabel}>Location</Text>
              <LocationAutocomplete
                value={draftLocation}
                onChange={setDraftLocation}
                placeholder="City, country"
                testID="profile-setup-location"
              />
              <Text style={styles.helper}>
                Helps shoppers discover looks from creators in their area.
              </Text>
            </View>

            <SectionFooter
              key1="1"
              saving={savingSection === '1'}
              saved={savedSection === '1'}
              onPress={saveSection1}
            />
          </View>

          {/* ====== SECTION 2: Where to find you ====== */}
          <View
            onLayout={onSectionLayout('2')}
            style={styles.section}
            testID="profile-setup-section-2"
          >
            <Text style={styles.sectionTitle}>Where to find you</Text>
            <Text style={styles.sectionLead}>Add your handles. Toggle which ones show up on your profile.</Text>

            {handles.map((h) => (
              <View key={h.id} style={styles.fieldCard}>
                <View style={styles.handleHeaderRow}>
                  <Text style={styles.fieldLabel}>{h.platform}</Text>
                  <View style={styles.handleToggleRow}>
                    <Text style={styles.helperSm}>Show on profile</Text>
                    <Switch
                      value={h.connected}
                      onValueChange={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        toggleConnected(h.id);
                      }}
                      trackColor={{ false: '#E8E0D8', true: '#1A1210' }}
                      thumbColor="#FFFFFF"
                      testID={`profile-setup-toggle-${h.id}`}
                    />
                  </View>
                </View>
                <View style={styles.handleInputRow}>
                  <Text style={styles.atSign}>@</Text>
                  <TextInput
                    value={h.handle}
                    onChangeText={(v) => updateHandle(h.id, v)}
                    placeholder="yourhandle"
                    placeholderTextColor="#A0938D"
                    style={[styles.input, { flex: 1 }]}
                    cursorColor="#2C2C2C"
                    selectionColor="rgba(44,44,44,0.3)"
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID={`profile-setup-handle-${h.id}`}
                  />
                </View>
              </View>
            ))}

            <SectionFooter
              key1="2"
              saving={savingSection === '2'}
              saved={savedSection === '2'}
              onPress={saveSection2}
            />
          </View>

          {/* ====== SECTION 3: Measurements ====== */}
          <View
            onLayout={onSectionLayout('3')}
            style={styles.section}
            testID="profile-setup-section-3"
          >
            <Text style={styles.sectionTitle}>Measurements</Text>
            <Text style={styles.sectionLead}>Optional but encouraged.</Text>
            <Text style={styles.privacyNote}>
              Help shoppers find your size and build. We never show your raw measurements — only descriptive tags like Petite or Plus that help match you to similar shoppers.
            </Text>

            {/* Unit toggle */}
            <View style={styles.unitRow}>
              <Pressable
                onPress={() => { setUnit('us'); Haptics.selectionAsync(); }}
                className={
                  unit === 'us'
                    ? 'bg-[#B87063] rounded-full py-2.5 px-5 flex-row items-center justify-center active:opacity-85'
                    : 'bg-white rounded-full py-2.5 px-5 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85'
                }
                testID="profile-setup-unit-us"
              >
                <Text
                  className={unit === 'us' ? 'text-white text-[14px] font-semibold' : 'text-[#1A1210] text-[14px] font-semibold'}
                  style={{ fontFamily: 'DMSans_500Medium' }}
                >
                  US (ft / lb)
                </Text>
              </Pressable>
              <Pressable
                onPress={() => { setUnit('metric'); Haptics.selectionAsync(); }}
                className={
                  unit === 'metric'
                    ? 'bg-[#B87063] rounded-full py-2.5 px-5 flex-row items-center justify-center active:opacity-85'
                    : 'bg-white rounded-full py-2.5 px-5 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85'
                }
                testID="profile-setup-unit-metric"
              >
                <Text
                  className={unit === 'metric' ? 'text-white text-[14px] font-semibold' : 'text-[#1A1210] text-[14px] font-semibold'}
                  style={{ fontFamily: 'DMSans_500Medium' }}
                >
                  Metric (cm / kg)
                </Text>
              </Pressable>
            </View>

            {/* Height */}
            <View style={styles.fieldCard}>
              <Text style={styles.fieldLabel}>Height</Text>
              {unit === 'us' ? (
                <View style={styles.row2}>
                  <View style={styles.unitInputWrap}>
                    <TextInput
                      value={feetStr}
                      onChangeText={(v) => setFeetStr(v.replace(/[^0-9]/g, ''))}
                      placeholder="5"
                      placeholderTextColor="#A0938D"
                      keyboardType="number-pad"
                      style={styles.input}
                      cursorColor="#2C2C2C"
                      selectionColor="rgba(44,44,44,0.3)"
                      testID="profile-setup-height-feet"
                    />
                    <Text style={styles.unitSuffix}>ft</Text>
                  </View>
                  <View style={styles.unitInputWrap}>
                    <TextInput
                      value={inchesStr}
                      onChangeText={(v) => setInchesStr(v.replace(/[^0-9]/g, ''))}
                      placeholder="6"
                      placeholderTextColor="#A0938D"
                      keyboardType="number-pad"
                      style={styles.input}
                      cursorColor="#2C2C2C"
                      selectionColor="rgba(44,44,44,0.3)"
                      testID="profile-setup-height-inches"
                    />
                    <Text style={styles.unitSuffix}>in</Text>
                  </View>
                </View>
              ) : (
                <View style={styles.unitInputWrap}>
                  <TextInput
                    value={cmStr}
                    onChangeText={(v) => setCmStr(v.replace(/[^0-9]/g, ''))}
                    placeholder="168"
                    placeholderTextColor="#A0938D"
                    keyboardType="number-pad"
                    style={styles.input}
                    cursorColor="#2C2C2C"
                    selectionColor="rgba(44,44,44,0.3)"
                    testID="profile-setup-height-cm"
                  />
                  <Text style={styles.unitSuffix}>cm</Text>
                </View>
              )}
            </View>

            {/* Weight */}
            <View style={styles.fieldCard}>
              <Text style={styles.fieldLabel}>Weight (optional)</Text>
              {unit === 'us' ? (
                <View style={styles.unitInputWrap}>
                  <TextInput
                    value={lbStr}
                    onChangeText={(v) => setLbStr(v.replace(/[^0-9.]/g, ''))}
                    placeholder="135"
                    placeholderTextColor="#A0938D"
                    keyboardType="numeric"
                    style={styles.input}
                    cursorColor="#2C2C2C"
                    selectionColor="rgba(44,44,44,0.3)"
                    testID="profile-setup-weight-lb"
                  />
                  <Text style={styles.unitSuffix}>lb</Text>
                </View>
              ) : (
                <View style={styles.unitInputWrap}>
                  <TextInput
                    value={kgStr}
                    onChangeText={(v) => setKgStr(v.replace(/[^0-9.]/g, ''))}
                    placeholder="61"
                    placeholderTextColor="#A0938D"
                    keyboardType="numeric"
                    style={styles.input}
                    cursorColor="#2C2C2C"
                    selectionColor="rgba(44,44,44,0.3)"
                    testID="profile-setup-weight-kg"
                  />
                  <Text style={styles.unitSuffix}>kg</Text>
                </View>
              )}
            </View>

            {/* Sizes grid */}
            <View style={styles.row2}>
              <View style={[styles.fieldCard, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>Top size</Text>
                <TextInput
                  value={draftTopSize}
                  onChangeText={setDraftTopSize}
                  placeholder="M"
                  placeholderTextColor="#A0938D"
                  autoCapitalize="characters"
                  style={styles.input}
                  cursorColor="#2C2C2C"
                  selectionColor="rgba(44,44,44,0.3)"
                  testID="profile-setup-top-size"
                />
              </View>
              <View style={[styles.fieldCard, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>Bottom size</Text>
                <TextInput
                  value={draftBottomSize}
                  onChangeText={setDraftBottomSize}
                  placeholder="27"
                  placeholderTextColor="#A0938D"
                  style={styles.input}
                  cursorColor="#2C2C2C"
                  selectionColor="rgba(44,44,44,0.3)"
                  testID="profile-setup-bottom-size"
                />
              </View>
            </View>
            <View style={styles.row2}>
              <View style={[styles.fieldCard, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>Dress size</Text>
                <TextInput
                  value={draftDressSize}
                  onChangeText={setDraftDressSize}
                  placeholder="8"
                  placeholderTextColor="#A0938D"
                  style={styles.input}
                  cursorColor="#2C2C2C"
                  selectionColor="rgba(44,44,44,0.3)"
                  testID="profile-setup-dress-size"
                />
              </View>
              <View style={[styles.fieldCard, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>Shoe size</Text>
                <TextInput
                  value={draftShoeSize}
                  onChangeText={setDraftShoeSize}
                  placeholder="8.5"
                  placeholderTextColor="#A0938D"
                  style={styles.input}
                  cursorColor="#2C2C2C"
                  selectionColor="rgba(44,44,44,0.3)"
                  testID="profile-setup-shoe-size"
                />
              </View>
            </View>
            <View style={styles.row2}>
              <View style={[styles.fieldCard, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>Bra size (optional)</Text>
                <TextInput
                  value={draftBraSize}
                  onChangeText={setDraftBraSize}
                  placeholder="34B"
                  placeholderTextColor="#A0938D"
                  autoCapitalize="characters"
                  style={styles.input}
                  cursorColor="#2C2C2C"
                  selectionColor="rgba(44,44,44,0.3)"
                  testID="profile-setup-bra-size"
                />
              </View>
              <View style={{ flex: 1 }} />
            </View>
            <SectionFooter
              key1="3"
              saving={savingSection === '3'}
              saved={savedSection === '3'}
              onPress={saveSection3}
            />
          </View>

          {/* ====== SECTION 4: Brand size examples ====== */}
          <View
            onLayout={onSectionLayout('4')}
            style={styles.section}
            testID="profile-setup-section-4"
          >
            <Text style={styles.sectionTitle}>Brand size examples</Text>
            <Text style={styles.sectionLead}>Optional.</Text>
            <Text style={styles.privacyNote}>
              Helps shoppers calibrate. Example: "I wear 27 in Levi's, M in Lululemon."
            </Text>

            {draftExamples.map((row, idx) => (
              <View key={idx} style={styles.exampleCard} testID={`profile-setup-example-${idx}`}>
                <View style={styles.exampleTopRow}>
                  <View style={[styles.exampleField, { flex: 2 }]}>
                    <Text style={styles.fieldLabel}>Brand</Text>
                    <TextInput
                      value={row.brand}
                      onChangeText={(v) => {
                        const next = [...draftExamples];
                        next[idx] = { ...next[idx], brand: v };
                        setDraftExamples(next);
                      }}
                      placeholder="Levi's"
                      placeholderTextColor="#A0938D"
                      style={styles.input}
                      cursorColor="#2C2C2C"
                      selectionColor="rgba(44,44,44,0.3)"
                      testID={`profile-setup-brand-${idx}`}
                    />
                  </View>
                  <View style={[styles.exampleField, { flex: 1 }]}>
                    <Text style={styles.fieldLabel}>Size</Text>
                    <TextInput
                      value={row.size}
                      onChangeText={(v) => {
                        const next = [...draftExamples];
                        next[idx] = { ...next[idx], size: v };
                        setDraftExamples(next);
                      }}
                      placeholder="27"
                      placeholderTextColor="#A0938D"
                      style={styles.input}
                      cursorColor="#2C2C2C"
                      selectionColor="rgba(44,44,44,0.3)"
                      testID={`profile-setup-size-${idx}`}
                    />
                  </View>
                  <Pressable
                    onPress={() => setDraftExamples(draftExamples.filter((_, i) => i !== idx))}
                    className="flex-row items-center justify-center gap-1.5 py-2 px-3 active:opacity-70"
                    testID={`profile-setup-remove-${idx}`}
                  >
                    <X size={16} color="#B87063" />
                  </Pressable>
                </View>

                <Text style={[styles.fieldLabel, { marginTop: 8, marginBottom: 6 }]}>Category</Text>
                <View style={styles.chipWrap}>
                  {BRAND_EXAMPLE_CATEGORIES.map((cat) => {
                    const selected = row.category === cat;
                    return (
                      <Pressable
                        key={cat}
                        onPress={() => {
                          Haptics.selectionAsync();
                          const next = [...draftExamples];
                          next[idx] = { ...next[idx], category: cat };
                          setDraftExamples(next);
                        }}
                        className={
                          selected
                            ? 'bg-[#B87063] rounded-full py-1.5 px-3 flex-row items-center justify-center active:opacity-85'
                            : 'bg-white rounded-full py-1.5 px-3 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85'
                        }
                        testID={`profile-setup-cat-${idx}-${cat}`}
                      >
                        <Text
                          className={selected ? 'text-white text-[12px] font-semibold' : 'text-[#1A1210] text-[12px] font-semibold'}
                          style={{ fontFamily: 'DMSans_500Medium' }}
                        >
                          {cat}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}

            <Pressable
              onPress={() => setDraftExamples([...draftExamples, { brand: '', category: '', size: '' }])}
              className="bg-white rounded-full py-3 px-5 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
              testID="profile-setup-add-example"
            >
              <Plus size={16} color="#1A1210" strokeWidth={2} />
              <Text className="ml-2 text-[#1A1210] text-[15px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
                Add brand example
              </Text>
            </Pressable>

            <SectionFooter
              key1="4"
              saving={savingSection === '4'}
              saved={savedSection === '4'}
              onPress={saveSection4}
            />
          </View>

          {/* ====== SECTION 5: Body type tags ====== */}
          <View
            onLayout={onSectionLayout('5')}
            style={styles.section}
            testID="profile-setup-section-5"
          >
            <Text style={styles.sectionTitle}>Body type tags</Text>
            <Text style={styles.sectionLead}>Optional.</Text>
            <Text style={styles.privacyNote}>
              Add tags to describe your style and build. We automatically infer some from your measurements; these are additional self-described ones.
            </Text>

            {autoTags.length > 0 ? (
              <View style={{ marginBottom: 16 }}>
                <Text style={styles.subSectionLabel}>Auto-derived</Text>
                <View style={styles.chipWrap}>
                  {autoTags.map((t) => (
                    <View key={`auto-${t}`} style={styles.autoChip} testID={`profile-setup-auto-${t}`}>
                      <Text style={styles.autoChipText}>
                        {t} <Text style={styles.autoChipMuted}>(auto)</Text>
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            <Text style={styles.subSectionLabel}>Self-described</Text>
            <View style={styles.chipWrap}>
              {SELF_TAG_OPTIONS.map((tag) => {
                const selected = draftSelfTags.includes(tag);
                return (
                  <Pressable
                    key={tag}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setDraftSelfTags(
                        selected
                          ? draftSelfTags.filter((t) => t !== tag)
                          : [...draftSelfTags, tag],
                      );
                    }}
                    className={
                      selected
                        ? 'bg-[#B87063] rounded-full py-2 px-4 flex-row items-center justify-center active:opacity-85'
                        : 'bg-white rounded-full py-2 px-4 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85'
                    }
                    testID={`profile-setup-self-tag-${tag}`}
                  >
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

            {(() => {
              const presetSet = new Set<string>(SELF_TAG_OPTIONS as readonly string[]);
              const customTags = draftSelfTags.filter((t) => !presetSet.has(t));
              const trimmed = customTagInput.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 24);
              const canAdd =
                trimmed.length >= 2 &&
                !draftSelfTags.includes(trimmed) &&
                customTags.length < 8;
              const addCustom = () => {
                if (!canAdd) return;
                Haptics.selectionAsync();
                setDraftSelfTags([...draftSelfTags, trimmed]);
                setCustomTagInput('');
              };
              return (
                <>
                  {customTags.length > 0 ? (
                    <>
                      <Text style={[styles.subSectionLabel, { marginTop: 8 }]}>Your tags</Text>
                      <View style={styles.chipWrap}>
                        {customTags.map((tag) => (
                          <Pressable
                            key={`custom-${tag}`}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setDraftSelfTags(draftSelfTags.filter((t) => t !== tag));
                            }}
                            className="bg-[#B87063] rounded-full py-2 pl-4 pr-2.5 flex-row items-center justify-center active:opacity-85"
                            testID={`profile-setup-custom-tag-${tag}`}
                          >
                            <Text
                              className="text-white text-[13px] font-semibold"
                              style={{ fontFamily: 'DMSans_500Medium' }}
                            >
                              {tag}
                            </Text>
                            <X size={14} color="#FFFFFF" strokeWidth={2.5} style={{ marginLeft: 6 }} />
                          </Pressable>
                        ))}
                      </View>
                    </>
                  ) : null}

                  <Text style={[styles.subSectionLabel, { marginTop: 8 }]}>Add your own</Text>
                  <View style={styles.customTagRow}>
                    <TextInput
                      value={customTagInput}
                      onChangeText={(v) => setCustomTagInput(v.slice(0, 24))}
                      placeholder='e.g. "tall girl friendly"'
                      placeholderTextColor="#8C8580"
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="done"
                      onSubmitEditing={addCustom}
                      maxLength={24}
                      style={styles.customTagInput}
                      testID="profile-setup-custom-tag-input"
                    />
                    <Pressable
                      onPress={addCustom}
                      disabled={!canAdd}
                      className={
                        canAdd
                          ? 'bg-[#B87063] rounded-full py-2.5 px-4 flex-row items-center justify-center active:opacity-85'
                          : 'bg-[#E8DFD7] rounded-full py-2.5 px-4 flex-row items-center justify-center'
                      }
                      testID="profile-setup-custom-tag-add"
                    >
                      <Plus size={16} color={canAdd ? '#FFFFFF' : '#8C8580'} strokeWidth={2.5} />
                      <Text
                        className={canAdd ? 'ml-1 text-white text-[13px] font-semibold' : 'ml-1 text-[#8C8580] text-[13px] font-semibold'}
                        style={{ fontFamily: 'DMSans_500Medium' }}
                      >
                        Add
                      </Text>
                    </Pressable>
                  </View>
                  <Text style={styles.customTagHint}>
                    Up to 8 custom tags, 24 characters each. Tap a tag to remove it.
                  </Text>
                </>
              );
            })()}

            <SectionFooter
              key1="5"
              saving={savingSection === '5'}
              saved={savedSection === '5'}
              onPress={saveSection5}
            />
          </View>

          {/* ====== SECTION 6: Save ====== */}
          <View
            onLayout={onSectionLayout('6')}
            style={[styles.section, { marginBottom: 60 }]}
            testID="profile-setup-section-6"
          >
            <Text style={styles.sectionTitle}>Save your profile</Text>
            <Text style={styles.sectionLead}>You can update any of this later.</Text>

            {missingRequired.length > 0 ? (
              <View style={styles.missingBanner} testID="profile-setup-missing-banner">
                <Text style={styles.missingTitle}>
                  {missingRequired.length} more {missingRequired.length === 1 ? 'step' : 'steps'} to go
                </Text>
                {missingRequired.map((item) => (
                  <Text key={item} style={styles.missingItem} testID={`profile-setup-missing-${item}`}>
                    {`\u2022 ${item}`}
                  </Text>
                ))}
              </View>
            ) : null}

            <Pressable
              onPress={saveAll}
              disabled={savingSection !== null}
              className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
              style={{
                shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
                opacity: savingSection !== null ? 0.7 : 1,
              }}
              testID="profile-setup-save"
            >
              {savedSection === '6' ? (
                <Check size={18} color="#FFFFFF" strokeWidth={2.5} />
              ) : null}
              <Text className="ml-2 text-white text-[15px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
                {savedSection === '6' ? 'Saved' : savingSection === '6' ? 'Saving…' : 'Save profile'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <PhotoEditor
        visible={showPhotoEditor}
        uri={pickedPhotoUri}
        aspectRatio={[1, 1]}
        onSave={handlePhotoEditorSave}
        onCancel={handlePhotoEditorCancel}
      />
    </SafeAreaView>
  );
}

function SectionFooter({
  key1,
  saving,
  saved,
  onPress,
}: {
  key1: SectionKey;
  saving: boolean;
  saved: boolean;
  onPress: () => void;
}) {
  return (
    <View style={{ marginTop: 12 }}>
      <Pressable
        onPress={onPress}
        disabled={saving}
        className="bg-[#B87063] rounded-full py-3 px-5 flex-row items-center justify-center active:opacity-85"
        style={{
          shadowColor: '#1A1210', shadowOpacity: 0.10, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
          opacity: saving ? 0.7 : 1,
        }}
        testID={`profile-setup-save-section-${key1}`}
      >
        {saved ? <Check size={16} color="#FFFFFF" strokeWidth={2.5} /> : null}
        <Text className="ml-2 text-white text-[14px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
          {saved ? 'Saved' : saving ? 'Saving…' : 'Save & continue'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F4F0' },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E0D8',
    backgroundColor: '#F7F4F0',
  },
  headerTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    letterSpacing: 1,
  },
  scroll: { paddingVertical: 16, paddingBottom: 80 },
  section: {
    marginHorizontal: 16,
    marginBottom: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EDE6DF',
  },
  sectionTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  sectionLead: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    marginBottom: 12,
  },
  privacyNote: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    backgroundColor: '#F7F1EC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    lineHeight: 18,
  },
  fieldCard: {
    backgroundColor: '#FAF7F4',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EDE6DF',
  },
  fieldLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#6B5E58',
    marginBottom: 4,
  },
  input: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    color: '#1A1210',
    paddingVertical: 4,
  },
  helper: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#A0938D',
    marginTop: 6,
  },
  helperSm: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#8C8580',
  },
  row2: { flexDirection: 'row', gap: 10 },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  avatarTap: {
    position: 'relative',
  },
  avatar: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#C4A882',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22, color: '#FFFFFF', letterSpacing: 1,
  },
  avatarBadge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#1A1210',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#FFFFFF',
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
  unitRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  unitInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  unitSuffix: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#6B5E58',
  },
  handleHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  handleToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  handleInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  atSign: { fontFamily: 'DMSans_400Regular', fontSize: 16, color: '#8C8580' },
  exampleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    marginBottom: 8,
  },
  exampleCard: {
    backgroundColor: '#FAF7F4',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#EDE6DF',
    marginBottom: 10,
  },
  exampleTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  exampleField: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#EDE6DF',
  },
  subSectionLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#6B5E58',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  autoChip: {
    backgroundColor: '#F0EBE5',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  autoChipText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
  },
  autoChipMuted: {
    color: '#8C8580',
    fontSize: 12,
  },
  customTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  customTagInput: {
    flex: 1,
    backgroundColor: '#FAF7F4',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    borderWidth: 1,
    borderColor: '#EDE6DF',
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
  },
  customTagHint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#8C8580',
    marginTop: 4,
  },
  missingBanner: {
    backgroundColor: '#FBEFE9',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E9D5CB',
  },
  missingTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#8C3A2A',
    marginBottom: 6,
  },
  missingItem: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    lineHeight: 20,
  },
});
