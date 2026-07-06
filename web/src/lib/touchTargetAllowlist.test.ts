import { describe, it, expect } from 'vitest';
import {
  TOUCH_TARGET_ELEMENTS,
  TOUCH_TARGET_ALLOWLIST,
  isTouchTargetWaived,
  validateTouchTargetWaiver,
  findInvalidWaivers,
  type TouchTargetWaiver,
} from './touchTargetAllowlist';

// A well-formed waiver used across the matcher tests.
const waiver = (over: Partial<TouchTargetWaiver> = {}): TouchTargetWaiver => ({
  file: 'features/notifications/components/AlertRow.tsx',
  element: 'Button',
  reason: 'Compact inline dismiss inside a dense list row; parent row is the tap target.',
  ...over,
});

describe('TOUCH_TARGET_ELEMENTS', () => {
  it('is the canonical, wildcard-first element set', () => {
    expect(TOUCH_TARGET_ELEMENTS).toEqual(['*', 'Button', 'IconButton', 'button', 'a']);
  });

  it('includes the wildcard and every concrete element name the interface allows', () => {
    expect(TOUCH_TARGET_ELEMENTS).toContain('*');
    expect(TOUCH_TARGET_ELEMENTS).toContain('Button');
    expect(TOUCH_TARGET_ELEMENTS).toContain('IconButton');
    expect(TOUCH_TARGET_ELEMENTS).toContain('button');
    expect(TOUCH_TARGET_ELEMENTS).toContain('a');
  });
});

describe('TOUCH_TARGET_ALLOWLIST', () => {
  it('ships empty at adoption time (waivers are a last resort)', () => {
    expect(Array.isArray(TOUCH_TARGET_ALLOWLIST)).toBe(true);
    expect(TOUCH_TARGET_ALLOWLIST).toHaveLength(0);
  });

  it('contains only well-formed entries (guards against a bad waiver landing)', () => {
    // Every shipped entry must satisfy the documented invariants. This turns
    // the prose rule ("non-empty reason") into an executable regression guard.
    expect(findInvalidWaivers()).toEqual([]);
    for (const entry of TOUCH_TARGET_ALLOWLIST) {
      expect(validateTouchTargetWaiver(entry)).toEqual([]);
    }
  });
});

