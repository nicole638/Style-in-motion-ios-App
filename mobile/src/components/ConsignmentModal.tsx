import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import { Sparkles, Check, Copy, ExternalLink, X } from 'lucide-react-native';
import { cn } from '@/lib/cn';
import { supabase } from '@/lib/supabase';
import { logConsignClick, TRR_PARTNERSHIP_LP } from '@/lib/analytics/clickEvents';
import type { ClothingItem } from '@/lib/state/lookStore';

interface ConsignmentModalProps {
  visible: boolean;
  item: ClothingItem;
  creatorId: string | null;
  onClose: () => void;
  onConsigned: () => void; // creator confirmed ownership + tapped through to TRR
}

export function ConsignmentModal({
  visible,
  item,
  creatorId,
  onClose,
  onConsigned,
}: ConsignmentModalProps) {
  // Required ownership attestation. Creators can pull brand-catalog items into
  // their closet without physically owning them — we MUST gate the CTA until
  // they confirm they have the physical piece.
  const [ownsItem, setOwnsItem] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Step 2: the SiM-email hand-off. TRR's $250 first-timer payout only
  // attributes if the creator submits the email on their Styled in Motion
  // account, so before opening the LP we surface it with a Copy button.
  const [emailStep, setEmailStep] = useState(false);
  const [simEmail, setSimEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const brand = item.brand ?? '';
  const itemName = item.name ?? 'this piece';

  const handleClose = () => {
    onClose();
    // Reset for next open, after the dismiss animation.
    setTimeout(() => {
      setOwnsItem(false);
      setError(null);
      setEmailStep(false);
      setSimEmail(null);
      setCopied(false);
    }, 300);
  };

  // Opens the TRR landing page and tears down the modal. Click tracking and
  // the closet-pill flip happen here so they fire exactly once, on hand-off.
  const openTRR = () => {
    // Fire-and-forget click tracking — never block the hand-off to TRR.
    void logConsignClick({ creatorId, itemId: item.id });

    onConsigned(); // flips the parent closet card pill to "Consigning ✓"
    handleClose();
    void WebBrowser.openBrowserAsync(TRR_PARTNERSHIP_LP, {
      toolbarColor: '#B87063',
      controlsColor: '#FFFFFF',
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC,
      dismissButtonStyle: 'done',
    });
  };

  const handleContinue = async () => {
    if (!ownsItem) {
      setError('Please confirm you own this item before continuing.');
      return;
    }
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Pull the creator's Styled in Motion account email (their auth email) so
    // they can attach it to TRR's form — that's the only way the $250 counts.
    let email: string | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      email = data.session?.user?.email ?? null;
    } catch {
      email = null;
    }

    if (email) {
      setSimEmail(email);
      setEmailStep(true);
      return;
    }
    // No email on file — never block the funnel; go straight to TRR.
    openTRR();
  };

  const handleCopyEmail = async () => {
    if (!simEmail) return;
    try {
      await Clipboard.setStringAsync(simEmail);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopied(true);
    } catch {
      // Copy can fail on some platforms — the email is still shown on screen.
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      testID="consignment-modal"
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={handleClose} />
        <View style={styles.sheet}>
          <View style={styles.dragHandle} />

          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {/* Item photo — large header */}
            <View style={styles.photoWrap}>
              {item.photoUri ? (
                <Image
                  source={{ uri: item.photoUri }}
                  style={styles.heroPhoto}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.heroPhoto, styles.heroPlaceholder]}>
                  <Text style={{ fontSize: 64 }}>{item.emoji}</Text>
                </View>
              )}
              <Pressable
                onPress={handleClose}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/35 items-center justify-center active:opacity-80"
                hitSlop={8}
                testID="consignment-modal-close"
              >
                <X size={18} color="#FFFFFF" strokeWidth={2.5} />
              </Pressable>
            </View>

            <View style={styles.body}>
              {!emailStep ? (
                <>
                  {/* Brand + item name */}
                  <Text style={styles.headline}>
                    {brand}{brand ? ' ' : null}{itemName}
                  </Text>

                  {/* First-time-consignor offer callout (Q3 promo) */}
                  <View style={styles.offerCard}>
                    <View style={styles.offerEyebrowRow}>
                      <Sparkles size={11} color="#B87063" strokeWidth={2.25} />
                      <Text style={styles.offerEyebrow}>STYLED IN MOTION CREATORS</Text>
                    </View>
                    <Text style={styles.offerHeadline}>Get $200 your first time</Text>
                    <Text style={styles.offerBody}>
                      Styled in Motion Creators get $200 when you consign for the first
                      time in July, August, or September.
                    </Text>
                  </View>

                  {/* Ownership checkbox (REQUIRED — gates the CTA) */}
                  <Pressable
                    style={styles.ownsRow}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setError(null);
                      setOwnsItem((v) => !v);
                    }}
                    testID="consignment-modal-owns-checkbox"
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: ownsItem }}
                  >
                    <View
                      style={[
                        styles.ownsCheckbox,
                        ownsItem ? styles.ownsCheckboxChecked : styles.ownsCheckboxUnchecked,
                      ]}
                    >
                      {ownsItem ? <Check size={14} color="#FFFFFF" strokeWidth={3} /> : null}
                    </View>
                    <View style={styles.ownsCopy}>
                      <Text style={styles.ownsTitle}>I own this item</Text>
                      <Text style={styles.ownsBody}>
                        I have the physical piece, not just a styled version from the
                        brand catalog.
                      </Text>
                    </View>
                  </Pressable>

                  {error ? (
                    <View style={styles.errorBanner} testID="consignment-modal-error">
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  ) : null}

                  {/* Single CTA — disabled until ownsItem is checked */}
                  {/* Not `disabled` — we keep it tappable so an unchecked tap can
                      surface the ownership error. It just *looks* disabled (faded)
                      until the box is checked. */}
                  <Pressable
                    onPress={handleContinue}
                    className={cn(
                      'w-full rounded-full py-4 flex-row items-center justify-center bg-[#B87063] active:opacity-85',
                      !ownsItem && 'opacity-40',
                    )}
                    accessibilityState={{ disabled: !ownsItem }}
                    style={{
                      shadowColor: '#1A1210',
                      shadowOpacity: 0.12,
                      shadowRadius: 8,
                      shadowOffset: { width: 0, height: 2 },
                      elevation: 2,
                    }}
                    testID="consignment-modal-continue"
                  >
                    <Text
                      className="text-white text-[16px]"
                      style={{ fontFamily: 'DMSans_500Medium', fontWeight: '600' }}
                    >
                      Continue on The RealReal
                    </Text>
                    <ExternalLink size={16} color="#FFFFFF" strokeWidth={2} style={{ marginLeft: 8 }} />
                  </Pressable>
                </>
              ) : (
                <>
                  {/* Step 2 — SiM email hand-off so the $250 attributes */}
                  <Text style={styles.headline}>Use this email so your $250 counts</Text>
                  <Text style={styles.emailIntro}>
                    On The RealReal's form, enter the email on your Styled in Motion
                    account. Copy it now so your first-time payout is credited to you.
                  </Text>

                  <Pressable
                    onPress={handleCopyEmail}
                    style={styles.emailPill}
                    testID="consignment-modal-copy-email"
                    accessibilityRole="button"
                    accessibilityLabel={`Copy email ${simEmail ?? ''}`}
                  >
                    <Text style={styles.emailText} numberOfLines={1}>
                      {simEmail}
                    </Text>
                    <View style={styles.copyChip}>
                      {copied ? (
                        <Check size={14} color="#B87063" strokeWidth={2.5} />
                      ) : (
                        <Copy size={14} color="#B87063" strokeWidth={2.25} />
                      )}
                      <Text style={styles.copyChipText}>{copied ? 'Copied' : 'Copy'}</Text>
                    </View>
                  </Pressable>

                  <Pressable
                    onPress={openTRR}
                    className="w-full rounded-full py-4 flex-row items-center justify-center bg-[#B87063] active:opacity-85"
                    style={{
                      shadowColor: '#1A1210',
                      shadowOpacity: 0.12,
                      shadowRadius: 8,
                      shadowOffset: { width: 0, height: 2 },
                      elevation: 2,
                    }}
                    testID="consignment-modal-open-trr"
                  >
                    <Text
                      className="text-white text-[16px]"
                      style={{ fontFamily: 'DMSans_500Medium', fontWeight: '600' }}
                    >
                      Continue to The RealReal
                    </Text>
                    <ExternalLink size={16} color="#FFFFFF" strokeWidth={2} style={{ marginLeft: 8 }} />
                  </Pressable>
                </>
              )}
            </View>
          </ScrollView>
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
  backdropTouch: { flex: 1 },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    overflow: 'hidden',
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
  content: {
    paddingBottom: 40,
  },
  photoWrap: {
    width: '100%',
    paddingHorizontal: 16,
    marginTop: 4,
  },
  heroPhoto: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 16,
    backgroundColor: '#E0D8D0',
  },
  heroPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  headline: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 26,
    color: '#1A1210',
    marginBottom: 18,
  },
  offerCard: {
    backgroundColor: 'rgba(184,112,99,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(184,112,99,0.30)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  offerEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  offerEyebrow: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    letterSpacing: 2,
    color: '#B87063',
  },
  offerHeadline: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    color: '#1A1210',
    marginBottom: 4,
  },
  offerBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#6B5E58',
    lineHeight: 19,
  },
  ownsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#FAF6F4',
    borderWidth: 1,
    borderColor: '#EFE3DE',
    borderRadius: 14,
    marginBottom: 16,
  },
  ownsCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  ownsCheckboxUnchecked: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#C9BDB6',
  },
  ownsCheckboxChecked: {
    backgroundColor: '#B87063',
    borderWidth: 1.5,
    borderColor: '#B87063',
  },
  ownsCopy: { flex: 1 },
  ownsTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
    marginBottom: 2,
  },
  ownsBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    lineHeight: 17,
  },
  emailIntro: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#6B5E58',
    lineHeight: 20,
    marginBottom: 18,
  },
  emailPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    paddingLeft: 16,
    paddingRight: 10,
    backgroundColor: '#FAF6F4',
    borderWidth: 1,
    borderColor: '#EFE3DE',
    borderRadius: 14,
    marginBottom: 20,
  },
  emailText: {
    flex: 1,
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#1A1210',
  },
  copyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(184,112,99,0.10)',
    borderRadius: 999,
  },
  copyChipText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#B87063',
  },
  errorBanner: {
    backgroundColor: '#FBEDEA',
    borderWidth: 1,
    borderColor: '#E8C4BC',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  errorText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#B5483A',
  },
});
