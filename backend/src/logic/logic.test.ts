import { describe, expect, it } from 'vitest';
import { D } from './decimal';
import { CalcError, feetToMetres, priceLine, roomGeometry, runCalculator, netFromGross } from './calc';

const EUR = { currency: 'EUR', minorDigits: 2 };

describe('decimal', () => {
  it('is exact where floats are not', () => {
    expect(D('0.1').add('0.2').toFixed(6)).toBe('0.3');
    expect(D('22').div('2.2').ceil()).toBe(10n);
    expect(D('17.6').div('5').ceil()).toBe(4n);
  });
  it('rounds half-up away from zero', () => {
    expect(D('2.345').roundTo(2)).toBe(235n);
    expect(D('-2.345').roundTo(2)).toBe(-235n);
    expect(D('2.344').roundTo(2)).toBe(234n);
  });
});

describe('AC09 flooring fixture (BRD 6.5)', () => {
  const r = runCalculator('flooring', { net_area_m2: '20', waste_percent: '10', pack_area_m2: '2.2', pack_price_net: '30', labour_rate_net: '12', labour_basis: 'net_area' }, EUR);
  it('quantities', () => {
    expect(r.quantities).toMatchObject({ net_area_m2: '20', required_area_m2: '22', packs: 10, purchased_area_m2: '22' });
  });
  it('money', () => {
    expect(r.costs.material_net_minor).toBe('30000');
    expect(r.costs.labour_net_minor).toBe('24000');
    expect(r.totals).toEqual({ net_minor: '54000', tax_minor: '0', gross_minor: '54000' });
    expect(r.complete).toBe(true);
  });
});

describe('AC09 paint fixture (BRD 6.5)', () => {
  const r = runCalculator('paint', { net_surface_m2: '80', coats: '2', coverage_m2_per_litre: '10', waste_percent: '10', can_size_litres: '5', labour_basis: 'none' }, EUR);
  it('17.6 L required, 4 cans, 20 L purchased', () => {
    expect(r.quantities).toMatchObject({ litres_required: '17.6', cans: 4, purchased_litres: '20' });
  });
  it('AC11: no price → quantities, null cost, incomplete', () => {
    expect(r.totals).toBeNull();
    expect(r.costs.material_net_minor).toBeNull();
    expect(r.complete).toBe(false);
    expect(r.missing_fields).toContain('can_price_net');
  });
});

describe('pack rounding at exact boundaries', () => {
  it('exactly one pack is one pack', () => {
    const r = runCalculator('flooring', { net_area_m2: '2.2', pack_area_m2: '2.2', labour_basis: 'none' }, EUR);
    expect(r.quantities.packs).toBe(1);
  });
  it('a hair over is two packs', () => {
    const r = runCalculator('flooring', { net_area_m2: '2.200001', pack_area_m2: '2.2', labour_basis: 'none' }, EUR);
    expect(r.quantities.packs).toBe(2);
  });
});

describe('AC20 composite installed rate', () => {
  it('refuses a separate labour price when the rate includes fitting', () => {
    expect(() =>
      runCalculator('flooring', { net_area_m2: '20', pack_area_m2: '2', pack_price_net: '50', labour_rate_net: '12', material_includes: { labour: true } }, EUR),
    ).toThrow(CalcError);
  });
  it('charges no labour on top of an installed rate', () => {
    const r = runCalculator('flooring', { net_area_m2: '20', pack_area_m2: '2', pack_price_net: '50', material_includes: { labour: true } }, EUR);
    expect(r.costs.labour_net_minor).toBe('0');
    expect(r.totals?.net_minor).toBe('50000');
  });
});

