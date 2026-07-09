import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Animated } from 'react-native';
import { supabase } from '@/lib/supabase';

interface UsernameCheckResult {
  available: boolean;
  normalized: string;
  reason: 'too_short' | 'too_long' | 'invalid_chars' | 'invalid_format' | 'reserved' | 'taken' | null;
  suggestions: string[];
}

interface UsernameFieldProps {
  initialValue: string;
  onValidityChange: (isValid: boolean, normalized: string) => void;
  autoFocus?: boolean;
}

export default function UsernameField({ initialValue, onValidityChange, autoFocus = false }: UsernameFieldProps) {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState<'idle' | 'checking' | 'available' | 'unavailable'>('idle');
  const [reason, setReason] = useState<UsernameCheckResult['reason']>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<string>('');
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const onValidityChangeRef = useRef(onValidityChange);
  onValidityChangeRef.current = onValidityChange;

  useEffect(() => {
    if (status === 'checking') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    pulseAnim.setValue(1);
  }, [status, pulseAnim]);

  const checkUsername = useCallback(async (candidate: string) => {
    latestRef.current = candidate;
    setStatus('checking');

    try {
      const { data, error } = await supabase.rpc('check_username_availability', { candidate });

      if (latestRef.current !== candidate) return;

      if (error) {
        setStatus('idle');
        onValidityChangeRef.current(false, candidate);
        return;
      }

      const result = data as UsernameCheckResult;
      if (result.available) {
        setStatus('available');
        setReason(null);
        setSuggestions([]);
        onValidityChangeRef.current(true, result.normalized);
      } else {
        setStatus('unavailable');
        setReason(result.reason);
        setSuggestions(result.suggestions ?? []);
        onValidityChangeRef.current(false, result.normalized);
      }
    } catch {
      if (latestRef.current !== candidate) return;
      setStatus('idle');
      onValidityChangeRef.current(false, candidate);
    }
  }, []);

  useEffect(() => {
    const trimmed = initialValue.trim();
    if (trimmed) {
      checkUsername(trimmed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChangeText = useCallback((text: string) => {
    setValue(text);
    const trimmed = text.trim();

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!trimmed) {
      setStatus('idle');
      setReason(null);
      setSuggestions([]);
      latestRef.current = '';
      onValidityChangeRef.current(false, '');
      return;
    }

    debounceRef.current = setTimeout(() => {
      checkUsername(trimmed);
    }, 400);
  }, [checkUsername]);

  const handleSuggestionTap = useCallback((suggestion: string) => {
    setValue(suggestion);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    checkUsername(suggestion);
  }, [checkUsername]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <View style={styles.container} testID="username-field">
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={handleChangeText}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        cursorColor="#2C2C2C"
        selectionColor="rgba(44, 44, 44, 0.3)"
        placeholder="username"
        placeholderTextColor="#A0938D"
        testID="username-field-input"
      />
      {status === 'checking' ? (
        <View style={styles.statusRow} testID="username-checking">
          <Animated.View style={[styles.pulsingDot, { opacity: pulseAnim }]} />
          <Text style={styles.checkingText}>Checking…</Text>
        </View>
      ) : status === 'available' ? (
        <View style={styles.statusRow} testID="username-available">
          <Text style={styles.checkmark}>✓</Text>
          <Text style={styles.availableText}>{value.trim()} is available</Text>
        </View>
      ) : status === 'unavailable' ? (
        <View testID="username-unavailable">
          <Text style={styles.unavailableText}>
            {reason === 'taken' ? `${value.trim()} is taken` :
             reason === 'too_short' ? 'At least 3 characters' :
             reason === 'too_long' ? '30 characters max' :
             reason === 'invalid_chars' ? 'Letters, numbers, dots, and underscores only' :
             reason === 'invalid_format' ? "Can't start or end with . or _, no doubles" :
             reason === 'reserved' ? "That one's reserved" : 'Not available'}
          </Text>
          {reason === 'taken' && suggestions.length > 0 ? (
            <View style={styles.suggestionsRow} testID="username-suggestions">
              {suggestions.map((s) => (
                <Pressable
                  key={s}
                  style={styles.suggestionChip}
                  onPress={() => handleSuggestionTap(s)}
                  testID={`suggestion-${s}`}
                >
                  <Text style={styles.suggestionText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  input: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    color: '#1A1210',
    borderBottomWidth: 1.5,
    borderBottomColor: '#C4A882',
    paddingHorizontal: 12,
    paddingBottom: 4,
    minWidth: 160,
    textAlign: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    gap: 6,
  },
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#C4A882',
  },
  checkingText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#8C8580',
  },
  checkmark: {
    fontSize: 16,
    color: '#2E7D52',
    fontWeight: '700',
  },
  availableText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#2E7D52',
  },
  unavailableText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#B87063',
    textAlign: 'center',
    marginTop: 8,
  },
  suggestionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  suggestionChip: {
    backgroundColor: '#F0EBE5',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E8E0D8',
  },
  suggestionText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: '#1A1210',
  },
});
