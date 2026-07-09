// "Invite a creator" sheet — surfaced from the Closet tab and the More
// (Settings/Profile) tab. Calls `ensure_referral_code` on open, displays the
// creator's referral link + a share/copy affordance.
//
// Read-only on the perks copy; the bonus computation lives on the backend.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ActivityIndicator,
  Share,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { X, Copy } from 'lucide-react-native';
import useAuthStore from '@/lib/state/authStore';
import { useReferralCode } from '@/lib/queries/referral';

interface InviteCreatorSheetProps {
  visible: boolean;
  onClose: () => void;
  testIDPrefix?: string;
}

function buildReferralUrl(code: string): string {
  return `https://styledinmotion.studio/join?ref=${encodeURIComponent(code)}`;
}

function buildShareMessage(code: string, url: string): string {
  return `Join me on Styled in Motion 🖤
Looks you'll love. Shops that work. No follower minimum.

When you sign up, use my code: ${code}

${url}`;
}

export function InviteCreatorSheet({
  visible,
  onClose,
  testIDPrefix = 'invite-creator-sheet',
}: InviteCreatorSheetProps) {
  const creatorId = useAuthStore((s) => s.creatorId);
  const { data: code, isLoading, isFetching } = useReferralCode(visible ? creatorId : null);

  const [toastVisible, setToastVisible] = useState<boolean>(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // <300ms spinner gate — show nothing for the first 300ms so we don't
  // flash a spinner on a fast cache hit.
  const [showSpinner, setShowSpinner] = useState<boolean>(false);
  useEffect(() => {
    if (!visible) {
      setShowSpinner(false);
      return;
    }
    if (code) {
      setShowSpinner(false);
      return;
    }
    const t = setTimeout(() => setShowSpinner(true), 300);
    return () => clearTimeout(t);
  }, [visible, code]);

  const referralUrl = code ? buildReferralUrl(code) : '';

  const flashToast = useCallback(() => {
    setToastVisible(true);
    Animated.timing(toastOpacity, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setToastVisible(false);
      });
    }, 1500);
  }, [toastOpacity]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!referralUrl) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await Clipboard.setStringAsync(referralUrl);
      flashToast();
    } catch (e) {
      console.warn('[InviteCreatorSheet] copy failed:', e);
    }
  }, [referralUrl, flashToast]);

  const handleShare = useCallback(async () => {
    if (!referralUrl || !code) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      // The message now contains the URL inline (so SMS/Android paste the
      // code + link together). We deliberately DO NOT pass `url` separately
      // on iOS — doing so causes the native composer to append the URL a
      // second time after the message body.
      await Share.share({
        message: buildShareMessage(code, referralUrl),
        title: 'Styled in Motion',
      });
    } catch (err) {
      console.warn('[InviteCreatorSheet] share failed:', err);
    }
  }, [referralUrl, code]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID={`${testIDPrefix}-modal`}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallow taps so press-through on the card doesn't close. */}
        <Pressable style={styles.card} onPress={() => { /* swallow */ }}>
          <View style={styles.header}>
            <Text style={styles.title} testID={`${testIDPrefix}-title`}>
              Invite a creator 🖤
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              testID={`${testIDPrefix}-close`}
              style={styles.closeButton}
            >
              <X size={20} color="#1A1210" strokeWidth={2} />
            </Pressable>
          </View>

          <Text style={styles.lead}>
            When they publish 3 looks, you both unlock:
          </Text>

          <View style={styles.perksList}>
            <PerkRow
              text="A multi-Reel spotlight on @styled.in.motion (~1,500 views per Reel) + a Story takeover"
            />
            <PerkRow
              text="Priority access to paid brand partnerships as they come available"
            />
          </View>

          <Text style={styles.linkLabel}>Your referral link:</Text>

          {showSpinner && !code ? (
            <View style={styles.spinnerRow} testID={`${testIDPrefix}-loading`}>
              <ActivityIndicator size="small" color="#1A1210" />
            </View>
          ) : code ? (
            <View style={styles.linkRow}>
              <View style={styles.linkBox} testID={`${testIDPrefix}-link`}>
                <Text
                  style={styles.linkText}
                  numberOfLines={1}
                  ellipsizeMode="middle"
                >
                  {referralUrl}
                </Text>
              </View>
              <Pressable
                onPress={handleCopy}
                className="bg-white rounded-full flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
                style={styles.copyButton}
                testID={`${testIDPrefix}-copy`}
                accessibilityRole="button"
                accessibilityLabel="Copy referral link"
              >
                <Copy size={14} color="#1A1210" strokeWidth={2} />
                <Text
                  className="text-[#1A1210] text-[13px] font-semibold"
                  style={{ fontFamily: 'DMSans_500Medium', marginLeft: 6 }}
                >
                  Copy
                </Text>
              </Pressable>
            </View>
          ) : (
            // Loading-but-cache-hit window or quiet failure — keep the layout
            // height stable so the modal doesn't jump when the code lands.
            <View style={styles.spinnerRow} pointerEvents="none">
              {isLoading || isFetching ? (
                <ActivityIndicator size="small" color="#1A1210" />
              ) : null}
            </View>
          )}

          <Pressable
            onPress={handleShare}
            disabled={!code}
            className="bg-[#B87063] rounded-full py-3.5 px-5 flex-row items-center justify-center active:opacity-85"
            style={[styles.shareButton, !code ? styles.shareButtonDisabled : null]}
            testID={`${testIDPrefix}-share`}
          >
            <Text
              className="text-white text-[15px] font-semibold"
              style={{ fontFamily: 'DMSans_500Medium' }}
            >
              Share link
            </Text>
          </Pressable>

          {toastVisible ? (
            <Animated.View
              style={[styles.toast, { opacity: toastOpacity }]}
              pointerEvents="none"
              testID={`${testIDPrefix}-toast`}
            >
              <Text style={styles.toastText}>Link copied 🖤</Text>
            </Animated.View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PerkRow({ text }: { text: string }) {
  return (
    <View style={styles.perkRow}>
      <View style={styles.perkBullet} />
      <Text style={styles.perkText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: '#FAF7F3',
    borderRadius: 20,
    padding: 22,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 24,
    color: '#1A1210',
    flexShrink: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0EBE5',
  },
  lead: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#3D3330',
    lineHeight: 20,
    marginBottom: 12,
  },
  perksList: {
    marginBottom: 18,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
  },
  perkBullet: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#B87063',
    marginTop: 8,
    marginRight: 10,
  },
  perkText: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#3D3330',
    lineHeight: 20,
  },
  linkLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#6B5E58',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  spinnerRow: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  linkBox: {
    flex: 1,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
  },
  linkText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#1A1210',
  },
  copyButton: {
    height: 44,
    paddingHorizontal: 14,
  },
  shareButton: {
    shadowColor: '#1A1210',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  shareButtonDisabled: {
    opacity: 0.5,
  },
  toast: {
    position: 'absolute',
    bottom: -52,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  toastText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#FFFFFF',
    backgroundColor: '#1A1210',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    overflow: 'hidden',
  },
});

export default InviteCreatorSheet;
