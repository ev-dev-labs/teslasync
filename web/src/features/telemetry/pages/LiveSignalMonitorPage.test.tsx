/**
 * LiveSignalMonitorPage — behaviour + hardening coverage.
 *
 * The page owns one piece of real logic: the `analytics` useMemo that derives
 * a KPI band, a value-type breakdown, and a most-active-signals ranking from
 * the live tail buffer produced by `useLiveSignalStream`. Everything else is
 * wiring (connection badge, disconnect banner, hook configuration). We mock the
 * two feature hooks + `useSelectedVehicle` so the page's own derivation and
 * wiring run against fully-controlled inputs, then assert the rendered output
 * of the (real) child components.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type {
  UseLiveSignalStreamResult,
  UseLiveSignalStreamOptions,
} from '../hooks/useLiveSignalStream';
import type {
  UseThroughputHistoryResult,
  UseThroughputHistoryOptions,
} from '../hooks/useThroughputHistory';
import type { SelectedVehicleResult } from '@/hooks/useSelectedVehicle';
import type { Vehicle } from '@/types/vehicle';
import type { SignalEntry } from '@/types/telemetry';

// ── Hoisted mutable state shared by the module mocks below ──────────────
const h = vi.hoisted(() => ({
  stream: null as UseLiveSignalStreamResult | null,
  throughput: null as UseThroughputHistoryResult | null,
  selected: null as SelectedVehicleResult | null,
  streamOpts: null as UseLiveSignalStreamOptions | null,
  throughputArgs: null as { rate: number; args: UseThroughputHistoryOptions } | null,
}));

// ── i18n stub: return the fallback default string (with {{var}} interp) ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallback === 'string') {
        if (opts && typeof opts === 'object') {
          let s = fallback;
          for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
          return s;
        }
        return fallback;
      }
      return _key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── framer-motion: render eagerly, strip animation-only props ───────────
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const safe: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (['animate', 'initial', 'exit', 'transition', 'whileHover', 'whileTap', 'variants'].includes(k))
              continue;
            safe[k] = v;
          }
          return <div {...safe}>{children}</div>;
        },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

vi.mock('../hooks/useLiveSignalStream', () => ({
  useLiveSignalStream: (opts: UseLiveSignalStreamOptions) => {
    h.streamOpts = opts;
    return h.stream;
  },
}));

vi.mock('../hooks/useThroughputHistory', () => ({
  useThroughputHistory: (rate: number, args: UseThroughputHistoryOptions) => {
    h.throughputArgs = { rate, args };
    return h.throughput;
  },
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => h.selected,
}));

import LiveSignalMonitorPage from './LiveSignalMonitorPage';

// ── Builders ────────────────────────────────────────────────────────────
function makeStream(over: Partial<UseLiveSignalStreamResult> = {}): UseLiveSignalStreamResult {
  return {
    connected: true,
    chartData: [],
    chartStats: [],
    chartPointCount: 0,
    tailEntries: [],
    tailRate: 0,
    tailPaused: false,
    setTailPaused: vi.fn(),
    clearTail: vi.fn(),
    resetChart: vi.fn(),
    ...over,
  };
}

function veh(id: number): Vehicle {
  return { id, vehicle_id: id, display_name: `Vehicle ${id}`, vin: `VIN${id}` } as unknown as Vehicle;
}

function makeSelected(vehicleId: number | null, vehicles: Vehicle[]): SelectedVehicleResult {
  return { vehicleId, vehicle: null, vehicles, setVehicleId: vi.fn() };
}

function entry(id: number, name: string, value: string, type: SignalEntry['type']): SignalEntry {
  return { id, timestamp: '2026-07-04T12:00:00Z', name, value, type };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LiveSignalMonitorPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.selected = makeSelected(1, [veh(1)]);
  h.stream = makeStream();
  h.throughput = { history: [], peak: 0, reset: vi.fn() };
  h.streamOpts = null;
  h.throughputArgs = null;
});

describe('LiveSignalMonitorPage', () => {
  it('renders the KPI band, empty analytics panels and page title when connected with an empty buffer', () => {
    h.stream = makeStream({ connected: true, tailEntries: [], tailRate: 0 });

    renderPage();

    // Page title (usePageTitle) + heading fall back to the same canonical
    // default that matches the i18n catalog value ("Live Monitor").
    expect(document.title).toContain('Live Monitor');
    expect(document.title).toContain('TeslaSync');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Live Monitor');

    // Named landmark regions for the summary + analytics bento.
    expect(screen.getByRole('region', { name: 'Live stream summary' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Live analytics' })).toBeInTheDocument();

    // Connected → no disconnect banner, connected badge reused twice.
    expect(screen.queryByText(/attempting to reconnect/i)).toBeNull();
    expect(screen.getAllByText('Connected').length).toBeGreaterThanOrEqual(2);

    // Both derived analytics panels show their empty state on a cold buffer.
    expect(screen.getAllByText('No signals buffered yet')).toHaveLength(2);
    // Connected throughput waits for data rather than showing "offline".
    expect(screen.getByText('Waiting for live throughput…')).toBeInTheDocument();

    // Unique-signals KPI reads 0 (null-safe) rather than blank.
    const uniqueCard = screen.getByText('Unique Signals').closest('div');
    expect(uniqueCard).not.toBeNull();
    expect(within(uniqueCard as HTMLElement).getByText('0')).toBeInTheDocument();
  });

  it('derives unique/typed counts and ranks the most active signals from the live buffer', () => {
    // Newest-first buffer: speed x3 (numeric), gear (string), charging (boolean).
    h.stream = makeStream({
      connected: true,
      tailRate: 7,
      tailEntries: [
        entry(5, 'speed', '55', 'number'),
        entry(4, 'speed', '50', 'number'),
        entry(3, 'gear', 'D', 'string'),
        entry(2, 'charging', 'true', 'boolean'),
        entry(1, 'speed', '40', 'number'),
      ],
    });

    renderPage();

    // Value-type breakdown: numeric 3/5 = 60%, boolean & string 1/5 = 20% each.
    expect(screen.getByText('3 · 60%')).toBeInTheDocument();
    expect(screen.getAllByText('1 · 20%')).toHaveLength(2);

    // Ranking: speed is the busiest signal (count 3), the two singletons tie.
    expect(screen.getByText('3×')).toBeInTheDocument();
    expect(screen.getAllByText('1×')).toHaveLength(2);

    // Unique-signals KPI counts distinct names (3), not raw buffer entries (5).
    const uniqueCard = screen.getByText('Unique Signals').closest('div');
    expect(within(uniqueCard as HTMLElement).getByText('3')).toBeInTheDocument();

    // The top-signal row carries the LATEST (newest-first) value, 55 not 40.
    const topPanel = screen.getByText('Most Active Signals').closest('[data-print-card]');
    expect(topPanel).not.toBeNull();
    expect(within(topPanel as HTMLElement).getByText('speed')).toBeInTheDocument();
    expect(within(topPanel as HTMLElement).getByText('55')).toBeInTheDocument();
  });

  it('surfaces the disconnected banner and offline states when the stream drops', () => {
    h.stream = makeStream({ connected: false, tailEntries: [], tailRate: 0 });
    h.throughput = { history: [], peak: 0, reset: vi.fn() };

    renderPage();

    expect(screen.getByText(/attempting to reconnect/i)).toBeInTheDocument();
    expect(screen.getAllByText('Disconnected').length).toBeGreaterThanOrEqual(2);
    // Throughput panel swaps to the offline message rather than "waiting".
    expect(screen.getByText('Stream disconnected — no live throughput')).toBeInTheDocument();
    expect(screen.queryByText('Waiting for live throughput…')).toBeNull();
  });

  it('wires the live stream and throughput hooks with the selected vehicle + tail config', () => {
    h.selected = makeSelected(42, [veh(42)]);
    h.stream = makeStream({ tailRate: 0 });

    renderPage();

    // Tail-only config: no chart signals, 500-entry buffer, scoped to vehicle 42.
    expect(h.streamOpts).toEqual({
      enabled: true,
      vehicleId: 42,
      chartSignals: [],
      tailMax: 500,
    });
    // Throughput samples the tail rate and resets on the same vehicle key.
    expect(h.throughputArgs).toEqual({
      rate: 0,
      args: { enabled: true, resetKey: 42 },
    });
    // Fleet with a vehicle renders the scope picker.
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('passes a null vehicle scope through and hides the picker for an empty fleet', () => {
    h.selected = makeSelected(null, []);

    renderPage();

    expect(h.streamOpts).toMatchObject({ vehicleId: null });
    expect(h.throughputArgs?.args.resetKey).toBeNull();
    // VehicleSelect renders nothing when the fleet is empty.
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('toggles the tail pause state through setTailPaused', () => {
    const setTailPaused = vi.fn();
    h.stream = makeStream({ connected: true, tailEntries: [], tailPaused: false, setTailPaused });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    expect(setTailPaused).toHaveBeenCalledTimes(1);
    // The page passes a functional updater that flips the current value.
    const updater = setTailPaused.mock.calls[0][0] as (prev: boolean) => boolean;
    expect(typeof updater).toBe('function');
    expect(updater(false)).toBe(true);
    expect(updater(true)).toBe(false);
  });

  it('clears the tail buffer via clearTail', () => {
    const clearTail = vi.fn();
    h.stream = makeStream({ connected: true, tailEntries: [], clearTail });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(clearTail).toHaveBeenCalledTimes(1);
  });
});