describe('isTouchTargetWaived', () => {
  it('returns false against the (empty) default allowlist', () => {
    expect(isTouchTargetWaived('features/x/Foo.tsx', 'Button')).toBe(false);
  });

  it('matches on an exact normalised path + element name', () => {
    const list = [waiver({ file: 'features/x/Foo.tsx', element: 'Button' })];
    expect(isTouchTargetWaived('features/x/Foo.tsx', 'Button', list)).toBe(true);
  });

  it('matches a repo-relative path via the "/" + suffix boundary', () => {
    const list = [waiver({ file: 'features/x/Foo.tsx', element: 'button' })];
    expect(isTouchTargetWaived('src/features/x/Foo.tsx', 'button', list)).toBe(true);
  });

  it('matches a bare filename suffix (terse suffixes intentionally over-match)', () => {
    const list = [waiver({ file: 'Foo.tsx', element: 'a' })];
    // `endsWith('Foo.tsx')` is true for BarFoo.tsx — documents why callers
    // must pick a suffix specific enough to identify exactly one file.
    expect(isTouchTargetWaived('src/deep/BarFoo.tsx', 'a', list)).toBe(true);
  });

  it('honours the "*" wildcard for any element in the file', () => {
    const list = [waiver({ file: 'features/x/Foo.tsx', element: '*' })];
    expect(isTouchTargetWaived('features/x/Foo.tsx', 'Button', list)).toBe(true);
    expect(isTouchTargetWaived('features/x/Foo.tsx', 'IconButton', list)).toBe(true);
    expect(isTouchTargetWaived('features/x/Foo.tsx', 'anything-else', list)).toBe(true);
  });

  it('does NOT match when the element name differs and no wildcard is set', () => {
    const list = [waiver({ file: 'features/x/Foo.tsx', element: 'Button' })];
    expect(isTouchTargetWaived('features/x/Foo.tsx', 'IconButton', list)).toBe(false);
  });

  it('does NOT match when the file differs even if the element matches', () => {
    const list = [waiver({ file: 'features/x/Foo.tsx', element: 'Button' })];
    expect(isTouchTargetWaived('features/y/Bar.tsx', 'Button', list)).toBe(false);
  });

  it('normalises Windows-style separators in the queried path', () => {
    const list = [waiver({ file: 'features/x/Foo.tsx', element: 'Button' })];
    expect(isTouchTargetWaived('src\\features\\x\\Foo.tsx', 'Button', list)).toBe(true);
  });

  it('normalises Windows-style separators in the waiver file too', () => {
    const list = [waiver({ file: 'features\\x\\Foo.tsx', element: 'Button' })];
    expect(isTouchTargetWaived('src/features/x/Foo.tsx', 'Button', list)).toBe(true);
  });

  it('never matches an empty waiver file (guards against waiving the whole tree)', () => {
    const list = [waiver({ file: '', element: '*' })];
    // Without the guard, `''.endsWith('')` would waive every element everywhere.
    expect(isTouchTargetWaived('any/path/At/All.tsx', 'Button', list)).toBe(false);
  });

  it('tolerates a nullish queried path without throwing', () => {
    const list = [waiver({ file: 'features/x/Foo.tsx', element: 'Button' })];
    expect(isTouchTargetWaived(undefined as unknown as string, 'Button', list)).toBe(false);
  });

  it('returns true when any one of several waivers matches', () => {
    const list = [
      waiver({ file: 'features/a/A.tsx', element: 'Button' }),
      waiver({ file: 'features/b/B.tsx', element: 'IconButton' }),
    ];
    expect(isTouchTargetWaived('src/features/b/B.tsx', 'IconButton', list)).toBe(true);
    expect(isTouchTargetWaived('src/features/b/B.tsx', 'Button', list)).toBe(false);
  });
});

describe('validateTouchTargetWaiver', () => {
  it('returns no problems for a fully-formed waiver', () => {
    expect(validateTouchTargetWaiver(waiver())).toEqual([]);
  });

  it('flags an empty reason (the documented gate invariant)', () => {
    const problems = validateTouchTargetWaiver(waiver({ reason: '' }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('reason');
  });

  it('flags a whitespace-only reason', () => {
    expect(validateTouchTargetWaiver(waiver({ reason: '   ' }))).toContain(
      'reason must be a non-empty justification',
    );
  });

  it('flags an empty file suffix', () => {
    const problems = validateTouchTargetWaiver(waiver({ file: '' }));
    expect(problems).toContain('file must be a non-empty repo-relative path suffix');
  });

  it('flags an unknown element identifier', () => {
    const problems = validateTouchTargetWaiver(
      waiver({ element: 'div' as unknown as TouchTargetWaiver['element'] }),
    );
    expect(problems.some((p) => p.startsWith('element must be one of'))).toBe(true);
    expect(problems[0]).toContain('Button');
  });

  it('accumulates every problem for a fully-broken waiver', () => {
    const problems = validateTouchTargetWaiver({
      file: '',
      element: 'span' as unknown as TouchTargetWaiver['element'],
      reason: '',
    });
    expect(problems).toHaveLength(3);
  });
});

describe('findInvalidWaivers', () => {
  it('returns an empty array for an all-valid allowlist', () => {
    expect(findInvalidWaivers([waiver(), waiver({ file: 'features/y/Y.tsx' })])).toEqual([]);
  });

  it('reports only the malformed entries with their index and problems', () => {
    const list = [
      waiver({ file: 'features/ok/Ok.tsx' }),
      waiver({ reason: '' }),
    ];
    const invalid = findInvalidWaivers(list);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].index).toBe(1);
    expect(invalid[0].waiver).toBe(list[1]);
    expect(invalid[0].problems).toContain('reason must be a non-empty justification');
  });

  it('defaults to the shipped allowlist, which must be clean', () => {
    expect(findInvalidWaivers()).toEqual([]);
  });
});