describe('skirting and wallpaper', () => {
  it('skirting leaves doors out and buys whole lengths', () => {
    const r = runCalculator('skirting', { perimeter_m: '18', door_widths_m: '0.9', waste_percent: '10', stock_length_m: '2.4', labour_basis: 'none' }, EUR);
    // (18 - 0.9) × 1.1 / 2.4 = 7.8375 → 8
    expect(r.quantities).toMatchObject({ required_length_m: '17.1', pieces: 8, purchased_length_m: '19.2' });
  });
  it('wallpaper straight match: strips per wall, rolls by cut length', () => {
    const r = runCalculator('wallpaper', { walls: [{ width_m: '4', height_m: '2.4' }, { width_m: '3', height_m: '2.4' }], roll_width_m: '0.53', roll_length_m: '10.05', labour_basis: 'none' }, EUR);
    // strips: ceil(4/0.53)=8 + ceil(3/0.53)=6 = 14; cut 2.5 → 4 per roll → 4 rolls
    expect(r.quantities).toMatchObject({ strips: 14, rolls: 4 });
  });
  it('wallpaper refuses a strip longer than the roll', () => {
    expect(() => runCalculator('wallpaper', { walls: [{ width_m: '3', height_m: '12' }], roll_width_m: '0.53', roll_length_m: '10' }, EUR)).toThrow(CalcError);
  });
});

describe('geometry (BRD 6.3)', () => {
  it('rectangular room with openings', () => {
    const g = roomGeometry({
      length_m: '5', width_m: '4', height_m: '2.5', manual_floor_area_m2: null, manual_wall_area_m2: null, manual_perimeter_m: null,
      openings: [
        { opening_type: 'door', width_m: '0.9', height_m: '2.1', floor_cutout_area_m2: null, count: 1 },
        { opening_type: 'window', width_m: '1.2', height_m: '1.2', floor_cutout_area_m2: null, count: 2 },
      ],
    });
    expect(g.floor_area_m2).toBe('20');
    expect(g.perimeter_m).toBe('18');
    expect(g.gross_wall_area_m2).toBe('45');
    expect(g.wall_openings_m2).toBe('4.77');
    expect(g.net_wall_area_m2).toBe('40.23');
    expect(g.door_width_total_m).toBe('0.9');
    expect(g.complete).toBe(true);
  });
  it('openings larger than the walls are invalid', () => {
    expect(() =>
      roomGeometry({ length_m: '1', width_m: '1', height_m: '1', manual_floor_area_m2: null, manual_wall_area_m2: null, manual_perimeter_m: null,
        openings: [{ opening_type: 'window', width_m: '2', height_m: '2', floor_cutout_area_m2: null, count: 1 }] }),
    ).toThrow(CalcError);
  });
  it('missing height leaves walls incomplete, not zero', () => {
    const g = roomGeometry({ length_m: '5', width_m: '4', height_m: null, manual_floor_area_m2: null, manual_wall_area_m2: null, manual_perimeter_m: null, openings: [] });
    expect(g.net_wall_area_m2).toBeNull();
    expect(g.missing).toContain('height_m');
  });
});

describe('AC10 imperial round trip', () => {
  it('16.404199 ft × 13.123360 ft ≈ 5 m × 4 m → same packs', () => {
    const l = feetToMetres('16.404199');
    const w = feetToMetres('13.12336');
    const area = D(l).mul(w).toFixed(6);
    expect(Math.abs(Number(area) - 20)).toBeLessThan(0.0001);
    const r = runCalculator('flooring', { net_area_m2: area, waste_percent: '10', pack_area_m2: '2.2', pack_price_net: '30', labour_rate_net: '12' }, EUR);
    expect(r.quantities.packs).toBe(10);
  });
});

describe('line pricing (BRD 6.6)', () => {
  it('round per line, tax on the rounded net', () => {
    expect(priceLine('3', '33.333333', 0n, '20', 2)).toEqual({ net_minor: '10000', tax_minor: '2000', gross_minor: '12000' });
  });
  it('null price stays null, never zero', () => {
    expect(priceLine('3', null, 0n, '20', 2)).toBeNull();
  });
  it('tax-inclusive entry converts to net with its own rate', () => {
    expect(netFromGross('120', '20')).toBe('100');
  });
  it('zero-digit currency', () => {
    expect(priceLine('2', '1500.5', 0n, '10', 0)).toEqual({ net_minor: '3001', tax_minor: '300', gross_minor: '3301' });
  });
});
