/**
 * AnomalyDetectorWidget — behaviour, branch, null-safety and a11y coverage for
 * the dashboard's statistical-outlier widget.
 *
 * What this file pins:
 *   - the two exported pure helpers:
 *       · `formatRelativeTime` — the i18n "time ago" label, including the
 *         invalid/empty/future-timestamp guards that previously produced
 *         "NaNd ago";
 *       · `maxSeverity` — the critical > warning > info reducer, incl. the
 *         empty-list and unknown-severity fallbacks;
 *   - the widget's data-source resolution (explicit `vehicleId` prop vs. the
 *     first fleet vehicle vs. no vehicle at all → `null`);
 *   - every render state fanned out by `WidgetShell` — loading skeleton, error
 *     panel, empty state, and the populated tip list;
 *   - the populated list's SORT (most-severe-first), the 3-card cap, the
 *     z-score / relative-time / message / severity-badge content, and that the
 *     decorative severity icons are hidden from the a11y tree;
 *   - the freshness "Refresh" control wiring back to `refetch`;
 *   - the compact (1×1) variant — active count + severity-coloured badge, and
 *     its own empty state.
 *
 * Strategy: the two data hooks (`useAnomalies`, `useVehicles`) are mocked so no
 * network is touched and every query state is controllable per-test. i18n is a
 * passthrough that honours the English default and interpolates `{{count}}`, so
 * the visible copy is deterministic and real. The component is rendered inside a
 * MemoryRouter because the shared `QueryError` panel (surfaced on the error
 * branch) calls `useNavigate()`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TFunction } from 'i18next';

import type { AnomalyData, AnomalyEntry } from '@/api/hooks/useAnomalies';
import type { WidgetSize } from './types';

// ── Mocks ────────────────────────────────────────────────────────────────────

// i18n passthrough: returns the English default and interpolates {{var}} tokens
// so count-bearing copy ("3 active", "5m ago") is asserted as real strings.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      const vars = typeof defaultValue === 'string' ? options : undefined;
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const { useAnomaliesMock, useVehiclesMock } = vi.hoisted(() => ({
  useAnomaliesMock: vi.fn(),
  useVehiclesMock: vi.fn(),
}));

vi.mock('@/api/hooks/useAnomalies', () => ({
  useAnomalies: (vehicleId: string | null) => useAnomaliesMock(vehicleId),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
}));

import AnomalyDetectorWidget, { formatRelativeTime, maxSeverity } from './AnomalyDetectorWidget';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** i18next-style translator: English default + {{var}} interpolation. */
function makeT() {
  return vi.fn(
    (key: string, defaultValue?: unknown, options?: Record<string, unknown>): string => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      const vars = typeof defaultValue === 'string' ? options : undefined;
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''))
        : template;
    },
  );
}

const asT = (fn: ReturnType<typeof makeT>): TFunction => fn as unknown as TFunction;

function makeEntry(over: Partial<AnomalyEntry> = {}): AnomalyEntry {
  return {
    signal: 'battery_voltage',
    type: 'z_score',
    severity: 'warning',
    value: 14.2,
    baseline: 12.5,
    z_score: 3,
    detected_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    message: 'Unusual reading',
    ...over,
  };
}

function makeData(anomalies: AnomalyEntry[]): AnomalyData {
  return {
    anomalies,
    health_summary: {},
    signals_monitored: 5,
    anomalies_last_7d: anomalies.length,
    anomalies_last_24h: anomalies.length,
  };
}

