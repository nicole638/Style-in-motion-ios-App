// Sign-up nudge — shown when a not-signed-in viewer taps Follow (or any
// account-gated action). The main guest path is a shared /look/<id> deep
// link opened from Instagram without an account: the deep-link entry skips
// the auth redirect, so a guest can reach a look + tap Follow.
//
// Reusable: pass a `context` line ("to follow Kerri", "to save looks", etc.)
// and the CTA routes to the public shopper signup.

import React from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Heart } from 'lucide-react-native';
import { router } from 'expo-router';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';

interface SignUpNudgeSheetProps {
  visible: boolean;
  onDismiss: () => void;
  // Trailing context for the headline, e.g. "to follow Kerri Daly".
  // Defaults to a generic message.
  context?: string;
}

export default function SignUpNudgeSheet({
  visible,
  onDismiss,
  context = 'to follow creators',
}: SignUpNudgeSheetProps) {
  const insets = useSafeAreaInsets();
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });
  if (!fontsLoaded) return null;

  const handleSignUp = () => {
    onDismiss();
    // Defer so the sheet's exit animation gets a frame before navigation.
    requestAnimationFrame(() => {
      router.push('/public-signup' as never);
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
      testID="signup-nudge-sheet"
    >
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onDismiss} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <Pressable style={styles.closeButton} onPress={onDismiss} testID="signup-nudge-close">
            <X size={20} color="#6B5E58" />
          </Pressable>

          <View style={styles.iconCircle}>
            <Heart size={24} color="#B87063" fill="#B87063" />
          </View>

          <Text style={styles.title}>Create a free account {context}.</Text>
          <Text style={styles.subtitle}>
            Save your follows, build a feed of looks you love, and pick up
            where you left off on any device.
          </Text>

          <Pressable style={styles.primaryButton} onPress={handleSignUp} testID="signup-nudge-cta">
            <Text style={styles.primaryButtonText}>Sign up — it&apos;s free</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={onDismiss} testID="signup-nudge-later">
            <Text style={styles.secondaryButtonText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#F0EBE5',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 24,
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(107,94,88,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FBF4EE',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 14,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 24,
    color: '#1A1210',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 22,
    paddingHorizontal: 8,
  },
  primaryButton: {
    alignSelf: 'stretch',
    backgroundColor: '#1A1210',
    borderRadius: 999,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#FFFFFF',
  },
  secondaryButton: {
    alignSelf: 'stretch',
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  secondaryButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#6B5E58',
  },
});
