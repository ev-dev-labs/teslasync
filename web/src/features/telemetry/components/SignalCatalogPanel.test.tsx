/**
 * SignalCatalogPanel — behavioural + unit contract tests.
 *
 * Covers every export of the module:
 *   - getCatalogStalenessStyle (pure threshold→style mapper, incl. the new i18n key)
 *   - formatStaleness (pure "…ago" formatter, incl. the floor/clamp bug fixes)
 *   - SignalCatalogPanel (the catalog browser component)
 *
 * The single data source (`useSignalGaps`) is mocked via a hoisted mutable
 * record so each branch — loading, empty, populated, no-match, selection,
 * invalid-timestamp — can be driven deterministically without a network.
 * `react-i18next` is stubbed with an interpolating `t` so copy assertions and
 * the per-row selection aria-labels stay stable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

type LiveEntry = { value: unknown; timestamp: string | null };
type LiveData = Record<string, LiveEntry | unknown> | undefined;

const h = vi.hoisted(() => ({
  gaps: {
    data: undefined as LiveData,
    isLoading: false,
    dataUpdatedAt: 0,
  },
}));

// Interpolating i18n stub: supports both `t(key, 'Default')` and the
// `t(key, { defaultValue: 'Add {{name}}…', name })` object form the
// selection column uses, so each row's aria-label is unique.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tpl: string, vars: Record<string, unknown>) =>
    tpl.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''));
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = (third && typeof third === 'object' ? third : {}) as Record<string, unknown>;
          return interpolate(second, vars);
        }
        if (second && typeof second === 'object') {
          const vars = second as Record<string, unknown>;
          const tpl = typeof vars.defaultValue === 'string' ? vars.defaultValue : key;
          return interpolate(tpl, vars);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('@/api/hooks/useTelemetry', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useTelemetry')>(
    '@/api/hooks/useTelemetry',
  );
  return { ...actual, useSignalGaps: () => h.gaps };
});

import {
  SignalCatalogPanel,
  getCatalogStalenessStyle,
  formatStaleness,
  type SignalCatalogPanelProps,
} from './SignalCatalogPanel';

// ── helpers ──────────────────────────────────────────────────────────────
function tsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

/** Active(<30s) + Aging(30-300s) + Stale(>300s) + Never(null-ts). */
function sampleData(): Record<string, LiveEntry> {
  return {
    vehicle_speed: { value: 42, timestamp: tsAgo(5) },
    battery_level: { value: 80, timestamp: tsAgo(60) },
    tpms_fl: { value: 2.9, timestamp: tsAgo(600) },
    door_state: { value: 'closed', timestamp: null },
  };
}

