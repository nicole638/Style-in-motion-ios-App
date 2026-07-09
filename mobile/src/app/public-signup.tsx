import React, { useState } from 'react';
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
import { router } from 'expo-router';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { ChevronLeft, Eye, EyeOff, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import useAuthStore from '@/lib/state/authStore';
import ForgotPasswordModal from '@/components/ForgotPasswordModal';

// Shopper Terms of Service — opened in an in-app Safari view, mirroring the
// creator signup's agreement link.
const SHOPPER_TERMS_URL = 'https://shop.styledinmotion.studio/terms';

type ActiveTab = 'signup' | 'login';

export default function PublicSignupScreen() {
  const signupAsPublic = useAuthStore((s) => s.signupAsPublic);
  const loginAsPublic = useAuthStore((s) => s.loginAsPublic);

  const [activeTab, setActiveTab] = useState<ActiveTab>('login');

  // Signup fields
  const [signupFirstName, setSignupFirstName] = useState<string>('');
  const [signupLastName, setSignupLastName] = useState<string>('');
  const [signupEmail, setSignupEmail] = useState<string>('');
  const [signupPassword, setSignupPassword] = useState<string>('');
  const [showSignupPassword, setShowSignupPassword] = useState<boolean>(false);
  // Required ToS acceptance — blocks "Join Free" until checked. Acceptance is
  // recorded server-side via signUp metadata (agreement_* in signupAsPublic).
  const [agreementAccepted, setAgreementAccepted] = useState<boolean>(false);

  // Login fields
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [showLoginPassword, setShowLoginPassword] = useState<boolean>(false);

  // Shared state
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasSubmitted, setHasSubmitted] = useState<boolean>(false);
  const [showForgotPassword, setShowForgotPassword] = useState<boolean>(false);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  if (!fontsLoaded) {
    return null;
  }

  const switchTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    setSignupFirstName('');
    setSignupLastName('');
    setSignupEmail('');
    setSignupPassword('');
    setLoginEmail('');
    setLoginPassword('');
    setShowSignupPassword(false);
    setShowLoginPassword(false);
    setAgreementAccepted(false);
    setError('');
    setHasSubmitted(false);
  };

  const openUrl = (url: string) => {
    WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC,
    }).catch(() => {});
  };

  // Signup validation. Last name is OPTIONAL — many real creators are
  // mononyms (Latoya, Sylvia, Megan, Kerri, ReillyRose_Styles), so only
  // first name is required.
  const signupFirstNameEmpty = !signupFirstName.trim();
  const signupEmailEmpty = !signupEmail.trim();
  const signupPasswordEmpty = signupPassword.length === 0;
  const signupPasswordTooShort = signupPassword.length > 0 && signupPassword.length < 6;
  const isSignupDisabled =
    signupFirstNameEmpty ||
    signupEmailEmpty ||
    signupPassword.length < 6 ||
    // ToS must be accepted before signup is allowed.
    !agreementAccepted;

  // Login validation
  const isLoginDisabled = !loginEmail.trim() || !loginPassword.trim();

  const handleSignup = async () => {
    setHasSubmitted(true);
    if (isLoading) return;

    // Show specific field-level error when form is invalid
    if (isSignupDisabled) {
      if (signupFirstNameEmpty) {
        setError('First name is required.');
      } else if (signupEmailEmpty) {
        setError('Please enter your email');
      } else if (signupPasswordEmpty || signupPasswordTooShort) {
        setError('Password must be at least 6 characters');
      } else if (!agreementAccepted) {
        setError('Please agree to the Terms of Service to continue.');
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setError('');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(signupEmail.trim())) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);

    try {
      const result = await signupAsPublic(
        signupFirstName.trim(),
        signupLastName.trim(),
        signupEmail.trim(),
        signupPassword
      );

      switch (result) {
        case 'success':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.replace('/(public-tabs)/feed' as any);
          break;
        case 'confirm_email': {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          // In-app OTP: go straight to the 6-digit code entry screen \u2014 no
          // browser hop, no "come back and sign in again". The email
          // confirmation LINK still works as a fallback for anyone who taps it
          // instead (handled in the _layout deep-link handler).
          const pendingEmail = signupEmail.trim();
          try { await AsyncStorage.setItem('@sim/pending_verify_email', pendingEmail); } catch {}
          router.push({ pathname: '/auth/verify', params: { email: pendingEmail } } as any);
          break;
        }
        case 'email_taken':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError('An account with this email already exists. Try logging in instead.');
          break;
        case 'invalid_name':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError('Please enter your first name.');
          break;
        case 'invalid_email':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError('Please enter a valid email address.');
          break;
        case 'weak_password':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError('Password is too weak. Use at least 8 characters.');
          break;
        case 'rate_limited':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError('Too many attempts. Please wait a few minutes and try again.');
          break;
        case 'email_send_failed':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError("Your account was created but we couldn't send a confirmation email. Try signing in, or email support@styledinmotion.app.");
          break;
        case 'server_error':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError('Something went wrong on our end. Please try again in a moment, or email support@styledinmotion.app if it keeps happening.');
          break;
        case 'unknown_error':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError("Couldn't create your account. Please try again, or email support@styledinmotion.app.");
          break;
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    setHasSubmitted(true);
    if (isLoading) return;

    if (isLoginDisabled) {
      if (!loginEmail.trim()) {
        setError('Please enter your email');
      } else {
        setError('Please enter your password');
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setError('');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(loginEmail.trim())) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);

    try {
      const result = await loginAsPublic(loginEmail.trim(), loginPassword);

      switch (result) {
        case 'success':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.replace('/(public-tabs)/feed' as any);
          break;
        case 'wrong_credentials':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError('Email or password is incorrect.');
          break;
        case 'email_not_confirmed':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError('Please check your email and tap the confirmation link before signing in.');
          break;
        case 'wrong_account_type':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError("This email is registered as a creator account. Go back and tap 'Creator' to sign in.");
          break;
        case 'rate_limited':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError('Too many attempts. Please wait a few minutes and try again.');
          break;
        case 'server_error':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError('Something went wrong on our end. Please try again in a moment, or email support@styledinmotion.app if it keeps happening.');
          break;
        case 'unknown_error':
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setError("Couldn't log you in. Please try again.");
          break;
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const renderSignupForm = () => (
    <View>
      <Text style={styles.headline}>Join the Community</Text>
      <Text style={styles.subheadline}>
        Discover looks. Shop the pieces. Save what you love.
      </Text>

      {/* Name */}
      <View style={styles.nameRow}>
        <View style={[styles.inputContainer, styles.nameField]}>
          <TextInput
            style={styles.input}
            placeholder="First name"
            placeholderTextColor="#A0938D"
            cursorColor="#2C2C2C"
            selectionColor="rgba(44, 44, 44, 0.3)"
            value={signupFirstName}
            onChangeText={(text) => {
              setSignupFirstName(text);
              setError('');
            }}
            autoCapitalize="words"
            testID="signup-first-name-input"
          />
        </View>
        <View style={[styles.inputContainer, styles.nameField]}>
          <TextInput
            style={styles.input}
            placeholder="Last name (optional)"
            placeholderTextColor="#A0938D"
            cursorColor="#2C2C2C"
            selectionColor="rgba(44, 44, 44, 0.3)"
            value={signupLastName}
            onChangeText={(text) => {
              setSignupLastName(text);
              setError('');
            }}
            autoCapitalize="words"
            testID="signup-last-name-input"
          />
        </View>
      </View>

      {/* Email */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="your@email.com"
          placeholderTextColor="#A0938D"
          cursorColor="#2C2C2C"
          selectionColor="rgba(44, 44, 44, 0.3)"
          value={signupEmail}
          onChangeText={(text) => {
            setSignupEmail(text);
            setError('');
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          testID="signup-email-input"
        />
      </View>

      {/* Password */}
      <View style={styles.inputContainer}>
        <TextInput
          style={[styles.input, styles.passwordInput]}
          placeholder="Create a password (min. 6 characters)"
          placeholderTextColor="#A0938D"
          cursorColor="#2C2C2C"
          selectionColor="rgba(44, 44, 44, 0.3)"
          value={signupPassword}
          onChangeText={(text) => {
            setSignupPassword(text);
            setError('');
          }}
          secureTextEntry={!showSignupPassword}
          autoCapitalize="none"
          testID="signup-password-input"
        />
        <Pressable
          style={styles.eyeButton}
          onPress={() => setShowSignupPassword(!showSignupPassword)}
          testID="toggle-signup-password-button"
        >
          {showSignupPassword ? (
            <EyeOff size={20} color="#A0938D" />
          ) : (
            <Eye size={20} color="#A0938D" />
          )}
        </Pressable>
      </View>

      {/* Inline password validation hint */}
      {hasSubmitted && (signupPasswordTooShort || signupPasswordEmpty) ? (
        <Text style={styles.inlineError} testID="password-length-error">
          Password must be at least 6 characters
        </Text>
      ) : null}

      {/* API / validation error */}
      {error ? (
        <Text style={styles.errorText} testID="error-message">
          {error}
        </Text>
      ) : null}

      {/* Required Terms of Service acceptance. The button below stays disabled
          until this box is checked. Link opens in an in-app Safari view. */}
      <Pressable
        style={styles.agreementRow}
        onPress={() => setAgreementAccepted((v) => !v)}
        testID="agreement-checkbox"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreementAccepted }}
        hitSlop={8}
      >
        <View style={[styles.checkbox, agreementAccepted && styles.checkboxChecked]}>
          {agreementAccepted ? (
            <Check size={14} color="#F7F4F0" strokeWidth={3} />
          ) : null}
        </View>
        <Text style={styles.agreementText}>
          I agree to the{' '}
          <Text
            style={styles.agreementLink}
            onPress={() => openUrl(SHOPPER_TERMS_URL)}
            testID="terms-link-public-signup"
          >
            Terms of Service
          </Text>
          .
        </Text>
      </Pressable>

      {/* Join button */}
      <Pressable
        onPress={handleSignup}
        disabled={isLoading}
        testID="signup-button"
        style={[styles.button, isSignupDisabled && !isLoading && styles.buttonDisabled]}
      >
        {isLoading ? (
          <ActivityIndicator color="#1A1210" testID="loading-indicator" />
        ) : (
          <Text style={[styles.buttonText, isSignupDisabled && styles.buttonTextDisabled]}>
            Join Free
          </Text>
        )}
      </Pressable>
    </View>
  );

  const renderLoginForm = () => (
    <View>
      <Text style={styles.headline}>Welcome back</Text>

      {/* Email */}
      <View style={[styles.inputContainer, { marginTop: 24 }]}>
        <TextInput
          style={styles.input}
          placeholder="your@email.com"
          placeholderTextColor="#A0938D"
          cursorColor="#2C2C2C"
          selectionColor="rgba(44, 44, 44, 0.3)"
          value={loginEmail}
          onChangeText={(text) => {
            setLoginEmail(text);
            setError('');
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          testID="login-email-input"
        />
      </View>

      {/* Password */}
      <View style={styles.inputContainer}>
        <TextInput
          style={[styles.input, styles.passwordInput]}
          placeholder="Password"
          placeholderTextColor="#A0938D"
          cursorColor="#2C2C2C"
          selectionColor="rgba(44, 44, 44, 0.3)"
          value={loginPassword}
          onChangeText={(text) => {
            setLoginPassword(text);
            setError('');
          }}
          secureTextEntry={!showLoginPassword}
          autoCapitalize="none"
          testID="login-password-input"
        />
        <Pressable
          style={styles.eyeButton}
          onPress={() => setShowLoginPassword(!showLoginPassword)}
          testID="toggle-login-password-button"
        >
          {showLoginPassword ? (
            <EyeOff size={20} color="#A0938D" />
          ) : (
            <Eye size={20} color="#A0938D" />
          )}
        </Pressable>
      </View>

      {/* Error */}
      {error ? (
        <Text style={styles.errorText} testID="error-message">
          {error}
        </Text>
      ) : null}

      {/* Sign In button */}
      <Pressable
        onPress={handleLogin}
        disabled={isLoading}
        testID="login-button"
        style={[styles.button, isLoginDisabled && !isLoading && styles.buttonDisabled]}
      >
        {isLoading ? (
          <ActivityIndicator color="#1A1210" testID="loading-indicator" />
        ) : (
          <Text style={[styles.buttonText, isLoginDisabled && styles.buttonTextDisabled]}>Sign In</Text>
        )}
      </Pressable>

      {/* Forgot password */}
      <Pressable onPress={() => setShowForgotPassword(true)} testID="forgot-password-button">
        <Text style={[styles.forgotText, { color: '#B87063' }]}>Forgot Password?</Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top', 'bottom']}
      testID="public-signup-screen"
    >
      <Stack.Screen options={{ headerShown: false }} />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={styles.backButton}
            testID="back-button"
          >
            <ChevronLeft size={24} color="#1A1210" />
          </Pressable>
          <Text style={styles.wordmark}>Styled in Motion</Text>
          <View style={styles.backButton} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Segmented toggle */}
          <View style={styles.toggleContainer}>
            <Pressable
              style={[
                styles.toggleTab,
                activeTab === 'signup' && styles.toggleTabActive,
              ]}
              onPress={() => switchTab('signup')}
              testID="signup-tab"
            >
              <Text
                style={[
                  styles.toggleTabText,
                  activeTab === 'signup' && styles.toggleTabTextActive,
                ]}
              >
                Join Free
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.toggleTab,
                activeTab === 'login' && styles.toggleTabActive,
              ]}
              onPress={() => switchTab('login')}
              testID="login-tab"
            >
              <Text
                style={[
                  styles.toggleTabText,
                  activeTab === 'login' && styles.toggleTabTextActive,
                ]}
              >
                Sign In
              </Text>
            </Pressable>
          </View>

          {/* Form content */}
          <View style={styles.formContainer}>
            {activeTab === 'signup' ? renderSignupForm() : renderLoginForm()}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ForgotPasswordModal
        visible={showForgotPassword}
        onClose={() => setShowForgotPassword(false)}
        initialEmail={loginEmail}
      />
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
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    textAlign: 'center',
  },
  toggleContainer: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#E8E0D8',
    borderRadius: 10,
    overflow: 'hidden',
    marginTop: 8,
    marginBottom: 24,
  },
  toggleTab: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  toggleTabActive: {
    backgroundColor: '#DCDCDC',
  },
  toggleTabText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#6B5E58',
  },
  toggleTabTextActive: {
    color: '#1A1210',
  },
  formContainer: {
    flex: 1,
  },
  headline: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 24,
    color: '#1A1210',
  },
  subheadline: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#A0938D',
    marginTop: 6,
    marginBottom: 24,
  },
  inputContainer: {
    marginBottom: 16,
    position: 'relative',
  },
  nameRow: {
    flexDirection: 'row',
    gap: 12,
  },
  nameField: {
    flex: 1,
  },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 15,
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
    color: '#C0392B',
    marginTop: -8,
    marginBottom: 12,
    paddingLeft: 4,
  },
  errorText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#C0392B',
    textAlign: 'center',
    marginBottom: 16,
  },
  agreementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 20,
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#C4B8AF',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: '#1A1210',
    borderColor: '#1A1210',
  },
  agreementText: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#6B5E58',
  },
  agreementLink: {
    fontFamily: 'DMSans_500Medium',
    color: '#B87063',
    textDecorationLine: 'underline',
  },
  forgotText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#A0938D',
    textAlign: 'center',
    marginTop: 20,
  },
  button: {
    alignSelf: 'stretch' as const,
    height: 52,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#1A1210',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: '#CFC6BF',
    borderColor: '#CFC6BF',
  },
  buttonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 18,
    color: '#1A1210',
  },
  buttonTextDisabled: {
    color: '#4A3C38',
  },
});
