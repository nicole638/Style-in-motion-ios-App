import React from 'react';
import { View, Text, Pressable, Modal, StyleSheet, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import useProfileStore, { SocialHandle } from '@/lib/state/profileStore';

interface FollowPromptSheetProps {
  visible: boolean;
  creatorId: string;
  onDismiss: () => void;
}

export default function FollowPromptSheet({ visible, creatorId, onDismiss }: FollowPromptSheetProps) {
  const insets = useSafeAreaInsets();
  const profile = useProfileStore((s) => s.profiles[creatorId]);
  const creatorName = profile?.username || 'Creator';
  const socials = (profile?.socials ?? []).filter((s: SocialHandle) => s.handle && s.enabled);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  if (!fontsLoaded) return null;

  const handleOpenSocial = (social: SocialHandle) => {
    const url = `${social.urlPrefix}${social.handle}`;
    Linking.openURL(url).catch(() => {});
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
      testID="follow-prompt-sheet"
    >
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onDismiss} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <Pressable style={styles.closeButton} onPress={onDismiss} testID="follow-prompt-close">
            <X size={20} color="#6B5E58" />
          </Pressable>

          <Text style={styles.title}>You're now following{'\n'}{creatorName}!</Text>
          <Text style={styles.subtitle}>Follow them everywhere</Text>

          {socials.length > 0 ? (
            <View style={styles.socialsContainer}>
              {socials.map((social) => (
                <Pressable
                  key={social.platform}
                  style={styles.socialButton}
                  onPress={() => handleOpenSocial(social)}
                  testID={`follow-prompt-${social.platform.toLowerCase()}`}
                >
                  <Ionicons name={social.icon as any} size={20} color="#B87063" />
                  <Text style={styles.socialButtonText}>Follow on {social.platform}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#F0EBE5',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 20,
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
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 24,
    color: '#1A1210',
    textAlign: 'center',
    marginTop: 8,
  },
  subtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    marginTop: 8,
    marginBottom: 20,
  },
  socialsContainer: {
    width: '100%',
    gap: 10,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    height: 50,
    shadowColor: '#1A1210',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  socialButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#3D3330',
  },
});
