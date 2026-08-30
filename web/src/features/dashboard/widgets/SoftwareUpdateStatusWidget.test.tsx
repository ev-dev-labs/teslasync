/**
 * SoftwareUpdateStatusWidget — behaviour + hardening tests.
 *
 * SoftwareUpdateStatusWidget resolves a target vehicle (`vehicleId` prop →
 * first vehicle → 0), reads the live current firmware version from
 * `useVehicleState`, and reads the pending-update fields (version, download %,
 * install %, expected duration, scheduled start) from `useVehicleConfigLatest`.
 * A `useMemo` derives a six-value `updateStatus` state machine
 * (up-to-date / available / downloading / ready / installing / installed) that
 * drives both the compact 1×1 tile and the richer ≥2-wide layout.
 *
 * The three data hooks are mocked at the `@/api/hooks/useVehicles` boundary so
 * every orchestration branch is deterministic. `react-i18next` is echo-mocked
 * (returns the English fallback, interpolating `{{var}}`) so assertions target
 * rendered copy; `useSettings` / `useTimezone` come from the global stub in
 * src/test-setup.ts. `matchMedia` reports reduced-motion so framer-motion
 * settles synchronously. Network never touches the real backend.
 *
 * Facets covered:
 *   - vehicle resolution: explicit prop wins; else first vehicle; else 0 — and
 *     the config poll is wired to the SAME id with the 60s interval.
 *   - shell states: loading → skeleton (no body, no refresh control); empty →
 *     explicit "No software data" (never blank); undefined data is resilient;
 *     a state fetch error still surfaces through the freshness error dot.
 *   - compact 1×1: current version + status badge, no title, refresh overlay.
 *   - the updateStatus state machine, one branch per test: up-to-date /
 *     available / downloading (+%) / installing (+%) / ready / installed, plus
 *     the install-beats-download precedence when both are mid-flight.
 *   - tall-only rows: expected duration and scheduled start appear at rows≥2
 *     and are hidden at rows=1.
 *   - null-safety: a missing software_version renders "—" (not a blank row).
 *   - the hardening (regression): an in-flight update from the config snapshot
 *     is shown even when live vehicle state is momentarily absent — it must NOT
 *     collapse to the empty state.
 *   - refresh wiring: activating the freshness control invokes the state refetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n echo mock: returns the fallback string (or key when none), interpolating
// {{var}} tokens from the options object so assertions target rendered English.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: unknown, opts?: unknown) => {
      const options = (opts && typeof opts === 'object' ? opts : undefined) as
        | Record<string, unknown>
        | undefined;
      let base = typeof fb === 'string' ? fb : key;
      if (options) {
        base = base.replace(/{{\s*(\w+)\s*}}/g, (_m, n: string) =>
          n in options && options[n] != null ? String(options[n]) : `{{${n}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// All three vehicle hooks are mocked so the widget's orchestration is deterministic.
vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return {
    ...actual,
    useVehicles: vi.fn(),
    useVehicleState: vi.fn(),
    useVehicleConfigLatest: vi.fn(),
  };
});

// jsdom lacks matchMedia; useMotionPreference (via <DataFreshness>) and
// framer-motion both read it. Report reduced-motion so animations settle.
window.matchMedia = ((query: string) => ({
  matches: /prefers-reduced-motion/.test(query),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

import SoftwareUpdateStatusWidget from './SoftwareUpdateStatusWidget';
import {
  useVehicles,
  useVehicleState,
  useVehicleConfigLatest,
} from '@/api/hooks/useVehicles';
import type { WidgetProps, WidgetSize } from './types';

const mockVehicles = vi.mocked(useVehicles);
const mockState = vi.mocked(useVehicleState);
const mockConfig = vi.mocked(useVehicleConfigLatest);

const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const FULL: WidgetSize = { cols: 2, rows: 1 };
const TALL: WidgetSize = { cols: 2, rows: 2 };

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): never {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  } as never;
}

/** `useVehicles()` stub — the widget only reads `.data[i].id`. */
function vehicles(ids: number[]): never {
  return { data: ids.map((id) => ({ id })) } as never;
}

/** `useVehicleState()` stub wrapping the `{ state, live }` envelope. */
function stateResult(
  softwareVersion: string | null | undefined = '2025.20.1',
  over: Record<string, unknown> = {},
): never {
  return qr({ data: { state: { software_version: softwareVersion }, live: true }, ...over });
}

/** `useVehicleState()` stub with no resolved state. */
function noStateResult(over: Record<string, unknown> = {}): never {
  return qr({ data: { state: undefined, live: false }, ...over });
}

/** `useVehicleConfigLatest()` stub — `fields` becomes the snapshot payload. */
function cfg(
  fields: Record<string, unknown> | null = {},
  over: Record<string, unknown> = {},
): never {
  return { data: fields, isLoading: false, ...over } as never;
}

