import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Share,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { ChevronLeft, Camera, ImageIcon, Sparkles, RefreshCw, Bookmark, Share2, UserCircle2 } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import useAuthStore from '@/lib/state/authStore';
import useVtoGalleryStore from '@/lib/state/vtoGalleryStore';
import { uploadSelfie, requestVtoRender, saveRender, VtoError } from '@/lib/api/vto';
import { persistPickedPhoto } from '@/lib/utils/persistPickedPhoto';
import { supabase } from '@/lib/supabase';

type Stage = 'capture' | 'preview' | 'submitting' | 'result' | 'error';

interface ResultPayload {
  output_url: string;
  render_id: string;
  cached: boolean;
}

export default function TryOnScreen() {
  const params = useLocalSearchParams<{ garment_url?: string; look_id?: string }>();
  const garmentUrl = typeof params.garment_url === 'string' ? params.garment_url : '';
  const lookId = typeof params.look_id === 'string' ? params.look_id : undefined;

  const userType = useAuthStore((s) => s.userType);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const cacheSavedRender = useVtoGalleryStore((s) => s.saveRender);
  const cacheRemoveRender = useVtoGalleryStore((s) => s.removeRender);

  const [stage, setStage] = useState<Stage>('capture');
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [result, setResult] = useState<ResultPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [saved, setSaved] = useState<boolean>(false);
  const [savingError, setSavingError] = useState<string>('');

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const handleClose = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(public-tabs)/feed' as any);
  }, []);

  const handleTakePhoto = useCallback(async () => {
    Haptics.selectionAsync();
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Camera permission needed',
        'Allow camera access in Settings to take a try-on photo.',
      );
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: false,
    });
    if (!res.canceled && res.assets[0]?.uri) {
      const stableUri = await persistPickedPhoto(res.assets[0].uri);
      setSelfieUri(stableUri);
      setStage('preview');
    }
  }, []);

  const handlePickFromLibrary = useCallback(async () => {
    Haptics.selectionAsync();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Photo library access needed',
        'Allow photo library access in Settings to choose a try-on photo.',
      );
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: false,
    });
    if (!res.canceled && res.assets[0]?.uri) {
      const stableUri = await persistPickedPhoto(res.assets[0].uri);
      setSelfieUri(stableUri);
      setStage('preview');
    }
  }, []);

  const handleRetake = useCallback(() => {
    Haptics.selectionAsync();
    setSelfieUri(null);
    setStage('capture');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selfieUri || !garmentUrl) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStage('submitting');
    setErrorMessage('');
    try {
      const selfieUrl = await uploadSelfie(selfieUri);
      const r = await requestVtoRender({
        garment_url: garmentUrl,
        selfie_url: selfieUrl,
        look_id: lookId,
      });
      setResult(r);
      setSaved(false);
      setStage('result');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      const friendly =
        e instanceof VtoError && e.code === 'daily_quota_exceeded'
          ? "You've hit today's limit. Try again tomorrow."
          : e instanceof VtoError && e.code === 'photoroom_failed'
            ? "Couldn't generate this one — try a different photo."
            : e instanceof VtoError && e.code === 'unauthorized'
              ? 'Please sign in again to use try-on.'
              : 'Something went wrong. Please try again.';
      setErrorMessage(friendly);
      setStage('error');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [selfieUri, garmentUrl, lookId]);

  const handleSave = useCallback(async () => {
    if (!result) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;

    setSaved(true);
    setSavingError('');
    cacheSavedRender(userId, {
      render_id: result.render_id,
      output_url: result.output_url,
      look_id: lookId ?? null,
      created_at: new Date().toISOString(),
    });

    try {
      await saveRender(result.render_id);
    } catch (e: any) {
      setSaved(false);
      cacheRemoveRender(userId, result.render_id);
      setSavingError("Couldn't save — try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [result, cacheSavedRender, cacheRemoveRender, lookId]);

  const handleTryAnotherLook = useCallback(() => {
    Haptics.selectionAsync();
    handleClose();
  }, [handleClose]);

  const handleShareResult = useCallback(async () => {
    if (!result?.output_url) return;
    try {
      await Share.share({ url: result.output_url, message: 'Check out my try-on!' });
    } catch (e) {
      console.warn('[try-on] share error', e);
    }
  }, [result]);

  const handleRetryAfterError = useCallback(() => {
    setErrorMessage('');
    setStage(selfieUri ? 'preview' : 'capture');
  }, [selfieUri]);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#F7F4F0' }} />;
  }

  if (!isLoggedIn || (userType !== 'audience' && userType !== 'creator')) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="try-on-not-allowed">
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <Pressable onPress={handleClose} hitSlop={12} style={styles.iconButton} testID="try-on-close">
            <ChevronLeft size={24} color="#1A1210" strokeWidth={1.8} />
          </Pressable>
          <Text style={styles.headerTitle}>Try It On</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.centeredText}>Sign in as a shopper to try looks on.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="try-on-screen">
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable onPress={handleClose} hitSlop={12} style={styles.iconButton} testID="try-on-close">
          <ChevronLeft size={24} color="#1A1210" strokeWidth={1.8} />
        </Pressable>
        <Text style={styles.headerTitle}>Try It On</Text>
        <View style={styles.headerSpacer} />
      </View>

      {stage === 'capture' ? (
        <View style={styles.captureLayout} testID="try-on-capture-stage">
          <ScrollView
            contentContainerStyle={styles.captureTopContent}
            showsVerticalScrollIndicator={false}
          >
            {garmentUrl ? (
              <Image source={{ uri: garmentUrl }} style={styles.garmentPreviewSmall} contentFit="contain" />
            ) : null}

            <View style={styles.tipCard} testID="try-on-tip-card">
              <Sparkles size={18} color="#B87063" strokeWidth={1.75} />
              <Text style={styles.tipText}>
                For best results: wear fitted basics like a sports bra and bike shorts, stand against a plain wall, full body in frame, natural light.
              </Text>
            </View>
          </ScrollView>

          <View style={styles.captureBottom}>
            <View style={styles.paperDollCard} testID="try-on-paper-doll">
              <View style={styles.paperDollIconWrap}>
                <UserCircle2 size={36} color="#B87063" strokeWidth={1.5} />
              </View>
              <View style={styles.paperDollCopy}>
                <Text style={styles.paperDollTitle}>Upload a photo of yourself</Text>
                <Text style={styles.paperDollText}>
                  Stand straight, arms at your sides, feet shoulder-width — like a paper doll. We'll dress you in this look.
                </Text>
              </View>
            </View>

            <Pressable
              onPress={handleTakePhoto}
              className="bg-[#B87063] rounded-full py-4 px-6 flex-row items-center justify-center active:opacity-85"
              style={{ shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}
              testID="try-on-take-photo"
            >
              <Camera size={18} color="#FFFFFF" strokeWidth={2} />
              <Text className="ml-2 text-white text-base font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>Take Photo</Text>
            </Pressable>

            <Pressable
              onPress={handlePickFromLibrary}
              className="bg-white rounded-full py-4 px-6 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
              testID="try-on-pick-library"
            >
              <ImageIcon size={18} color="#1A1210" strokeWidth={2} />
              <Text className="ml-2 text-[#1A1210] text-base font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>Choose from Library</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {stage === 'preview' && selfieUri ? (
        <ScrollView contentContainerStyle={styles.content} testID="try-on-preview-stage">
          <Image source={{ uri: selfieUri }} style={styles.selfiePreview} contentFit="cover" />

          <Pressable
            onPress={handleSubmit}
            className="bg-[#B87063] rounded-full py-4 px-6 flex-row items-center justify-center active:opacity-85"
            style={{ shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}
            testID="try-on-submit"
          >
            <Sparkles size={18} color="#FFFFFF" strokeWidth={2} />
            <Text className="ml-2 text-white text-base font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>Try It On</Text>
          </Pressable>

          <Pressable
            onPress={handleRetake}
            className="bg-white rounded-full py-4 px-6 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
            testID="try-on-retake"
          >
            <RefreshCw size={18} color="#1A1210" strokeWidth={2} />
            <Text className="ml-2 text-[#1A1210] text-base font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>Retake</Text>
          </Pressable>
        </ScrollView>
      ) : null}

      {stage === 'submitting' ? (
        <View style={styles.centered} testID="try-on-loading">
          <ActivityIndicator size="large" color="#B87063" />
          <Text style={styles.loadingText}>Generating your try-on…</Text>
          <Text style={styles.loadingSubText}>This usually takes 10–20 seconds.</Text>
        </View>
      ) : null}

      {stage === 'result' && result ? (
        <ScrollView contentContainerStyle={styles.resultContent} testID="try-on-result-stage">
          <Image source={{ uri: result.output_url }} style={styles.resultImage} contentFit="cover" />

          <View style={styles.resultActions}>
            <Pressable
              onPress={handleSave}
              disabled={saved}
              className={
                saved
                  ? "bg-[#6B5E58] rounded-full py-4 px-6 flex-row items-center justify-center"
                  : "bg-[#B87063] rounded-full py-4 px-6 flex-row items-center justify-center active:opacity-85"
              }
              style={!saved ? { shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 } : undefined}
              testID="try-on-save"
            >
              <Bookmark size={18} color="#FFFFFF" strokeWidth={2} fill={saved ? '#FFFFFF' : 'none'} />
              <Text className="ml-2 text-white text-base font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>
                {saved ? 'Saved to Gallery' : 'Save to Gallery'}
              </Text>
            </Pressable>

            {savingError ? (
              <Text className="text-[#B53D2A] text-[13px] text-center" style={{ fontFamily: 'DMSans_400Regular' }} testID="try-on-save-error">{savingError}</Text>
            ) : null}

            <Pressable
              onPress={handleTryAnotherLook}
              className="bg-white rounded-full py-4 px-6 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
              testID="try-on-try-another"
            >
              <Sparkles size={18} color="#1A1210" strokeWidth={2} />
              <Text className="ml-2 text-[#1A1210] text-base font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>Try Another Look</Text>
            </Pressable>

            <Pressable
              onPress={handleShareResult}
              className="flex-row items-center justify-center gap-1.5 py-3 px-3 active:opacity-70"
              testID="try-on-share"
            >
              <Share2 size={16} color="#6B5E58" strokeWidth={2} />
              <Text className="text-[#6B5E58] text-sm font-medium ml-1.5" style={{ fontFamily: 'DMSans_500Medium' }}>Share</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : null}

      {stage === 'error' ? (
        <View style={styles.centered} testID="try-on-error">
          <Text style={styles.errorTitle}>{errorMessage}</Text>
          <Pressable
            onPress={handleRetryAfterError}
            className="bg-[#B87063] rounded-full py-4 px-6 flex-row items-center justify-center active:opacity-85"
            style={{ shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}
            testID="try-on-retry"
          >
            <Text className="text-white text-base font-semibold" style={{ fontFamily: 'DMSans_500Medium' }}>Try Again</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F4F0' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE6DF',
  },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  headerSpacer: { width: 40 },
  headerTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
    flex: 1,
    textAlign: 'center',
  },
  content: { padding: 20, paddingBottom: 32, gap: 14 },
  resultContent: { padding: 16, paddingBottom: 32, gap: 16 },
  garmentPreview: {
    width: '100%',
    aspectRatio: 0.75,
    borderRadius: 16,
    backgroundColor: '#EDE6DF',
  },
  selfiePreview: {
    width: '100%',
    aspectRatio: 0.75,
    borderRadius: 16,
    backgroundColor: '#EDE6DF',
  },
  resultImage: {
    width: '100%',
    aspectRatio: 0.75,
    borderRadius: 18,
    backgroundColor: '#1A1210',
  },
  resultActions: { gap: 12 },
  tipCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#FBF6EF',
    borderColor: '#E8DAC8',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'flex-start',
  },
  tipText: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: '#5A4F49',
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  centeredText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: '#5A4F49',
    textAlign: 'center',
  },
  loadingText: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
    marginTop: 16,
  },
  loadingSubText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
  },
  errorTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#1A1210',
    textAlign: 'center',
    marginBottom: 8,
  },
  captureLayout: { flex: 1 },
  captureTopContent: { padding: 20, paddingBottom: 16, gap: 14 },
  garmentPreviewSmall: {
    width: '60%',
    aspectRatio: 0.75,
    alignSelf: 'center',
    borderRadius: 16,
    backgroundColor: '#EDE6DF',
  },
  captureBottom: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 12,
    backgroundColor: '#FBF6EF',
    borderTopWidth: 1,
    borderTopColor: '#EDE6DF',
  },
  paperDollCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EDE6DF',
    marginBottom: 4,
  },
  paperDollIconWrap: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FBF6EF',
    borderRadius: 28,
  },
  paperDollCopy: { flex: 1 },
  paperDollTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 16,
    color: '#1A1210',
    marginBottom: 2,
  },
  paperDollText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5A4F49',
  },
});
