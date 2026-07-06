/**
 * `StaleSessionRow` behaviour tests.
 *
 * Co-located with the component. `StaleSessionRow` is a single accessible
 * disclosure summary (one native `<button>` carrying aria-expanded /
 * aria-controls) that fronts the inline repair form on the Data Repair page.
 * These tests exercise every observable facet of the file:
 *
 *   1. It renders the record id, a formatted start date, the SOC %, the
 *      vehicle label and every pre-formatted metric chip.
 *   2. The summary is exposed as ONE keyboard-operable disclosure button whose
 *      accessible name comes from its aria-label, and whose aria-controls
 *      points at the form it discloses.
 *   3. `expanded` drives aria-expanded, the amber active styling and the
 *      chevron rotation.
 *   4. Clicking (and focusing) the summary invokes `onToggle`.
 *   5. A missing / non-finite battery percentage collapses to an em-dash
 *      instead of a misleading "0%".
 *   6. The private `hoursOpen` helper — observed through the elapsed badge —
 *      FLOORS each component, so 23.9h reads "23h" (not a rounded "24h") and a
 *      day remainder never surfaces as "…d 24h".
 *   7. A future or unparseable timestamp shows an em-dash for elapsed time.
 *   8. The decorative icons are aria-hidden and the label stays the accessible
 *      name.
 *   9. Every provided metric renders, and an omitted metrics array is tolerated.
 *
 * react-i18next is mocked so `t(key, fallback, vars)` deterministically returns
 * the interpolated English fallback. lucide-react's three icons are stubbed
 * with test-ids so the chevron rotation and aria-hidden state can be asserted
 * precisely. `Date.now` is pinned so elapsed-time output is deterministic.
 * Interactions use `fireEvent` — `@testing-library/user-event` is intentionally
 * not a dependency in this repo (see FullscreenButton.test.tsx).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { SVGProps } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultOrOpts?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      let template: string;
      let interpolations: Record<string, unknown> | undefined;
      if (typeof defaultOrOpts === 'string') {
        template = defaultOrOpts || key;
        interpolations = opts;
      } else {
        template = key;
        interpolations = defaultOrOpts;
      }
      if (!interpolations) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name) =>
        String(interpolations?.[name] ?? `{{${name}}}`),
      );
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<typeof import('lucide-react')>('lucide-react');
  const makeIcon = (testid: string) =>
    function StubIcon(props: SVGProps<SVGSVGElement>) {
      return <svg {...props} data-testid={testid} />;
    };
  return {
    ...actual,
    AlertTriangle: makeIcon('icon-alert-triangle'),
    ChevronDown: makeIcon('icon-chevron-down'),
    Clock: makeIcon('icon-clock'),
  };
});

import { StaleSessionRow, type StaleSessionRowProps, type StaleRowMetric } from './StaleSessionRow';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-07-05T12:00:00.000Z');
/** ISO timestamp `msAgo` milliseconds before the pinned `NOW`. */
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const DEFAULT_TS = iso(12 * HOUR);

const baseMetrics: StaleRowMetric[] = [
  { key: 'energy', label: 'Energy', value: '12.3 kWh' },
  { key: 'peak', label: 'Peak', value: '48 kW' },
];

function renderRow(overrides: Partial<StaleSessionRowProps> = {}) {
  const onToggle = vi.fn();
  const props: StaleSessionRowProps = {
    id: 123,
    timestamp: DEFAULT_TS,
    batteryPct: 80,
    vehicleId: 7,
    metrics: baseMetrics,
    expanded: false,
    onToggle,
    controlsId: 'repair-form-charging-123',
    ...overrides,
  };
  const utils = render(<StaleSessionRow {...props} />);
  return { ...utils, onToggle, props };
}

/** Text content of the elapsed-open badge (the one carrying the Clock icon). */
function elapsedText(): string {
  return screen.getByTestId('icon-clock').parentElement?.textContent?.trim() ?? '';
}

