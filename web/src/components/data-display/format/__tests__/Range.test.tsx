import { render, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Range, useRangeLabel } from '../Range';
import { useSettings } from '@/hooks/useSettings';

// `<Range>` composes two real hooks — `useUnits()` (km↔mi display preference)
// and `usePreferredRange()` (rated↔ideal `preferred_range` preference) — both of
// which read `useSettings()`. We mock ONLY the settings hook (repo convention —
// see Distance.test.tsx / Format.test.tsx) so the genuine
// `selectPreferredRange` + `convertDistanceFromSI` + `Intl.NumberFormat`
// pipeline runs while we control the metric/imperial and rated/ideal prefs.
// `usePreferredRange` imports `./useSettings`, which resolves to the very same
// file as `@/hooks/useSettings`, so this single mock intercepts both call sites.
// No network is touched by this pure display leaf.
vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

// `useRangeLabel` is the only export that reaches for i18n. Mock `react-i18next`
// with a spy that returns the `t()` fallback (repo convention — see
// DataFreshness.test.tsx) so we can assert BOTH the resolved label string and
// the exact translation key the hook selects for each preference.
const { tSpy } = vi.hoisted(() => ({
  tSpy: vi.fn((_key: string, fallback: string) => fallback),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tSpy }),
}));

type UnitSystem = 'metric' | 'imperial';
type RangePref = 'rated' | 'ideal';

/**
 * Point the mocked settings hook at a metric (km) or imperial (mi) distance
 * preference and a rated/ideal `preferred_range` preference. The bag mirrors
 * `useSettings()`'s production shape so both `useUnits` (via `settings`) and
 * `usePreferredRange` (via `rangeType`) read faithful values.
 */
function configure(system: UnitSystem = 'metric', range: RangePref = 'rated') {
  const unitOfLength = system === 'imperial' ? 'mi' : 'km';
  vi.mocked(useSettings).mockReturnValue({
    settings: {
      unit_of_length: unitOfLength,
      unit_of_temp: 'C',
      unit_of_pressure: 'bar',
      preferred_range: range,
      decimal_precision: 2,
      locale: 'en-US',
    },
    isMiles: unitOfLength === 'mi',
    isFahrenheit: false,
    isPSI: false,
    decimals: 2,
    locale: 'en-US',
    density: 'comfortable',
    rangeType: range,
  } as never);
}

const span = (c: HTMLElement) => c.querySelector('span');

// SI-metre fixtures with clean display targets in one or both unit systems.
const KM_400 = 400_000; // 400 km exactly → 249 mi @0dp / 248.5 mi @1dp
const MI_250 = 402_336; // 250 mi exactly (250 × 1609.344) → 402 km @0dp
const KM_450 = 450_000; // 450 km exactly (ideal-range fixture)

beforeEach(() => {
  vi.mocked(useSettings).mockReset();
  tSpy.mockClear();
  // Sensible default so tests that don't call configure() still have a bag.
  configure('metric', 'rated');
});

