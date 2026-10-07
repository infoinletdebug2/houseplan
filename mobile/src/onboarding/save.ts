import { api, ApiError } from '../api/client';
import type { Me, Onboarding } from '../types';

/**
 * Save tap-only onboarding answers straight to the account (PUT
 * /me/onboarding, version-checked). On a version conflict (another device
 * moved on) it re-reads /me and tries once more with the fresh version.
 */
export async function saveOnboarding(me: Me, patch: Partial<Pick<Onboarding, 'build_type' | 'priorities' | 'role_hint' | 'step'>> & { complete?: boolean }, refresh: () => Promise<Me | null>): Promise<void> {
  try {
    await api.put<Onboarding>('/me/onboarding', { expected_version: me.onboarding.version, ...patch });
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'VERSION_CONFLICT')) throw error;
    const fresh = await refresh();
    if (!fresh) throw error;
    await api.put<Onboarding>('/me/onboarding', { expected_version: fresh.onboarding.version, ...patch });
  }
}
