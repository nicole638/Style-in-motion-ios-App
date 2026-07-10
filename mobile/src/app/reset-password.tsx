import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { mapSignupError } from '@/lib/utils/mapAuthError';
import useAuthStore from '@/lib/state/authStore';

export default function ResetPasswordScreen() {
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showNewPassword, setShowNewPassword] = useState<boolean>(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasSubmitted, setHasSubmitted] = useState<boolean>(false);
  const [linkInvalid, setLinkInvalid] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data.user) setLinkInvalid(true);
    });
    return () => { cancelled = true; };
  }, []);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  if (linkInvalid) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="reset-password-invalid">
        <Stack.Screen options={{ headerShown: false }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 28, color: '#1A1210', textAlign: 'center', marginBottom: 12 }}>Link expired</Text>
          <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 15, color: '#6B5E58', textAlign: 'center', marginBottom: 32 }}>
            This password reset link has expired or already been used. Request a new one.
          </Text>
          <Pressable
            onPress={() => router.replace('/welcome' as any)}
            className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center"
            testID="reset-password-go-login"
          >
            <Text style={{ fontFamily: 'DMSans_500Medium', color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>
              Back to sign in
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const passwordTooShort = newPassword.length > 0 && newPassword.length < 8;
  const passwordsDoNotMatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const isDisabled = newPassword.length < 8 || newPassword !== confirmPassword;

  const handleSubmit = async () => {
    setHasSubmitted(true);

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        // Same translation the signup screens use — most importantly the
        // leaked-password case (Supabase's HaveIBeenPwned check), which
        // otherwise reads as an inexplicable "failed, try again" loop.
        const outcome = mapSignupError(updateError);
        if (outcome === 'leaked_password') {
          setError('This password has appeared in a known data breach. Please choose a different one.');
        } else if (outcome === 'weak_password') {
          setError('Password is too weak. Use at least 8 characters.');
        } else if (outcome === 'rate_limited') {
          setError('Too many attempts. Please wait a minute and try again.');
        } else {
          setError('Failed to update password. Please try again.');
        }
        return;
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // The recovery link already authenticated this user; updateUser just
      // saved their new password. Do NOT sign out or bounce them to a login /
      // creator-signup screen — hydrate the store from the live session and
      // route by the account's real type: audience -> shopper shell, creator
      // -> creator shell. (Separation rule 2: route on account_type, never
      // assume "authenticated + no creator context => creator".)
      await useAuthStore.getState().initialize();
      const routedType = useAuthStore.getState().userType;
      if (routedType === 'creator') {
        router.replace('/(tabs)' as any);
      } else {
        router.replace('/(public-tabs)/feed' as any);
      }
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="reset-password-screen">
      <Stack.Screen options={{ headerShown: false }} />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.wordmark}>Styled in Motion</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Icon badge */}
          <View style={styles.iconBadge}>
            <ShieldCheck size={32} color="#1A1210" strokeWidth={1.5} />
          </View>

          {/* Headline */}
          <Text style={styles.headline}>Set New Password</Text>
          <Text style={styles.subheadline}>
            Choose a strong password you haven't used before.
          </Text>

          {/* New Password */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>New Password</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                placeholder="At least 8 characters"
                placeholderTextColor="#A0938D"
                cursorColor="#2C2C2C"
                selectionColor="rgba(44, 44, 44, 0.3)"
                value={newPassword}
                onChangeText={(text) => {
                  setNewPassword(text);
                  setError('');
                }}
                secureTextEntry={!showNewPassword}
                autoCapitalize="none"
                autoCorrect={false}
                testID="new-password-input"
              />
              <Pressable
                style={styles.eyeButton}
                onPress={() => setShowNewPassword(!showNewPassword)}
                testID="toggle-new-password-button"
              >
                {showNewPassword ? (
                  <EyeOff size={20} color="#A0938D" />
                ) : (
                  <Eye size={20} color="#A0938D" />
                )}
              </Pressable>
            </View>
            {hasSubmitted && passwordTooShort ? (
              <Text style={styles.inlineError} testID="password-length-error">
                Password must be at least 8 characters
              </Text>
            ) : null}
          </View>

          {/* Confirm Password */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Confirm Password</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                placeholder="Re-enter your password"
                placeholderTextColor="#A0938D"
                cursorColor="#2C2C2C"
                selectionColor="rgba(44, 44, 44, 0.3)"
                value={confirmPassword}
                onChangeText={(text) => {
                  setConfirmPassword(text);
                  setError('');
                }}
                secureTextEntry={!showConfirmPassword}
                autoCapitalize="none"
                autoCorrect={false}
                testID="confirm-password-input"
              />
              <Pressable
                style={styles.eyeButton}
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                testID="toggle-confirm-password-button"
              >
                {showConfirmPassword ? (
                  <EyeOff size={20} color="#A0938D" />
                ) : (
                  <Eye size={20} color="#A0938D" />
                )}
              </Pressable>
            </View>
            {hasSubmitted && passwordsDoNotMatch ? (
              <Text style={styles.inlineError} testID="passwords-match-error">
                Passwords do not match
              </Text>
            ) : null}
          </View>

          {/* API error */}
          {error ? (
            <Text style={styles.errorText} testID="error-message">
              {error}
            </Text>
          ) : null}

          {/* Submit button */}
          <Pressable
            onPress={handleSubmit}
            disabled={isLoading}
            testID="reset-password-button"
            style={[styles.button, isDisabled && !isLoading && styles.buttonDisabled]}
          >
            {isLoading ? (
              <ActivityIndicator color="#F7F4F0" testID="loading-indicator" />
            ) : (
              <Text style={[styles.buttonText, isDisabled && styles.buttonTextDisabled]}>
                Update Password
              </Text>
            )}
          </Pressable>

          <Text style={styles.hint}>
            You'll be signed out after updating and can log back in with your new password.
          </Text>
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
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerSpacer: {
    width: 40,
  },
  wordmark: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    textAlign: 'center',
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#EDE8E3',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    marginBottom: 20,
  },
  headline: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 32,
    color: '#1A1210',
    marginBottom: 8,
  },
  subheadline: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: '#A0938D',
    marginBottom: 32,
    lineHeight: 22,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputWrapper: {
    position: 'relative',
  },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: 'DMSans_400Regular',
    color: '#1A1210',
    backgroundColor: '#FFFFFF',
  },
  passwordInput: {
    paddingRight: 52,
  },
  eyeButton: {
    position: 'absolute',
    right: 16,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  inlineError: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#B87063',
    marginTop: 6,
    paddingLeft: 4,
  },
  errorText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#B87063',
    textAlign: 'center',
    marginBottom: 16,
  },
  button: {
    height: 52,
    backgroundColor: '#1A1210',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: '#CFC6BF',
  },
  buttonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 18,
    color: '#F7F4F0',
  },
  buttonTextDisabled: {
    color: '#4A3C38',
  },
  hint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#A0938D',
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 19,
  },
});