interface AnomalyQueryResult {
  data: AnomalyData | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeResult(over: Partial<AnomalyQueryResult> = {}): AnomalyQueryResult {
  return {
    data: makeData([]),
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 4 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <AnomalyDetectorWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAnomaliesMock.mockReset();
  useVehiclesMock.mockReset();
  useVehiclesMock.mockReturnValue({ data: [] });
  useAnomaliesMock.mockReturnValue(makeResult());
});

// ── Pure helper: formatRelativeTime ──────────────────────────────────────────

describe('formatRelativeTime', () => {
  it('collapses empty and unparseable timestamps to an em-dash (no "NaNd ago")', () => {
    const t = makeT();
    expect(formatRelativeTime('', asT(t))).toBe('—');
    expect(formatRelativeTime('not-a-date', asT(t))).toBe('—');
    // Regression guard: the old implementation returned "NaNd ago" here.
    expect(formatRelativeTime('not-a-date', asT(t))).not.toContain('NaN');
  });

  it('reads "Just now" for sub-minute and future (clock-skew) timestamps', () => {
    const t = makeT();
    const halfMinAgo = new Date(Date.now() - 30_000).toISOString();
    const oneHourAhead = new Date(Date.now() + 60 * 60_000).toISOString();
    expect(formatRelativeTime(halfMinAgo, asT(t))).toBe('Just now');
    expect(formatRelativeTime(oneHourAhead, asT(t))).toBe('Just now');
  });

  it('formats minutes, hours and days with the interpolated count', () => {
    const t = makeT();
    const minutes = new Date(Date.now() - 5 * 60_000).toISOString();
    const hours = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    const days = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();

    expect(formatRelativeTime(minutes, asT(t))).toBe('5m ago');
    expect(formatRelativeTime(hours, asT(t))).toBe('3h ago');
    expect(formatRelativeTime(days, asT(t))).toBe('2d ago');

    // The label goes through i18n with a stable key + count (not a raw string).
    expect(t).toHaveBeenCalledWith(
      'widget.anomalyDetector.relative.minutes',
      '{{count}}m ago',
      { count: 5 },
    );
  });
});

// ── Pure helper: maxSeverity ─────────────────────────────────────────────────

describe('maxSeverity', () => {
  it('returns the most severe level present (critical > warning > info)', () => {
    expect(
      maxSeverity([{ severity: 'info' }, { severity: 'critical' }, { severity: 'warning' }]),
    ).toBe('critical');
    expect(maxSeverity([{ severity: 'info' }, { severity: 'warning' }])).toBe('warning');
    expect(maxSeverity([{ severity: 'info' }])).toBe('info');
  });

  it('defaults to info for empty lists and never lets an unknown severity win', () => {
    expect(maxSeverity([])).toBe('info');
    expect(maxSeverity([{ severity: 'bogus' }])).toBe('info');
    // An unknown severity must not mask a real critical.
    expect(maxSeverity([{ severity: 'bogus' }, { severity: 'critical' }])).toBe('critical');
  });
});

// ── Data-source resolution ───────────────────────────────────────────────────

describe('AnomalyDetectorWidget — vehicle resolution', () => {
  it('queries anomalies for the explicit vehicleId prop', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 99 }] });
    renderWidget({ cols: 2, rows: 4 }, 42);
    expect(useAnomaliesMock).toHaveBeenCalledWith('42');
  });

  it('falls back to the first fleet vehicle when no vehicleId prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 7 }, { id: 8 }] });
    renderWidget();
    expect(useAnomaliesMock).toHaveBeenCalledWith('7');
  });

  it('passes null (querying nothing) when the fleet is empty', () => {
    useVehiclesMock.mockReturnValue({ data: [] });
    renderWidget();
    expect(useAnomaliesMock).toHaveBeenCalledWith(null);
  });
});

// ── Render states ────────────────────────────────────────────────────────────

describe('AnomalyDetectorWidget — states', () => {
  it('renders a loading skeleton while the query is pending', () => {
    useAnomaliesMock.mockReturnValue(makeResult({ isLoading: true, data: undefined }));
    const { container } = renderWidget();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No anomalies')).toBeNull();
  });

  it('surfaces an error panel when the query fails', () => {
    useAnomaliesMock.mockReturnValue(
      makeResult({ error: new Error('boom'), isError: true, data: undefined }),
    );
    renderWidget();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No anomalies')).toBeNull();
  });

  it('shows an empty state when there are no anomalies', () => {
    useAnomaliesMock.mockReturnValue(makeResult({ data: makeData([]) }));
    renderWidget();
    expect(screen.getByText('No anomalies')).toBeInTheDocument();
  });
});