function renderWidget(size: WidgetSize = FULL, props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SoftwareUpdateStatusWidget size={size} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockVehicles.mockReset();
  mockState.mockReset();
  mockConfig.mockReset();
  mockVehicles.mockReturnValue(vehicles([1]));
  mockState.mockReturnValue(stateResult('2025.20.1'));
  mockConfig.mockReturnValue(cfg({})); // no pending update → 'up-to-date'
});

afterEach(() => {
  cleanup();
});

describe('SoftwareUpdateStatusWidget — vehicle resolution', () => {
  it('prefers the explicit vehicleId prop and wires the config poll to the same id', () => {
    mockVehicles.mockReturnValue(vehicles([7, 9]));
    renderWidget(FULL, { vehicleId: 42 });

    expect(mockState).toHaveBeenCalledWith(42);
    expect(mockConfig).toHaveBeenCalledWith(42, 60000);
  });

  it('falls back to the first vehicle when no vehicleId prop is given', () => {
    mockVehicles.mockReturnValue(vehicles([7, 9]));
    renderWidget();

    expect(mockState).toHaveBeenCalledWith(7);
    expect(mockConfig).toHaveBeenCalledWith(7, 60000);
  });

  it('falls back to 0 when there is neither a prop nor any vehicle', () => {
    mockVehicles.mockReturnValue(vehicles([]));
    renderWidget();

    expect(mockState).toHaveBeenCalledWith(0);
  });
});

describe('SoftwareUpdateStatusWidget — shell states', () => {
  it('shows a skeleton (never a blank panel) and no refresh control while loading', () => {
    mockState.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Current Version')).toBeNull();
    expect(screen.queryByText('No software data')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Refresh/i })).toBeNull();
  });

  it('renders an explicit empty state when neither live state nor an update exists', () => {
    mockState.mockReturnValue(noStateResult());
    mockConfig.mockReturnValue(cfg({}));
    renderWidget();

    expect(screen.getByText('No software data')).toBeInTheDocument();
    expect(screen.queryByText('Current Version')).toBeNull();
  });

  it('is resilient when both queries resolve to undefined/null data', () => {
    mockState.mockReturnValue(qr({ data: undefined }));
    mockConfig.mockReturnValue(cfg(null));
    renderWidget();

    expect(screen.getByText('No software data')).toBeInTheDocument();
  });

  it('surfaces a state fetch error through the freshness error dot without blanking', () => {
    mockState.mockReturnValue(
      qr({ isError: true, error: new Error('state down'), data: undefined }),
    );
    mockConfig.mockReturnValue(cfg({}));
    const { container } = renderWidget();

    expect(screen.getByText('No software data')).toBeInTheDocument();
    expect(container.querySelector('.bg-red-400')).not.toBeNull();
  });
});

describe('SoftwareUpdateStatusWidget — compact (1×1)', () => {
  it('renders the current version and status badge with no title, plus a refresh overlay', () => {
    mockState.mockReturnValue(stateResult('2025.20.1'));
    mockConfig.mockReturnValue(cfg({}));
    renderWidget(COMPACT);

    expect(screen.getByText('2025.20.1')).toBeInTheDocument();
    expect(screen.getByText('Up to date')).toBeInTheDocument();
    // Compact tiles have no header title…
    expect(screen.queryByText('Software Update')).toBeNull();
    expect(screen.queryByText('Current Version')).toBeNull();
    // …but still expose the refresh affordance as an icon-only overlay.
    expect(screen.getByRole('button', { name: /^Refresh/i })).toBeInTheDocument();
  });
});

