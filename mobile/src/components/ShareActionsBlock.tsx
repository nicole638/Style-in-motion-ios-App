import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Share2, Download, Camera } from 'lucide-react-native';
import PinToPinterestRow from '@/components/PinToPinterestRow';

// When provided, the list variant shows the "Pin to Pinterest" row, which
// opens Pinterest's public create-pin share-intent (the creator's own logged-in
// Pinterest — no SiM API call, works regardless of connection state).
interface PinToPinterestConfig {
  lookId: string;
  hasCoverPhoto: boolean;
  coverPhotoUrl?: string | null;
  caption?: string | null;
  title?: string | null;
  hashtags?: string[] | null;
  // Optional/unused on the share-intent path; kept for the future API path.
  onConnectPinterest?: () => void;
}

interface ShareActionsBlockProps {
  onShareLook: () => void;
  onSaveAllPhotos: () => void;
  onShareToStory: () => void;
  onShareInstagram: () => void;
  onShareTikTok: () => void;
  onShareToPinterest?: () => void;
  pinToPinterest?: PinToPinterestConfig;
  savedPhotosCount: number | null;
  storyShareMessage: string | null;
  testIDPrefix?: string;
  variant?: 'pills' | 'list';
}

export function ShareActionsBlock({
  onShareLook,
  onSaveAllPhotos,
  onShareToStory,
  onShareInstagram,
  onShareTikTok,
  onShareToPinterest,
  pinToPinterest,
  savedPhotosCount,
  storyShareMessage,
  testIDPrefix = 'share',
  variant = 'pills',
}: ShareActionsBlockProps) {
  if (variant === 'list') {
    return (
      <View style={listStyles.container}>
        <Pressable
          onPress={onShareLook}
          testID={`${testIDPrefix}-share-look`}
          style={({ pressed }) => [listStyles.row, pressed && listStyles.rowPressed]}
        >
          <View style={listStyles.rowInner}>
            <Share2 size={18} color="#1A1210" strokeWidth={1.75} />
            <Text style={listStyles.label}>Share Look</Text>
          </View>
        </Pressable>

        <View style={listStyles.divider} />

        <Pressable
          onPress={onSaveAllPhotos}
          testID={`${testIDPrefix}-save-all-photos`}
          style={({ pressed }) => [listStyles.row, pressed && listStyles.rowPressed]}
        >
          <View style={listStyles.rowInner}>
            <Download size={18} color="#1A1210" strokeWidth={1.75} />
            <View style={listStyles.textCol}>
              <Text style={listStyles.label}>
                {savedPhotosCount !== null ? `Saved ${savedPhotosCount} photos!` : 'Save All Photos'}
              </Text>
              <Text style={listStyles.subtitle}>Save first, then select multiple photos</Text>
            </View>
          </View>
        </Pressable>

        <View style={listStyles.divider} />

        {storyShareMessage ? (
          <View style={pillStyles.storyBanner} testID={`${testIDPrefix}-story-banner`}>
            <Text style={pillStyles.storyBannerText}>{storyShareMessage}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={onShareToStory}
          testID={`${testIDPrefix}-share-story`}
          style={({ pressed }) => [listStyles.row, pressed && listStyles.rowPressed]}
        >
          <View style={listStyles.rowInner}>
            <Camera size={18} color="#E1306C" strokeWidth={1.75} />
            <View style={listStyles.textCol}>
              <Text style={listStyles.label}>Share to IG Story</Text>
              <Text style={listStyles.subtitle}>Adds a tappable link your audience can shop</Text>
            </View>
          </View>
        </Pressable>

        <View style={listStyles.divider} />

        <Pressable
          onPress={onShareInstagram}
          testID={`${testIDPrefix}-share-instagram`}
          style={({ pressed }) => [listStyles.row, pressed && listStyles.rowPressed]}
        >
          <View style={listStyles.rowInner}>
            <Ionicons name="logo-instagram" size={18} color="#E1306C" />
            <View style={listStyles.textCol}>
              <Text style={listStyles.label}>Share to Instagram</Text>
              <Text style={listStyles.subtitle}>Copies the first item's link</Text>
            </View>
          </View>
        </Pressable>

        {/* Pinterest slot. Prefer the API-backed pin row (creates a pin via
            the Edge Function, stays in-app); fall back to the legacy composer
            row only where a caller still wires onShareToPinterest. Render
            nothing (and no divider) when neither is provided. */}
        {pinToPinterest ? (
          <>
            <View style={listStyles.divider} />
            <PinToPinterestRow
              lookId={pinToPinterest.lookId}
              hasCoverPhoto={pinToPinterest.hasCoverPhoto}
              coverPhotoUrl={pinToPinterest.coverPhotoUrl}
              caption={pinToPinterest.caption}
              title={pinToPinterest.title}
              hashtags={pinToPinterest.hashtags}
              testIDPrefix={`${testIDPrefix}-pin-pinterest`}
            />
          </>
        ) : onShareToPinterest ? (
          <>
            <View style={listStyles.divider} />
            <Pressable
              onPress={onShareToPinterest}
              testID={`${testIDPrefix}-share-pinterest`}
              style={({ pressed }) => [listStyles.row, pressed && listStyles.rowPressed]}
            >
              <View style={listStyles.rowInner}>
                <Ionicons name="logo-pinterest" size={18} color="#E60023" />
                <View style={listStyles.textCol}>
                  <Text style={listStyles.label}>Share to Pinterest</Text>
                  <Text style={listStyles.subtitle}>Pins keep your link — taps go straight back to your look</Text>
                </View>
              </View>
            </Pressable>
          </>
        ) : null}

        <View style={listStyles.divider} />

        <Pressable
          onPress={onShareTikTok}
          testID={`${testIDPrefix}-share-tiktok`}
          style={({ pressed }) => [listStyles.row, pressed && listStyles.rowPressed]}
        >
          <View style={listStyles.rowInner}>
            <Ionicons name="logo-tiktok" size={18} color="#1A1210" />
            <Text style={listStyles.label}>Share to TikTok</Text>
          </View>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={pillStyles.container}>
      {/* 1. Share Look — black filled primary */}
      <Pressable
        onPress={onShareLook}
        testID={`${testIDPrefix}-share-look`}
      >
        {({ pressed }) => (
          <View style={[pillStyles.btnBlack, pressed && pillStyles.pressed]}>
            <View style={pillStyles.btnRow}>
              <Share2 size={16} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={pillStyles.btnWhiteText}>Share Look</Text>
            </View>
          </View>
        )}
      </Pressable>

      {/* 2. Save All Photos — beige filled */}
      <Pressable
        onPress={onSaveAllPhotos}
        testID={`${testIDPrefix}-save-all-photos`}
      >
        {({ pressed }) => (
          <View style={[pillStyles.btnBeige, pressed && pillStyles.pressed]}>
            <Text style={pillStyles.btnDarkText}>
              {savedPhotosCount !== null ? `Saved ${savedPhotosCount} photos!` : 'Save All Photos to Camera Roll'}
            </Text>
          </View>
        )}
      </Pressable>
      <Text style={pillStyles.helperText}>Save first, then select multiple photos in Instagram</Text>

      {/* Story share banner */}
      {storyShareMessage ? (
        <View style={pillStyles.storyBanner} testID={`${testIDPrefix}-story-banner`}>
          <Text style={pillStyles.storyBannerText}>{storyShareMessage}</Text>
        </View>
      ) : null}

      {/* 3. Share to IG Story — outlined terracotta */}
      <Pressable
        onPress={onShareToStory}
        testID={`${testIDPrefix}-share-story`}
      >
        {({ pressed }) => (
          <View style={[pillStyles.btnOutlined, pressed && pillStyles.pressed]}>
            <Text style={pillStyles.btnOutlinedText}>Share to IG Story</Text>
          </View>
        )}
      </Pressable>
      <Text style={pillStyles.helperText}>Adds a tappable link your audience can shop</Text>

      {/* 4. Share to Instagram — pink filled */}
      <Pressable
        onPress={onShareInstagram}
        testID={`${testIDPrefix}-share-instagram`}
      >
        {({ pressed }) => (
          <View style={[pillStyles.btnPink, pressed && pillStyles.pressed]}>
            <View style={pillStyles.btnRow}>
              <Ionicons name="logo-instagram" size={16} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={pillStyles.btnWhiteText}>Share to Instagram</Text>
            </View>
          </View>
        )}
      </Pressable>
      <Text style={pillStyles.helperText}>Copies the first item's link — best for a single-product post</Text>

      {/* 5. Share to Pinterest — Pinterest red filled. Pinterest preserves
            the source URL on the resulting pin, so unlike TikTok the link
            actually flows back to the creator's look on tap. */}
      <Pressable
        onPress={onShareToPinterest}
        testID={`${testIDPrefix}-share-pinterest`}
      >
        {({ pressed }) => (
          <View style={[pillStyles.btnPinterest, pressed && pillStyles.pressed]}>
            <View style={pillStyles.btnRow}>
              <Ionicons name="logo-pinterest" size={16} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={pillStyles.btnWhiteText}>Share to Pinterest</Text>
            </View>
          </View>
        )}
      </Pressable>
      <Text style={pillStyles.helperText}>Pins keep your link — taps go straight back to your look</Text>

      {/* 6. Share to TikTok — black filled */}
      <Pressable
        onPress={onShareTikTok}
        testID={`${testIDPrefix}-share-tiktok`}
      >
        {({ pressed }) => (
          <View style={[pillStyles.btnTikTok, pressed && pillStyles.pressed]}>
            <View style={pillStyles.btnRow}>
              <Ionicons name="logo-tiktok" size={16} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={pillStyles.btnWhiteText}>Share to TikTok</Text>
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const pillStyles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 0,
    backgroundColor: '#F5F0EB',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  pressed: {
    opacity: 0.85,
  },
  btnBlack: {
    width: '100%',
    height: 52,
    backgroundColor: '#1A1210',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  btnBeige: {
    width: '100%',
    height: 48,
    backgroundColor: '#F0EBE5',
    borderWidth: 1.5,
    borderColor: '#B87063',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  btnOutlined: {
    width: '100%',
    height: 48,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#B87063',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  btnOutlinedText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    fontWeight: '600',
    color: '#B87063',
  },
  btnPink: {
    width: '100%',
    height: 48,
    backgroundColor: '#E1306C',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  btnPinterest: {
    width: '100%',
    height: 48,
    // Pinterest brand red — official hex, white text matches IG button
    backgroundColor: '#E60023',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  btnTikTok: {
    width: '100%',
    height: 48,
    backgroundColor: '#1A1210',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnWhiteText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  btnDarkText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    fontWeight: '500',
    color: '#1A1210',
  },
  helperText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    textAlign: 'center',
    marginBottom: 12,
  },
  storyBanner: {
    backgroundColor: '#2E7D52',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  storyBannerText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});

// Matches ActionRow structure: Pressable(row) > View(rowInner) > children
const listStyles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    overflow: 'hidden',
  },
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
    color: '#1A1210',
    marginLeft: 12,
  },
  subtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginTop: 2,
    marginLeft: 12,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E8E0D8',
    marginLeft: 16 + 18 + 12,
  },
});
