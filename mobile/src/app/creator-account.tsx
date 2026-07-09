import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  StyleSheet,
  Switch,
  Modal,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { Shield, FileText, Info, ChevronRight, ChevronLeft, Sparkles, Pencil, Wallet, Plus } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import useAuthStore from '@/lib/state/authStore';
import useCreatorStore from '@/lib/state/creatorStore';
import useLookStore from '@/lib/state/lookStore';
import useProfileStore from '@/lib/state/profileStore';
import { useAppFollowerCount } from '@/lib/queries/creatorStats';
import useAppMetadataStore from '@/lib/state/appMetadataStore';
import PhotoEditor from '@/components/PhotoEditor';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import UsernameField from '@/components/UsernameField';
import FoundingCreatorBadge from '@/components/FoundingCreatorBadge';
import FoundingCreatorPill from '@/components/FoundingCreatorPill';
import PillButton from '@/components/PillButton';
import PinterestConnectCard from '@/components/PinterestConnectCard';
import { computeCompletionPct } from '@/lib/utils/profileCompletion';
import { persistPickedPhoto } from '@/lib/utils/persistPickedPhoto';

const MEASUREMENT_PROMPT_KEY = 'sim_measurement_prompt_seen';

function getTierPercent(count: number): number {
  if (count >= 15000) return 85;
  if (count >= 10001) return 90;
  if (count >= 5001) return 95;
  if (count >= 4001) return 95;
  if (count >= 3001) return 96;
  if (count >= 2001) return 97;
  if (count >= 1001) return 98;
  return 99;
}

function getTierName(count: number): string {
  if (count >= 15000) return 'Mega';
  if (count >= 10001) return 'Macro';
  if (count >= 5001) return 'Mid-Tier';
  if (count >= 1001) return 'Micro';
  return 'Nano';
}

