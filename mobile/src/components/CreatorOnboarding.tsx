import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  FlatList,
  TextInput,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import useAuthStore from '@/lib/state/authStore';
import useProfileStore from '@/lib/state/profileStore';
import { persistPickedPhoto } from '@/lib/utils/persistPickedPhoto';

const { width: SCREEN_W } = Dimensions.get('window');
const STORAGE_KEY = 'styled_creator_onboarding_seen';

const PAGES = ['welcome', 'how', 'profile', 'tips', 'go'] as const;

interface Props {
  onComplete: () => void;
}

export default function CreatorOnboarding({ onComplete }: Props) {
  const [currentPage, setCurrentPage] = useState<number>(0);
  const flatListRef = useRef<FlatList>(null);

  // Profile page state
  const [draftBio, setDraftBio] = useState<string>('');
  const [savedProfile, setSavedProfile] = useState<boolean>(false);

  const creatorName = useAuthStore((s) => s.creatorName);
  const username = useProfileStore((s) => s.username);
  const bio = useProfileStore((s) => s.bio);
  const photoUri = useProfileStore((s) => s.photoUri);
  const setBio = useProfileStore((s) => s.setBio);
  const setPhotoUri = useProfileStore((s) => s.setPhotoUri);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const displayName = creatorName || username || 'Creator';
  const hasProfileComplete = !!(photoUri && bio);

  const dismiss = useCallback(async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'true');
    onComplete();
  }, [onComplete]);

  const goToPage = useCallback((index: number) => {
    flatListRef.current?.scrollToIndex({ index, animated: true });
    setCurrentPage(index);
  }, []);

  const handleNext = useCallback(() => {
    if (currentPage < PAGES.length - 1) {
      goToPage(currentPage + 1);
    }
  }, [currentPage, goToPage]);

  const pickPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (!result.canceled && result.assets[0]) {
        const stableUri = await persistPickedPhoto(result.assets[0].uri);
        setPhotoUri(stableUri);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (e) {
      console.error('[ONBOARDING] ImagePicker error:', e);
    }
  };

  const handleSaveProfile = () => {
    if (draftBio.trim()) {
      setBio(draftBio.trim());
    }
    setSavedProfile(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setCurrentPage(viewableItems[0].index ?? 0);
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  if (!fontsLoaded) return null;

  const renderPage = ({ item }: { item: typeof PAGES[number] }) => {
    switch (item) {
      case 'welcome':
        return <WelcomePage name={displayName} />;
      case 'how':
        return <HowItWorksPage />;
      case 'profile':
        return (
          <ProfilePage
            photoUri={photoUri}
            bio={bio}
            draftBio={draftBio}
            setDraftBio={setDraftBio}
            hasProfileComplete={hasProfileComplete}
            savedProfile={savedProfile}
            onPickPhoto={pickPhoto}
            onSave={handleSaveProfile}
            onSkip={handleNext}
          />
        );
      case 'tips':
        return <TipsPage />;
      case 'go':
        return <LetsGoPage onCreateLook={() => { dismiss(); setTimeout(() => router.push('/(tabs)/create'), 300); }} onExplore={dismiss} />;
      default:
        return null;
    }
  };

  return (
    <Modal visible animationType="fade" testID="creator-onboarding-modal">
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {/* Skip button */}
        <View style={styles.topBar}>
          <View style={styles.topBarSpacer} />
          <Pressable
            onPress={dismiss}
            style={styles.skipButton}
            testID="onboarding-skip"
          >
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        </View>

        {/* Pages */}
        <FlatList
          ref={flatListRef}
          data={PAGES as unknown as typeof PAGES[number][]}
          keyExtractor={(item) => item}
          renderItem={renderPage}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          getItemLayout={(_, index) => ({
            length: SCREEN_W,
            offset: SCREEN_W * index,
            index,
          })}
          testID="onboarding-flatlist"
        />

        {/* Bottom: dots + next button */}
        <View style={styles.bottomBar}>
          <View style={styles.dotsRow}>
            {PAGES.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === currentPage && styles.dotActive]}
              />
            ))}
          </View>
          {currentPage < PAGES.length - 1 ? (
            <Pressable
              onPress={handleNext}
              style={styles.nextButton}
              testID="onboarding-next"
            >
              <Text style={styles.nextButtonText}>Next</Text>
            </Pressable>
          ) : (
            <View style={styles.nextButtonPlaceholder} />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

/* ─── Page 1: Welcome ──────────────────────────────────────── */
function WelcomePage({ name }: { name: string }) {
  return (
    <View style={styles.page} testID="onboarding-welcome">
      <View style={styles.pageContent}>
        <View style={styles.iconCircle}>
          <Ionicons name="sparkles" size={48} color="#B87063" />
        </View>
        <Text style={styles.pageTitle}>
          Welcome to{'\n'}Styled in Motion
        </Text>
        <Text style={styles.welcomeName}>{name}</Text>
        <Text style={styles.pageSubtitle}>The platform where your style earns.</Text>
      </View>
    </View>
  );
}

/* ─── Page 2: How It Works ─────────────────────────────────── */
function HowItWorksPage() {
  const steps = [
    { icon: 'camera-outline' as const, title: 'Create a Look', desc: 'Style an outfit and tag your items with shop links' },
    { icon: 'people-outline' as const, title: 'Shoppers Discover You', desc: 'Your looks appear in the feed and search' },
    { icon: 'cash-outline' as const, title: 'You Earn Commission', desc: 'Every purchase through your links earns you money' },
  ];

  return (
    <View style={styles.page} testID="onboarding-how">
      <View style={styles.pageContent}>
        <Text style={styles.pageTitle}>How It Works</Text>
        <View style={styles.stepsContainer}>
          {steps.map((s, i) => (
            <View key={s.title}>
              <View style={styles.stepRow}>
                <View style={styles.stepIconCircle}>
                  <Ionicons name={s.icon} size={28} color="#B87063" />
                </View>
                <View style={styles.stepTextCol}>
                  <Text style={styles.stepTitle}>{s.title}</Text>
                  <Text style={styles.stepDesc}>{s.desc}</Text>
                </View>
              </View>
              {i < steps.length - 1 ? <View style={styles.stepDivider} /> : null}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/* ─── Page 3: Profile ──────────────────────────────────────── */
interface ProfilePageProps {
  photoUri: string;
  bio: string;
  draftBio: string;
  setDraftBio: (t: string) => void;
  hasProfileComplete: boolean;
  savedProfile: boolean;
  onPickPhoto: () => void;
  onSave: () => void;
  onSkip: () => void;
}

function ProfilePage({
  photoUri,
  bio,
  draftBio,
  setDraftBio,
  hasProfileComplete,
  savedProfile,
  onPickPhoto,
  onSave,
  onSkip,
}: ProfilePageProps) {
  const showGoodState = hasProfileComplete || savedProfile;
  const charCount = draftBio.length;

  return (
    <View style={styles.page} testID="onboarding-profile">
      <View style={styles.pageContent}>
        <Text style={styles.pageTitle}>Make a Great{'\n'}First Impression</Text>
        <Text style={[styles.pageSubtitle, { marginBottom: 28 }]}>
          Shoppers are more likely to follow creators with a photo and bio.
        </Text>

        {/* Avatar */}
        <Pressable
          onPress={onPickPhoto}
          style={styles.avatarTappable}
          testID="onboarding-pick-photo"
        >
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.avatarImage} contentFit="cover" />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="camera-outline" size={32} color="#6B5E58" />
            </View>
          )}
          <View style={styles.avatarBadge}>
            <Ionicons name="add" size={16} color="#FFFFFF" />
          </View>
        </Pressable>

        {showGoodState ? (
          <View style={styles.goodStateContainer} testID="onboarding-profile-good">
            <Ionicons name="checkmark-circle" size={32} color="#2E7D52" />
            <Text style={styles.goodStateText}>Looking good!</Text>
          </View>
        ) : (
          <>
            {/* Bio input */}
            <View style={styles.bioInputContainer}>
              <TextInput
                style={styles.bioInput}
                placeholder="Tell shoppers about your style..."
                placeholderTextColor="#6B5E58"
                selectionColor="rgba(26, 18, 16, 0.3)"
                cursorColor="#1A1210"
                value={draftBio}
                onChangeText={setDraftBio}
                multiline
                numberOfLines={3}
                maxLength={150}
                testID="onboarding-bio-input"
              />
              <Text style={styles.charCount}>{charCount}/150</Text>
            </View>

            <Pressable
              onPress={onSave}
              style={styles.ctaButton}
              testID="onboarding-save-profile"
            >
              <Text style={styles.ctaButtonText}>Save</Text>
            </Pressable>

            <Pressable onPress={onSkip} testID="onboarding-skip-profile">
              <Text style={styles.skipForNowText}>Skip for Now</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

/* ─── Page 4: Tips ─────────────────────────────────────────── */
function TipsPage() {
  const tips = [
    { icon: 'shirt-outline' as const, text: 'Start with 3-5 items per look — quality over quantity' },
    { icon: 'logo-instagram' as const, text: 'Connect your Instagram or TikTok to auto-sync your follower count' },
    { icon: 'sunny-outline' as const, text: 'Use high-quality, well-lit photos — they get 3x more saves' },
    { icon: 'calendar-outline' as const, text: 'Post consistently — creators who post weekly grow followers 5x faster' },
  ];

  return (
    <View style={styles.page} testID="onboarding-tips">
      <View style={styles.pageContent}>
        <Text style={styles.pageTitle}>Tips from{'\n'}Top Creators</Text>
        <View style={styles.tipsContainer}>
          {tips.map((tip) => (
            <View key={tip.text} style={styles.tipCard}>
              <Ionicons name={tip.icon} size={24} color="#B87063" style={styles.tipIcon} />
              <Text style={styles.tipText}>{tip.text}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/* ─── Page 5: Let's Go ─────────────────────────────────────── */
function LetsGoPage({ onCreateLook, onExplore }: { onCreateLook: () => void; onExplore: () => void }) {
  return (
    <View style={styles.page} testID="onboarding-go">
      <View style={styles.pageContent}>
        <View style={styles.iconCircle}>
          <Ionicons name="checkmark-done" size={48} color="#2E7D52" />
        </View>
        <Text style={styles.pageTitle}>You're All Set!</Text>
        <Text style={styles.pageSubtitle}>Time to create your first look and start earning.</Text>

        <Pressable
          onPress={onCreateLook}
          style={[styles.ctaButton, { width: '100%', marginTop: 40 }]}
          testID="onboarding-create-first-look"
        >
          <Text style={styles.ctaButtonText}>Create My First Look</Text>
        </Pressable>

        <Pressable onPress={onExplore} testID="onboarding-explore">
          <Text style={styles.exploreText}>or explore the app first</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ─── Styles ───────────────────────────────────────────────── */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F4F0',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  topBarSpacer: { width: 60 },
  skipButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  skipText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#6B5E58',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E8E0D8',
  },
  dotActive: {
    width: 24,
    backgroundColor: '#B87063',
    borderRadius: 4,
  },
  nextButton: {
    backgroundColor: '#B87063',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
  },
  nextButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  nextButtonPlaceholder: { width: 100 },
  page: {
    width: SCREEN_W,
    flex: 1,
    paddingHorizontal: 24,
  },
  pageContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    shadowColor: '#B87063',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  pageTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 28,
    color: '#1A1210',
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 34,
  },
  welcomeName: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 20,
    color: '#B87063',
    marginBottom: 12,
  },
  pageSubtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    color: '#3D3330',
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 300,
  },
  // How It Works
  stepsContainer: {
    width: '100%',
    marginTop: 32,
    gap: 0,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 16,
  },
  stepIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#C4A882',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  stepTextCol: {
    flex: 1,
  },
  stepTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#1A1210',
    marginBottom: 4,
  },
  stepDesc: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    lineHeight: 20,
  },
  stepDivider: {
    height: 1,
    backgroundColor: '#E8E0D8',
    marginLeft: 68,
    borderStyle: 'dashed',
  },
  // Profile page
  avatarTappable: {
    position: 'relative',
    marginBottom: 20,
  },
  avatarImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#E8E0D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#B87063',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#F7F4F0',
  },
  bioInputContainer: {
    width: '100%',
    marginBottom: 16,
  },
  bioInput: {
    backgroundColor: '#F0EBE5',
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    fontFamily: 'DMSans_400Regular',
    color: '#1A1210',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  charCount: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    textAlign: 'right',
    marginTop: 6,
  },
  goodStateContainer: {
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  goodStateText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 18,
    color: '#2E7D52',
  },
  skipForNowText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    marginTop: 16,
  },
  // Tips
  tipsContainer: {
    width: '100%',
    marginTop: 28,
    gap: 12,
  },
  tipCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#C4A882',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  tipIcon: {
    marginRight: 14,
  },
  tipText: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
    lineHeight: 20,
  },
  // CTA
  ctaButton: {
    height: 52,
    backgroundColor: '#B87063',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  ctaButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  exploreText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    marginTop: 20,
  },
});
