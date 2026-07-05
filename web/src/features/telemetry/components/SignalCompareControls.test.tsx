/**
 * SignalCompareControls — behaviour + hardening coverage.
 *
 * SignalCompareControls is the pure control surface (windows + presets +
 * filter + category chips) shared by the full-page SignalDiffPage and the
 * compare block of SignalsWorkspacePage. It owns NO data — every value is a
 * prop and every change is a callback — so these specs drive it purely
 * through props and assert its OWN behaviour, plus the pure helpers and
 * constants it exports:
 *
 *   1. toLocalDatetimeInput — zero-padded YYYY-MM-DDTHH:mm formatting, matches
 *      the datetime-local contract, and the null-safety guard (invalid /
 *      absent Date → '' rather than the literal "NaN-NaN-NaNTNaN:NaN").
 *   2. isoOrEmpty — empty / unparseable → '', valid local value → an ISO
 *      instant that round-trips to the same epoch millis.
 *   3. CATEGORY_PREFIXES — the 8 documented buckets, their matching regexes,
 *      and that an unrelated name matches nothing.
 *   4. DIFF_PRESETS — the 5 presets, each anchored to "now" with the
 *      documented span.
 *   5. The component: both datetime windows render with ACCESSIBLE labels and
 *      current values and fire their onChange; the two help tooltips surface;
 *      presets push datetime-local strings into BOTH windows; the filter box
 *      fires onSearchChange; the category chips form a labelled group, expose
 *      selection via aria-pressed, toggle on/off, and gate the Clear
 *      affordance; the optional topSlot renders only when supplied.
 *
 * The real shared UI (GlassPanel, Button, Input, HelpTooltip, FadeIn) is
 * rendered — only react-i18next is mocked to resolve the developer fallback
 * strings (handling both the `t(key, 'Default')` and
 * `t(key, { defaultValue })` call shapes the component + HelpTooltip use).
 * Interactions use fireEvent (user-event is not a dependency of this
 * codebase — see web/package.json), matching ./LiveSignalTail.test.tsx.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// jsdom lacks matchMedia; framer-motion (<FadeIn> via useMotionPreference)
// reads it during render. Install a benign stub before any module imports it.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// i18n → resolve the developer fallback so assertions read like the English
// UI. Handles both the plain-string fallback (`t('k', 'Default')`) and the
// options-object form (`t('k', { defaultValue })`) that HelpTooltip uses.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => {
        if (typeof fallback === 'string') return fallback;
        if (fallback && typeof fallback === 'object' && 'defaultValue' in fallback) {
          return (fallback as { defaultValue?: string }).defaultValue ?? key;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import {
  SignalCompareControls,
  type SignalCompareControlsProps,
  CATEGORY_PREFIXES,
  DIFF_PRESETS,
  toLocalDatetimeInput,
  isoOrEmpty,
} from './SignalCompareControls';

// The datetime-local wire format the windows speak.
const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function renderControls(over: Partial<SignalCompareControlsProps> = {}) {
  const onChangeA = vi.fn();
  const onChangeB = vi.fn();
  const onSearchChange = vi.fn();
  const onCategoryChange = vi.fn();
  const props: SignalCompareControlsProps = {
    atA: '2024-01-05T09:07',
    atB: '2024-01-05T10:07',
    onChangeA,
    onChangeB,
    search: '',
    onSearchChange,
    category: null,
    onCategoryChange,
    ...over,
  };
  const utils = render(<SignalCompareControls {...props} />);
  return { ...utils, onChangeA, onChangeB, onSearchChange, onCategoryChange, props };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('toLocalDatetimeInput', () => {
  it('formats a local date as zero-padded YYYY-MM-DDTHH:mm', () => {
    // Local-constructor dates avoid timezone drift — the function reads the
    // date's LOCAL components, which is exactly what these inputs echo.
    expect(toLocalDatetimeInput(new Date(2024, 0, 5, 9, 7))).toBe('2024-01-05T09:07');
    expect(toLocalDatetimeInput(new Date(2024, 8, 3, 4, 6))).toBe('2024-09-03T04:06');
    expect(toLocalDatetimeInput(new Date(2024, 11, 31, 23, 59))).toMatch(DT_RE);
  });

  it('returns "" for an invalid or absent date instead of "NaN-…"', () => {
    expect(toLocalDatetimeInput(new Date('definitely-not-a-date'))).toBe('');
    expect(toLocalDatetimeInput(undefined as unknown as Date)).toBe('');
  });
});

describe('isoOrEmpty', () => {
  it('returns "" for empty or unparseable input', () => {
    expect(isoOrEmpty('')).toBe('');
    expect(isoOrEmpty('not-a-real-datetime')).toBe('');
  });

  it('round-trips a valid local datetime to an ISO instant', () => {
    const local = '2024-01-05T09:07';
    const iso = isoOrEmpty(local);
    expect(iso).not.toBe('');
    expect(iso.endsWith('Z')).toBe(true);
    expect(new Date(iso).getTime()).toBe(new Date(local).getTime());
  });
});

describe('CATEGORY_PREFIXES', () => {
  it('exposes the 8 documented buckets in order', () => {
    expect(CATEGORY_PREFIXES.map((c) => c.id)).toEqual([
      'battery',
      'drive',
      'climate',
      'security',
      'motor',
      'tire',
      'media',
      'safety',
    ]);
  });

  it('matches representative signal names to the right bucket', () => {
    const byId = Object.fromEntries(CATEGORY_PREFIXES.map((c) => [c.id, c] as const));
    expect(byId.battery.matches('battery_level')).toBe(true);
    expect(byId.battery.matches('charge_state')).toBe(true);
    expect(byId.battery.matches('soc')).toBe(true);
    expect(byId.battery.matches('energy_used_kwh')).toBe(true);
    expect(byId.drive.matches('vehicle_speed')).toBe(true);
    expect(byId.drive.matches('odometer')).toBe(true);
    expect(byId.climate.matches('cabin_temp')).toBe(true);
    expect(byId.security.matches('door_lock')).toBe(true);
    expect(byId.motor.matches('motor_rpm')).toBe(true);
    expect(byId.tire.matches('tpms_front_left')).toBe(true);
    expect(byId.media.matches('media_volume')).toBe(true);
    expect(byId.safety.matches('airbag_status')).toBe(true);
  });

  it('does not cross-match unrelated names', () => {
    const battery = CATEGORY_PREFIXES.find((c) => c.id === 'battery')!;
    expect(battery.matches('vehicle_speed')).toBe(false);
    // A name that belongs to no bucket matches nothing at all.
    expect(CATEGORY_PREFIXES.some((c) => c.matches('quux_unrelated_signal'))).toBe(false);
  });
});

describe('DIFF_PRESETS', () => {
  const NOW = new Date('2024-06-15T12:30:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes the five documented presets', () => {
    expect(DIFF_PRESETS).toHaveLength(5);
    expect([...DIFF_PRESETS].map((p) => p.id).sort()).toEqual(
      ['before-after-charge', 'last-drive', 'now-vs-1d', 'now-vs-1h', 'today-vs-yesterday'].sort(),
    );
  });

  it('anchors each window to "now" with the documented span', () => {
    const now = NOW.getTime();
    const byId = Object.fromEntries(DIFF_PRESETS.map((p) => [p.id, p] as const));

    const h1 = byId['now-vs-1h'].compute();
    expect(h1.atB.getTime()).toBe(now);
    expect(h1.atB.getTime() - h1.atA.getTime()).toBe(3600 * 1000);

    const d1 = byId['now-vs-1d'].compute();
    expect(d1.atB.getTime() - d1.atA.getTime()).toBe(86400 * 1000);

    const charge = byId['before-after-charge'].compute();
    expect(charge.atB.getTime() - charge.atA.getTime()).toBe(4 * 3600 * 1000);

    const drive = byId['last-drive'].compute();
    expect(drive.atA.getTime()).toBe(now - 90 * 60 * 1000);
    expect(drive.atB.getTime()).toBe(now - 5 * 60 * 1000);
  });
});

describe('SignalCompareControls — windows', () => {
  it('renders both datetime windows with accessible labels and current values', () => {
    renderControls({ atA: '2024-01-05T09:07', atB: '2024-01-05T10:07' });
    const a = screen.getByLabelText('Window A') as HTMLInputElement;
    const b = screen.getByLabelText('Window B') as HTMLInputElement;
    expect(a).toHaveAttribute('type', 'datetime-local');
    expect(a.value).toBe('2024-01-05T09:07');
    expect(b.value).toBe('2024-01-05T10:07');
  });

  it('fires onChangeA / onChangeB when a window changes', () => {
    const { onChangeA, onChangeB } = renderControls();
    fireEvent.change(screen.getByLabelText('Window A'), { target: { value: '2024-02-02T02:02' } });
    fireEvent.change(screen.getByLabelText('Window B'), { target: { value: '2024-03-03T03:03' } });
    expect(onChangeA).toHaveBeenCalledWith('2024-02-02T02:02');
    expect(onChangeB).toHaveBeenCalledWith('2024-03-03T03:03');
  });

  it('surfaces the two snapshot / diff help tooltips', () => {
    renderControls();
    expect(screen.getAllByRole('button', { name: /more info/i })).toHaveLength(2);
  });
});

describe('SignalCompareControls — presets', () => {
  it('renders every preset as a labelled button inside a labelled group', () => {
    renderControls();
    expect(screen.getByRole('group', { name: 'Quick presets:' })).toBeInTheDocument();
    for (const label of [
      'Now vs 1h ago',
      'Now vs 1 day ago',
      'Before vs after last charge',
      'Last drive start vs end',
      'Today vs yesterday (same time)',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('applies a preset by pushing datetime-local strings into BOTH windows', () => {
    const { onChangeA, onChangeB } = renderControls();
    fireEvent.click(screen.getByRole('button', { name: 'Now vs 1h ago' }));

    expect(onChangeA).toHaveBeenCalledTimes(1);
    expect(onChangeB).toHaveBeenCalledTimes(1);
    const aArg = onChangeA.mock.calls[0][0] as string;
    const bArg = onChangeB.mock.calls[0][0] as string;
    expect(aArg).toMatch(DT_RE);
    expect(bArg).toMatch(DT_RE);
    // Window A precedes Window B by exactly one hour — asserted via the
    // round-trip epoch diff so it holds in any timezone the runner uses.
    expect(new Date(bArg).getTime() - new Date(aArg).getTime()).toBe(3600 * 1000);
  });
});

describe('SignalCompareControls — filter + categories', () => {
  it('fires onSearchChange as the accessible filter box is typed into', () => {
    const { onSearchChange } = renderControls({ search: '' });
    fireEvent.change(screen.getByLabelText('Filter signals'), { target: { value: 'batt' } });
    expect(onSearchChange).toHaveBeenCalledWith('batt');
  });

  it('groups the category chips and selects one on click', () => {
    const { onCategoryChange } = renderControls({ category: null });
    const group = screen.getByRole('group', { name: 'Filter by category' });
    expect(group).toBeInTheDocument();

    const battery = within(group).getByRole('button', { name: 'Battery' });
    expect(battery).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(battery);
    expect(onCategoryChange).toHaveBeenCalledWith('battery');
  });

  it('reflects the active chip via aria-pressed and toggles it off when re-clicked', () => {
    const { onCategoryChange } = renderControls({ category: 'battery' });
    const battery = screen.getByRole('button', { name: 'Battery' });
    const drive = screen.getByRole('button', { name: 'Drive' });
    expect(battery).toHaveAttribute('aria-pressed', 'true');
    expect(drive).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(battery);
    expect(onCategoryChange).toHaveBeenCalledWith(null);
  });

  it('shows the Clear affordance only when a category is active', () => {
    const { onCategoryChange, rerender, props } = renderControls({ category: null });
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();

    rerender(<SignalCompareControls {...props} category="drive" />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onCategoryChange).toHaveBeenCalledWith(null);
  });
});

describe('SignalCompareControls — topSlot', () => {
  it('renders the topSlot when provided', () => {
    renderControls({ topSlot: <div data-testid="veh-picker">picker</div> });
    expect(screen.getByTestId('veh-picker')).toHaveTextContent('picker');
  });

  it('omits the top slot region when none is given', () => {
    renderControls();
    expect(screen.queryByTestId('veh-picker')).not.toBeInTheDocument();
  });
});
