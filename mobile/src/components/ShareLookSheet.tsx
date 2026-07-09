import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  Alert,
  Linking,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as MediaLibrary from 'expo-media-library';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { ShareActionsBlock } from '@/components/ShareActionsBlock';
import { TikTokPostShareNudge } from '@/components/TikTokPostShareNudge';
import type { Look } from '@/lib/state/lookStore';
import {
  buildShareText,
  savePhotosToAlbum,
  shareLook,
  buildLookShareUrl,
} from '@/lib/utils/shareLook';
import { shareToTikTok } from '@/lib/utils/shareToTikTok';
import { router } from 'expo-router';

async function savePhotoToLibrary(uri: string): Promise<boolean> {
  try {
    await MediaLibrary.saveToLibraryAsync(uri);
    return true;
  } catch {
    return false;
  }
}

interface ShareLookSheetProps {
  look: Look | null;
  visible: boolean;
  onClose: () => void;
  testIDPrefix?: string;
}

export function ShareLookSheet({
  look,
  visible,
  onClose,
  testIDPrefix = 'share-look-sheet',
}: ShareLookSheetProps) {
  const [savedPhotosCount, setSavedPhotosCount] = useState<number | null>(null);
  const [storyShareMessage, setStoryShareMessage] = useState<string | null>(null);
  const [tikTokNudgeUrl, setTikTokNudgeUrl] = useState<string | null>(null);

  const translateY = useSharedValue(0);
  const dismissSheet = useCallback(() => {
    setSavedPhotosCount(null);
    setStoryShareMessage(null);
    onClose();
  }, [onClose]);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > 100 || e.velocityY > 800) {
        runOnJS(dismissSheet)();
      }
      translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
    });

  const sheetAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const handleShareLook = useCallback(async () => {
    if (!look) return;
    await shareLook({
      id: look.id,
      caption: look.caption,
      items: look.items,
      hashtags: look.hashtags,
    });
  }, [look]);

  const handleSaveAllPhotos = useCallback(async () => {
    if (!look) return;
    const { status } = await MediaLibrary.requestPermissionsAsync(true);
    if (status !== 'granted') return;
    let count = 0;
    if (look.photoUri && await savePhotoToLibrary(look.photoUri)) count++;
    for (const item of look.items) {
      if (item.photoUri && await savePhotoToLibrary(item.photoUri)) count++;
    }
    setSavedPhotosCount(count);
  }, [look]);

  const handleShareToStory = useCallback(async () => {
    if (!look) return;
    const shareUrl = buildLookShareUrl(look.id);
    if (!shareUrl) return;
    try { await Clipboard.setStringAsync(shareUrl); } catch {}
    let photoSaved = true;
    try { await savePhotosToAlbum({ coverPhotoUri: look.photoUri, items: [] }); } catch { photoSaved = false; }
    setStoryShareMessage(
      photoSaved
        ? "Link copied! In Instagram: tap + \u2192 Story \u2192 pick this look's cover photo \u2192 add a Link sticker \u2192 paste."
        : "Link copied, but we couldn't save the cover photo. You can still open Instagram and share manually."
    );
    setTimeout(() => setStoryShareMessage(null), 5000);
    Linking.openURL('instagram://app').catch(() => {
      setStoryShareMessage('Instagram not installed. Cover photo saved to your Photos app, link copied \u2014 share manually.');
      setTimeout(() => setStoryShareMessage(null), 5000);
    });
  }, [look]);

  const handleShareInstagram = useCallback(async () => {
    if (!look) return;
    const shareText = buildShareText({
      caption: look.caption || '',
      items: look.items,
      hashtags: look.hashtags,
    });
    await Clipboard.setStringAsync(shareText);
    let photoCount = 0;
    try {
      photoCount = await savePhotosToAlbum({ coverPhotoUri: look.photoUri, items: look.items });
    } catch {}
    const message = photoCount > 0
      ? `${photoCount} photo${photoCount !== 1 ? 's' : ''} saved to your Styled in Motion album. Caption copied!\n\nIn Instagram, tap + and select your photos for a carousel post.`
      : 'Caption copied to clipboard! Paste it into your Instagram post.';
    Linking.openURL('instagram://app').catch(() => {});
    setTimeout(() => {
      Alert.alert('Caption Copied!', message, [{ text: 'Got it' }]);
    }, 500);
  }, [look]);

  const handleShareTikTok = useCallback(async () => {
    if (!look) return;
    if (!look.photoUri) {
      Alert.alert('Add a cover photo first', 'TikTok needs a cover image to share.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const outcome = await shareToTikTok({
      id: look.id,
      title: look.title || look.caption || 'New look',
      caption: look.caption,
      shortCode: look.shortCode ?? null,
      hashtags: look.hashtags,
      photoUri: look.photoUri,
    });
    if (outcome.stage === 'shared' || outcome.stage === 'cancelled') {
      setTikTokNudgeUrl(outcome.clipboardUrl);
    } else if (outcome.stage === 'sdk-unavailable') {
      Linking.openURL('tiktok://').catch(() => {});
    } else if (outcome.stage === 'missing-photo') {
      Alert.alert('Add a cover photo first', 'TikTok needs a cover image to share.');
    } else if (outcome.stage === 'error') {
      Alert.alert('TikTok share failed', outcome.message || 'Please try again.');
    }
  }, [look]);

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={dismissSheet}
        testID={testIDPrefix}
      >
        <View style={styles.backdrop}>
          <Pressable style={styles.backdropTouch} onPress={dismissSheet} />
          <Animated.View style={[styles.sheet, sheetAnimStyle]}>
            <GestureDetector gesture={panGesture}>
              <Animated.View>
                <View style={styles.dragHandle} />
              </Animated.View>
            </GestureDetector>

            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.heading}>Share This Look</Text>

              <ShareActionsBlock
                onShareLook={handleShareLook}
                onSaveAllPhotos={handleSaveAllPhotos}
                onShareToStory={handleShareToStory}
                onShareInstagram={handleShareInstagram}
                onShareTikTok={handleShareTikTok}
                pinToPinterest={
                  look
                    ? {
                        lookId: look.id,
                        hasCoverPhoto: !!look.photoUri,
                        coverPhotoUrl: look.photoUri,
                        caption: look.caption,
                        title: look.title,
                        hashtags: look.hashtags,
                      }
                    : undefined
                }
                savedPhotosCount={savedPhotosCount}
                storyShareMessage={storyShareMessage}
                testIDPrefix={testIDPrefix}
                variant="list"
              />
            </ScrollView>

            <Pressable
              style={styles.closeButton}
              onPress={dismissSheet}
              testID={`${testIDPrefix}-close`}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>

      <TikTokPostShareNudge
        visible={tikTokNudgeUrl !== null}
        shopUrl={tikTokNudgeUrl}
        onDismiss={() => setTikTokNudgeUrl(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  backdropTouch: { flex: 1 },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E8E0D8',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  heading: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
    marginBottom: 16,
    textAlign: 'center',
  },
  closeButton: {
    width: '100%',
    height: 52,
    backgroundColor: '#F7F4F0',
    borderTopWidth: 0.5,
    borderTopColor: '#E8E0D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#1A1210',
  },
});
