import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { ChevronLeft } from 'lucide-react-native';
import useAuthStore from '@/lib/state/authStore';
import ConfirmModal from '@/components/ConfirmModal';

export default function AccountSettingsScreen() {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Creator → shopper revert (guarded). Only creators see this option.
  const userType = useAuthStore((s) => s.userType);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);

  const handleConfirmRevert = async () => {
    if (isReverting) return;
    setIsReverting(true);
    setRevertError(null);
    const result = await useAuthStore.getState().revertToShopper();
    if (result.success) {
      setShowRevertModal(false);
      setIsReverting(false);
      // Route into the shopper shell (audience tabs).
      router.replace('/(public-tabs)/feed' as any);
    } else {
      setRevertError(result.error ?? 'Something went wrong. Please try again.');
      setIsReverting(false);
    }
  };

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  if (!fontsLoaded) return null;

  return (
    <SafeAreaView style={styles.container} testID="account-settings-screen">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          testID="account-settings-back"
        >
          <ChevronLeft size={24} color="#1A1210" />
        </Pressable>
        <Text style={styles.headerTitle}>Account Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        {userType === 'creator' ? (
          <View style={styles.accountModeSection} testID="account-mode-section">
            <Text style={styles.accountModeLabel}>Account Mode</Text>
            <Text style={styles.accountModeDescription}>
              You're in creator mode. Switch back to shopper anytime — your closet
              stays yours.
            </Text>
            <Pressable
              testID="switch-to-shopper-button"
              onPress={() => {
                setRevertError(null);
                setShowRevertModal(true);
              }}
              style={styles.switchShopperButton}
            >
              <Text style={styles.switchShopperText}>Switch back to shopper mode</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.dangerSection}>
          <Text style={styles.dangerLabel}>Danger Zone</Text>
          <Text style={styles.dangerDescription}>
            Deleting your account is permanent and cannot be reversed.
          </Text>
          <Pressable
            testID="delete-account-button"
            onPress={() => setShowDeleteModal(true)}
            style={styles.deleteAccountButton}
          >
            <Text style={styles.deleteAccountText}>Delete Account</Text>
          </Pressable>
        </View>
      </View>

      {/* Delete Account Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isDeleting) {
            setShowDeleteModal(false);
            setDeleteError(null);
          }
        }}
        testID="delete-account-modal"
      >
        <View style={styles.deleteModalBackdrop}>
          <View style={styles.deleteModalCard}>
            <Text style={styles.deleteModalTitle}>Delete your account?</Text>
            <Text style={styles.deleteModalBody}>
              This permanently removes your closet, looks, and earnings history. This can't be undone.
            </Text>
            {deleteError ? (
              <Text style={styles.deleteModalError} testID="delete-error-text">{deleteError}</Text>
            ) : null}
            <View style={styles.deleteModalActions}>
              <Pressable
                style={styles.deleteModalCancelBtn}
                onPress={() => {
                  setShowDeleteModal(false);
                  setDeleteError(null);
                }}
                disabled={isDeleting}
                testID="delete-cancel-button"
              >
                <Text style={styles.deleteModalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.deleteModalConfirmBtn, isDeleting && { opacity: 0.6 }]}
                onPress={async () => {
                  setIsDeleting(true);
                  setDeleteError(null);
                  const result = await useAuthStore.getState().deleteAccount();
                  if (result.success) {
                    router.replace('/');
                  } else {
                    setDeleteError(result.error ?? 'Something went wrong. Please try again.');
                    setIsDeleting(false);
                  }
                }}
                disabled={isDeleting}
                testID="delete-confirm-button"
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" testID="delete-loading-indicator" />
                ) : (
                  <Text style={styles.deleteModalConfirmText}>Delete account</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Creator → shopper revert confirmation (guarded). */}
      <ConfirmModal
        visible={showRevertModal}
        title="Switch to shopper mode?"
        body={
          'Your closet stays private and your published looks will be hidden from discovery. You can become a creator again anytime.'
        }
        confirmLabel="Switch to shopper"
        cancelLabel="Cancel"
        onConfirm={handleConfirmRevert}
        onCancel={() => setShowRevertModal(false)}
        loading={isReverting}
        error={revertError}
        testID="switch-to-shopper-modal"
      />
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
  headerTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: '#1A1210',
    textAlign: 'center',
    flex: 1,
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 32,
  },
  accountModeSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#EDE6DF',
    marginBottom: 20,
  },
  accountModeLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#B87063',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  accountModeDescription: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    lineHeight: 20,
    marginBottom: 20,
  },
  switchShopperButton: {
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#1A1210',
  },
  switchShopperText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#1A1210',
  },
  dangerSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#F0D6D2',
  },
  dangerLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#C0392B',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  dangerDescription: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    lineHeight: 20,
    marginBottom: 20,
  },
  deleteAccountButton: {
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#C0392B',
  },
  deleteAccountText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#C0392B',
  },
  deleteModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  deleteModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    width: '100%',
  },
  deleteModalTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 18,
    color: '#C0392B',
    textAlign: 'center',
    marginBottom: 12,
  },
  deleteModalBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  deleteModalError: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#C0392B',
    textAlign: 'center',
    marginBottom: 16,
  },
  deleteModalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  deleteModalCancelBtn: {
    flex: 1,
    height: 48,
    backgroundColor: '#F0EBE5',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteModalCancelText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#1A1210',
  },
  deleteModalConfirmBtn: {
    flex: 1,
    height: 48,
    backgroundColor: '#C0392B',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteModalConfirmText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#FFFFFF',
  },
});
