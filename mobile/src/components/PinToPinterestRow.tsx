import React, { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { shareToPinterest } from '@/lib/utils/shareToPinterest';

interface PinToPinterestRowProps {
  // The look the creator is pinning. We need the cover photo (the pin media),
  // the id (the pin's destination = shop look page), and caption/title/hashtags
  // (the description). hasCoverPhoto lets us short-circuit when there's nothing
  // to pin.
  lookId: string;
  hasCoverPhoto: boolean;
  coverPhotoUrl?: string | null;
  caption?: string | null;
  title?: string | null;
  hashtags?: string[] | null;
  // Kept for API-path compatibility (the future pinterest-create-pin flow once
  // Pinterest grants Standard access). UNUSED by the share-intent path — the
  // public create-pin screen uses the creator's own Pinterest session, so no
  // SiM connection is ever required. Parents may still pass it.
  onConnectPinterest?: () => void;
  testIDPrefix?: string;
}

// One row of the "Share This Look" list. Opens Pinterest's PUBLIC create-pin
// share-intent (creator's own logged-in Pinterest) rather than the API-backed
// pinterest-create-pin Edge Function — the API app is on Pinterest Trial access
// and 403s pin creation in production, while the share-intent works for every
// creator today, connected or not. See shareToPinterest.ts.

type Phase = 'idle' | 'opening' | 'no_cover' | 'error';

export default function PinToPinterestRow({
  lookId,
  hasCoverPhoto,
  coverPhotoUrl,
  caption,
  title,
  hashtags,
  testIDPrefix = 'pin-to-pinterest',
}: PinToPinterestRowProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const busy = useRef<boolean>(false);

  const openPinterest = useCallback(async () => {
    if (busy.current) return;

    // No cover image means nothing to pin.
    if (!hasCoverPhoto || !coverPhotoUrl) {
      setPhase('no_cover');
      return;
    }

    busy.current = true;
    setPhase('opening');
    try {
      const outcome = await shareToPinterest({
        id: lookId,
        photoUri: coverPhotoUrl,
        caption: caption ?? null,
        title: title ?? null,
        hashtags: hashtags ?? null,
      });
      if (outcome.stage === 'missing-photo') {
        setPhase('no_cover');
      } else if (outcome.stage === 'error') {
        console.warn('[PinToPinterestRow] share-intent error:', outcome.message);
        setPhase('error');
      } else {
        // Handed off to Pinterest — reset so the row is ready for next time.
        setPhase('idle');
      }
    } catch (e) {
      console.warn('[PinToPinterestRow] share-intent threw:', e);
      setPhase('error');
    } finally {
      busy.current = false;
    }
  }, [hasCoverPhoto, coverPhotoUrl, lookId, caption, title, hashtags]);

  const handlePress = useCallback(() => {
    if (phase === 'opening') return;
    void openPinterest();
  }, [phase, openPinterest]);

  // Per-phase copy + styling.
  let label = 'Pin to Pinterest';
  let subtitle = 'Opens Pinterest with your look ready to save';
  let subtitleColor = '#6B5E58';
  let right: React.ReactNode = null;

  switch (phase) {
    case 'opening':
      subtitle = 'Opening Pinterest…';
      right = <ActivityIndicator size="small" color="#E60023" testID={`${testIDPrefix}-loading`} />;
      break;
    case 'no_cover':
      subtitle = 'This look needs a cover image before it can be pinned';
      subtitleColor = '#B87063';
      break;
    case 'error':
      subtitle = "Couldn't open Pinterest — tap to try again";
      subtitleColor = '#B87063';
      right = <Text style={[styles.action, { color: '#B87063' }]}>Retry</Text>;
      break;
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={phase === 'opening'}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`${testIDPrefix}-row`}
    >
      <View style={styles.rowInner}>
        <Ionicons name="logo-pinterest" size={18} color="#E60023" />
        <View style={styles.textCol}>
          <Text style={[styles.label, { color: '#1A1210' }]} numberOfLines={1}>
            {label}
          </Text>
          <Text style={[styles.subtitle, { color: subtitleColor }]}>{subtitle}</Text>
        </View>
        {right}
      </View>
    </Pressable>
  );
}

// Mirrors ShareActionsBlock's listStyles so the row is visually identical to
// the other share rows in the sheet.
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    minHeight: 56,
    backgroundColor: '#FFFFFF',
  },
  rowPressed: {
    backgroundColor: '#F7F4F0',
  },
  rowInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  textCol: {
    flex: 1,
  },
  label: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    marginLeft: 12,
  },
  subtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    marginTop: 2,
    marginLeft: 12,
  },
  action: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    marginLeft: 12,
  },
});
