import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The person's Reduce Motion setting, kept current (blueprint C4: Reduce
 * Motion means no animation, render the final state instantly).
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduce(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduce(v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduce;
}
