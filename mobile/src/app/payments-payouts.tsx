import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Switch,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { ChevronLeft, Mail, CheckCircle2, AlertCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import useAuthStore from '@/lib/state/authStore';
import { COLORS as PALETTE } from '@/constants/theme';

type CommissionStatus = 'pending' | 'confirmed' | 'paid' | 'reversed' | 'cancelled' | string;

interface CommissionRow {
  id: string;
  affiliate_network: string | null;
  merchant_name: string | null;
  creator_share: number | null;
  status: CommissionStatus;
  order_date: string | null;
}

interface PayoutSettings {
  payout_email: string | null;
  payout_method: string | null;
  amazon_associates_tag: string | null;
  amazon_use_own_tag: boolean;
  amazon_own_tag_enabled: boolean;
  amazon_setup_acknowledged_at: string | null;
}

// Local aliases sourced from the central theme (src/constants/theme.ts).
// Same hex values as before — pulling from the single source of truth.
const COLORS = {
  bg: PALETTE.bg,
  card: PALETTE.card,
  ink: PALETTE.ink,
  inkMid: PALETTE.inkMid,
  inkLight: PALETTE.inkLight,
  border: PALETTE.borderSoft,
  rose: PALETTE.rose,
  roseSoft: PALETTE.roseSoft,
  green: PALETTE.success,
  amber: PALETTE.warning,
};

function isValidEmail(s: string): boolean {
  // Simple, well-formed-enough check
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function formatMoney(n: number): string {
  if (!isFinite(n)) return '$0.00';
  return `$${n.toFixed(2)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

function statusPillColor(status: CommissionStatus): { bg: string; fg: string } {
  switch (status) {
    case 'paid': return { bg: '#E6F4EC', fg: COLORS.green };
    case 'confirmed': return { bg: '#FBF4EE', fg: COLORS.rose };
    case 'pending': return { bg: '#F0EBE5', fg: COLORS.inkMid };
    case 'reversed':
    case 'cancelled':
      return { bg: '#FDECEA', fg: '#B23A2A' };
    default:
      return { bg: '#F0EBE5', fg: COLORS.inkMid };
  }
}

function networkLabel(network: string | null): string {
  if (!network) return 'Affiliate';
  const map: Record<string, string> = {
    amazon: 'Amazon',
    rakuten: 'Rakuten',
    impact: 'Impact',
    shareasale: 'ShareASale',
    cj: 'CJ',
    awin: 'Awin',
    skimlinks: 'Skimlinks',
  };
  return map[network.toLowerCase()] ?? network;
}

export default function PaymentsPayoutsScreen() {
  const creatorId = useAuthStore((s) => s.creatorId);

  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  const [loading, setLoading] = useState<boolean>(true);
  const [commissions, setCommissions] = useState<CommissionRow[]>([]);
  const [settings, setSettings] = useState<PayoutSettings>({
    payout_email: null,
    payout_method: null,
    amazon_associates_tag: null,
    amazon_use_own_tag: false,
    amazon_own_tag_enabled: false,
    amazon_setup_acknowledged_at: null,
  });

  // Editable form state — PayPal section
  const [editingPaypal, setEditingPaypal] = useState<boolean>(false);
  const [paypalDraft, setPaypalDraft] = useState<string>('');
  const [savingPaypal, setSavingPaypal] = useState<boolean>(false);
  const [paypalError, setPaypalError] = useState<string | null>(null);

  // Amazon section
  const [amazonTagDraft, setAmazonTagDraft] = useState<string>('');
  const [amazonUseOwnDraft, setAmazonUseOwnDraft] = useState<boolean>(false);
  const [amazonDirty, setAmazonDirty] = useState<boolean>(false);
  const [savingAmazon, setSavingAmazon] = useState<boolean>(false);

  const fetchAll = useCallback(async () => {
    if (!creatorId) return;
    setLoading(true);
    try {
      const [{ data: profileRow }, { data: commissionRows }] = await Promise.all([
        supabase
          .from('creator_profiles')
          .select('payout_email, payout_method, amazon_associates_tag, amazon_use_own_tag, amazon_own_tag_enabled, amazon_setup_acknowledged_at')
          .eq('creator_id', creatorId)
          .maybeSingle(),
        supabase
          .from('commissions')
          .select('id, affiliate_network, merchant_name, creator_share, status, order_date')
          .eq('creator_id', creatorId)
          .order('order_date', { ascending: false })
          .limit(50),
      ]);

      if (profileRow) {
        const next: PayoutSettings = {
          payout_email: (profileRow as any).payout_email ?? null,
          payout_method: (profileRow as any).payout_method ?? null,
          amazon_associates_tag: (profileRow as any).amazon_associates_tag ?? null,
          amazon_use_own_tag: !!(profileRow as any).amazon_use_own_tag,
          amazon_own_tag_enabled: !!(profileRow as any).amazon_own_tag_enabled,
          amazon_setup_acknowledged_at: (profileRow as any).amazon_setup_acknowledged_at ?? null,
        };
        setSettings(next);
        setPaypalDraft(next.payout_email ?? '');
        setAmazonTagDraft(next.amazon_associates_tag ?? '');
        setAmazonUseOwnDraft(next.amazon_use_own_tag);
        setAmazonDirty(false);
      }
      if (Array.isArray(commissionRows)) {
        setCommissions(commissionRows as CommissionRow[]);
      }
    } catch (e) {
      console.warn('[payments-payouts] fetch error', e);
    } finally {
      setLoading(false);
    }
  }, [creatorId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Earnings totals
  const totals = useMemo(() => {
    let pending = 0;
    let confirmed = 0;
    let paid = 0;
    for (const c of commissions) {
      const v = Number(c.creator_share ?? 0);
      if (!isFinite(v)) continue;
      if (c.status === 'pending') pending += v;
      else if (c.status === 'confirmed') confirmed += v;
      else if (c.status === 'paid') paid += v;
    }
    return { pending, confirmed, paid };
  }, [commissions]);

  const hasAnyCommissions = commissions.some(
    (c) => c.status === 'pending' || c.status === 'confirmed' || c.status === 'paid'
  );

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/creator-account' as any);
  }, []);

  const handleSavePaypal = useCallback(async () => {
    if (!creatorId) return;
    const trimmed = paypalDraft.trim();
    if (!isValidEmail(trimmed)) {
      setPaypalError('Enter a valid email address.');
      return;
    }
    setPaypalError(null);
    setSavingPaypal(true);
    try {
      const { error } = await supabase
        .from('creator_profiles')
        .update({ payout_email: trimmed, payout_method: 'paypal' })
        .eq('creator_id', creatorId);
      if (error) throw error;
      setSettings((prev) => ({ ...prev, payout_email: trimmed, payout_method: 'paypal' }));
      setEditingPaypal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      Alert.alert('Save failed', e?.message ?? 'Could not save your PayPal email.');
    } finally {
      setSavingPaypal(false);
    }
  }, [creatorId, paypalDraft]);

  const amazonTagWarning = useMemo(() => {
    const t = amazonTagDraft.trim();
    if (!t) return null;
    // Soft validate: warn if no -NN suffix
    if (!/-\d{2}$/.test(t)) return 'Most Amazon tags end with "-20", "-21", etc. Double-check it matches the one in your Amazon Associates dashboard.';
    return null;
  }, [amazonTagDraft]);

  const handleSaveAmazon = useCallback(async () => {
    if (!creatorId) return;
    setSavingAmazon(true);
    try {
      const trimmedTag = amazonTagDraft.trim();
      const tagToSave = trimmedTag === '' ? null : trimmedTag;
      const { error } = await supabase
        .from('creator_profiles')
        .update({
          amazon_associates_tag: tagToSave,
          amazon_use_own_tag: amazonUseOwnDraft,
          amazon_setup_acknowledged_at: new Date().toISOString(),
        })
        .eq('creator_id', creatorId);
      if (error) throw error;
      setSettings((prev) => ({
        ...prev,
        amazon_associates_tag: tagToSave,
        amazon_use_own_tag: amazonUseOwnDraft,
        amazon_setup_acknowledged_at: new Date().toISOString(),
      }));
      setAmazonDirty(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      Alert.alert('Save failed', e?.message ?? 'Could not save your Amazon settings.');
    } finally {
      setSavingAmazon(false);
    }
  }, [creatorId, amazonTagDraft, amazonUseOwnDraft]);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: COLORS.bg }} />;
  }

  const payoutEmailSet = !!(settings.payout_email && settings.payout_email.trim());
  const amazonTagSaved = !!(settings.amazon_associates_tag && settings.amazon_associates_tag.trim());

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="payments-payouts-screen">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
          testID="pp-back-button"
        >
          <ChevronLeft size={24} color={COLORS.ink} strokeWidth={1.8} />
        </Pressable>
        <Text style={styles.headerTitle}>Payments & Payouts</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          testID="pp-scroll"
        >
          {loading ? (
            <View style={styles.loaderBox}>
              <ActivityIndicator size="small" color={COLORS.ink} testID="pp-loading" />
            </View>
          ) : null}

          {/* Empty-state nudge card (top) */}
          {!loading && !payoutEmailSet ? (
            <Pressable
              onPress={() => {
                setEditingPaypal(true);
                setPaypalDraft(settings.payout_email ?? '');
              }}
              style={({ pressed }) => [styles.nudgeCard, pressed && { opacity: 0.92 }]}
              testID="pp-payout-empty-card"
            >
              <View style={styles.nudgeRow}>
                <View style={styles.nudgeIconWrap}>
                  <Mail size={20} color={COLORS.rose} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.nudgeTitle}>Set up payment to get paid</Text>
                  <Text style={styles.nudgeBody}>
                    Tell us where to send your confirmed commissions.
                  </Text>
                </View>
              </View>
            </Pressable>
          ) : null}

          {/* Section A — Earnings overview */}
          <Text style={styles.sectionLabel}>Your earnings</Text>

          <View style={styles.earningsRow}>
            <EarningsCell label="Pending" value={formatMoney(totals.pending)} tone="ink" testID="pp-pending" />
            <View style={styles.earningsDivider} />
            <EarningsCell label="Confirmed" value={formatMoney(totals.confirmed)} tone="rose" testID="pp-confirmed" />
            <View style={styles.earningsDivider} />
            <EarningsCell label="Lifetime paid" value={formatMoney(totals.paid)} tone="green" testID="pp-paid" />
          </View>

          <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Recent commissions</Text>

          {commissions.length === 0 ? (
            <View style={styles.emptyLedger} testID="pp-empty-ledger">
              <Text style={styles.emptyLedgerTitle}>No commissions yet.</Text>
              <Text style={styles.emptyLedgerBody}>
                Add Amazon links to your closet and publish a look — once a shopper buys, you'll see the credit here.
              </Text>
            </View>
          ) : (
            <View style={styles.ledgerCard} testID="pp-ledger">
              {commissions.map((c, idx) => {
                const pill = statusPillColor(c.status);
                return (
                  <View
                    key={c.id}
                    style={[
                      styles.ledgerRow,
                      idx < commissions.length - 1 && styles.ledgerRowBorder,
                    ]}
                    testID={`pp-commission-${c.id}`}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={styles.ledgerTopRow}>
                        <View style={styles.networkBadge}>
                          <Text style={styles.networkBadgeText}>{networkLabel(c.affiliate_network)}</Text>
                        </View>
                        <Text style={styles.merchantName} numberOfLines={1}>
                          {c.merchant_name ?? 'Merchant'}
                        </Text>
                      </View>
                      {c.order_date ? (
                        <Text style={styles.ledgerDate}>{formatDate(c.order_date)}</Text>
                      ) : null}
                    </View>
                    <View style={styles.ledgerRightCol}>
                      <Text style={styles.ledgerAmount}>{formatMoney(Number(c.creator_share ?? 0))}</Text>
                      <View style={[styles.statusPill, { backgroundColor: pill.bg }]}>
                        <Text style={[styles.statusPillText, { color: pill.fg }]}>{c.status}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Section B — How you get paid */}
          <Text style={[styles.sectionLabel, { marginTop: 28 }]}>How you get paid</Text>

          <View style={styles.cardPad}>
            <Text style={styles.cardBody}>
              We send your confirmed commissions to PayPal once your balance hits $25. Enter the email you use for PayPal — that's where the money lands.
            </Text>

            {editingPaypal || !payoutEmailSet ? (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.fieldLabel}>PayPal email</Text>
                <TextInput
                  value={paypalDraft}
                  onChangeText={(t) => {
                    setPaypalDraft(t);
                    if (paypalError) setPaypalError(null);
                  }}
                  placeholder="you@example.com"
                  placeholderTextColor={COLORS.inkLight}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                  testID="pp-paypal-input"
                />
                {paypalError ? (
                  <View style={styles.warnRow}>
                    <AlertCircle size={14} color="#B23A2A" />
                    <Text style={styles.warnText}>{paypalError}</Text>
                  </View>
                ) : null}
                <View style={styles.actionsRow}>
                  {payoutEmailSet ? (
                    <Pressable
                      onPress={() => {
                        setEditingPaypal(false);
                        setPaypalDraft(settings.payout_email ?? '');
                        setPaypalError(null);
                      }}
                      className="bg-white rounded-full py-3 px-5 flex-row items-center justify-center border-[1.5px] border-[#1A1210] active:opacity-85"
                      style={{ flex: 1 }}
                      testID="pp-paypal-cancel"
                    >
                      <Text
                        className="text-[#1A1210] text-[15px] font-semibold"
                        style={{ fontFamily: 'DMSans_500Medium' }}
                      >
                        Cancel
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={handleSavePaypal}
                    disabled={savingPaypal}
                    className="bg-[#B87063] rounded-full py-3 px-5 flex-row items-center justify-center active:opacity-85"
                    style={[
                      { flex: 1 },
                      savingPaypal && { opacity: 0.6 },
                      { shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
                    ]}
                    testID="pp-paypal-save"
                  >
                    {savingPaypal ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text
                        className="text-white text-[15px] font-semibold"
                        style={{ fontFamily: 'DMSans_500Medium' }}
                      >
                        Save PayPal email
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.paidToRow} testID="pp-paid-to-row">
                <View style={styles.paidToLeft}>
                  <CheckCircle2 size={16} color={COLORS.green} strokeWidth={2} />
                  <Text style={styles.paidToText} numberOfLines={1}>
                    Paid to: {settings.payout_email}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    setPaypalDraft(settings.payout_email ?? '');
                    setEditingPaypal(true);
                  }}
                  hitSlop={8}
                  testID="pp-paypal-edit"
                >
                  <Text style={styles.editLink}>Edit</Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* Section C — Amazon Associates tag (gated to founders / paid tier) */}
          {settings.amazon_own_tag_enabled ? (
            <>
          <Text style={[styles.sectionLabel, { marginTop: 28 }]}>Amazon attribution</Text>

          <View style={styles.cardPad}>
            <Text style={styles.cardBody}>
              When a shopper clicks an Amazon link in one of your looks, the sale attributes to Styled in Motion by default. If you have your own Amazon Associates tag (something like {'`'}yourname-20{'`'}), you can route your own clicks to your tag instead so the commission goes straight into your Amazon Associates account. If you don't have one, that's fine — leave this off and we'll attribute through the platform.
            </Text>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>Use my own Amazon tag</Text>
                {amazonTagSaved && !amazonUseOwnDraft ? (
                  <Text style={styles.toggleHint}>Saved, not in use</Text>
                ) : null}
              </View>
              <Switch
                value={amazonUseOwnDraft}
                onValueChange={(v) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  setAmazonUseOwnDraft(v);
                  setAmazonDirty(true);
                }}
                trackColor={{ false: '#E8E0D8', true: COLORS.ink }}
                thumbColor="#FFFFFF"
                testID="pp-amazon-toggle"
              />
            </View>

            <View style={{ marginTop: 12, opacity: amazonUseOwnDraft ? 1 : 0.5 }}>
              <Text style={styles.fieldLabel}>Your Amazon tag</Text>
              <TextInput
                value={amazonTagDraft}
                onChangeText={(t) => {
                  setAmazonTagDraft(t);
                  setAmazonDirty(true);
                }}
                placeholder="yourname-20"
                placeholderTextColor={COLORS.inkLight}
                editable={amazonUseOwnDraft}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                testID="pp-amazon-tag-input"
              />
              <Text style={styles.helperText}>
                Ends in {'`'}-20{'`'} for US programs (e.g. {'`'}yourname-20{'`'}).
              </Text>
              {amazonTagWarning && amazonUseOwnDraft ? (
                <View style={styles.warnRow}>
                  <AlertCircle size={14} color={COLORS.amber} />
                  <Text style={[styles.warnText, { color: COLORS.amber }]}>{amazonTagWarning}</Text>
                </View>
              ) : null}
            </View>

            {amazonDirty ? (
              <View style={[styles.actionsRow, { marginTop: 16 }]}>
                <Pressable
                  onPress={handleSaveAmazon}
                  disabled={savingAmazon}
                  className="bg-[#B87063] rounded-full py-3 px-5 flex-row items-center justify-center active:opacity-85"
                  style={[
                    { flex: 1 },
                    savingAmazon && { opacity: 0.6 },
                    { shadowColor: '#1A1210', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
                  ]}
                  testID="pp-amazon-save"
                >
                  {savingAmazon ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text
                      className="text-white text-[15px] font-semibold"
                      style={{ fontFamily: 'DMSans_500Medium' }}
                    >
                      Save Amazon settings
                    </Text>
                  )}
                </Pressable>
              </View>
            ) : null}
          </View>
            </>
          ) : null}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function EarningsCell({
  label,
  value,
  tone,
  testID,
}: {
  label: string;
  value: string;
  tone: 'ink' | 'rose' | 'green';
  testID?: string;
}) {
  const color =
    tone === 'rose' ? COLORS.rose : tone === 'green' ? COLORS.green : COLORS.ink;
  return (
    <View style={styles.earningsCell} testID={testID}>
      <Text style={[styles.earningsValue, { color }]}>{value}</Text>
      <Text style={styles.earningsLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  headerSpacer: { width: 40 },
  headerTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: COLORS.ink,
    textAlign: 'center',
    flex: 1,
    letterSpacing: 0.5,
  },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 48 },
  loaderBox: { paddingVertical: 12, alignItems: 'center' },

  // Nudge card at top
  nudgeCard: {
    backgroundColor: COLORS.roseSoft,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: COLORS.rose,
    padding: 14,
    marginBottom: 16,
  },
  nudgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nudgeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeTitle: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 18,
    color: COLORS.ink,
    letterSpacing: 0.3,
  },
  nudgeBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: COLORS.inkMid,
    marginTop: 2,
    lineHeight: 18,
  },

  sectionLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 10,
    paddingHorizontal: 4,
  },

  // Earnings overview row
  earningsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 14,
  },
  earningsCell: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  earningsDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 4,
  },
  earningsValue: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    letterSpacing: 0.2,
  },
  earningsLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: COLORS.inkMid,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // Ledger
  emptyLedger: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },
  emptyLedgerTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: COLORS.ink,
    marginBottom: 4,
  },
  emptyLedgerBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: COLORS.inkMid,
    lineHeight: 19,
  },
  ledgerCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  ledgerRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  ledgerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  networkBadge: {
    backgroundColor: '#F0EBE5',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  networkBadgeText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    color: COLORS.inkMid,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  merchantName: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: COLORS.ink,
    flexShrink: 1,
  },
  ledgerDate: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: COLORS.inkLight,
    marginTop: 4,
  },
  ledgerRightCol: { alignItems: 'flex-end', gap: 6 },
  ledgerAmount: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: COLORS.ink,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusPillText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  // Generic card padding (used by sections B & C)
  cardPad: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
  },
  cardBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: COLORS.inkMid,
    lineHeight: 19,
  },
  fieldLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: COLORS.inkMid,
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#F7F4F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: COLORS.ink,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  helperText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: COLORS.inkLight,
    marginTop: 6,
  },
  warnRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 8,
  },
  warnText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#B23A2A',
    flex: 1,
    lineHeight: 17,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  paidToRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    gap: 12,
  },
  paidToLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  paidToText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: COLORS.ink,
    flex: 1,
  },
  editLink: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: COLORS.rose,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
  },
  toggleLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: COLORS.ink,
  },
  toggleHint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: COLORS.inkLight,
    marginTop: 2,
  },
  disclosureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  disclosureLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: COLORS.inkMid,
  },
  disclosureBody: {
    marginTop: 10,
    gap: 8,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linkText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: COLORS.rose,
  },
});
