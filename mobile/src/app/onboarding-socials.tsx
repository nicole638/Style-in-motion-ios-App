import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Switch,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import useAuthStore from '@/lib/state/authStore';
import useCreatorStore, { defaultHandles, PlatformHandle } from '@/lib/state/creatorStore';
import useProfileStore from '@/lib/state/profileStore';
import UsernameField from '@/components/UsernameField';

export default function OnboardingSocialsScreen() {
  const creatorId = useAuthStore((s) => s.creatorId);
  const saveSocialsToSupabase = useCreatorStore((s) => s.saveSocialsToSupabase);
  const currentUsername = useProfileStore((s) => s.username);
  const setUsername = useProfileStore((s) => s.setUsername);

  const [handles, setHandles] = useState<PlatformHandle[]>(defaultHandles);
  const [usernameValid, setUsernameValid] = useState<boolean>(false);
  const [normalizedUsername, setNormalizedUsername] = useState<string>('');
  const [usernameSaveError, setUsernameSaveError] = useState<string | null>(null);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;

  const updateHandle = (id: string, value: string) => {
    setHandles((prev) => prev.map((h) => (h.id === id ? { ...h, handle: value } : h)));
  };

  const toggleEnabled = (id: string) => {
    setHandles((prev) => prev.map((h) => (h.id === id ? { ...h, connected: !h.connected } : h)));
  };

  const handleSave = async () => {
    if (!creatorId) return;
    // Save username
    if (usernameValid && normalizedUsername) {
      try {
        await setUsername(normalizedUsername);
        setUsernameSaveError(null);
      } catch (e) {
        if (e instanceof Error && e.message === 'USERNAME_TAKEN') {
          setUsernameSaveError('That just got taken — try another');
          return;
        }
      }
    }
    // Save to Zustand store
    const store = useCreatorStore.getState();
    const { handlesPerCreator } = store;
    useCreatorStore.setState({
      handles,
      handlesPerCreator: { ...handlesPerCreator, [creatorId]: handles },
    });
    // Save to Supabase
    await saveSocialsToSupabase(creatorId, handles);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace('/(tabs)' as any);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="onboarding-socials-screen">
      <Stack.Screen options={{ headerShown: false }} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Choose Your Username</Text>
          <Text style={styles.subtitle}>Pick a unique username for your creator profile.</Text>

          <View style={styles.usernameCard}>
            <UsernameField
              initialValue={currentUsername}
              onValidityChange={(isValid, normalized) => {
                setUsernameValid(isValid);
                setNormalizedUsername(normalized);
                setUsernameSaveError(null);
              }}
            />
            {usernameSaveError ? (
              <Text style={styles.usernameError} testID="onboarding-username-error">{usernameSaveError}</Text>
            ) : null}
          </View>

          <Text style={styles.sectionTitle}>Connect Your Socials</Text>
          <Text style={styles.subtitle}>Let your audience find you everywhere. You can always update this later.</Text>

          <View style={styles.card}>
            {handles.map((h, index) => (
              <View
                key={h.id}
                style={[styles.platformRow, index < handles.length - 1 && styles.platformRowBorder]}
                testID={`onboarding-platform-${h.id}`}
              >
                <Ionicons name={h.icon as any} size={22} color="#B87063" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.platformName}>{h.platform}</Text>
                  <TextInput
                    style={styles.handleInput}
                    placeholder="@username"
                    placeholderTextColor="#A0938D"
                    value={h.handle}
                    onChangeText={(text) => updateHandle(h.id, text.replace('@', ''))}
                    autoCapitalize="none"
                    autoCorrect={false}
                    cursorColor="#2C2C2C"
                    selectionColor="rgba(44, 44, 44, 0.3)"
                    testID={`onboarding-handle-${h.id}`}
                  />
                </View>
                <Switch
                  value={h.connected}
                  onValueChange={() => toggleEnabled(h.id)}
                  trackColor={{ false: '#E8E0D8', true: '#1A1210' }}
                  thumbColor="#FFFFFF"
                  testID={`onboarding-toggle-${h.id}`}
                />
              </View>
            ))}
          </View>

          <Pressable
            style={[styles.saveButton, !usernameValid && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={!usernameValid}
            testID="onboarding-save-button"
          >
            <Text style={[styles.saveButtonText, !usernameValid && styles.saveButtonTextDisabled]}>Save & Continue</Text>
          </Pressable>

          {!usernameValid ? (
            <Text style={styles.usernameRequiredHint} testID="onboarding-username-required-hint">
              A username is required to continue.
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F4F0',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 40,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 32,
    color: '#1A1210',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: '#6B5E58',
    lineHeight: 22,
    marginBottom: 28,
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
    marginBottom: 24,
  },
  platformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  platformRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#E8E0D8',
  },
  platformName: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
  },
  handleInput: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#1A1210',
    borderBottomWidth: 1,
    borderBottomColor: '#E8E0D8',
    paddingVertical: 4,
    marginTop: 2,
  },
  saveButton: {
    height: 52,
    backgroundColor: '#1A1210',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  saveButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 17,
    color: '#F7F4F0',
  },
  usernameRequiredHint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    textAlign: 'center',
    marginTop: 4,
  },
  usernameCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    shadowColor: '#C4A882',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    padding: 20,
    marginBottom: 28,
    alignItems: 'center',
  },
  usernameError: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#B87063',
    textAlign: 'center',
    marginTop: 8,
  },
  sectionTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 24,
    color: '#1A1210',
    marginBottom: 8,
  },
  saveButtonDisabled: {
    backgroundColor: '#CFC6BF',
  },
  saveButtonTextDisabled: {
    color: '#4A3C38',
  },
});
