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
  money: ['#F4E2DB', '#B0603F'], // terracotta: costs, payments
  estimate: ['#F4E9D2', '#9A6F1E'], // ochre: estimate, calculators
  rooms: ['#E3EBE1', '#4F6E4A'], // sage: rooms, structure
  documents: ['#E1E7EF', '#435D7E'], // slate: quotes, documents
  services: ['#DCECEB', '#2F6F6C'], // teal: services, progress
  alerts: ['#F6E3E2', '#A2444D'], // rose
  settings: ['#E1E9E7', '#2F4D47'], // spruce: account
  materials: ['#EFE5DA', '#86613D'], // clay: procurement
  neutral: ['#ECE5D9', '#5F6B66'],
};

const dark: Record<Meaning, Pair> = {
  money: ['#3A2620', '#EBA58A'],
  estimate: ['#352B18', '#E3C27F'],
  rooms: ['#223024', '#A9C6A2'],
  documents: ['#1F2836', '#A6BCD8'],
  services: ['#173130', '#86CBC6'],
  alerts: ['#3B2427', '#F09AA2'],
  settings: ['#1E2B28', '#B6D2CA'],
  materials: ['#33281E', '#D9B48E'],
  neutral: ['#18201E', '#9AA6A1'],
};

export function useAccent(meaning: Meaning): Pair {
  return (useColorScheme() === 'dark' ? dark : light)[meaning];
}

/** Solid tones for bars and charts (stacked bar segments by category). */
export const solid = ['#7F9A7A', '#C9785F', '#C99A45', '#5F7896', '#4E8F8C', '#A9825F', '#3F5E57', '#B5545C'];

export const accents = { light, dark };