function renderPanel(props?: Partial<SignalCatalogPanelProps>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SignalCatalogPanel vehicleId={1} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// StatCard renders <label span> then a sibling value row; hop across.
function statValue(label: string): string {
  const labelEl = screen.getByText(label);
  return labelEl.parentElement?.nextElementSibling?.textContent?.trim() ?? '';
}

// The signal-name column is the only place that renders <code>.
function signalNames(): string[] {
  return Array.from(document.querySelectorAll('code')).map((c) => c.textContent ?? '');
}

beforeEach(() => {
  h.gaps.data = sampleData();
  h.gaps.isLoading = false;
  h.gaps.dataUpdatedAt = 0;
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── getCatalogStalenessStyle ───────────────────────────────────────────────
describe('getCatalogStalenessStyle', () => {
  it('maps no-timestamp to the neutral "never" style', () => {
    const s = getCatalogStalenessStyle(10, false);
    expect(s.key).toBe('never');
    expect(s.label).toBe('Never received');
    expect(s.variant).toBe('neutral');
    expect(s.text).toContain('text-muted');
  });

  it('maps fresh/aging/stale windows with inclusive lower boundaries', () => {
    expect(getCatalogStalenessStyle(0, true)).toMatchObject({ key: 'active', variant: 'success' });
    expect(getCatalogStalenessStyle(29, true).key).toBe('active');
    // 30 is NOT active (uses `< 30`) → aging.
    expect(getCatalogStalenessStyle(30, true)).toMatchObject({ key: 'aging', variant: 'warning' });
    expect(getCatalogStalenessStyle(299, true).key).toBe('aging');
    // 300 is NOT aging (uses `< 300`) → stale.
    expect(getCatalogStalenessStyle(300, true)).toMatchObject({ key: 'stale', variant: 'danger' });
    expect(getCatalogStalenessStyle(9999, true).key).toBe('stale');
  });
});

// ── formatStaleness ─────────────────────────────────────────────────────────
describe('formatStaleness', () => {
  it('renders em-dash for non-finite input', () => {
    expect(formatStaleness(Infinity)).toBe('—');
    expect(formatStaleness(NaN)).toBe('—');
  });

  it('formats seconds / minutes / hours and clamps negatives to zero', () => {
    expect(formatStaleness(0)).toBe('0s ago');
    expect(formatStaleness(5)).toBe('5s ago');
    expect(formatStaleness(59)).toBe('59s ago');
    expect(formatStaleness(90)).toBe('1m ago');
    // Clock-skew / future timestamp must not print "-5s ago".
    expect(formatStaleness(-5)).toBe('0s ago');
  });

  it('floors instead of rounding so it never overflows to "60m" / "1h 60m"', () => {
    // Pre-fix these rounded up (fmtInt(59.98)=60) → wrong labels.
    expect(formatStaleness(3599)).toBe('59m ago');
    expect(formatStaleness(3600)).toBe('1h 0m ago');
    expect(formatStaleness(7190)).toBe('1h 59m ago');
  });
});

// ── SignalCatalogPanel — summary + table ────────────────────────────────────
describe('SignalCatalogPanel — summary + rows', () => {
  it('renders the four KPI cards partitioned by staleness category', () => {
    renderPanel();
    expect(statValue('Total Signals')).toBe('4');
    // "Active" card counts the active category (fresh + aging).
    expect(statValue('Active (<30s)')).toBe('2');
    expect(statValue('Stale (>5min)')).toBe('1');
    expect(statValue('Never Received')).toBe('1');
  });

  it('renders every signal row with a per-window status badge', () => {
    renderPanel();
    expect(screen.getByText('vehicle_speed')).toBeInTheDocument();
    expect(screen.getByText('battery_level')).toBeInTheDocument();
    // Badge labels come from getCatalogStalenessStyle via t().
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Aging')).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('Never received')).toBeInTheDocument();
  });

  it('hides the summary band when showSummary is false', () => {
    renderPanel({ showSummary: false });
    expect(screen.queryByText('Total Signals')).toBeNull();
    // Rows still render.
    expect(screen.getByText('vehicle_speed')).toBeInTheDocument();
  });

  it('renders an optional title and headerExtra slot', () => {
    renderPanel({ title: 'My Catalog', headerExtra: <span>extra-slot</span> });
    expect(screen.getByRole('heading', { name: 'My Catalog' })).toBeInTheDocument();
    expect(screen.getByText('extra-slot')).toBeInTheDocument();
  });
});

// ── loading / empty states ──────────────────────────────────────────────────
describe('SignalCatalogPanel — loading & empty', () => {
  it('shows skeletons (no table, no empty copy) while loading', () => {
    h.gaps.isLoading = true;
    const { container } = renderPanel();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText('vehicle_speed')).toBeNull();
    expect(screen.queryByText('No signal data available')).toBeNull();
  });

  it('shows the empty placeholder when the vehicle has no signals', () => {
    h.gaps.data = {};
    renderPanel();
    expect(screen.getByText('No signal data available')).toBeInTheDocument();
    expect(signalNames()).toHaveLength(0);
  });

  it('shows a "last refreshed" footer only when the query has resolved once', () => {
    h.gaps.dataUpdatedAt = Date.now();
    renderPanel();
    expect(screen.getByText(/Last refreshed/)).toBeInTheDocument();
  });
});

// ── search / filter / sort ──────────────────────────────────────────────────
describe('SignalCatalogPanel — search, filter & sort', () => {
  it('filters rows by the search box and shows the no-match copy', () => {
    renderPanel();
    const input = screen.getByLabelText('Filter signals');

    fireEvent.change(input, { target: { value: 'battery' } });
    expect(signalNames()).toEqual(['battery_level']);

    fireEvent.change(input, { target: { value: 'zzz-nope' } });
    expect(screen.getByText('No signals match current filters')).toBeInTheDocument();
    expect(signalNames()).toHaveLength(0);
  });

  it('narrows to stale+never and reflects pressed state via aria-pressed', () => {
    renderPanel();
    const staleBtn = screen.getByRole('button', { name: 'Stale Only' });
    expect(staleBtn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(staleBtn);

    expect(staleBtn).toHaveAttribute('aria-pressed', 'true');
    const names = signalNames();
    expect(names).toContain('tpms_fl'); // stale
    expect(names).toContain('door_state'); // never
    expect(names).not.toContain('vehicle_speed'); // active → hidden
  });

  it('narrows to the active category only', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Active Only' }));
    const names = signalNames();
    expect(names).toContain('vehicle_speed');
    expect(names).toContain('battery_level');
    expect(names).not.toContain('tpms_fl');
  });

  it('re-sorts alphabetically and defaults to most-stale-first', () => {
    renderPanel();
    // Default sort = staleness desc: never(∞) → 600 → 60 → 5.
    expect(signalNames()).toEqual(['door_state', 'tpms_fl', 'battery_level', 'vehicle_speed']);

    const azBtn = screen.getByRole('button', { name: 'A-Z' });
    fireEvent.click(azBtn);
    expect(azBtn).toHaveAttribute('aria-pressed', 'true');
    expect(signalNames()).toEqual(['battery_level', 'door_state', 'tpms_fl', 'vehicle_speed']);
  });
});

// ── selection workflow ──────────────────────────────────────────────────────
describe('SignalCatalogPanel — selection', () => {
  it('exposes per-row toggles and calls onToggle with the signal name', () => {
    const onToggle = vi.fn();
    renderPanel({ selection: { selectedSignals: ['vehicle_speed'], onToggle, max: 3 } });

    // Selected row → "Remove"; unselected row → "Add".
    const remove = screen.getByRole('button', { name: 'Remove vehicle_speed from selection' });
    const add = screen.getByRole('button', { name: 'Add battery_level to selection' });
    expect(remove).toBeInTheDocument();
    expect(add).toBeInTheDocument();

    fireEvent.click(add);
    expect(onToggle).toHaveBeenCalledWith('battery_level');
  });

  it('disables unselected toggles once the selection cap is reached', () => {
    const onToggle = vi.fn();
    renderPanel({
      selection: { selectedSignals: ['vehicle_speed', 'battery_level'], onToggle, max: 2 },
    });

    const capped = screen.getByRole('button', { name: 'Add tpms_fl to selection' });
    const selected = screen.getByRole('button', { name: 'Remove vehicle_speed from selection' });

    expect(capped).toBeDisabled();
    // Already-selected rows can still be removed even at the cap.
    expect(selected).not.toBeDisabled();

    fireEvent.click(capped);
    expect(onToggle).not.toHaveBeenCalled();
  });
});

// ── hardening: invalid timestamp ────────────────────────────────────────────
describe('SignalCatalogPanel — invalid timestamp hardening', () => {
  it('treats an unparseable timestamp as "never received" rather than a bogus active row', () => {
    h.gaps.data = { flaky_signal: { value: 1, timestamp: 'not-a-real-date' } };
    renderPanel();

    expect(statValue('Never Received')).toBe('1');
    expect(statValue('Active (<30s)')).toBe('0');
    expect(screen.getByText('Never received')).toBeInTheDocument();
  });
});