describe('Range (component)', () => {
  it('renders the rated range in km as a whole number for a metric user', () => {
    configure('metric', 'rated');
    const { container } = render(<Range state={{ rated_range: KM_400, ideal_range: KM_450 }} />);
    // Default precision is 0, and the rated field wins under the rated pref.
    expect(container.textContent).toBe('400 km');
  });

  it('converts the SI metres to miles for an imperial user', () => {
    configure('imperial', 'rated');
    const { container } = render(<Range state={{ rated_range: KM_400 }} />);
    expect(container.textContent).toBe('249 mi');
  });

  it('honours an explicit precision override', () => {
    configure('metric', 'rated');
    const { container } = render(<Range state={{ rated_range: KM_400 }} precision={1} />);
    expect(container.textContent).toBe('400.0 km');
  });

  it('selects ideal_range instead of rated_range when the user prefers ideal', () => {
    configure('metric', 'ideal');
    const { container } = render(<Range state={{ rated_range: KM_400, ideal_range: KM_450 }} />);
    // 450 (ideal) not 400 (rated) proves the preference drives field selection.
    expect(container.textContent).toBe('450 km');
    expect(container.textContent).not.toBe('400 km');
  });

  it('renders an em dash when state is null (loading)', () => {
    configure('metric', 'rated');
    const { container } = render(<Range state={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash when state is undefined', () => {
    const { container } = render(<Range state={undefined} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash when the preferred field is missing (no cross-fallback)', () => {
    configure('metric', 'ideal');
    // Ideal preferred but ideal_range null → em dash, even though rated_range
    // is present. The helper intentionally does NOT silently fall back.
    const { container } = render(<Range state={{ rated_range: KM_400, ideal_range: null }} />);
    expect(container.textContent).toBe('—');
  });

  it('treats a zero range as a real value, not an empty one', () => {
    configure('metric', 'rated');
    const { container } = render(<Range state={{ rated_range: 0 }} />);
    expect(container.textContent).toBe('0 km');
    expect(container.textContent).not.toBe('—');
  });

  it('renders an em dash for a NaN range value', () => {
    configure('metric', 'rated');
    const { container } = render(<Range state={{ rated_range: NaN }} />);
    expect(container.textContent).toBe('—');
  });

  it('renders an em dash for a non-finite Infinity range value', () => {
    const { container } = render(<Range state={{ rated_range: Infinity }} />);
    expect(container.textContent).toBe('—');
  });

  it('applies the className to the value span', () => {
    configure('metric', 'rated');
    const { container } = render(
      <Range state={{ rated_range: KM_400 }} className="text-cyan-300" />,
    );
    expect(span(container)?.getAttribute('class')).toBe('text-cyan-300');
    expect(container.textContent).toBe('400 km');
  });

  it('applies the className to the empty-state span too', () => {
    const { container } = render(<Range state={null} className="opacity-50" />);
    expect(span(container)?.getAttribute('class')).toBe('opacity-50');
    expect(container.textContent).toBe('—');
  });

  it('renders the value inside a <span> element', () => {
    configure('metric', 'rated');
    const { container } = render(<Range state={{ rated_range: KM_400 }} />);
    const el = span(container);
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('SPAN');
  });

  it('recomputes the display when the user switches unit systems', () => {
    configure('metric', 'rated');
    const { container, rerender } = render(<Range state={{ rated_range: MI_250 }} />);
    expect(container.textContent).toBe('402 km');

    configure('imperial', 'rated');
    rerender(<Range state={{ rated_range: MI_250 }} />);
    expect(container.textContent).toBe('250 mi');
  });

  it('recomputes the selected range when the range-type preference flips', () => {
    configure('metric', 'rated');
    const { container, rerender } = render(
      <Range state={{ rated_range: KM_400, ideal_range: KM_450 }} />,
    );
    expect(container.textContent).toBe('400 km');

    configure('metric', 'ideal');
    rerender(<Range state={{ rated_range: KM_400, ideal_range: KM_450 }} />);
    expect(container.textContent).toBe('450 km');
  });
});

describe('useRangeLabel (hook)', () => {
  it('returns the localized "Rated Range" label when the user prefers rated range', () => {
    configure('metric', 'rated');
    const { result } = renderHook(() => useRangeLabel({ rated_range: KM_400 }));
    expect(result.current).toBe('Rated Range');
    expect(tSpy).toHaveBeenCalledWith('common.ratedRange', 'Rated Range');
  });

  it('returns the localized "Ideal Range" label when the user prefers ideal range', () => {
    configure('metric', 'ideal');
    const { result } = renderHook(() => useRangeLabel({ ideal_range: KM_450 }));
    expect(result.current).toBe('Ideal Range');
    expect(tSpy).toHaveBeenCalledWith('common.idealRange', 'Ideal Range');
  });

  it('returns a stable rated label for a null state during loading', () => {
    configure('metric', 'rated');
    const { result } = renderHook(() => useRangeLabel(null));
    // Label reflects the preference even when the value is absent.
    expect(result.current).toBe('Rated Range');
    expect(tSpy).toHaveBeenCalledWith('common.ratedRange', 'Rated Range');
  });

  it('derives the label from the preference independent of value presence', () => {
    configure('metric', 'ideal');
    const { result } = renderHook(() => useRangeLabel(null));
    expect(result.current).toBe('Ideal Range');
  });
});
