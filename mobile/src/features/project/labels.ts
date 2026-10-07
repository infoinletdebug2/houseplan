import type { ImageKey } from '../../assets/images';
import type { FinishTier, Project, ProjectType, RoomType } from './types';

/** Plain words for the codes the worker uses (blueprint A5: "Recipes", not "BOMs"). */

export const TYPE_LABEL: Record<ProjectType, string> = { new_build: 'New build', extension: 'Extension', renovation: 'Renovation' };
export const TYPE_HINT: Record<ProjectType, string> = {
  new_build: 'A whole new house, from the ground up',
  extension: 'Adding space to the house you have',
  renovation: 'Reworking rooms inside an existing house',
};
export const TYPE_IMAGE: Record<ProjectType, ImageKey> = { new_build: 'type-new-build', extension: 'type-extension', renovation: 'type-renovation' };

export const TIER_LABEL: Record<FinishTier, string> = { economical: 'Economical', standard: 'Standard', premium: 'Premium' };
export const TIER_HINT: Record<FinishTier, string> = {
  economical: 'Practical, hard-wearing finishes',
  standard: 'Mid-range finishes most people choose',
  premium: 'Natural materials and fine fittings',
};
export const TIER_IMAGE: Record<FinishTier, ImageKey> = { economical: 'tier-economical', standard: 'tier-standard', premium: 'tier-premium' };

/** The project's cover photo: its build type's photo. */
export function coverImage(p: Pick<Project, 'type'>): ImageKey {
  return TYPE_IMAGE[p.type] ?? 'type-new-build';
}

export const ROOM_TYPES: Array<{ value: RoomType; label: string }> = [
  { value: 'living', label: 'Living room' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'dining', label: 'Dining room' },
  { value: 'bedroom', label: 'Bedroom' },
  { value: 'bathroom', label: 'Bathroom' },
  { value: 'hall', label: 'Hall or landing' },
  { value: 'utility', label: 'Utility' },
  { value: 'office', label: 'Office' },
  { value: 'garage', label: 'Garage' },
  { value: 'other', label: 'Other' },
];
export const roomTypeLabel = (t: string) => ROOM_TYPES.find((r) => r.value === t)?.label ?? 'Room';

export function storeyLabel(i: number): string {
  if (i === 0) return 'Ground floor';
  if (i < 0) return i === -1 ? 'Basement' : `Basement ${-i}`;
  if (i === 1) return 'First floor';
  if (i === 2) return 'Second floor';
  if (i === 3) return 'Third floor';
  return `Floor ${i}`;
}

export const INCLUSION_LABEL = { included: 'Included', excluded: 'Not in budget', undecided: 'Undecided' } as const;