// ── Populated list (full size) ───────────────────────────────────────────────

describe('AnomalyDetectorWidget — populated', () => {
  it('renders one tip per anomaly, sorted most-severe first', () => {
    useAnomaliesMock.mockReturnValue(
      makeResult({
        data: makeData([
          makeEntry({ signal: 'batt_warn', severity: 'warning' }),
          makeEntry({ signal: 'batt_info', severity: 'info' }),
          makeEntry({ signal: 'batt_crit', severity: 'critical' }),
        ]),
      }),
    );
    renderWidget();

    const titles = screen.getAllByText(/· z=/);
    expect(titles).toHaveLength(3);
    expect(titles[0]).toHaveTextContent('batt_crit');
    expect(titles[1]).toHaveTextContent('batt_warn');
    expect(titles[2]).toHaveTextContent('batt_info');
  });

  it('shows the signal, z-score, relative time, message and severity badge', () => {
    useAnomaliesMock.mockReturnValue(
      makeResult({
        data: makeData([
          makeEntry({
            signal: 'batt_warn',
            severity: 'warning',
            z_score: 4.3,
            detected_at: new Date(Date.now() - 12 * 60_000).toISOString(),
            message: 'Voltage spike detected',
          }),
        ]),
      }),
    );
    renderWidget();

    const title = screen.getByText(/batt_warn/);
    expect(title).toHaveTextContent('z=4.3');
    expect(title).toHaveTextContent('12m ago');
    expect(screen.getByText('Voltage spike detected')).toBeInTheDocument();
    expect(screen.getByText('warning')).toBeInTheDocument();
  });

  it('caps the visible list at three cards', () => {
    useAnomaliesMock.mockReturnValue(
      makeResult({
        data: makeData([
          makeEntry({ signal: 's1', severity: 'critical' }),
          makeEntry({ signal: 's2', severity: 'warning' }),
          makeEntry({ signal: 's3', severity: 'info' }),
          makeEntry({ signal: 's4', severity: 'info' }),
        ]),
      }),
    );
    renderWidget();
    expect(screen.getAllByText(/· z=/)).toHaveLength(3);
  });

  it('hides the decorative severity icons from the accessibility tree', () => {
    useAnomaliesMock.mockReturnValue(
      makeResult({
        data: makeData([
          makeEntry({ signal: 's1', severity: 'critical' }),
          makeEntry({ signal: 's2', severity: 'warning' }),
          makeEntry({ signal: 's3', severity: 'info' }),
        ]),
      }),
    );
    const { container } = renderWidget();
    // One aria-hidden icon per tip (+ the header icon).
    expect(
      container.querySelectorAll('svg[aria-hidden="true"]').length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('refetches when the freshness control is activated', () => {
    const refetch = vi.fn();
    useAnomaliesMock.mockReturnValue(
      makeResult({ data: makeData([makeEntry()]), dataUpdatedAt: Date.now(), refetch }),
    );
    renderWidget();

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ── Compact (1×1) variant ────────────────────────────────────────────────────

describe('AnomalyDetectorWidget — compact', () => {
  it('shows the active count and a severity-coloured badge', () => {
    useAnomaliesMock.mockReturnValue(
      makeResult({
        data: makeData([
          makeEntry({ signal: 's1', severity: 'critical' }),
          makeEntry({ signal: 's2', severity: 'warning' }),
        ]),
      }),
    );
    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('2')).toBeInTheDocument();
    const badge = screen.getByText('2 active');
    // maxSeverity → critical → SEVERITY_BADGE.danger → red chip.
    expect(badge).toHaveClass('bg-red-100');
  });

  it('renders an empty state in compact mode when there are no anomalies', () => {
    useAnomaliesMock.mockReturnValue(makeResult({ data: makeData([]) }));
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('No anomalies')).toBeInTheDocument();
  });
});
