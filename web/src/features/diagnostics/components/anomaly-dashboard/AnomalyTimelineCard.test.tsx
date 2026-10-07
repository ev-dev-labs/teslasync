// Behavioural coverage for the anomaly-timeline card.
//
// AnomalyTimelineCard is a pure presentational leaf: it maps one
// AnomalyEntry onto a severity-toned <li> with a colour-independent
// SeverityBadge, a signal + type-label + z-score header, the detector
// message, and a value/baseline footer. These tests pin:
//   - rendered content (signal, message, localized type label, 2dp
//     value/baseline, timestamp)
//   - the severity -> tone branch (incl. the 'warning' -> 'warn' alias)
//   - the z-score chip conditional (shown for z>0, hidden for range/0)
//   - null-safety of the timestamp path (unparseable -> em-dash)
//   - list-item semantics + severity-as-text (a11y: not colour-alone)
//
// react-i18next returns the English default (2nd arg) when no provider
// is mounted, so severity labels surface verbatim ('critical', ...) —
// asserted case-insensitively so the suite is stable whether or not a
// bundle is loaded. TimeStamp's locale/tz hooks are stubbed (they pull
// TanStack Query + Router otherwise) exactly as TimeStamp's own test does.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AnomalyEntry } from '@/api/hooks/useAnomalies';
import { AnomalyTimelineCard } from './AnomalyTimelineCard';

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
function renderCard(anomaly: AnomalyEntry) {
  return render(
    <ul>
      <AnomalyTimelineCard anomaly={anomaly} />
    </ul>,
  );
}

describe('AnomalyTimelineCard', () => {
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

  it('shows the z-score sigma chip at one decimal when z_score > 0', () => {
    const { container } = renderCard(makeAnomaly({ z_score: 4.27 }));
    const text = container.textContent ?? '';
    expect(text).toContain('4.3\u03c3'); // fmtNumber(4.27, 1) = '4.3'
    expect(text).not.toContain('4.27\u03c3');
  });

  it('hides the sigma chip for a range violation (z_score === 0)', () => {
    const { container } = renderCard(makeAnomaly({ type: 'range', z_score: 0 }));
    const text = container.textContent ?? '';
    expect(text).not.toContain('\u03c3');
    expect(text).toContain('Range'); // anomaly.type.range label still shown
  });

  it('maps each severity to its list-item tone (incl. the warning->warn alias)', () => {
    const critical = renderCard(makeAnomaly({ severity: 'critical' })).container.querySelector('li');
    expect(critical?.className).toContain('bg-red-500/10');
    expect(critical?.className).toContain('border-red-500/30');

    const warning = renderCard(makeAnomaly({ severity: 'warning' })).container.querySelector('li');
    expect(warning?.className).toContain('bg-amber-500/10');

    const info = renderCard(makeAnomaly({ severity: 'info' })).container.querySelector('li');
    expect(info?.className).toContain('bg-sky-500/10');
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
