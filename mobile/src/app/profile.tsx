import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import {
  ChevronLeft,
  ChevronRight,
  Camera,
  FileText,
  MapPin,
  Shield,
  Info,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import useAuthStore from '@/lib/state/authStore';
import useAppMetadataStore from '@/lib/state/appMetadataStore';
import { useShopperProfile } from '@/lib/hooks/useShopperProfile';
import { persistPickedPhoto } from '@/lib/utils/persistPickedPhoto';
import LocationAutocomplete from '@/components/LocationAutocomplete';

export default function ShopperProfileScreen() {
  const publicUser = useAuthStore((s) => s.publicUser);
  const logout = useAuthStore((s) => s.logout);
  const currentVersion = useAppMetadataStore((s) => s.currentVersion);

  const { profile, loading, save, uploadPhoto, uploadingPhoto } = useShopperProfile();

  const [name, setName] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const [dirty, setDirty] = useState<boolean>(false);
  const [savingField, setSavingField] = useState<boolean>(false);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  useEffect(() => {
    if (profile) {
      setName(profile.name ?? '');
      setLocation(profile.location ?? '');
      setDirty(false);
    } else if (publicUser) {
      setName(publicUser.name ?? '');
    }
  }, [profile, publicUser]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(public-tabs)/feed' as any);
    }
  }, []);

  const handleSaveFields = useCallback(async () => {
    if (!dirty) return;
    setSavingField(true);
    try {
      await save({
        name: name.trim(),
        location: location.trim() === '' ? null : location.trim(),
      });
      setDirty(false);
    } catch (e: any) {
      Alert.alert('Save failed', e?.message ?? 'Something went wrong.');
    } finally {
      setSavingField(false);
    }
  }, [dirty, name, location, save]);

  const handlePickPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to change your picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const stableUri = await persistPickedPhoto(result.assets[0].uri);
      await uploadPhoto(stableUri);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Could not upload photo.');
    }
  }, [uploadPhoto]);

  const handleSignOut = useCallback(async () => {
    await logout();
    router.replace('/welcome' as any);
  }, [logout]);


  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  const displayName = name || publicUser?.name || 'Guest';
  const email = publicUser?.email ?? profile?.email ?? '';
  const avatarUri = profile?.profile_photo_url ?? null;
  const initial = (displayName.trim().charAt(0) || '?').toUpperCase();
  const fallbackVersion = Constants.expoConfig?.version ?? '—';
  const appVersion = currentVersion ?? fallbackVersion;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="shopper-profile-screen">
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
          testID="profile-back-button"
        >
          <ChevronLeft size={24} color="#1A1210" strokeWidth={1.8} />
        </Pressable>
        <Text style={styles.wordmark}>Profile</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        testID="profile-scroll"
      >
        {/* Identity section */}
        <View style={styles.identitySection}>
          <Pressable
            onPress={handlePickPhoto}
            style={({ pressed }) => [styles.avatarWrapper, pressed && { opacity: 0.85 }]}
            testID="avatar-picker"
            disabled={uploadingPhoto}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
            )}
            <View style={styles.avatarOverlay}>
              {uploadingPhoto ? (
                <ActivityIndicator size="small" color="#FFFFFF" testID="avatar-uploading" />
              ) : (
                <Camera size={16} color="#FFFFFF" strokeWidth={2} />
              )}
            </View>
          </Pressable>

          <Text style={styles.displayName} testID="profile-display-name">{displayName}</Text>
          {email ? <Text style={styles.displayEmail}>{email}</Text> : null}
          {location ? (
            <View style={styles.locationRow} testID="profile-location-display">
              <MapPin size={13} color="#6B5E58" />
              <Text style={styles.locationText}>{location}</Text>
            </View>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.loaderBox}>
            <ActivityIndicator size="small" color="#1A1210" testID="profile-loading" />
          </View>
        ) : null}

        {/* Editable fields */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>About you</Text>
        </View>

        <View style={styles.fieldCard}>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            value={name}
            onChangeText={(t) => { setName(t); setDirty(true); }}
            placeholder="Your name"
            placeholderTextColor="#A0938D"
            style={styles.fieldInput}
            testID="profile-name-input"
            autoCapitalize="words"
          />
        </View>

        <View style={[styles.fieldCard, { zIndex: 10 }]}>
          <Text style={styles.fieldLabel}>Location</Text>
          <LocationAutocomplete
            value={location}
            onChange={(val) => { setLocation(val); setDirty(true); }}
            placeholder="City, country"
            testID="profile-location-input"
          />
          <Text style={styles.fieldHelper}>
            Helps us recommend looks from brands in your area.
          </Text>
        </View>

        {dirty ? (
          <Pressable
            style={[styles.saveButton, savingField && { opacity: 0.6 }]}
            onPress={handleSaveFields}
            disabled={savingField}
            testID="profile-save-button"
          >
            {savingField ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.saveButtonText}>Save changes</Text>
            )}
          </Pressable>
        ) : null}

        {/* Legal & meta */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>Legal</Text>
        </View>

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
              <Text style={styles.legalRowValue} testID="profile-app-version">{appVersion}</Text>
            </View>
          </View>
        </View>

        {/* Account actions */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>Account</Text>
        </View>

        <Pressable
          style={styles.signOutButton}
          onPress={handleSignOut}
          testID="profile-sign-out-button"
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </Pressable>

        <Pressable
          style={styles.accountSettingsButton}
          onPress={() => router.push('/account-settings')}
          testID="profile-account-settings-button"
        >
          <Text style={styles.accountSettingsText}>Account Settings</Text>
          <ChevronRight size={18} color="#6B5E58" />
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>

    </SafeAreaView>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE6DF',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  headerSpacer: {
    width: 40,
  },
  wordmark: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    textAlign: 'center',
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 48,
  },
  identitySection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarWrapper: {
    width: 112,
    height: 112,
    borderRadius: 56,
    marginBottom: 12,
    position: 'relative',
  },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  avatarFallback: {
    backgroundColor: '#8C5A3A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 44,
    color: '#FFFFFF',
  },
  avatarOverlay: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1A1210',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#F7F4F0',
  },
  displayName: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 24,
    color: '#1A1210',
  },
  displayEmail: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    marginTop: 4,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  locationText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
  },
  loaderBox: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  sectionHeader: {
    marginTop: 16,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  sectionLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#6B5E58',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
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
  saveButton: {
    marginTop: 8,
    backgroundColor: '#1A1210',
    borderRadius: 14,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#FFFFFF',
  },
  legalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE6DF',
    overflow: 'hidden',
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
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: '#D4C8C2',
  },
  signOutText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#1A1210',
  },
  accountSettingsButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    height: 50,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: '#D4C8C2',
  },
  accountSettingsText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#6B5E58',
  },
  galleryEmpty: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE6DF',
    padding: 16,
    marginBottom: 4,
  },
  galleryEmptyText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    lineHeight: 19,
  },
  galleryRow: {
    gap: 10,
    paddingVertical: 4,
    paddingRight: 4,
  },
  galleryTile: {
    width: 110,
    aspectRatio: 0.75,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#EDE6DF',
  },
  galleryImage: {
    width: '100%',
    height: '100%',
  },
});
