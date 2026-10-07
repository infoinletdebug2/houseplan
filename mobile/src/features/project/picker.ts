import type { Rate } from './types';

/**
 * A one-shot hand-off between a form and the rate book opened as a picker
 * (S16 → S18 → back). The form registers a callback, the rate book calls it
 * with the chosen rate and goes back. Nothing global survives the hand-off.
 */
let pending: ((rate: Rate) => void) | null = null;

export function awaitRate(cb: (rate: Rate) => void): void {
  pending = cb;
}

export function deliverRate(rate: Rate): boolean {
  const cb = pending;
  pending = null;
  if (!cb) return false;
  cb(rate);
  return true;
}

export function cancelRatePick(): void {
  pending = null;
}
