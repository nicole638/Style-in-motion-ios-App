import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  ActivityIndicator,
} from 'react-native';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  error?: string | null;
  testID?: string;
}

/**
 * Reusable two-button confirmation dialog in the SiM voice. Used to guard
 * deliberate account-mode switches (shopper → creator and creator → shopper)
 * so a single accidental tap can never flip an account — the action only runs
 * from the explicit confirm button here.
 */
export default function ConfirmModal({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  loading = false,
  error = null,
  testID = 'confirm-modal',
}: ConfirmModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!loading) onCancel();
      }}
      testID={testID}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          {error ? (
            <Text style={styles.error} testID={`${testID}-error`}>
              {error}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              className="flex-1 bg-white rounded-full py-3.5 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
              onPress={onCancel}
              disabled={loading}
              testID={`${testID}-cancel`}
            >
              <Text
                className="text-[#1A1210] text-[15px]"
                style={{ fontFamily: 'DMSans_500Medium' }}
              >
                {cancelLabel}
              </Text>
            </Pressable>
            <Pressable
              className="flex-1 bg-[#B87063] rounded-full py-3.5 flex-row items-center justify-center active:opacity-85"
              style={{ opacity: loading ? 0.6 : 1 }}
              onPress={onConfirm}
              disabled={loading}
              testID={`${testID}-confirm`}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text
                  className="text-white text-[15px]"
                  style={{ fontFamily: 'DMSans_500Medium' }}
                >
                  {confirmLabel}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    width: '100%',
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },
  error: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#C0392B',
    textAlign: 'center',
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
});
