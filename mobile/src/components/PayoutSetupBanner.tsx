import React, { useEffect, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import useAuthStore from '@/lib/state/authStore';

/**
 * Dashboard nudge that appears when a creator has earned commissions
 * (pending/confirmed/paid rows in `commissions`) but hasn't yet set a
 * `payout_email` on their `creator_profiles` row. Tapping routes to the
 * Payments & Payouts screen. Auto-hides once payout_email is set.
 */
export function PayoutSetupBanner() {
  const creatorId = useAuthStore((s) => s.creatorId);
  const [show, setShow] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (!creatorId) {
        if (!cancelled) setShow(false);
        return;
      }
      try {
        const [profileRes, commissionsRes] = await Promise.all([
          supabase
            .from('creator_profiles')
            .select('payout_email')
            .eq('creator_id', creatorId)
            .maybeSingle(),
          supabase
            .from('commissions')
            .select('id', { count: 'exact', head: true })
            .eq('creator_id', creatorId)
            .in('status', ['pending', 'confirmed', 'paid']),
        ]);

        const payoutEmail = (profileRes.data as any)?.payout_email ?? null;
        const hasPayout = !!(payoutEmail && String(payoutEmail).trim());
        const hasCommissions = (commissionsRes.count ?? 0) > 0;
        if (!cancelled) {
          setShow(!hasPayout && hasCommissions);
        }
      } catch (e) {
        console.warn('[PayoutSetupBanner] check failed', e);
      }
    };

    check();
    return () => { cancelled = true; };
  }, [creatorId]);

  if (!show) return null;

  return (
    <Pressable
      onPress={() => router.push('/payments-payouts' as any)}
      style={({ pressed }) => [styles.banner, pressed && { opacity: 0.92 }]}
      testID="dashboard-payout-banner"
    >
      <Text style={styles.emoji}>💸</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>You've earned commissions</Text>
        <Text style={styles.body}>Set up how you get paid</Text>
      </View>
      <ChevronRight size={20} color="#B87063" strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FBF4EE',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#B87063',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 20,
    marginBottom: 12,
  },
  emoji: { fontSize: 24 },
  title: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: '#1A1210',
  },
  body: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#6B5E58',
    marginTop: 2,
  },
});

export default PayoutSetupBanner;
