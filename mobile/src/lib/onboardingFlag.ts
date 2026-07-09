import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'sim_seen_onboarding';

export async function readSeenOnboarding(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
}

export async function writeSeenOnboarding(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // best-effort; user may simply re-onboard next launch
  }
}
