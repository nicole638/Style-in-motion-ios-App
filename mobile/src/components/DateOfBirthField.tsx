import React, { useRef, useState, useCallback } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { partsToISO } from '@/lib/age';

interface DateOfBirthFieldProps {
  /** Called on every edit with a valid ISO yyyy-mm-dd, or null while incomplete/invalid. */
  onChange: (iso: string | null) => void;
  /** Optional inline message (e.g. the under-16 notice) rendered under the field. */
  error?: string | null;
  testID?: string;
}

/**
 * Neutral date-of-birth entry (Month / Day / Year), used by both signup flows to
 * enforce the 16+ age gate. Deliberately a plain numeric entry with no picker
 * dependency and NO hint about the passing threshold — a neutral age screen is
 * what Apple expects. The parent decides pass/fail via lib/age.
 */
export function DateOfBirthField({ onChange, error, testID }: DateOfBirthFieldProps) {
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [year, setYear] = useState('');

  const dayRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);

  const emit = useCallback(
    (mo: string, d: string, y: string) => {
      onChange(partsToISO(mo, d, y));
    },
    [onChange],
  );

  const onMonth = useCallback((t: string) => {
    const v = t.replace(/\D/g, '').slice(0, 2);
    setMonth(v);
    emit(v, day, year);
    if (v.length === 2) dayRef.current?.focus();
  }, [day, year, emit]);

  const onDay = useCallback((t: string) => {
    const v = t.replace(/\D/g, '').slice(0, 2);
    setDay(v);
    emit(month, v, year);
    if (v.length === 2) yearRef.current?.focus();
  }, [month, year, emit]);

  const onYear = useCallback((t: string) => {
    const v = t.replace(/\D/g, '').slice(0, 4);
    setYear(v);
    emit(month, day, v);
  }, [month, day, emit]);

  return (
    <View testID={testID}>
      <Text style={styles.label}>Date of birth</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.box, styles.mmdd]}
          value={month}
          onChangeText={onMonth}
          placeholder="MM"
          placeholderTextColor="#B8ADA5"
          keyboardType="number-pad"
          maxLength={2}
          returnKeyType="next"
          testID="dob-month"
        />
        <Text style={styles.sep}>/</Text>
        <TextInput
          ref={dayRef}
          style={[styles.box, styles.mmdd]}
          value={day}
          onChangeText={onDay}
          placeholder="DD"
          placeholderTextColor="#B8ADA5"
          keyboardType="number-pad"
          maxLength={2}
          returnKeyType="next"
          testID="dob-day"
        />
        <Text style={styles.sep}>/</Text>
        <TextInput
          ref={yearRef}
          style={[styles.box, styles.yyyy]}
          value={year}
          onChangeText={onYear}
          placeholder="YYYY"
          placeholderTextColor="#B8ADA5"
          keyboardType="number-pad"
          maxLength={4}
          returnKeyType="done"
          testID="dob-year"
        />
      </View>
      {error ? <Text style={styles.error} testID="dob-error">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#6B5E58',
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  box: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E0D8',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    color: '#1A1210',
    textAlign: 'center',
  },
  mmdd: { width: 58 },
  yyyy: { width: 84 },
  sep: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 18,
    color: '#B8ADA5',
  },
  error: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#B4453A',
    marginTop: 6,
  },
});
