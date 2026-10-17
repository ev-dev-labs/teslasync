// Behavioural coverage for the anomaly-timeline card.
//
// AnomalyTimelineCard is a pure presentational leaf: it maps one
// AnomalyEntry onto a neutral <li> with a colour-independent
// SeverityBadge, a signal + type-label + z-score header, the detector
// message, and a value/baseline footer. These tests pin:
//   - rendered content (signal, message, localized type label, 2dp
//     value/baseline, timestamp)
//   - neutral card roles with semantic badge tones (incl. warning -> warn)
//   - the z-score chip conditional (shown for z>0, hidden for range/0)
//   - null-safety of the timestamp path (unparseable -> em-dash)
//   - list-item semantics + severity-as-text (a11y: not colour-alone)
//
// react-i18next returns the English default (2nd arg) when no provider
// is mounted, so severity labels surface verbatim ('critical', ...) —
// asserted case-insensitively so the suite is stable whether or not a
// bundle is loaded. TimeStamp's locale/tz hooks are stubbed (they pull
// TanStack Query + Router otherwise) exactly as TimeStamp's own test does.

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { UnitPref } from '@/lib/unitConversion';

import type { AnomalyEntry } from '@/api/hooks/useAnomalies';
import { AnomalyTimelineCard } from './AnomalyTimelineCard';

const display = vi.hoisted((): { prefs: UnitPref } => ({
  prefs: {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
    energy: 'kWh', power: 'kW', duration: 'h', locale: 'en-US', precision: 2,
  },
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      unit_of_length: display.prefs.distance,
      unit_of_temp: display.prefs.temperature === '°F' ? 'F' : 'C',
      unit_of_pressure: display.prefs.pressure,
      locale: display.prefs.locale,
      decimal_precision: display.prefs.precision,
    },
  }),
}));

vi.mock('@/hooks/useTimeFormatPreference', () => ({
  useTimeFormatPreference: () => 'relative',
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    opts: {},
    tz: 'UTC',
    locale: 'en-US',
    formatDate: () => 'date',
    formatDateTime: () => 'Jan 2, 2024, 3:04 AM',
    formatTime: () => 'time',
    formatDateShort: () => 'short',
    formatDateWithDay: () => 'withday',
    formatRelative: () => '2 hours ago',
    formatRelativeTime: () => 'reltime',
    formatRelativeDays: () => 'reldays',
  }),
}));

function makeAnomaly(overrides: Partial<AnomalyEntry> = {}): AnomalyEntry {
  return {
    signal: 'BatteryVoltage',
    type: 'z_score',
    severity: 'critical',
    value: 14.2,
    baseline: 12.5,
    z_score: 4.3,
    detected_at: '2024-01-02T03:04:05Z',
    message: 'reading deviates sharply from the learned mean',
    ...overrides,
  };
}

// Wrap in <ul> so the <li> resolves to the listitem role, matching how
// AnomalyDashboardPage renders the timeline grid.
function renderCard(anomaly: ComponentProps<typeof AnomalyTimelineCard>['anomaly']) {
  return render(
    <ul>
      <AnomalyTimelineCard anomaly={anomaly} />
    </ul>,
  );
}