describe('SoftwareUpdateStatusWidget — updateStatus state machine (full)', () => {
  it('up-to-date: no pending version → badge + message, and no update section', () => {
    mockState.mockReturnValue(stateResult('2025.20.1'));
    mockConfig.mockReturnValue(cfg({}));
    const { container } = renderWidget(FULL);

    expect(screen.getByText('Current Version')).toBeInTheDocument();
    expect(screen.getByText('2025.20.1')).toBeInTheDocument();
    // "Up to date" appears twice: the status badge AND the confirmation line.
    expect(screen.getAllByText('Up to date')).toHaveLength(2);
    // No update section / progress copy.
    expect(container.textContent).not.toContain('Downloading');
    expect(container.textContent).not.toContain('Ready to install');
  });

  it('available: a version with no progress → "Available" badge + target version', () => {
    mockConfig.mockReturnValue(cfg({ software_update_version: '2025.26.5' }));
    const { container } = renderWidget(FULL);

    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('2025.26.5')).toBeInTheDocument();
    expect(container.textContent).toContain('Update');
    // No progress bars, no up-to-date confirmation.
    expect(screen.queryByText('%', { exact: false })).toBeNull();
    expect(container.textContent).not.toContain('Ready to install');
  });

  it('downloading: 0<pct<100 → "Downloading" bar with the rounded percent readout', () => {
    mockConfig.mockReturnValue(
      cfg({ software_update_version: '2025.26.5', software_update_download_pct: 45 }),
    );
    renderWidget(FULL);

    // "Downloading" appears twice: the status badge AND the MetricBar label.
    expect(screen.getAllByText('Downloading')).toHaveLength(2);
    expect(screen.getByText('45%')).toBeInTheDocument();
    expect(screen.getByText('2025.26.5')).toBeInTheDocument();
    // The install bar must not be present.
    expect(screen.queryByText('Installing')).toBeNull();
  });

  it('installing: install in flight → "Installing" bar with its percent readout', () => {
    mockConfig.mockReturnValue(
      cfg({
        software_update_version: '2025.26.5',
        software_update_download_pct: 100,
        software_update_install_pct: 60,
      }),
    );
    renderWidget(FULL);

    expect(screen.getAllByText('Installing')).toHaveLength(2);
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.queryByText('Downloading')).toBeNull();
  });

  it('ready: download complete, install not started → "Ready to install" message', () => {
    mockConfig.mockReturnValue(
      cfg({ software_update_version: '2025.26.5', software_update_download_pct: 100 }),
    );
    const { container } = renderWidget(FULL);

    expect(screen.getByText('Ready')).toBeInTheDocument(); // badge
    expect(screen.getByText('Ready to install')).toBeInTheDocument(); // message line
    // No percent readouts in the ready state.
    expect(container.textContent).not.toContain('%');
  });

  it('installed: both percentages at 100 → "Installed" badge, no progress bar', () => {
    mockConfig.mockReturnValue(
      cfg({
        software_update_version: '2025.26.5',
        software_update_download_pct: 100,
        software_update_install_pct: 100,
      }),
    );
    const { container } = renderWidget(FULL);

    expect(screen.getByText('Installed')).toBeInTheDocument();
    expect(screen.getByText('2025.26.5')).toBeInTheDocument();
    expect(container.textContent).not.toContain('Ready to install');
  });

  it('install-in-flight beats download-in-flight (memo precedence)', () => {
    mockConfig.mockReturnValue(
      cfg({
        software_update_version: '2025.26.5',
        software_update_download_pct: 50,
        software_update_install_pct: 30,
      }),
    );
    renderWidget(FULL);

    expect(screen.getAllByText('Installing')).toHaveLength(2);
    expect(screen.getByText('30%')).toBeInTheDocument();
    // The download percentage must not leak through.
    expect(screen.queryByText('50%')).toBeNull();
    expect(screen.queryByText('Downloading')).toBeNull();
  });
});

describe('SoftwareUpdateStatusWidget — tall-only detail rows', () => {
  it('shows expected duration and scheduled start only when rows ≥ 2', () => {
    const config = {
      software_update_version: '2025.26.5',
      software_update_download_pct: 45,
      software_update_expected_duration: 30,
      software_update_scheduled_start: '2025-07-01T03:00:00Z',
    };
    mockConfig.mockReturnValue(cfg(config));
    const { container } = renderWidget(TALL);

    expect(container.textContent).toContain('Est. time');
    expect(container.textContent).toContain('~30');
    expect(container.textContent).toContain('min');
    expect(container.textContent).toContain('Scheduled');
    expect(container.textContent).toContain('2025-07-01T03:00:00Z');
  });

  it('hides expected duration and scheduled start at rows = 1', () => {
    const config = {
      software_update_version: '2025.26.5',
      software_update_download_pct: 45,
      software_update_expected_duration: 30,
      software_update_scheduled_start: '2025-07-01T03:00:00Z',
    };
    mockConfig.mockReturnValue(cfg(config));
    const { container } = renderWidget(FULL);

    expect(container.textContent).not.toContain('Est. time');
    expect(container.textContent).not.toContain('Scheduled');
    // The download bar itself still renders regardless of height.
    expect(screen.getByText('45%')).toBeInTheDocument();
  });
});

describe('SoftwareUpdateStatusWidget — null-safety & hardening', () => {
  it('renders "—" for the current version when software_version is missing', () => {
    // A resolved state object with no software_version (bypasses the helper
    // default, which would otherwise swallow an explicit `undefined`).
    mockState.mockReturnValue(qr({ data: { state: {}, live: true } }));
    mockConfig.mockReturnValue(cfg({}));
    renderWidget(FULL);

    expect(screen.getByText('Current Version')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows an in-flight update from config even when live vehicle state is absent', () => {
    // Regression: the body must gate on state OR a pending update, so a live
    // gap never hides an update the config poll already reported.
    mockState.mockReturnValue(noStateResult());
    mockConfig.mockReturnValue(
      cfg({ software_update_version: '2025.30.1', software_update_download_pct: 45 }),
    );
    renderWidget(FULL);

    expect(screen.queryByText('No software data')).toBeNull();
    expect(screen.getByText('2025.30.1')).toBeInTheDocument();
    expect(screen.getByText('45%')).toBeInTheDocument();
    // Current version degrades gracefully rather than crashing.
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('SoftwareUpdateStatusWidget — refresh wiring', () => {
  it('invokes the state refetch when the freshness control is activated', () => {
    const refetch = vi.fn();
    mockState.mockReturnValue(stateResult('2025.20.1', { refetch }));
    mockConfig.mockReturnValue(cfg({}));
    renderWidget(FULL);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