export default function ProfileScreen() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const insets = useSafeAreaInsets();

  const logout = useAuthStore((s) => s.logout);

  const handles = useCreatorStore((s) => s.handles);
  const updateHandle = useCreatorStore((s) => s.updateHandle);
  const toggleConnected = useCreatorStore((s) => s.toggleConnected);
  const primaryPlatform = useCreatorStore((s) => s.primaryPlatform);
  const setPrimaryPlatform = useCreatorStore((s) => s.setPrimaryPlatform);

  const allLooks = useLookStore((s) => s.looks);
  const creatorId = useAuthStore((s) => s.creatorId);
  const looks = allLooks.filter(l => l.creatorId === creatorId);
  const totalItems = looks.reduce((sum, l) => sum + l.items.length, 0);
  const totalClicks = looks.reduce((sum, l) => sum + l.clicks, 0);

  const followerCount = useAppFollowerCount(creatorId ?? null).data ?? 0;

  const currentVersion = useAppMetadataStore((s) => s.currentVersion);
  const fallbackVersion = Constants.expoConfig?.version ?? '—';
  const appVersion = currentVersion ?? fallbackVersion;

  const username = useProfileStore((s) => s.username);
  const bio = useProfileStore((s) => s.bio);
  const location = useProfileStore((s) => s.location);
  const photoUri = useProfileStore((s) => s.photoUri);
  const captionStyle = useProfileStore((s) => s.captionStyle);
  const includeHashtags = useProfileStore((s) => s.includeHashtags);
  const includePrices = useProfileStore((s) => s.includePrices);
  const setUsername = useProfileStore((s) => s.setUsername);
  const setBio = useProfileStore((s) => s.setBio);
  const setLocation = useProfileStore((s) => s.setLocation);
  const setPhotoUri = useProfileStore((s) => s.setPhotoUri);
  const setCaptionStyle = useProfileStore((s) => s.setCaptionStyle);
  const setIncludeHashtags = useProfileStore((s) => s.setIncludeHashtags);
  const setIncludePrices = useProfileStore((s) => s.setIncludePrices);
  const socialFollowerCount = useProfileStore((s) => s.socialFollowerCount);
  const setSocialFollowerCount = useProfileStore((s) => s.setSocialFollowerCount);
  const isFoundingCreator = useProfileStore((s) => s.isFoundingCreator);

  // Profile completion fields
  const firstName = useProfileStore((s) => s.firstName);
  const lastName = useProfileStore((s) => s.lastName);
  const heightCm = useProfileStore((s) => s.heightCm);
  const topSize = useProfileStore((s) => s.topSize);
  const dressSize = useProfileStore((s) => s.dressSize);
  const shoeSize = useProfileStore((s) => s.shoeSize);
  const bodyTypeSelfTagsCount = useProfileStore((s) => s.bodyTypeSelfTags.length);
  const brandSizeExamplesCount = useProfileStore((s) => s.brandSizeExamples.length);
  const profileCompletedAt = useProfileStore((s) => s.profileCompletedAt);
  const igHandle = handles.find((h) => h.id === 'instagram')?.handle ?? '';
  const ttHandle = handles.find((h) => h.id === 'tiktok')?.handle ?? '';
  const ytHandle = handles.find((h) => h.id === 'youtube')?.handle ?? '';
  const piHandle = handles.find((h) => h.id === 'pinterest')?.handle ?? '';

  const completionPct = useMemo(
    () =>
      computeCompletionPct({
        photoUri,
        bio,
        location,
        firstName,
        lastName,
        socialHandles: [igHandle, ttHandle, ytHandle, piHandle],
        heightCm,
        topSize,
        dressSize,
        shoeSize,
        bodyTypeSelfTagsCount,
        brandSizeExamplesCount,
      }),
    [
      photoUri, bio, location, firstName, lastName,
      igHandle, ttHandle, ytHandle, piHandle,
      heightCm, topSize, dressSize, shoeSize,
      bodyTypeSelfTagsCount, brandSizeExamplesCount,
    ],
  );

  // Backfill prompt: show once for existing creators (have a published look but
  // never completed their profile). AsyncStorage flag prevents re-show.
  const [showBackfillSheet, setShowBackfillSheet] = useState<boolean>(false);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!creatorId) return;
      if (profileCompletedAt) return;
      const hasPublishedLook = looks.some((l) => l.publishedAt);
      if (!hasPublishedLook) return;
      try {
        const seen = await AsyncStorage.getItem(MEASUREMENT_PROMPT_KEY);
        if (seen) return;
        if (!cancelled) setShowBackfillSheet(true);
      } catch {
        // ignore
      }
    };
    check();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorId, profileCompletedAt, looks.length]);

  const dismissBackfill = useCallback(async (openSetup: boolean) => {
    setShowBackfillSheet(false);
    try { await AsyncStorage.setItem(MEASUREMENT_PROMPT_KEY, '1'); } catch { /* ignore */ }
    if (openSetup) {
      router.push({ pathname: '/profile-setup', params: { section: '3' } } as any);
    }
  }, []);

  const [draftFollowerCount, setDraftFollowerCount] = useState<string>('');
  const [editingFollowerCount, setEditingFollowerCount] = useState<boolean>(false);
  const [editingUsername, setEditingUsername] = useState<boolean>(false);
  const [draftUsername, setDraftUsername] = useState<string>('');
  const [usernameValid, setUsernameValid] = useState<boolean>(false);
  const [normalizedUsername, setNormalizedUsername] = useState<string>('');
  const [usernameSaveError, setUsernameSaveError] = useState<string | null>(null);
  const [editingBio, setEditingBio] = useState<boolean>(false);
  const [draftBio, setDraftBio] = useState<string>('');
  const [draftLocation, setDraftLocation] = useState<string>('');
  const [editingHandle, setEditingHandle] = useState<string | null>(null);
  const [handleDraft, setHandleDraft] = useState<string>('');
  const [showAvatarModal, setShowAvatarModal] = useState<boolean>(false);
  const [showPhotoEditor, setShowPhotoEditor] = useState<boolean>(false);
  const [pickedPhotoUri, setPickedPhotoUri] = useState<string>('');
  const [showSignOutConfirm, setShowSignOutConfirm] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'fetching' | 'success' | 'error'>('idle');
  const [fetchedPlatformName, setFetchedPlatformName] = useState<string>('');
  const fetchFollowerCount = useCallback(async (platformOverride?: 'instagram' | 'tiktok') => {
    setFetchStatus('fetching');
    const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
    // Use explicit platform if provided, otherwise read current state
    const platform = platformOverride ?? primaryPlatform;
    const secondaryPlatform = platform === 'instagram' ? 'tiktok' : 'instagram';

    // Try primary platform first
    const primaryHandle = handles.find((h) => h.id === platform && h.connected && h.handle);
    if (primaryHandle) {
      try {
        const res = await fetch(`${baseUrl}/api/social-followers?handle=${encodeURIComponent(primaryHandle.handle)}&platform=${platform}`);
        const json = await res.json();
        if (json.data?.count != null) {
          setSocialFollowerCount(json.data.count);
          setFetchedPlatformName(platform === 'instagram' ? 'Instagram' : 'TikTok');
          setFetchStatus('success');
          return;
        }
      } catch (e) {
        console.warn(`[fetchFollowerCount] ${platform} failed:`, e);
      }
    }

    // Try secondary platform
    const secondaryHandle = handles.find((h) => h.id === secondaryPlatform && h.connected && h.handle);
    if (secondaryHandle) {
      try {
        const res = await fetch(`${baseUrl}/api/social-followers?handle=${encodeURIComponent(secondaryHandle.handle)}&platform=${secondaryPlatform}`);
        const json = await res.json();
        if (json.data?.count != null) {
          setSocialFollowerCount(json.data.count);
          setFetchedPlatformName(secondaryPlatform === 'instagram' ? 'Instagram' : 'TikTok');
          setFetchStatus('success');
          return;
        }
      } catch (e) {
        console.warn(`[fetchFollowerCount] ${secondaryPlatform} failed:`, e);
      }
    }

    setFetchStatus('error');
  }, [primaryPlatform, handles, setSocialFollowerCount]);

  useEffect(() => {
    fetchFollowerCount();
  }, [fetchFollowerCount]);

  useEffect(() => {
    setDraftLocation(location ?? '');
  }, [location]);

  const handleSaveLocation = useCallback(() => {
    const trimmed = draftLocation.trim();
    const next = trimmed === '' ? null : trimmed;
    if (next !== location) {
      setLocation(next);
    }
  }, [draftLocation, location, setLocation]);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  const displayName = username.trim() || 'yourname';
  const initials = displayName.slice(0, 2).toUpperCase();

  const handleAvatarPress = () => {
    setShowAvatarModal(true);
  };

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
    } catch (error) {
      console.error('[PROFILE] ImagePicker error:', error);
    }
  };

  const handlePhotoEditorSave = async (editedUri: string) => {
    setShowPhotoEditor(false);
    setPickedPhotoUri('');
    try {
      await setPhotoUri(editedUri);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error saving photo';
      Alert.alert('Could not save photo', message);
    }
  };

  const handlePhotoEditorCancel = () => {
    setShowPhotoEditor(false);
    setPickedPhotoUri('');
  };

  const handleSaveHandle = (id: string) => {
    updateHandle(id, handleDraft);
    setEditingHandle(null);
    setHandleDraft('');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="profile-screen">
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          testID="profile-back"
        >
          <ChevronLeft size={26} color="#1A1210" />
        </Pressable>
        <Text style={styles.topBarTitle} numberOfLines={1}>Profile</Text>
        <View style={{ width: 26 }} />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.pageTitle}>Profile</Text>
          </View>

          {/* Profile completion banner — hidden once >= 75% */}
          {completionPct < 75 ? (
            <View style={styles.completionBanner} testID="profile-completion-banner">
              <View style={styles.completionRow}>
                <Sparkles size={18} color="#B87063" strokeWidth={2} />
                <Text style={styles.completionTitle}>Complete your profile</Text>
              </View>
              <Text style={styles.completionBody}>
                Your profile is {completionPct}% complete. Help shoppers find creators like them.
              </Text>
              <Pressable
                onPress={() => router.push('/profile-setup' as any)}
                className="bg-[#B87063] rounded-full py-3 px-5 flex-row items-center justify-center active:opacity-85"
                style={{ shadowColor: '#1A1210', shadowOpacity: 0.10, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}
                testID="profile-completion-cta"
              >
                <Text className="text-white text-[15px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
                  Continue setup
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* Avatar + identity */}
          <View style={styles.identitySection}>
            {/* Tappable avatar */}
            <Pressable
              onPress={handleAvatarPress}
              testID="avatar-press"
              style={({ pressed }) => [styles.avatarWrapper, pressed && { opacity: 0.85 }]}
            >
              {photoUri ? (
                <Image
                  source={{ uri: photoUri }}
                  style={styles.avatarCircle}
                  contentFit="cover"
                />
              ) : (
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarInitials}>{initials}</Text>
                </View>
              )}
              {/* Edit badge */}
              <View style={styles.avatarEditBadge}>
                <Text style={styles.avatarEditIcon}>✎</Text>
              </View>
              {isFoundingCreator ? (
                <View style={styles.foundingBadgeOnAvatar} testID="profile-founding-badge">
                  <FoundingCreatorBadge
                    size="sm"
                    photoUri={photoUri || null}
                    firstInitial={initials}
                  />
                </View>
              ) : null}
            </Pressable>

            <Text style={styles.avatarHint}>Tap to change photo or name</Text>

            {/* Username */}
            {editingUsername ? (
              <View style={{ alignItems: 'center', width: '100%', paddingHorizontal: 32 }}>
                <UsernameField
                  initialValue={username}
                  onValidityChange={(isValid, normalized) => {
                    setUsernameValid(isValid);
                    setNormalizedUsername(normalized);
                    setUsernameSaveError(null);
                  }}
                  autoFocus
                />
                {usernameSaveError ? (
                  <Text style={styles.usernameSaveError} testID="username-save-error">{usernameSaveError}</Text>
                ) : null}
                <View style={styles.editActionRow}>
                  <Pressable
                    style={styles.editCancelBtn}
                    onPress={() => {
                      setEditingUsername(false);
                      setUsernameSaveError(null);
                    }}
                    testID="username-cancel"
                  >
                    <Text style={styles.editCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.editSaveBtn, !usernameValid && styles.editSaveBtnDisabled]}
                    onPress={async () => {
                      if (!usernameValid) return;
                      try {
                        await setUsername(normalizedUsername);
                        setEditingUsername(false);
                        setUsernameSaveError(null);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      } catch (e) {
                        if (e instanceof Error && e.message === 'USERNAME_TAKEN') {
                          setUsernameSaveError('That just got taken — try another');
                        }
                      }
                    }}
                    disabled={!usernameValid}
                    testID="username-save"
                  >
                    <Text style={[styles.editSaveText, !usernameValid && styles.editSaveTextDisabled]}>Save</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={{ alignItems: 'center' }}>
                <Pressable
                  onPress={() => {
                    setDraftUsername(username);
                    setEditingUsername(true);
                  }}
                  testID="username-press"
                >
                  <Text style={styles.username}>@ {displayName}</Text>
                </Pressable>
                {isFoundingCreator ? (
                  <View style={{ marginTop: 6, flexDirection: 'row' }}>
                    <FoundingCreatorPill testID="profile-founding-pill" />
                  </View>
                ) : null}
              </View>
            )}

            {/* Bio */}
            {editingBio ? (
              <View style={{ alignItems: 'center', width: '100%', paddingHorizontal: 32 }}>
                <TextInput
                  style={styles.bioInput}
                  value={draftBio}
                  onChangeText={setDraftBio}
                  cursorColor="#2C2C2C"
                  selectionColor="rgba(44, 44, 44, 0.3)"
                  autoFocus
                  multiline
                  numberOfLines={3}
                  testID="bio-input"
                />
                <View style={styles.editActionRow}>
                  <Pressable
                    style={styles.editCancelBtn}
                    onPress={() => {
                      setEditingBio(false);
                      setDraftBio('');
                    }}
                    testID="bio-cancel"
                  >
                    <Text style={styles.editCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={styles.editSaveBtn}
                    onPress={() => {
                      setBio(draftBio.trim());
                      setEditingBio(false);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    testID="bio-save"
                  >
                    <Text style={styles.editSaveText}>Save</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                onPress={() => {
                  setDraftBio(bio);
                  setEditingBio(true);
                }}
                testID="bio-press"
              >
                <Text style={styles.bio}>{bio}</Text>
              </Pressable>
            )}

            {/* Always-on entry point to /profile-setup, regardless of completion % */}
            <Pressable
              onPress={() => router.push('/profile-setup' as any)}
              className="flex-row items-center justify-center gap-1.5 py-2 px-3 active:opacity-70"
              hitSlop={6}
              testID="profile-edit-button"
            >
              <Pencil size={14} color="#6B5E58" strokeWidth={2} />
              <Text
                className="text-[#6B5E58] text-sm font-medium"
                style={{ fontFamily: 'DMSans_500Medium' }}
              >
                Edit profile
              </Text>
            </Pressable>
          </View>

          {/* About You */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About You</Text>
            <View style={[styles.fieldCard, { zIndex: 10 }]}>
              <Text style={styles.fieldLabel}>Location</Text>
              <LocationAutocomplete
                value={draftLocation}
                onChange={(val) => {
                  setDraftLocation(val);
                  const next = val.trim() === '' ? null : val.trim();
                  if (next !== location) setLocation(next);
                }}
                placeholder="City, country"
                testID="profile-location-input"
              />
              <Text style={styles.fieldHelper}>
                Helps shoppers discover looks from creators in their area.
              </Text>
            </View>
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            <StatItem label="Looks" value={String(looks.length)} />
            <View style={styles.statDivider} />
            <StatItem label="Items" value={String(totalItems)} />
            <View style={styles.statDivider} />
            <StatItem label="Clicks" value={String(totalClicks)} />
            <View style={styles.statDivider} />
            <StatItem label="Followers" value={String(followerCount)} />
          </View>

          {/* Connected Platforms */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Connected Platforms</Text>
            <View style={styles.card}>
              {handles.filter((h) => h.id !== 'pinterest').map((h, index, arr) => (
                <View
                  key={h.id}
                  testID={`profile-platform-${h.id}`}
                  style={[
                    styles.platformRow,
                    index < arr.length - 1 && styles.platformRowBorder,
                  ]}
                >
                  <Ionicons name={h.icon as any} size={20} color={h.connected ? '#B87063' : '#A0938D'} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.platformName}>{h.platform}</Text>
                    {editingHandle === h.id ? (
                      <View style={styles.handleEditRow}>
                        <Text style={styles.atSign}>@</Text>
                        <TextInput
                          style={styles.handleInput}
                          value={handleDraft}
                          onChangeText={setHandleDraft}
                          cursorColor="#2C2C2C"
                          selectionColor="rgba(44, 44, 44, 0.3)"
                          autoCapitalize="none"
                          autoCorrect={false}
                          autoFocus
                          testID={`handle-input-${h.id}`}
                        />
                        <Pressable
                          onPress={() => handleSaveHandle(h.id)}
                          style={styles.saveMiniButton}
                          testID={`save-handle-${h.id}`}
                        >
                          <Text style={styles.saveMiniText}>Save</Text>
                        </Pressable>
                      </View>
                    ) : h.handle ? (
                      <Pressable
                        onPress={() => {
                          setEditingHandle(h.id);
                          setHandleDraft(h.handle);
                        }}
                        testID={`add-handle-${h.id}`}
                      >
                        <Text style={styles.handleValue}>@{h.handle}</Text>
                      </Pressable>
                    ) : (
                      <View style={{ alignSelf: 'flex-start', marginTop: 4 }}>
                        <PillButton
                          label="Add handle"
                          variant="secondary"
                          size="sm"
                          icon={<Plus size={16} color="#1A1210" />}
                          onPress={() => {
                            setEditingHandle(h.id);
                            setHandleDraft(h.handle);
                          }}
                          testID={`add-handle-${h.id}`}
                        />
                      </View>
                    )}
                  </View>
                  <Switch
                    testID={`toggle-${h.id}`}
                    value={h.connected}
                    onValueChange={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      toggleConnected(h.id);
                    }}
                    trackColor={{ false: '#E8E0D8', true: '#1A1210' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              ))}
            </View>
          </View>

          {/* Pinterest OAuth — server-managed connection */}
          <View style={styles.section}>
            <PinterestConnectCard creatorId={creatorId} />
          </View>

          {/* Primary Platform */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Primary Platform</Text>
            <View style={styles.pillRow}>
              <Pressable
                testID="pill-instagram"
                style={[
                  styles.pill,
                  primaryPlatform === 'instagram' ? styles.pillSelected : styles.pillUnselected,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setPrimaryPlatform('instagram');
                  // Fetch with explicit platform to avoid stale-state race
                  fetchFollowerCount('instagram');
                }}
              >
                <Text style={primaryPlatform === 'instagram' ? styles.pillTextSelected : styles.pillTextUnselected}>
                  Instagram
                </Text>
              </Pressable>
              <Pressable
                testID="pill-tiktok"
                style={[
                  styles.pill,
                  primaryPlatform === 'tiktok' ? styles.pillSelected : styles.pillUnselected,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setPrimaryPlatform('tiktok');
                  // Fetch with explicit platform to avoid stale-state race
                  fetchFollowerCount('tiktok');
                }}
              >
                <Text style={primaryPlatform === 'tiktok' ? styles.pillTextSelected : styles.pillTextUnselected}>
                  TikTok
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Total Social Followers */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Total Social Followers</Text>
            <View style={styles.card}>
              <View style={styles.followerInputRow}>
                <View style={styles.followerInputContainer}>
                  <TextInput
                    style={[
                      styles.followerInput,
                      fetchStatus === 'fetching' && { opacity: 0.35 },
                    ]}
                    value={editingFollowerCount ? draftFollowerCount : (socialFollowerCount > 0 ? String(socialFollowerCount) : '')}
                    placeholder="Enter your total follower count"
                    placeholderTextColor="#A0938D"
                    keyboardType="number-pad"
                    cursorColor="#2C2C2C"
                    selectionColor="rgba(44, 44, 44, 0.3)"
                    editable={fetchStatus !== 'fetching'}
                    onFocus={() => {
                      setEditingFollowerCount(true);
                      setDraftFollowerCount(socialFollowerCount > 0 ? String(socialFollowerCount) : '');
                    }}
                    onChangeText={setDraftFollowerCount}
                    onBlur={() => {
                      const parsed = parseInt(draftFollowerCount, 10);
                      if (!isNaN(parsed) && parsed >= 0) {
                        setSocialFollowerCount(parsed);
                      }
                      setEditingFollowerCount(false);
                    }}
                    testID="follower-count-input"
                  />
                  <Pressable
                    testID="refresh-followers-btn"
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      fetchFollowerCount();
                    }}
                    style={styles.refreshButton}
                  >
                    {fetchStatus === 'fetching' ? (
                      <ActivityIndicator size="small" color="#6B5E58" />
                    ) : (
                      <Ionicons name="refresh-outline" size={20} color="#6B5E58" />
                    )}
                  </Pressable>
                </View>
                {fetchStatus === 'fetching' ? (
                  <Text style={styles.fetchStatusFetching}>Fetching from {primaryPlatform === 'instagram' ? 'Instagram' : 'TikTok'}...</Text>
                ) : fetchStatus === 'success' ? (
                  <Text style={styles.fetchStatusSuccess}>Updated from {fetchedPlatformName}</Text>
                ) : fetchStatus === 'error' || editingFollowerCount ? (
                  <Text style={styles.fetchStatusHint}>
                    Make sure your {primaryPlatform === 'instagram' ? 'Instagram' : 'TikTok'} profile is set to public so we can pull your follower count automatically.
                  </Text>
                ) : null}
              </View>
              {socialFollowerCount > 0 ? (
                <View style={styles.tierRow}>
                  <Text style={styles.tierText}>
                    Your tier: {getTierName(socialFollowerCount)} · You keep {getTierPercent(socialFollowerCount)}% of commissions
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Founding Creator hero */}
          {isFoundingCreator ? (
            <View style={styles.foundingHeroCard} testID="profile-founding-hero">
              <FoundingCreatorBadge
                size="md"
                photoUri={photoUri || null}
                firstInitial={initials.charAt(0)}
                onPress={() => router.push({ pathname: '/founding-badge-info', params: { photoUri: photoUri || '', firstInitial: initials.charAt(0) } })}
              />
              <Text style={styles.foundingHeroTitle}>Founding Creator</Text>
              <Text style={styles.foundingHeroSubtitle}>
                You're one of the first 10 creators on Styled in Motion. Thank you for shaping the platform with us.
              </Text>
            </View>
          ) : null}

          {/* Settings */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Settings</Text>
            <View style={styles.card}>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Auto Caption Style</Text>
              </View>
              <View style={styles.segmentedWrapper}>
                <SegmentedControl
                  values={['Casual', 'Professional', 'Minimal']}
                  selectedIndex={['Casual', 'Professional', 'Minimal'].indexOf(captionStyle)}
                  onChange={(e) => setCaptionStyle((['Casual', 'Professional', 'Minimal'] as const)[e.nativeEvent.selectedSegmentIndex])}
                  tintColor="#1A1210"
                  testID="caption-style-control"
                />
              </View>

              <View style={styles.settingDivider} />

              <View style={styles.settingRow}>
                <View>
                  <Text style={styles.settingLabel}>Include Hashtags</Text>
                  <Text style={styles.settingHint}>Auto-add #ootd and more</Text>
                </View>
                <Switch
                  testID="hashtags-toggle"
                  value={includeHashtags}
                  onValueChange={setIncludeHashtags}
                  trackColor={{ false: '#E8E0D8', true: '#1A1210' }}
                  thumbColor="#FFFFFF"
                />
              </View>

              <View style={styles.settingDivider} />

              <View style={styles.settingRow}>
                <View>
                  <Text style={styles.settingLabel}>Include Prices</Text>
                  <Text style={styles.settingHint}>Show prices in caption</Text>
                </View>
                <Switch
                  testID="prices-toggle"
                  value={includePrices}
                  onValueChange={setIncludePrices}
                  trackColor={{ false: '#E8E0D8', true: '#1A1210' }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </View>

            {/* Legal */}
            <View style={styles.legalCard}>
              <Pressable
                onPress={() => router.push('/privacy-policy' as any)}
                style={({ pressed }) => [styles.legalRow, pressed && styles.legalRowPressed]}
                hitSlop={4}
                testID="link-privacy-policy"
              >
                <View style={styles.legalRowInner} pointerEvents="none">
                  <View style={styles.legalRowLeft}>
                    <Shield size={18} color="#6B5E58" strokeWidth={1.75} />
                    <Text style={styles.legalRowLabel}>Privacy Policy</Text>
                  </View>
                  <ChevronRight size={18} color="#6B5E58" />
                </View>
              </Pressable>

              <View style={styles.legalRowDivider} />

              <Pressable
                onPress={() => router.push('/terms-of-service' as any)}
                style={({ pressed }) => [styles.legalRow, pressed && styles.legalRowPressed]}
                hitSlop={4}
                testID="link-terms-of-service"
              >
                <View style={styles.legalRowInner} pointerEvents="none">
                  <View style={styles.legalRowLeft}>
                    <FileText size={18} color="#6B5E58" strokeWidth={1.75} />
                    <Text style={styles.legalRowLabel}>Terms of Service</Text>
                  </View>
                  <ChevronRight size={18} color="#6B5E58" />
                </View>
              </Pressable>

              <View style={styles.legalRowDivider} />

              <View style={styles.legalRow}>
                <View style={styles.legalRowInner} pointerEvents="none">
                  <View style={styles.legalRowLeft}>
                    <Info size={18} color="#6B5E58" strokeWidth={1.75} />
                    <Text style={styles.legalRowLabel}>App Version</Text>
                  </View>
                  <Text style={styles.legalRowValue} testID="profile-app-version">
                    {appVersion}
                  </Text>
                </View>
              </View>
            </View>

            {/* Payments & Payouts */}
            <Pressable
              testID="payments-payouts-row"
              onPress={() => router.push('/payments-payouts' as any)}
              style={styles.paymentsRow}
            >
              <View style={styles.paymentsRowLeft}>
                <Wallet size={18} color="#B87063" strokeWidth={1.75} />
                <Text style={styles.paymentsRowLabel}>Payments & Payouts</Text>
              </View>
              <ChevronRight size={18} color="#6B5E58" />
            </Pressable>

            {/* Sign Out */}
            <Pressable
              testID="sign-out-button"
              onPress={() => setShowSignOutConfirm(true)}
              style={styles.signOutButton}
            >
              <Text style={styles.signOutText}>Sign Out</Text>
            </Pressable>

            {/* Account Settings (contains Delete Account) */}
            <Pressable
              testID="account-settings-button"
              onPress={() => router.push('/account-settings')}
              style={styles.accountSettingsButton}
            >
              <Text style={styles.accountSettingsText}>Account Settings</Text>
              <ChevronRight size={18} color="#6B5E58" />
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Unified avatar/name modal — iOS + Android */}
      <Modal
        visible={showAvatarModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAvatarModal(false)}
        onDismiss={() => {
          if (pendingAction === 'photo') {
            pickAvatarPhoto();
            setPendingAction(null);
          }
        }}
        testID="avatar-modal"
      >
        <View style={styles.avatarModalBackdrop}>
          <Pressable
            style={{ flex: 1 }}
            onPress={() => setShowAvatarModal(false)}
          />
          <View style={[styles.avatarModalSheet, { paddingBottom: insets.bottom + 24 }]}>
            <Text style={styles.avatarModalTitle}>Change Photo or Name</Text>

            <Pressable
              style={styles.avatarModalOption}
              onPress={() => {
                setPendingAction('photo');
                setShowAvatarModal(false);
              }}
              testID="modal-pick-photo"
            >
              <Text style={styles.avatarModalOptionText}>Choose Photo</Text>
            </Pressable>

            <Pressable
              style={styles.avatarModalOption}
              onPress={() => {
                setShowAvatarModal(false);
                setDraftUsername(username);
                setEditingUsername(true);
              }}
              testID="modal-edit-name"
            >
              <Text style={styles.avatarModalOptionText}>Edit Name</Text>
            </Pressable>

            <Pressable
              style={styles.avatarModalCancel}
              onPress={() => setShowAvatarModal(false)}
              testID="modal-cancel"
            >
              <Text style={styles.avatarModalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Sign out confirmation bar */}
      {showSignOutConfirm ? (
        <View style={[styles.signOutConfirmBar, { paddingBottom: insets.bottom + 100 }]}>
          <Text style={styles.signOutConfirmTitle}>Sign out of Styled in Motion?</Text>
          <View style={styles.signOutConfirmRow}>
            <Pressable
              style={styles.signOutCancelBtn}
              onPress={() => setShowSignOutConfirm(false)}
              testID="sign-out-cancel"
            >
              <Text style={styles.signOutCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={styles.signOutConfirmBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                useAuthStore.getState().logout();
                router.replace('/welcome');
              }}
              testID="sign-out-confirm"
            >
              <Text style={styles.signOutConfirmText}>Sign Out</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Photo Editor */}
      <PhotoEditor
        visible={showPhotoEditor}
        uri={pickedPhotoUri}
        aspectRatio={[1, 1]}
        onSave={handlePhotoEditorSave}
        onCancel={handlePhotoEditorCancel}
      />

      {/* Backfill prompt — first-time creators with looks but no profile */}
      <Modal
        visible={showBackfillSheet}
        transparent
        animationType="slide"
        onRequestClose={() => dismissBackfill(false)}
        testID="profile-measurement-prompt"
      >
        <View style={styles.backfillBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => dismissBackfill(false)} />
          <View style={[styles.backfillSheet, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.backfillTitle}>Help shoppers find creators like you</Text>
            <Text style={styles.backfillBody}>
              Add a few measurements so shoppers can match looks to their size and build. We never show your raw numbers — just descriptive tags.
            </Text>
            <Pressable
              onPress={() => dismissBackfill(true)}
              className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
              style={{ shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}
              testID="profile-measurement-prompt-cta"
            >
              <Text className="text-white text-[15px] font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
                Add measurements
              </Text>
            </Pressable>
            <Pressable
              onPress={() => dismissBackfill(false)}
              className="flex-row items-center justify-center gap-1.5 py-3 px-3 active:opacity-70"
              style={{ marginTop: 6 }}
              testID="profile-measurement-prompt-dismiss"
            >
              <Text className="text-[#6B5E58] text-sm font-medium" style={{ fontFamily: 'DMSans_500Medium' }}>
                Maybe later
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statItem} testID={`stat-${label.toLowerCase()}`}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F4F0' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  topBarTitle: {
    flex: 1,
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    textAlign: 'center',
  },
  scrollContent: { paddingBottom: 120 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  pageTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 32,
    letterSpacing: 2,
    color: '#1A1210',
  },
  identitySection: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  avatarWrapper: { position: 'relative', marginBottom: 4 },
  avatarCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#C4A882',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#C4A882',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  avatarInitials: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 30,
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#1A1210',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#F7F4F0',
  },
  avatarEditIcon: { fontSize: 12, color: '#FFFFFF' },
  foundingBadgeOnAvatar: {
    position: 'absolute',
    top: -6,
    left: -6,
  },
  foundingHeroCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 16,
    marginHorizontal: 20,
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#EDE6DF',
  },
  foundingHeroTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
    marginTop: 14,
    letterSpacing: 0.6,
  },
  foundingHeroSubtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 16,
    lineHeight: 19,
  },
  avatarHint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#7D634A',
    letterSpacing: 0.3,
  },
  username: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
    letterSpacing: 1,
  },
  usernameInput: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
    borderBottomWidth: 1.5,
    borderBottomColor: '#C4A882',
    paddingHorizontal: 12,
    paddingBottom: 4,
    minWidth: 160,
    textAlign: 'center',
  },
  bio: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#8C8580',
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280,
  },
  bioInput: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280,
    borderWidth: 1.5,
    borderColor: '#C4A882',
    borderRadius: 10,
    padding: 10,
    minWidth: 200,
  },
  // Save/Cancel row for inline editing
  editActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    width: '100%',
  },
  editCancelBtn: {
    flex: 1,
    height: 40,
    borderWidth: 1.5,
    borderColor: '#B87063',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editCancelText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    fontWeight: '600',
    color: '#B87063',
  },
  editSaveBtn: {
    flex: 1,
    height: 40,
    backgroundColor: '#B87063',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editSaveText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 16,
    shadowColor: '#C4A882',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    marginBottom: 8,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, backgroundColor: '#E8E0D8', marginVertical: 4 },
  statValue: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 24,
    color: '#1A1210',
  },
  statLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#8C8580',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  section: { paddingHorizontal: 20, paddingTop: 24 },
  sectionTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#8C8580',
    marginBottom: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    shadowColor: '#C4A882',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    overflow: 'hidden',
  },
  platformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  platformRowBorder: { borderBottomWidth: 1, borderBottomColor: '#E8E0D8' },
  platformDot: { width: 10, height: 10, borderRadius: 5 },
  platformName: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
  },
  handleValue: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#7D634A',
    marginTop: 2,
  },
  handleEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  atSign: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#8C8580' },
  handleInput: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#1A1210',
    borderBottomWidth: 1,
    borderBottomColor: '#C4A882',
    flex: 1,
    paddingVertical: 2,
  },
  saveMiniButton: {
    backgroundColor: '#DCDCDC',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#999999',
  },
  saveMiniText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#1A1210',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  settingLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
  },
  settingHint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#8C8580',
    marginTop: 2,
  },
  settingDivider: { height: 1, backgroundColor: '#E8E0D8', marginHorizontal: 16 },
  segmentedWrapper: { paddingHorizontal: 16, paddingBottom: 14 },
  // About You — field card (mirrors shopper profile.tsx)
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
    marginBottom: 4,
  },
  fieldInput: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    color: '#1A1210',
    paddingVertical: 4,
  },
  fieldHelper: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#A0938D',
    marginTop: 6,
  },
  // Legal card
  legalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE6DF',
    overflow: 'hidden',
    marginTop: 24,
    marginBottom: 8,
  },
  legalRow: {
    flexDirection: 'row',
    minHeight: 56,
    backgroundColor: '#FFFFFF',
  },
  legalRowInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  legalRowPressed: {
    backgroundColor: '#F7F4F0',
  },
  legalRowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E8E0D8',
    marginLeft: 16 + 18 + 12,
  },
  legalRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  legalRowLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#1A1210',
    marginLeft: 12,
  },
  legalRowValue: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: '#6B5E58',
  },
  signOutButton: {
    backgroundColor: '#F0EBE5',
    borderRadius: 14,
    height: 48,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 12,
    marginBottom: 20,
  },
  signOutText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    fontWeight: '600',
    color: '#B87063',
    letterSpacing: 0.3,
  },
  // Unified avatar modal
  avatarModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  avatarModalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  avatarModalTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    textAlign: 'center',
    marginBottom: 20,
  },
  avatarModalOption: {
    height: 52,
    backgroundColor: '#F0EBE5',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarModalOptionText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    fontWeight: '500',
    color: '#1A1210',
  },
  avatarModalCancel: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  avatarModalCancelText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: '#6B5E58',
  },
  // Sign out confirmation bar
  signOutConfirmBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 24,
    shadowColor: '#1A1210',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
    zIndex: 100,
  },
  signOutConfirmTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    textAlign: 'center',
    marginBottom: 20,
  },
  signOutConfirmRow: {
    flexDirection: 'row',
    gap: 12,
  },
  signOutCancelBtn: {
    flex: 1,
    height: 48,
    borderWidth: 1.5,
    borderColor: '#B87063',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutCancelText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    fontWeight: '600',
    color: '#B87063',
  },
  signOutConfirmBtn: {
    flex: 1,
    height: 48,
    backgroundColor: '#B87063',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutConfirmText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  followerInputRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  followerInput: {
    flex: 1,
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#1A1210',
    backgroundColor: '#F0EBE5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  tierRow: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  tierText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#2E7D52',
  },
  pillRow: {
    flexDirection: 'row',
    gap: 12,
  },
  pill: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  pillSelected: {
    backgroundColor: '#B87063',
  },
  pillUnselected: {
    backgroundColor: '#F0EBE5',
  },
  pillTextSelected: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#FFFFFF',
  },
  pillTextUnselected: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#6B5E58',
  },
  followerInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  refreshButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0EBE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fetchStatusFetching: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginTop: 8,
  },
  fetchStatusSuccess: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#2E7D52',
    marginTop: 8,
  },
  fetchStatusError: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#B87063',
    marginTop: 8,
  },
  fetchStatusHint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#B87063',
    marginTop: 8,
  },
  accountSettingsButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: '#F0EBE5',
    borderRadius: 14,
    height: 48,
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 20,
  },
  accountSettingsText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#6B5E58',
  },
  editSaveBtnDisabled: {
    backgroundColor: '#D4C8C2',
  },
  editSaveTextDisabled: {
    color: '#A0938D',
  },
  usernameSaveError: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#B87063',
    textAlign: 'center',
    marginTop: 8,
  },
  completionBanner: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 12,
    backgroundColor: '#FBF4EE',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#B87063',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  completionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  completionTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    letterSpacing: 0.5,
  },
  completionBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    lineHeight: 19,
    marginBottom: 12,
  },
  backfillBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  backfillSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 22,
  },
  backfillTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  backfillBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    lineHeight: 20,
    marginBottom: 16,
  },
  paymentsRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    height: 56,
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#EDE6DF',
  },
  paymentsRowLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  paymentsRowLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#1A1210',
  },
});
