/**
 * Age gate for account creation.
 *
 * Apple's UGC/social questionnaire requires that users under 13 have no access
 * to social features. Styled in Motion goes further — per product decision the
 * minimum age to create ANY account (creator or shopper) is 16, so under-13s
 * (and under-16s) simply cannot sign up, which satisfies the under-13 rule by
 * construction.
 *
 * This is a self-declared date-of-birth gate. It is NOT Apple's Declared Age
 * Range API (a native iOS 26 call) — that is a separate, additional signal we
 * can layer on later; do not attest to that specific API on the strength of
 * this module alone.
 */
export const MIN_SIGNUP_AGE = 16;

/** Full years old on `asOf` (default today) for an ISO `yyyy-mm-dd` birth date. */
export function computeAge(birthDateISO: string, asOf: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDateISO);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Reject impossible dates (e.g. 02/31) by round-tripping through Date.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (dt.getTime() > asOf.getTime()) return null; // future date

  let age = asOf.getFullYear() - y;
  const beforeBirthdayThisYear =
    asOf.getMonth() + 1 < mo || (asOf.getMonth() + 1 === mo && asOf.getDate() < d);
  if (beforeBirthdayThisYear) age -= 1;
  return age;
}

/** True only when the birth date is valid AND the person is at least MIN_SIGNUP_AGE. */
export function isOldEnoughToSignUp(birthDateISO: string, asOf: Date = new Date()): boolean {
  const age = computeAge(birthDateISO, asOf);
  return age !== null && age >= MIN_SIGNUP_AGE;
}

/**
 * Compose an ISO `yyyy-mm-dd` from separate month/day/year strings, or null if
 * the parts don't form a real calendar date. Used by the DateOfBirthField.
 */
export function partsToISO(month: string, day: string, year: string): string | null {
  if (!/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day) || !/^\d{4}$/.test(year)) return null;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  // computeAge validates the calendar date; reuse it as the single source of truth.
  return computeAge(iso) === null ? null : iso;
}