describe('AnomalyTimelineCard', () => {
  beforeEach(() => {
    display.prefs = {
      distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
      energy: 'kWh', power: 'kW', duration: 'h', locale: 'en-US', precision: 2,
    };
  });

  it.each([
    ['m', -1250, 500, '-1.25 km', '0.50 km'],
    ['m/s', -1.25, 0.5, '-4.50 km/h', '1.80 km/h'],
    ['°C', -12.25, 0, '-12.25°C', '0.00°C'],
    ['Pa', 312500, 250000, '3.13 bar', '2.50 bar'],
    ['kPa', -125.5, 0, '-1.26 bar', '0.00 bar'],
    ['Wh', -1250, 500, '-1.25 kWh', '0.50 kWh'],
    ['W', -1250, 500, '-1.25 kW', '0.50 kW'],
    ['s', -4500, 1800, '-1.25 h', '0.50 h'],
  ])('displays authoritative %s readings without changing raw evidence', (unit, value, baseline, reading, reference) => {
    const anomaly = Object.freeze({ ...makeAnomaly({ value, baseline, z_score: 4.27 }), unit });
    const { container } = renderCard(anomaly);
    expect(container.textContent).toContain(reading);
    expect(container.textContent).toContain(reference);
    expect(container.textContent).toContain('4.27σ');
    expect(anomaly.value).toBe(value);
    expect(anomaly.baseline).toBe(baseline);
  });

  it('updates display preferences without altering SI readings or dimensionless z-score', () => {
    const anomaly = Object.freeze({ ...makeAnomaly({ value: -12.5, baseline: 0, z_score: 3.125 }), unit: '°C' });
    const { container, rerender } = renderCard(anomaly);
    expect(container.textContent).toContain('-12.50°C');
    display.prefs.temperature = '°F';
    rerender(<ul><AnomalyTimelineCard anomaly={{ ...anomaly }} /></ul>);
    expect(container.textContent).toContain('9.50°F');
    expect(container.textContent).toContain('32.00°F');
    expect(container.textContent).toContain('3.13σ');
    expect(anomaly.value).toBe(-12.5);
  });

  it.each([null, undefined, NaN, Infinity, -Infinity])('keeps missing/invalid %s distinct from measured zero', value => {
    const { container } = renderCard({ ...makeAnomaly(), unit: '°C', value, baseline: 0, z_score: value });
    expect(container.textContent).toContain('Value: —');
    expect(container.textContent).toContain('Baseline: 0.00°C');
    expect(container.textContent).not.toContain('σ');
  });

  it.each([null, undefined, NaN, Infinity, -Infinity])('keeps a missing/invalid baseline (%s) distinct from a measured zero value', baseline => {
    const { container } = renderCard({ ...makeAnomaly(), unit: 'Pa', value: 0, baseline });
    expect(container.textContent).toContain('Value: 0.00 bar');
    expect(container.textContent).toContain('Baseline: —');
  });

  it('retains an unsupported authoritative unit as raw rather than guessing a converter', () => {
    const { container } = renderCard({
      ...makeAnomaly({ signal: 'ChargeRateMilePerHour', value: 1250.5, baseline: -0.125 }),
      unit: 'm/h',
    });
    expect(container.textContent).toContain('Value: 1,250.50 m/h');
    expect(container.textContent).toContain('Baseline: -0.13 m/h');
    expect(container.textContent).not.toContain('mph');
    expect(container.textContent).not.toContain('km/h');
  });

  it.each([undefined, '', 'unknown'])('does not guess units for an unspecified mapping (%s)', unit => {
    const { container } = renderCard({ ...makeAnomaly({ signal: 'OutsideTemp', value: -0.125, baseline: 0 }), unit });
    expect(container.textContent).toContain('Value: -0.13');
    expect(container.textContent).toContain('Baseline: 0.00');
    expect(container.textContent).not.toContain('°C');
    expect(container.textContent).not.toContain('°F');
  });

  it('renders the signal, message, localized type label and timestamp', () => {
    const { container } = renderCard(makeAnomaly());
    const text = container.textContent ?? '';
    expect(text).toContain('BatteryVoltage');
    expect(text).toContain('reading deviates sharply from the learned mean');
    expect(text).toContain('Statistical'); // anomaly.type.z_score label
    expect(text).toContain('2 hours ago'); // detected_at -> TimeStamp (relative)
  });

  it('formats value and baseline to two decimals with their labels', () => {
    const { container } = renderCard(makeAnomaly({ value: 3.14159, baseline: 2 }));
    const text = container.textContent ?? '';
    expect(text).toContain('Value');
    expect(text).toContain('3.14'); // fmtNumber(3.14159, 2)
    expect(text).toContain('Baseline');
    expect(text).toContain('2.00'); // fmtNumber(2, 2)
  });

  it('shows the z-score sigma chip at the selected precision when z_score > 0', () => {
    const { container } = renderCard(makeAnomaly({ z_score: 4.27 }));
    const text = container.textContent ?? '';
    expect(text).toContain('4.27\u03c3');
    expect(text).not.toContain('4.3\u03c3');
  });

  it('hides the sigma chip for a range violation (z_score === 0)', () => {
    const { container } = renderCard(makeAnomaly({ type: 'range', z_score: 0 }));
    const text = container.textContent ?? '';
    expect(text).not.toContain('\u03c3');
    expect(text).toContain('Range'); // anomaly.type.range label still shown
  });

  it.each([
    ['critical', 'danger'],
    ['warning', 'warning'],
    ['info', 'info'],
  ] as const)('keeps the %s card neutral while preserving its badge tone', (severity, tone) => {
    renderCard(makeAnomaly({ severity }));
    const item = screen.getByRole('listitem');
    expect(item).toHaveClass('bg-[var(--surface-1)]', 'border-[var(--border-default)]');
    expect(item.className).not.toContain('--semantic-');
    expect(item).toHaveClass('flex', 'flex-col', 'gap-2', 'rounded-xl', 'border', 'p-4');
    const badge = screen.getByText(new RegExp(`^${severity}$`, 'i'));
    expect(badge.parentElement?.className).toContain(`bg-[var(--semantic-${tone}-bg)]`);
    expect(screen.getByText('Statistical')).toHaveClass('bg-[var(--surface-2)]');
  });

  it('conveys severity as text on the badge, not by colour alone (a11y)', () => {
    renderCard(makeAnomaly({ severity: 'critical' }));
    // The badge renders the severity word (English default when no i18n
    // bundle is mounted); matched case-insensitively.
    expect(screen.getByText(/^critical$/i)).toBeInTheDocument();
  });

  it('renders an em-dash when detected_at is unparseable (null-safe timestamp)', () => {
    const { container } = renderCard(makeAnomaly({ detected_at: '' }));
    expect(container.textContent).toContain('\u2014');
    expect(container.textContent).not.toContain('2 hours ago');
  });

  it('falls back to the raw type string for an unknown detector type', () => {
    const { container } = renderCard(makeAnomaly({ type: 'spike' as AnomalyEntry['type'] }));
    expect(container.textContent).toContain('spike');
  });

  it('renders as a single semantic list item', () => {
    renderCard(makeAnomaly());
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0].tagName).toBe('LI');
  });
});
