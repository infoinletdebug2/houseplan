import { useColorScheme } from 'react-native';

/**
 * Icons are coloured by MEANING, one colour per meaning everywhere
 * (blueprint C3, DESIGN-SYSTEM.md). Pairs: [disc background, icon colour].
 * The solid disc colours from the boards are used as the icon colour on a
 * soft tint of themselves.
 */
export type Meaning = 'money' | 'estimate' | 'rooms' | 'documents' | 'services' | 'alerts' | 'settings' | 'materials' | 'neutral';

type Pair = [bg: string, fg: string];

const light: Record<Meaning, Pair> = {
  money: ['#FBE4D6', '#B04E1C'], // burnt orange: costs, payments
  estimate: ['#F6EAD1', '#93681A'], // ochre: estimate, calculators
  rooms: ['#F0E3EC', '#7E4A6E'], // plum: rooms, structure
  documents: ['#E2E8F0', '#46607F'], // slate: quotes, documents
  services: ['#E0E9F3', '#2F5D8A'], // cobalt: services, progress
  alerts: ['#F7E1E1', '#A13E46'], // rose
  settings: ['#F1E6DA', '#4A3628'], // espresso: account
  materials: ['#F2E6D8', '#8A5E36'], // clay: procurement
  neutral: ['#F4E9DA', '#7A6A5D'],
};

const dark: Record<Meaning, Pair> = {
  money: ['#3A2418', '#F5A270'],
  estimate: ['#352A16', '#E6C67F'],
  rooms: ['#33212E', '#DDA9CC'],
  documents: ['#1F2733', '#A9BFDA'],
  services: ['#1B2838', '#8DB4DE'],
  alerts: ['#3B2224', '#F09AA2'],
  settings: ['#2E241D', '#E3CDB8'],
  materials: ['#33271C', '#DDB48C'],
  neutral: ['#1E1712', '#B5A493'],
};

export function useAccent(meaning: Meaning): Pair {
  return (useColorScheme() === 'dark' ? dark : light)[meaning];
}

/** Solid tones for bars and charts (stacked bar segments by category). */
export const solid = ['#C4561F', '#C99A45', '#5F7896', '#8E5A7E', '#A9825F', '#2F5D8A', '#E9A27A', '#6B5243'];

export const accents = { light, dark };