describe('StaleSessionRow', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the id, formatted date, battery %, vehicle and every metric chip', () => {
    renderRow();

    expect(screen.getByText('#123')).toBeInTheDocument();
    // formatDateTime renders the local-zone date; regardless of the runner's
    // timezone the year is always present.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Vehicle 7')).toBeInTheDocument();

    expect(screen.getByText('Energy')).toBeInTheDocument();
    expect(screen.getByText('12.3 kWh')).toBeInTheDocument();
    expect(screen.getByText('Peak')).toBeInTheDocument();
    expect(screen.getByText('48 kW')).toBeInTheDocument();

    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('exposes the summary as a single native, focusable disclosure button', () => {
    renderRow({ controlsId: 'repair-form-drive-9' });

    const btn = screen.getByRole('button', {
      name: /Open repair form for record #123/,
    });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('aria-controls', 'repair-form-drive-9');
    expect(btn).toHaveAttribute('aria-expanded', 'false');

    // Native buttons are inherently keyboard operable — prove it is focusable.
    btn.focus();
    expect(btn).toHaveFocus();
  });

  it('reflects the expanded state on aria-expanded, styling and chevron rotation', () => {
    const { rerender, props } = renderRow({ expanded: false });

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button').className).toContain('bg-white/[0.02]');
    expect(screen.getByTestId('icon-chevron-down').getAttribute('class') ?? '').not.toContain('rotate-180');

    rerender(<StaleSessionRow {...props} expanded />);

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button').className).toContain('border-amber-400/30');
    expect(screen.getByTestId('icon-chevron-down').getAttribute('class') ?? '').toContain('rotate-180');
  });

  it('invokes onToggle on every click without mutating its own props', () => {
    const { onToggle } = renderRow();
    const btn = screen.getByRole('button');

    fireEvent.click(btn);
    fireEvent.click(btn);

    expect(onToggle).toHaveBeenCalledTimes(2);
    // It is a controlled disclosure — clicking does not flip aria-expanded on
    // its own; the parent owns that state.
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders a valid battery percentage with a rounded whole-number label', () => {
    renderRow({ batteryPct: 42.6 });
    expect(screen.getByText('43%')).toBeInTheDocument();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('shows an em-dash (not "0%%") when battery is %s', (_label, value) => {
    renderRow({ batteryPct: value as number | null });

    // Elapsed badge is valid here, so the only em-dash is the battery cell.
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it.each([
    ['12h', 12 * HOUR, '12h'],
    ['floors 23.9h to 23h', 23.9 * HOUR, '23h'],
    ['3d 4h', 76 * HOUR, '3d 4h'],
    ['floors a day remainder (47.9h -> 1d 23h)', 47.9 * HOUR, '1d 23h'],
  ])('formats the elapsed-open time: %s', (_label, msAgo, expected) => {
    renderRow({ timestamp: iso(msAgo) });
    expect(elapsedText()).toBe(expected);
  });

  it.each([
    ['a future timestamp', iso(-2 * HOUR)],
    ['an unparseable timestamp', 'not-a-real-date'],
    ['an empty timestamp', ''],
  ])('shows an em-dash for elapsed time given %s', (_label, timestamp) => {
    renderRow({ timestamp });
    expect(elapsedText()).toBe('—');
  });

  it('marks the decorative icons aria-hidden and keeps the label as the accessible name', () => {
    renderRow();

    expect(screen.getByTestId('icon-clock')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('icon-alert-triangle')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('icon-chevron-down')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Open repair form for record #123',
    );
  });

  it('renders each provided metric chip (label + display value)', () => {
    renderRow({
      metrics: [
        { key: 'distance', label: 'Distance', value: '42 km' },
        { key: 'max', label: 'Max', value: '120 km/h' },
        { key: 'avg', label: 'Avg', value: '80 km/h' },
      ],
    });

    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('42 km')).toBeInTheDocument();
    expect(screen.getByText('Max')).toBeInTheDocument();
    expect(screen.getByText('120 km/h')).toBeInTheDocument();
    expect(screen.getByText('Avg')).toBeInTheDocument();
    expect(screen.getByText('80 km/h')).toBeInTheDocument();
  });

  it('tolerates an empty or omitted metrics array without crashing', () => {
    const { unmount } = renderRow({ metrics: [] });
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    unmount();

    // The prop is required by the type, but the component defaults it to []
    // so a stray `undefined` never explodes on `.map`.
    expect(() =>
      renderRow({ metrics: undefined as unknown as StaleRowMetric[] }),
    ).not.toThrow();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
