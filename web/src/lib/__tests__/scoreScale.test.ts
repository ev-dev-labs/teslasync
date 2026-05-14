import { describe, it, expect } from 'vitest';
import { numericToGrade, gradeInfo, averageGrade, DEFAULT_SCORE_THRESHOLDS } from '../scoreScale';

describe('scoreScale.numericToGrade', () => {
  it.each([
    [100, 'A+'],
    [90,  'A+'],
    [89,  'A'],
    [80,  'A'],
    [79,  'B'],
    [65,  'B'],
    [64,  'C'],
    [50,  'C'],
    [49,  'D'],
    [35,  'D'],
    [34,  'F'],
    [0,   'F'],
  ])('maps %d to %s on default 0–100 scale', (score, label) => {
    expect(numericToGrade(score).label).toBe(label);
  });

  it.each([null, undefined, NaN, Infinity, -Infinity])('returns "—" for %p', (v) => {
    // @ts-expect-error — intentionally pass invalid types for runtime check
    expect(numericToGrade(v).label).toBe('—');
  });

  it('uses caller-provided thresholds (e.g. inverted Wh/km)', () => {
    const whThresholds = [
      { min: 220, label: 'D' as const },
      { min: 190, label: 'C' as const },
      { min: 160, label: 'B' as const },
      { min: 130, label: 'A' as const },
      { min: 0,   label: 'A+' as const },
    ];
    expect(numericToGrade(120, whThresholds).label).toBe('A+');
    expect(numericToGrade(150, whThresholds).label).toBe('A');
    expect(numericToGrade(170, whThresholds).label).toBe('B');
    expect(numericToGrade(225, whThresholds).label).toBe('D');
  });

  it('matches a default-threshold sentinel before falling through', () => {
    // 35 sits exactly on the D boundary — must go to D, not F.
    expect(numericToGrade(35).label).toBe('D');
  });

  it('returns colour and numeric weight together', () => {
    const a = numericToGrade(95);
    expect(a.label).toBe('A+');
    expect(a.color).toMatch(/^#/);
    expect(a.numeric).toBe(4.5);
  });

  it('default thresholds are sorted descending', () => {
    const sorted = [...DEFAULT_SCORE_THRESHOLDS].sort((a, b) => b.min - a.min);
    expect(sorted.map(t => t.min)).toEqual([90, 80, 65, 50, 35, 0]);
  });
});

describe('scoreScale.gradeInfo', () => {
  it.each([
    ['A+', '#10b981', 4.5],
    ['A',  '#10b981', 4.0],
    ['B',  '#00f0ff', 3.0],
    ['C',  '#f59e0b', 2.0],
    ['D',  '#ef4444', 1.0],
    ['F',  '#b91c1c', 0.5],
    ['—',  '#6b7280', null],
  ] as const)('returns palette for %s', (label, color, numeric) => {
    const info = gradeInfo(label);
    expect(info.color).toBe(color);
    expect(info.numeric).toBe(numeric);
  });
});

describe('scoreScale.averageGrade', () => {
  it('averages numeric weights and returns the corresponding label', () => {
    // [4.5, 4.0] avg → 4.25 → A+
    expect(averageGrade([4.5, 4.0]).label).toBe('A+');
    // [4.0, 3.0] avg → 3.5 → A (boundary)
    expect(averageGrade([4.0, 3.0]).label).toBe('A');
    // [3.0, 2.0] avg → 2.5 → B (boundary)
    expect(averageGrade([3.0, 2.0]).label).toBe('B');
    // [2.0, 1.0] avg → 1.5 → C (boundary)
    expect(averageGrade([2.0, 1.0]).label).toBe('C');
    // [1.0, 0.5] avg → 0.75 → D (boundary)
    expect(averageGrade([1.0, 0.5]).label).toBe('D');
    // [0.5, 0.5] avg → 0.5 → F
    expect(averageGrade([0.5, 0.5]).label).toBe('F');
  });

  it('skips null inputs in the average', () => {
    expect(averageGrade([4.0, null, null, 4.5]).label).toBe('A+');
  });

  it('returns "—" when every input is null', () => {
    expect(averageGrade([null, null, null]).label).toBe('—');
  });

  it('returns "—" for empty input', () => {
    expect(averageGrade([]).label).toBe('—');
  });
});
