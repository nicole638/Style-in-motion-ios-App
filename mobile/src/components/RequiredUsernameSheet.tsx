import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
} from 'react-native';
import { useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import useProfileStore from '@/lib/state/profileStore';
import UsernameField from './UsernameField';

interface Props {
  visible: boolean;
  onSaved: () => void;
}

export default function RequiredUsernameSheet({ visible, onSaved }: Props) {
  const setUsername = useProfileStore((s) => s.setUsername);
  const [valid, setValid] = useState<boolean>(false);
  const [normalized, setNormalized] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Block Android hardware back so user cannot dismiss without saving.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [visible]);

  const handleSave = async () => {
    if (!valid || !normalized || saving) return;
    setSaving(true);
    setError(null);
    try {
      await setUsername(normalized);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
    } catch (e: any) {
      if (e?.message === 'USERNAME_TAKEN') {
        setError('That just got taken — try another');
      } else {
        setError("Couldn't save. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => {}}
      statusBarTranslucent
      testID="required-username-sheet"
    >
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kbWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.title}>One more thing</Text>
            <Text style={styles.subtitle}>
              Pick a username so your audience can find your profile. This is required to keep publishing.
            </Text>

            <View style={styles.fieldWrap}>
              <UsernameField
                initialValue=""
                onValidityChange={(isValid, norm) => {
                  setValid(isValid);
                  setNormalized(norm);
                  setError(null);
                }}
                autoFocus
              />
              {error ? (
                <Text style={styles.error} testID="required-username-error">{error}</Text>
              ) : null}
            </View>

            <Pressable
              style={[styles.cta, (!valid || saving) && styles.ctaDisabled]}
              onPress={handleSave}
              disabled={!valid || saving}
              testID="required-username-save"
            >
              <Text style={styles.ctaText}>{saving ? 'Saving…' : 'Save Username'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26, 18, 16, 0.55)',
    justifyContent: 'flex-end',
  },
  kbWrap: {
    width: '100%',
  },
  sheet: {
    backgroundColor: '#F7F4F0',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D6CDC4',
    marginBottom: 16,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 28,
    color: '#1A1210',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    lineHeight: 20,
    marginBottom: 20,
  },
  fieldWrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  error: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#B87063',
    textAlign: 'center',
    marginTop: 8,
  },
  cta: {
    height: 52,
    backgroundColor: '#1A1210',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: {
    backgroundColor: '#CFC6BF',
  },
  ctaText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 17,
    color: '#F7F4F0',
  },
});
