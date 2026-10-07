import type { AdviceKind } from './types';

/** The six things the advisor does (BRD §6.11). Not an open chatbot. */
export const ADVICE_KINDS: Array<{ kind: AdviceKind; label: string; hint: string; prompt?: string }> = [
  { kind: 'explain_estimate', label: 'Explain my estimate', hint: 'What the total is made of, in plain words' },
  { kind: 'cost_drivers', label: 'What drives the cost', hint: 'The few lines that matter most' },
  { kind: 'missing_costs', label: 'What could be missing', hint: 'Gaps, unpriced lines, undecided scope' },
  { kind: 'compare_options', label: 'Compare options', hint: 'Weigh a scenario against the baseline', prompt: 'Which choice are you weighing?' },
  { kind: 'forecast_summary', label: 'Summarise the forecast', hint: 'Cash still needed and why' },
  { kind: 'contractor_questions', label: 'Questions for my builder', hint: 'What to ask before you sign', prompt: 'Anything specific to ask about?' },
];

export const kindLabel = (k: AdviceKind) => ADVICE_KINDS.find((x) => x.kind === k)?.label ?? 'Advice';
