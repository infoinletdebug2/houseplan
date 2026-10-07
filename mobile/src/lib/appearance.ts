import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Light, dark, or follow the phone. Per device; applied app-wide through RN's Appearance. */
export type AppearanceChoice = 'system' | 'light' | 'dark';

const KEY = 'houseplan.appearance';

export const APPEARANCE_LABEL: Record<AppearanceChoice, string> = { system: 'Same as phone', light: 'Light', dark: 'Dark' };

function apply(choice: AppearanceChoice): void {
  try {
    // 'unspecified' hands control back to the phone.
    Appearance.setColorScheme?.(choice === 'system' ? ('unspecified' as never) : choice);
  } catch {
    /* web and old runtimes: follow the system */
  }
}

export async function loadAppearance(): Promise<AppearanceChoice> {
  const raw = await AsyncStorage.getItem(KEY).catch(() => null);
  const choice: AppearanceChoice = raw === 'light' || raw === 'dark' ? raw : 'system';
  apply(choice);
  return choice;
}

export async function setAppearance(choice: AppearanceChoice): Promise<void> {
  apply(choice);
  await AsyncStorage.setItem(KEY, choice).catch(() => undefined);
}
