// Founding-Creator monthly goal rail — sits directly under the
// PerformanceCard on the Closet (home) tab. Only mounts for accounts where
// `is_founding_creator = true`. Reads `looks` directly: counts the rows for
// the current calendar month that are published and not archived.
//
// Read-only nudge. The reward is a non-cash discovery-feed spotlight ("get
// featured"), not a payout — no dollars are promised or owed anywhere here.
import React from 'react';
import { View, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  startOfMonth,
  endOfMonth,
  format,
  differenceInCalendarDays,
} from 'date-fns';
import useAuthStore from '@/lib/state/authStore';
import useProfileStore from '@/lib/state/profileStore';
import { supabase } from '@/lib/supabase';

// Looks needed in-month to earn the monthly Founding Creator reward
// (a discovery-feed spotlight — see copy below).
const TARGET_LOOKS = 4;

interface MonthCountResult {
  count: number;
}

async function fetchPublishedLooksThisMonth(creatorId: string): Promise<MonthCountResult> {
  const start = startOfMonth(new Date()).toISOString();
  const { count, error } = await supabase
    .from('looks')
    .select('id', { count: 'exact', head: true })
    .eq('creator_id', creatorId)
    .not('published_at', 'is', null)
    .eq('archived', false)
    .gte('published_at', start);
  if (error) {
    // Soft-fail — render the rail with 0 so the creator still sees the
    // target rather than nothing.
    return { count: 0 };
  }
  return { count: count ?? 0 };
}

function useFoundingMonthLooks(creatorId: string | null) {
  return useQuery<MonthCountResult>({
    queryKey: ['founding-creator-month-looks', creatorId, new Date().getMonth()],
    queryFn: () => fetchPublishedLooksThisMonth(creatorId as string),
    enabled: !!creatorId,
    staleTime: 60_000,
  });
}

export function FoundingCreatorMonthRail() {
  const creatorId = useAuthStore((s) => s.creatorId);
  const isFoundingCreator = useProfileStore((s) => s.isFoundingCreator);
  const { data, isSuccess } = useFoundingMonthLooks(creatorId);

  // Gate everything on founding status — non-founding creators never see this.
  if (!isFoundingCreator) return null;
  if (!isSuccess || !data) return null;

  const n = data.count;
  const now = new Date();
  const monthName = format(now, 'LLLL'); // "January", "February", ...
  const monthEnd = endOfMonth(now);
  const daysLeft = Math.max(0, differenceInCalendarDays(monthEnd, now));
  const isLastDay = daysLeft === 0;
  const unlocked = n >= TARGET_LOOKS;
  const remaining = Math.max(0, TARGET_LOOKS - n);

  // Progress bar fill, capped at 1.
  const progress = Math.min(1, n / TARGET_LOOKS);

  let subcopy: string;
  if (unlocked) {
    subcopy = `You're featured this month 🎉 — publish more to keep the spotlight.`;
  } else if (isLastDay) {
    // Spec says "fresh start in {days} days" — but at 0 days left we frame
    // as "tomorrow" to stay gentle and avoid an awkward "0 days".
    subcopy = `${n}/${TARGET_LOOKS} this month — fresh start tomorrow`;
  } else {
    subcopy = `Publish ${remaining} more this month and we'll spotlight you in the discovery feed.`;
  }

  return (
    <View
      style={{
        paddingHorizontal: 20,
        paddingTop: 4,
        paddingBottom: 4,
      }}
      testID="founding-creator-month-rail"
    >
      <View
        style={{
          backgroundColor: '#FBF6EF',
          borderColor: '#E8DCC9',
          borderWidth: 1,
          borderRadius: 16,
          padding: 16,
        }}
      >
        {/* Title row — Founding Creator · {Month} */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          <Text
            style={{
              fontFamily: 'DMSans_500Medium',
              fontSize: 11,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              color: '#B87063',
            }}
            testID="founding-creator-month-rail-title"
          >
            Founding Creator · {monthName}
          </Text>
        </View>

        {/* Count + reward headline */}
        <Text
          style={{
            fontFamily: 'CormorantGaramond_600SemiBold',
            fontSize: 20,
            color: '#1A1210',
            marginBottom: 4,
          }}
          testID="founding-creator-month-rail-count"
        >
          {n} / {TARGET_LOOKS} looks this month{'  '}
          <Text style={{ color: '#6B5E58' }}>→</Text>{'  '}
          <Text style={{ color: '#1A1210' }}>
            get featured ✨
          </Text>
        </Text>

        {/* Subcopy */}
        <Text
          style={{
            fontFamily: 'DMSans_400Regular',
            fontSize: 13,
            color: '#6B5E58',
            lineHeight: 18,
            marginBottom: 12,
          }}
          testID="founding-creator-month-rail-subcopy"
        >
          {subcopy}
        </Text>

        {/* Progress bar */}
        <View
          style={{
            height: 8,
            borderRadius: 999,
            backgroundColor: '#EFE3D0',
            overflow: 'hidden',
          }}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: TARGET_LOOKS, now: n }}
        >
          <View
            style={{
              width: `${progress * 100}%`,
              height: '100%',
              backgroundColor: '#B87063',
              borderRadius: 999,
            }}
            testID="founding-creator-month-rail-progress-fill"
          />
        </View>
      </View>
    </View>
  );
}

export default FoundingCreatorMonthRail;
