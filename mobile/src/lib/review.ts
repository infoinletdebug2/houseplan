import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import * as StoreReview from 'expo-store-review';
import { api } from '../api/client';
import { ANDROID_PACKAGE, APP_VERSION, APPLE_APP_ID } from '../config';
import { installationId } from './installation';

/**
 * The store review prompt (BRD §6.13), within what the stores allow.
 *
 *   - **Success moments that count:** an estimate revision saved, a
 *     calculation added to the estimate, a comparison saved, an export
 *     shared, a cost posted, a forecast confirmed.
 *   - **Eligible when:** ≥ 3 successes across ≥ 2 sessions AND ≥ 7 days since
 *     first use AND not asked in the last 120 days AND at most once per app
 *     version AND `isAvailableAsync()`. The SERVER is asked first
 *     (`POST /me/review-prompts`), so a reinstall cannot reset the cooldown.
 *   - **When:** 2.5 s after the success toast, never during onboarding, the
 *     paywall, after an error, on launch or mid-payment.
 *   - Native only; we record the ATTEMPT. No sentiment gate, no reward, never
 *     gates a feature. Settings → Rate HousePlan opens the listing any time.
 */

export type SuccessMoment = 'revision_saved' | 'calculation_added' | 'comparison_saved' | 'export_shared' | 'cost_posted' | 'forecast_confirmed';

const KEYS = {
  firstSeen: 'houseplan.review.firstSeen',
  successes: 'houseplan.review.successes',
  sessions: 'houseplan.review.sessions',
  nextEligible: 'houseplan.review.nextEligibleAt',
  askedVersion: 'houseplan.review.askedVersion',
} as const;

const MIN_SUCCESSES = 3;
const MIN_SESSIONS = 2;
const MIN_DAYS = 7;
const COOLDOWN_DAYS = 120;
const DELAY_MS = 2500;
const DAY = 86_400_000;

async function read(key: string): Promise<string | null> {
  return AsyncStorage.getItem(key).catch(() => null);
}

async function write(key: string, value: string): Promise<void> {
  await AsyncStorage.setItem(key, value).catch(() => undefined);
}

let sessionCounted = false;

/** Call on launch when signed in: starts the 7-day clock and counts this session once. */
export async function noteFirstUse(): Promise<void> {
  if (!(await read(KEYS.firstSeen))) await write(KEYS.firstSeen, String(Date.now()));
  if (sessionCounted) return;
  sessionCounted = true;
  await write(KEYS.sessions, String(Number((await read(KEYS.sessions)) ?? '0') + 1));
}

/** Pure gate, exported for tests. */
export function reviewEligible(input: { successes: number; sessions: number; firstSeen: number; nextEligibleAt: number; now: number; askedThisVersion: boolean }): boolean {
  if (input.askedThisVersion) return false;
  if (input.successes < MIN_SUCCESSES || input.sessions < MIN_SESSIONS) return false;
  if (!input.firstSeen || input.now - input.firstSeen < MIN_DAYS * DAY) return false;
  return input.now >= input.nextEligibleAt;
}

let pending: ReturnType<typeof setTimeout> | null = null;

/** A meaningful action succeeded. Counts it and, if eligible, asks shortly after the confirmation. */
export async function noteSuccess(moment: SuccessMoment): Promise<void> {
  const count = Number((await read(KEYS.successes)) ?? '0') + 1;
  await write(KEYS.successes, String(count));
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  const now = Date.now();
  const eligible = reviewEligible({
    successes: count,
    sessions: Number((await read(KEYS.sessions)) ?? '0'),
    firstSeen: Number((await read(KEYS.firstSeen)) ?? '0'),
    nextEligibleAt: Number((await read(KEYS.nextEligible)) ?? '0'),
    now,
    askedThisVersion: (await read(KEYS.askedVersion)) === APP_VERSION,
  });
  if (!eligible) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void ask(moment);
  }, DELAY_MS);
}

async function ask(moment: SuccessMoment): Promise<void> {
  try {
    if (!(await StoreReview.isAvailableAsync())) return;
  } catch {
    return;
  }
  const now = Date.now();
  try {
    const answer = await api.post<{ recorded: boolean; eligible_again_at: string | null }>('/me/review-prompts', {
      installation_id: await installationId(),
      app_version: APP_VERSION,
      trigger: moment,
    });
    const serverNext = answer?.eligible_again_at ? Date.parse(answer.eligible_again_at) : NaN;
    await write(KEYS.nextEligible, String(Math.max(now + COOLDOWN_DAYS * DAY, Number.isFinite(serverNext) ? serverNext : 0)));
    if (answer && answer.recorded === false) return;
  } catch {
    await write(KEYS.nextEligible, String(now + COOLDOWN_DAYS * DAY));
  }
  await write(KEYS.askedVersion, APP_VERSION);
  try {
    await StoreReview.requestReview();
  } catch {
    // The OS may drop it silently; the attempt is spent either way.
  }
}

export function canOpenStoreListing(): boolean {
  return Platform.OS === 'ios' ? APPLE_APP_ID.length > 0 : ANDROID_PACKAGE.length > 0;
}

/** Settings → "Rate HousePlan": a link, no quota. */
export async function openStoreListing(): Promise<void> {
  const url =
    Platform.OS === 'ios'
      ? `https://apps.apple.com/app/id${APPLE_APP_ID}?action=write-review`
      : `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}&showAllReviews=true`;
  await Linking.openURL(url).catch(() => undefined);
}
