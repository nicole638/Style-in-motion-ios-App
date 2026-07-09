// Phase 2 of the TikTok Share Kit.
//
// After the OpenSDK confirms a successful share, we surface this modal:
//   - Title: "Posted to TikTok!"
//   - Body: caption+link is already on the clipboard; paste into the caption,
//     and also drop the link in the bio (the only tappable surface on TikTok —
//     captions don't render clickable external URLs).
//   - Primary CTA jumps the creator straight back into TikTok.
//
// Lives in /components rather than inline because all three share entry
// points (create.tsx, shop.tsx, ItemListSheet.tsx) need to render it.
//
// Match the existing toast aesthetic (terracotta accent, soft beige card)
// rather than spawning a system Alert — Alerts are forbidden by Rule UX.

import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Linking } from 'react-native';

interface TikTokPostShareNudgeProps {
  visible: boolean;
  shopUrl: string | null;
  onDismiss: () => void;
}

export function TikTokPostShareNudge({ visible, shopUrl, onDismiss }: TikTokPostShareNudgeProps) {
  const handleOpenTikTok = () => {
    Linking.openURL('tiktok://').catch(() => {});
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      testID="tiktok-post-share-nudge"
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Posted to TikTok!</Text>
          <Text style={styles.body}>
            Caption + link copied — paste it into your TikTok caption.
          </Text>
          <Text style={styles.body}>
            TikTok captions aren&apos;t tappable, so also drop this link in your bio to
            make it clickable. That&apos;s how shoppers find your closet.
          </Text>
          {shopUrl ? (
            <View style={styles.urlPill}>
              <Text style={styles.urlText} numberOfLines={1}>{shopUrl}</Text>
            </View>
          ) : null}
          <Pressable
            onPress={handleOpenTikTok}
            testID="tiktok-post-share-nudge-open"
          >
            {({ pressed }) => (
              <View style={[styles.primaryBtn, pressed && styles.pressed]}>
                <Text style={styles.primaryBtnText}>Open TikTok</Text>
              </View>
            )}
          </Pressable>
          <Pressable
            onPress={onDismiss}
            testID="tiktok-post-share-nudge-dismiss"
          >
            {({ pressed }) => (
              <View style={[styles.secondaryBtn, pressed && styles.pressed]}>
                <Text style={styles.secondaryBtnText}>Got it</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26, 18, 16, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 24,
    gap: 12,
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  title: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 26,
    color: '#1A1210',
  },
  body: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: '#3D2E29',
  },
  urlPill: {
    backgroundColor: '#F5F0EB',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  urlText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
  },
  primaryBtn: {
    width: '100%',
    height: 48,
    backgroundColor: '#1A1210',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryBtnText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#FFFFFF',
  },
  secondaryBtn: {
    width: '100%',
    height: 44,
    backgroundColor: 'transparent',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#6B5E58',
  },
  pressed: {
    opacity: 0.85,
  },
});
