import { describe, it, expect } from 'vitest';
import {
  FALLBACK_PAINT,
  PAINT_PALETTES,
  PAINT_PALETTE_LIST,
  inferPaintFromTesla,
  isPaintPaletteId,
} from '../vehicleColors';

describe('vehicleColors', () => {
  describe('FALLBACK_PAINT', () => {
    it('is Pearl White (high-contrast default for dark UI)', () => {
      expect(FALLBACK_PAINT).toBe(PAINT_PALETTES['pearl-white']);
      expect(FALLBACK_PAINT.id).toBe('pearl-white');
    });
  });

  describe('PAINT_PALETTE_LIST', () => {
    it('lists all 5 known palettes in display order', () => {
      expect(PAINT_PALETTE_LIST).toHaveLength(5);
      expect(PAINT_PALETTE_LIST.map((p) => p.id)).toEqual([
        'pearl-white',
        'midnight-silver',
        'deep-blue',
        'solid-black',
        'red-multicoat',
      ]);
    });

    it('every palette has a swatch hex, labelKey, defaultLabel', () => {
      for (const p of PAINT_PALETTE_LIST) {
        expect(p.swatch).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(p.labelKey).toMatch(/^paint\./);
        expect(p.defaultLabel.length).toBeGreaterThan(0);
        expect(p.body).toHaveLength(4);
        expect(p.lower).toHaveLength(3);
        expect(p.surface).toHaveLength(3);
        expect(p.mirror).toHaveLength(3);
      }
    });
  });

  describe('inferPaintFromTesla', () => {
    it.each([
      // null/empty → fallback
      [null, 'pearl-white'],
      [undefined, 'pearl-white'],
      ['', 'pearl-white'],
      // pearl white variants
      ['PearlWhite', 'pearl-white'],
      ['PearlWhiteMultiCoat', 'pearl-white'],
      ['Pearl White Multi-Coat', 'pearl-white'],
      ['pearl_white', 'pearl-white'],
      ['white', 'pearl-white'],
      // midnight silver variants
      ['MidnightSilver', 'midnight-silver'],
      ['MidnightSilverMetallic', 'midnight-silver'],
      ['midnight-silver', 'midnight-silver'],
      ['silver', 'midnight-silver'],
      // deep blue variants
      ['DeepBlue', 'deep-blue'],
      ['DeepBlueMetallic', 'deep-blue'],
      ['deep_blue', 'deep-blue'],
      ['blue', 'deep-blue'],
      ['darkblue', 'deep-blue'],
      // solid black variants
      ['SolidBlack', 'solid-black'],
      ['black', 'solid-black'],
      ['ObsidianBlack', 'solid-black'],
      // red multi-coat variants
      ['RedMulticoat', 'red-multicoat'],
      ['RedMultiCoat', 'red-multicoat'],
      ['Red Multi-Coat', 'red-multicoat'],
      ['red', 'red-multicoat'],
      // unknown → fallback
      ['DiamondPurple', 'pearl-white'],
      ['gold', 'pearl-white'],
    ] as const)('inferPaintFromTesla(%j) → %s', (input, expectedId) => {
      expect(inferPaintFromTesla(input).id).toBe(expectedId);
    });

    it('is case-insensitive', () => {
      expect(inferPaintFromTesla('PEARLWHITE').id).toBe('pearl-white');
      expect(inferPaintFromTesla('midnightsilver').id).toBe('midnight-silver');
      expect(inferPaintFromTesla('DEEPBLUE').id).toBe('deep-blue');
    });
  });

  describe('isPaintPaletteId', () => {
    it('accepts every known id', () => {
      expect(isPaintPaletteId('pearl-white')).toBe(true);
      expect(isPaintPaletteId('midnight-silver')).toBe(true);
      expect(isPaintPaletteId('deep-blue')).toBe(true);
      expect(isPaintPaletteId('solid-black')).toBe(true);
      expect(isPaintPaletteId('red-multicoat')).toBe(true);
    });

    it('rejects unknowns and non-strings', () => {
      expect(isPaintPaletteId('orange')).toBe(false);
      expect(isPaintPaletteId('')).toBe(false);
      expect(isPaintPaletteId(null)).toBe(false);
      expect(isPaintPaletteId(undefined)).toBe(false);
      expect(isPaintPaletteId(42)).toBe(false);
      expect(isPaintPaletteId({ id: 'pearl-white' })).toBe(false);
    });
  });
});
