import type { ImageKey } from '../assets/images';
import type { BuildType, Priority, RoleHint } from '../types';

/** Step 1 (and its review in step 3): what HousePlan should help with. Multi-select photo tiles. */
export const PRIORITIES: Array<{ value: Priority; label: string; hint: string; image: ImageKey }> = [
  { value: 'know_total', label: 'Full cost', hint: 'Every category, gaps shown', image: 'discover-budget' },
  { value: 'compare_finishes', label: 'Finishes', hint: 'Compare before buying', image: 'tier-standard' },
  { value: 'control_spending', label: 'Spending', hint: 'Invoices and payments', image: 'discover-quotes' },
  { value: 'manage_quotes', label: 'Quotes', hint: 'Side by side', image: 'discover-compare' },
  { value: 'track_progress', label: 'Progress', hint: 'Phases and materials', image: 'discover-progress' },
  { value: 'avoid_surprises', label: 'Cost to finish', hint: 'No surprises at the end', image: 'discover-rooms' },
];

/** Step 2: what is being built. Single-select photo cards. */
export const BUILDS: Array<{ value: BuildType; title: string; subtitle: string; image: ImageKey }> = [
  { value: 'new_build', title: 'A new house', subtitle: 'From the plot up: site, structure and every finish', image: 'type-new-build' },
  { value: 'extension', title: 'An extension', subtitle: 'More room on a home you already have', image: 'type-extension' },
  { value: 'renovation', title: 'A renovation', subtitle: 'Strip out and rework what is there', image: 'type-renovation' },
];

/** Step 3: who is planning. */
export const ROLES: Array<{ value: RoleHint; label: string }> = [
  { value: 'homeowner', label: 'Homeowner' },
  { value: 'self_builder', label: 'Self-builder' },
  { value: 'builder', label: 'Builder' },
];
