import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { X, Mail } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { mapLoginError } from '@/lib/utils/mapAuthError';

type ResetStatus = 'idle' | 'sending' | 'sent' | 'error';

interface ForgotPasswordModalProps {
  visible: boolean;
  onClose: () => void;
  initialEmail?: string;
}

export default function ForgotPasswordModal({
  visible,
  onClose,
  initialEmail = '',
}: ForgotPasswordModalProps) {
  const [resetEmail, setResetEmail] = useState<string>(initialEmail);
  const [resetStatus, setResetStatus] = useState<ResetStatus>('idle');
  const [resetError, setResetError] = useState<string>('');

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail.trim());
  const isSendDisabled = !resetEmail.trim() || !isEmailValid;

  const handleResetPassword = async () => {
    setResetStatus('sending');
    setResetError('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
        // Dedicated recovery deep-link. _layout.tsx handles 'auth/reset',
        // exchanges the ?code= param for a session, and routes to /reset-password.
        redirectTo: 'styledinmotion://auth/reset',
      });
      if (error) {
        console.error('[auth] resetPasswordForEmail error:', {
          code: (error as any)?.code,
          status: (error as any)?.status,
          message: error?.message,
        });
        const outcome = mapLoginError(error);
        let msg: string;
        switch (outcome) {
          case 'rate_limited':
            msg = 'Too many attempts. Please wait a few minutes and try again.';
            break;
          case 'server_error':
            msg = 'Something went wrong on our end. Please try again in a moment, or email support@styledinmotion.app if it keeps happening.';
            break;
          default:
            msg = "Couldn't send the reset email. Please try again, or email support@styledinmotion.app.";
            break;
        }
        setResetError(msg);
        setResetStatus('error');
        return;
      }
      setResetStatus('sent');
    } catch (e: any) {
      console.error('[auth] resetPasswordForEmail exception:', {
        code: e?.code,
        status: e?.status,
        message: e?.message,
      });
      setResetError("Couldn't send the reset email. Please try again, or email support@styledinmotion.app.");
      setResetStatus('error');
    }
  };

  const handleClose = () => {
    setResetStatus('idle');
    setResetError('');
    setResetEmail(initialEmail);
    onClose();
  };

  // Reset email field when modal opens with new initialEmail
  React.useEffect(() => {
    if (visible) {
      setResetEmail(initialEmail);
      setResetStatus('idle');
      setResetError('');
    }
  }, [visible, initialEmail]);

  if (!fontsLoaded) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
      testID="forgot-password-modal"
    >
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {/* Close button */}
          <View style={styles.header}>
            <View style={styles.headerSpacer} />
            <Pressable
              onPress={handleClose}
              style={styles.closeButton}
              testID="forgot-password-close"
            >
              <X size={24} color="#1A1210" />
            </Pressable>
          </View>

          <View style={styles.content}>
            {resetStatus === 'sent' ? (
              /* Success State */
              <View style={styles.successContainer} testID="forgot-password-success">
                <View style={styles.iconCircle}>
                  <Mail size={40} color="#2E7D52" />
                </View>
                <Text style={styles.successTitle}>Check your email</Text>
                <Text style={styles.successSubtitle}>
                  We sent a password reset link to{' '}
                  <Text style={styles.emailHighlight}>{resetEmail.trim()}</Text>.
                  {'\n\n'}Tap the link in the email to set a new password.
                </Text>
                <Pressable
                  onPress={handleClose}
                  style={styles.backToLoginButton}
                  testID="back-to-login-button"
                >
                  <Text style={styles.backToLoginText}>Back to Login</Text>
                </Pressable>
              </View>
            ) : (
              /* Email Input State */
              <View style={styles.formContainer} testID="forgot-password-form">
                <Text style={styles.title}>Reset your password</Text>
                <Text style={styles.subtitle}>
                  Enter the email address you signed up with and we'll send you a link to reset your password.
                </Text>

                <View style={styles.inputContainer}>
                  <TextInput
                    style={styles.emailInput}
                    placeholder="your@email.com"
                    placeholderTextColor="#6B5E58"
                    value={resetEmail}
                    onChangeText={(text) => {
                      setResetEmail(text);
                      if (resetError) setResetError('');
                    }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    cursorColor="#1A1210"
                    selectionColor="rgba(26, 18, 16, 0.3)"
                    testID="reset-email-input"
                  />
                </View>

                {resetStatus === 'error' && resetError ? (
                  <Text style={styles.errorText} testID="reset-error">
                    {resetError}
                  </Text>
                ) : null}

                <Pressable
                  onPress={handleResetPassword}
                  disabled={isSendDisabled || resetStatus === 'sending'}
                  style={[
                    styles.sendButton,
                    (isSendDisabled || resetStatus === 'sending') && styles.sendButtonDisabled,
                  ]}
                  testID="send-reset-link-button"
                >
                  {resetStatus === 'sending' ? (
                    <ActivityIndicator color="#FFFFFF" testID="reset-loading-indicator" />
                  ) : (
                    <Text style={[styles.sendButtonText, isSendDisabled && styles.sendButtonTextDisabled]}>Send Reset Link</Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
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
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  // Form state
  formContainer: {
    paddingTop: 24,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 28,
    color: '#1A1210',
    marginBottom: 12,
  },
  subtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: '#3D3330',
    lineHeight: 22,
    marginBottom: 32,
  },
  inputContainer: {
    marginBottom: 16,
  },
  emailInput: {
    height: 52,
    backgroundColor: '#F0EBE5',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: 'DMSans_400Regular',
    color: '#1A1210',
  },
  errorText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#C0392B',
    textAlign: 'center',
    marginBottom: 16,
  },
  sendButton: {
    height: 52,
    backgroundColor: '#B87063',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  sendButtonDisabled: {
    backgroundColor: '#CFC6BF',
  },
  sendButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  sendButtonTextDisabled: {
    color: '#4A3C38',
  },
  // Success state
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    shadowColor: '#2E7D52',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  successTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 28,
    color: '#1A1210',
    marginBottom: 12,
  },
  successSubtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: '#3D3330',
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
    marginBottom: 40,
  },
  emailHighlight: {
    fontFamily: 'DMSans_500Medium',
    color: '#1A1210',
  },
  backToLoginButton: {
    height: 52,
    paddingHorizontal: 48,
    backgroundColor: '#B87063',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backToLoginText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
