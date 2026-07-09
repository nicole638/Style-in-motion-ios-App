import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import * as Location from 'expo-location';

function formatCity(place: Location.LocationGeocodedAddress): string {
  const city = place.city || place.subregion || '';
  const region = place.region || '';
  const country = place.country || '';
  if (country === 'United States' && region) return `${city}, ${region}`;
  return [city, country].filter(Boolean).join(', ');
}

interface Suggestion {
  label: string;
  lat: number;
  lng: number;
}

interface Props {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  testID?: string;
}

export default function LocationAutocomplete({ value, onChange, placeholder = 'City, country', testID }: Props) {
  const [query, setQuery] = useState<string>(value);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const search = useCallback(async (text: string) => {
    if (!text || text.length < 2) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
      const results = await Location.geocodeAsync(text);
      const cities = await Promise.all(
        results.slice(0, 5).map(async (r) => {
          const [place] = await Location.reverseGeocodeAsync({ latitude: r.latitude, longitude: r.longitude });
          return {
            label: formatCity(place),
            lat: r.latitude,
            lng: r.longitude,
          };
        })
      );
      const deduped = Array.from(new Map(cities.filter((c) => c.label.length > 0).map((c) => [c.label, c])).values());
      setSuggestions(deduped);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChangeText = useCallback((text: string) => {
    setQuery(text);
    setShowDropdown(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(text), 300);
  }, [search]);

  const handleSelect = useCallback((suggestion: Suggestion) => {
    setQuery(suggestion.label);
    onChange(suggestion.label);
    setShowDropdown(false);
    setSuggestions([]);
  }, [onChange]);

  const handleBlur = useCallback(() => {
    setTimeout(() => setShowDropdown(false), 200);
    const trimmed = query.trim();
    if (trimmed !== value) {
      onChange(trimmed);
    }
  }, [query, value, onChange]);

  return (
    <View style={styles.container}>
      <TextInput
        value={query}
        onChangeText={handleChangeText}
        onBlur={handleBlur}
        onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
        placeholder={placeholder}
        placeholderTextColor="#A0938D"
        style={styles.input}
        testID={testID}
        autoCapitalize="words"
        returnKeyType="done"
      />
      {loading ? (
        <ActivityIndicator size="small" color="#B87063" style={styles.spinner} testID="location-loading" />
      ) : null}
      {showDropdown && suggestions.length > 0 ? (
        <View style={styles.dropdown} testID="location-suggestions">
          {suggestions.map((s) => (
            <Pressable
              key={s.label}
              onPress={() => handleSelect(s)}
              style={({ pressed }) => [styles.suggestion, pressed && styles.suggestionPressed]}
              testID={`location-suggestion-${s.label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`}
            >
              <Text style={styles.suggestionText}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 10,
  },
  input: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: '#1A1210',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E0D8',
  },
  spinner: {
    position: 'absolute',
    right: 4,
    top: 10,
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E8E0D8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 20,
    marginTop: 4,
  },
  suggestion: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0EBE6',
  },
  suggestionPressed: {
    backgroundColor: '#F7F4F0',
  },
  suggestionText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#1A1210',
  },
});
