import { useEffect, useState } from 'react';
import { disconnect, isAvailable, loadPlans, type StorePlan } from './store';

/**
 * The store's plans with their localised prices, for the offer and the paywall.
 * `available` false = no store in this build (Expo Go, a simulator without a
 * sandbox account): the screens then show plans without prices, never a
 * made-up number.
 */
export function usePlans() {
  const [plans, setPlans] = useState<StorePlan[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const ok = await isAvailable().catch(() => false);
      const list = ok ? await loadPlans().catch(() => []) : [];
      if (!alive) return;
      setAvailable(ok);
      setPlans(list);
    })();
    return () => {
      alive = false;
      void disconnect();
    };
  }, []);
  return {
    plans,
    available,
    yearly: plans.find((p) => p.period === 'yearly') ?? null,
    monthly: plans.find((p) => p.period === 'monthly') ?? null,
  };
}
