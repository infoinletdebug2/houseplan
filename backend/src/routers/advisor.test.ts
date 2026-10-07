import { describe, expect, it } from 'vitest';
import { fallbackAdvice, validateAdvice } from './advisor';

const LINE = '11111111-1111-4111-8111-111111111111';
const REV = '22222222-2222-4222-8222-222222222222';
const SCEN = '33333333-3333-4333-8333-333333333333';

const ctx = {
  revision: { id: REV, version: 3, revision_number: 2, status: 'frozen', gross_known_minor: '5400000', reserve_minor: '540000', missing_line_count: 1, unresolved_category_count: 1, contingency_percent: '10' },
  data: { revision: { gross_known_minor: '5400000' }, lines: [{ id: LINE, gross_minor: '1200000' }], scenarios: [{ scenario_id: SCEN, savings_minor: '720000' }] },
  lineIds: new Set([LINE]),
  scenarioSavings: new Map([[SCEN, '720000']]),
  calculationIds: new Set<string>(),
  categories: [
    { code: 'STRUCTURE', name: 'Frame, walls and floors', inclusion: 'included', subtotal: 4200000n, missing: 0 },
    { code: 'FLOORING', name: 'Flooring', inclusion: 'included', subtotal: 1200000n, missing: 1 },
    { code: 'FEES', name: 'Design, surveys and permits', inclusion: 'undecided', subtotal: 0n, missing: 0 },
  ],
  currency: 'EUR',
};

const base = { summary: 'Known subtotal is EUR 54,000.', observations: [], suggestions: [], missing_information: [], professional_questions: [], limitations: [] };

describe('advisor validation (BRD 6.11)', () => {
  it('AC21: keeps a saving only when it equals the server figure', () => {
    const out = validateAdvice(
      {
        ...base,
        suggestions: [
          { title: 'Adopt vinyl floors', reason: 'The scenario is fully priced.', tradeoffs: [], scenario_id: SCEN, calculation_id: null, verified_savings_minor: '720000', requires_professional_review: false },
          { title: 'Cheaper tiles', reason: 'Could save more.', tradeoffs: [], scenario_id: SCEN, calculation_id: null, verified_savings_minor: '999999', requires_professional_review: false },
          { title: 'Made-up scenario', reason: 'x', tradeoffs: [], scenario_id: 'not-ours', calculation_id: null, verified_savings_minor: '720000', requires_professional_review: false },
        ],
      },
      ctx as never,
    );
    expect(out.suggestions[0]!.verified_savings_minor).toBe('720000');
    expect(out.suggestions[1]!.verified_savings_minor).toBeNull();
    expect(out.suggestions[2]!.scenario_id).toBeNull();
    expect(out.suggestions[2]!.verified_savings_minor).toBeNull();
  });

  it('AC21: removes amounts that are not in the project data', () => {
    const out = validateAdvice(
      {
        ...base,
        summary: 'Local builders charge about €1,850 per square metre.',
        suggestions: [{ title: 'Typical price', reason: 'Kitchens usually cost $25,000 here.', tradeoffs: [], scenario_id: null, calculation_id: null, verified_savings_minor: null, requires_professional_review: false }],
      },
      ctx as never,
    );
    expect(out.summary).toContain('[amount removed]');
    expect(out.suggestions).toHaveLength(0);
    expect(out.limitations.join(' ')).toMatch(/removed/);
  });

  it('withholds advice to drop safety work', () => {
    const out = validateAdvice(
      { ...base, suggestions: [{ title: 'Skip the waterproofing', reason: 'Save money by skipping waterproofing in the shower.', tradeoffs: [], scenario_id: null, calculation_id: null, verified_savings_minor: null, requires_professional_review: false }] },
      ctx as never,
    );
    expect(out.suggestions).toHaveLength(0);
    expect(out.limitations.join(' ')).toMatch(/withheld/);
  });

  it('strips line ids that are not in this revision and pins the revision id', () => {
    const out = validateAdvice({ ...base, observations: [{ text: 'Flooring is a large line.', line_ids: [LINE, 'foreign-id'], revision_id: 'other' }] }, ctx as never);
    expect(out.observations[0]!.line_ids).toEqual([LINE]);
    expect(out.observations[0]!.revision_id).toBe(REV);
  });

  it('flags structural questions for professional review', () => {
    const out = validateAdvice(
      { ...base, suggestions: [{ title: 'Open up the kitchen wall', reason: 'It may be load-bearing, so ask an engineer first.', tradeoffs: [], scenario_id: null, calculation_id: null, verified_savings_minor: null, requires_professional_review: false }] },
      ctx as never,
    );
    expect(out.suggestions[0]!.requires_professional_review).toBe(true);
  });

  it('rejects a malformed answer so the fallback runs', () => {
    expect(() => validateAdvice({ summary: 3 }, ctx as never)).toThrow();
  });

  it('fallback ranks categories from the figures and lists what is missing', () => {
    const out = fallbackAdvice(ctx as never);
    expect(out.summary).toContain('EUR 54,000.00');
    expect(out.observations[0]!.text).toContain('Frame, walls and floors');
    expect(out.missing_information.join(' ')).toMatch(/Flooring: 1 line without a price/);
    expect(out.missing_information.join(' ')).toMatch(/Design, surveys and permits: decide/);
  });
});
