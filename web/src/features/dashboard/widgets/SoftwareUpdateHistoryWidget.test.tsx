/**
 * SoftwareUpdateHistoryWidget — comprehensive unit + integration coverage.
 *
 * Exercises every export of SoftwareUpdateHistoryWidget.tsx:
 *   - `updateStatusMeta` — the pure status → visual/label resolver (every known
 *     status, the case-insensitive/whitespace path, and the unknown/empty/null
 *     fallback), and
 *   - `updateTimestamp` — the pure recency-key resolver (installedAt →
 *     scheduledAt → createdAt precedence + the epoch fallback), and
 *   - the default widget across every render branch: the compact tile
 *     (installed / non-installed / empty), the medium feed (multi-row + the
 *     "Current" marker + per-status labels), the newest-first ordering fix,
 *     the loading / error / empty-feed states, vehicle selection, and the
 *     manual-refresh interaction.
 *
 * Strategy (mirrors the repo convention, e.g. ChargeStatusLiveWidget.test.tsx):
 *   - The two data hooks (`useVehicles`, `useSoftwareUpdates`) are replaced with
 *     hoisted `vi.fn()` doubles so the network is never touched and every render
 *     is deterministic.
 *   - `react-i18next` is stubbed to resolve the developer fallback (2nd arg) and
 *     interpolate `{{vars}}` from the 3rd options arg, so assertions read the
 *     real English copy (and the transitive <DataFreshness> header resolves).
 *   - The global test-setup already mocks `useSettings` (km / °C) and
 *     `useTimezone` (UTC), which the transitive <DataFreshness> / <WidgetEventFeed>
 *     date formatters depend on.
 *
 * `@testing-library/user-event` is intentionally NOT a dependency of this
 * codebase — interactions use `fireEvent`, consistent with the other slice
 * tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

// jsdom lacks matchMedia; <DataFreshness>'s useMotionPreference touches it on
// first paint. Install a no-op reporting no reduced-motion before any import.
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

// react-i18next passthrough — resolve the fallback (2nd arg) and interpolate
// `{{vars}}` from the options object so assertions read production copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, opts?: Record<string, unknown>) => {
      let out = typeof fallback === 'string' ? fallback : key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
  }),
}));

// Hoisted hook doubles — the network boundary. Never hit real endpoints.
const { vehiclesMock, softwareUpdatesMock } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  softwareUpdatesMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vehiclesMock }));
vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useSoftwareUpdates: softwareUpdatesMock,
}));

import SoftwareUpdateHistoryWidget, {
  updateStatusMeta,
  updateTimestamp,
} from './SoftwareUpdateHistoryWidget';
import type { SoftwareUpdate } from '@/types/vehicle-systems';
import type { WidgetSize } from './types';

// ── Fixtures ───────────────────────────────────────────────────────────────
const SIZE_COMPACT: WidgetSize = { cols: 1, rows: 1 };
const SIZE_MEDIUM: WidgetSize = { cols: 2, rows: 3 };

function makeUpdate(overrides: Partial<SoftwareUpdate> = {}): SoftwareUpdate {
  return {
    id: '1',
    vehicleId: '42',
    version: '2024.44.25',
    status: 'installed',
    installedAt: '2024-11-01T10:00:00.000Z',
    scheduledAt: null,
    createdAt: '2024-11-01T09:00:00.000Z',
    ...overrides,
  };
}

interface QueryOverrides {
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function makeQuery(data?: SoftwareUpdate[], over: QueryOverrides = {}) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: data ? Date.now() : 0,
    refetch: vi.fn(),
    ...over,
  };
}

function renderWidget(node: ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  vehiclesMock.mockReset();
  softwareUpdatesMock.mockReset();
  // Sensible defaults: one vehicle, a single installed update.
  vehiclesMock.mockReturnValue({ data: [{ id: 42 }] });
  softwareUpdatesMock.mockReturnValue(makeQuery([makeUpdate()]));
});

// ── updateStatusMeta (pure) ──────────────────────────────────────────────────
describe('updateStatusMeta', () => {
  it('maps every known status to its variant, colour, severity and label', () => {
    expect(updateStatusMeta('installed')).toEqual({
      labelKey: 'widget.updateStatusInstalled',
      labelDefault: 'Installed',
      variant: 'success',
      color: '#22c55e',
      severity: 'info',
    });
    // installing is the only warning-severity status (an in-flight install).
    expect(updateStatusMeta('installing').variant).toBe('warning');
    expect(updateStatusMeta('installing').severity).toBe('warning');
    // downloading stays info-variant (matches the legacy compact badge mapping).
    expect(updateStatusMeta('downloading').variant).toBe('info');
    expect(updateStatusMeta('available').labelDefault).toBe('Available');
    expect(updateStatusMeta('scheduled').color).toBe('#a78bfa');
  });

  it('resolves case-insensitively and tolerates surrounding whitespace', () => {
    expect(updateStatusMeta('  INSTALLED ').labelDefault).toBe('Installed');
    expect(updateStatusMeta('Downloading').variant).toBe('info');
  });

  it('falls back to a neutral visual that echoes the raw text for unknown statuses', () => {
    const meta = updateStatusMeta('rolling_back');
    expect(meta.labelKey).toBe(''); // no i18n key → render the raw text
    expect(meta.labelDefault).toBe('rolling_back');
    expect(meta.variant).toBe('info');
  });

  it('returns an em-dash label for null, undefined or empty input (never blank)', () => {
    expect(updateStatusMeta(null).labelDefault).toBe('—');
    expect(updateStatusMeta(undefined).labelDefault).toBe('—');
    expect(updateStatusMeta('   ').labelDefault).toBe('—');
  });
});

// ── updateTimestamp (pure) ───────────────────────────────────────────────────
describe('updateTimestamp', () => {
  it('prefers installedAt, then scheduledAt, then createdAt', () => {
    expect(
      updateTimestamp({ installedAt: 'i', scheduledAt: 's', createdAt: 'c' }),
    ).toBe('i');
    expect(
      updateTimestamp({ installedAt: null, scheduledAt: 's', createdAt: 'c' }),
    ).toBe('s');
    expect(
      updateTimestamp({ installedAt: null, scheduledAt: null, createdAt: 'c' }),
    ).toBe('c');
  });

  it('falls back to the epoch when every timestamp is missing', () => {
    const ts = updateTimestamp({
      installedAt: null,
      scheduledAt: null,
      createdAt: undefined as unknown as string,
    });
    expect(ts).toBe(new Date(0).toISOString());
  });
});

// ── Widget render states ─────────────────────────────────────────────────────
describe('SoftwareUpdateHistoryWidget', () => {
  it('renders the compact tile for an installed latest as the "Current" build', () => {
    renderWidget(<SoftwareUpdateHistoryWidget size={SIZE_COMPACT} />);

    // Title chrome + version + the "Current" badge (installed → Current).
    expect(screen.getByText('Update History')).toBeInTheDocument();
    expect(screen.getByText('2024.44.25')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('shows a proper capitalised status label in the compact badge (not raw lowercase)', () => {
    // Regression guard: a non-installed status used to route through one generic
    // key and render the raw lowercase status ("downloading"). It must now read
    // the translated "Downloading" and must NOT be marked "Current".
    softwareUpdatesMock.mockReturnValue(
      makeQuery([makeUpdate({ status: 'downloading', version: '2024.45.1' })]),
    );

    renderWidget(<SoftwareUpdateHistoryWidget size={SIZE_COMPACT} />);

    expect(screen.getByText('2024.45.1')).toBeInTheDocument();
    expect(screen.getByText('Downloading')).toBeInTheDocument();
    expect(screen.queryByText('downloading')).not.toBeInTheDocument();
    expect(screen.queryByText('Current')).not.toBeInTheDocument();
  });

  it('renders the compact empty state when there is no update history', () => {
    softwareUpdatesMock.mockReturnValue(makeQuery([]));

    renderWidget(<SoftwareUpdateHistoryWidget size={SIZE_COMPACT} />);

    expect(screen.getByText('No update history')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('2024.44.25')).not.toBeInTheDocument();
  });

  it('renders the medium feed with a row per update and per-status labels', () => {
    softwareUpdatesMock.mockReturnValue(
      makeQuery([
        makeUpdate({ id: 'a', version: '2024.44.25', status: 'installed', installedAt: '2024-11-01T10:00:00.000Z' }),
        makeUpdate({ id: 'b', version: '2024.40.9', status: 'downloading', installedAt: null, scheduledAt: null, createdAt: '2024-10-01T10:00:00.000Z' }),
        makeUpdate({ id: 'c', version: '2024.38.6', status: 'available', installedAt: null, scheduledAt: null, createdAt: '2024-09-01T10:00:00.000Z' }),
      ]),
    );

    renderWidget(<SoftwareUpdateHistoryWidget size={SIZE_MEDIUM} />);

    // Every version renders as a feed row title.
    expect(screen.getByText('2024.44.25')).toBeInTheDocument();
    expect(screen.getByText('2024.40.9')).toBeInTheDocument();
    expect(screen.getByText('2024.38.6')).toBeInTheDocument();
    // The newest installed row is the "Current" one; the others show labels.
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Downloading')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
  });

  it('orders newest-first and marks the newest installed build "Current" even when the API returns rows out of order', () => {
    // Ascending (oldest-first) input — the pre-sort must flip it so the compact
    // tile and the "Current" marker land on the genuinely newest build.
    const outOfOrder = [
      makeUpdate({ id: 'old', version: '2024.8.9', installedAt: '2024-03-01T00:00:00.000Z' }),
      makeUpdate({ id: 'mid', version: '2024.20.1', installedAt: '2024-06-01T00:00:00.000Z' }),
      makeUpdate({ id: 'new', version: '2024.44.25', installedAt: '2024-11-01T00:00:00.000Z' }),
    ];

    // Compact: shows the newest build only, marked Current.
    softwareUpdatesMock.mockReturnValue(makeQuery(outOfOrder));
    const { unmount } = renderWidget(<SoftwareUpdateHistoryWidget size={SIZE_COMPACT} />);
    expect(screen.getByText('2024.44.25')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.queryByText('2024.8.9')).not.toBeInTheDocument();
    unmount();

    // Medium feed: rows are newest-first and exactly one row is "Current".
    softwareUpdatesMock.mockReturnValue(makeQuery(outOfOrder));
    renderWidget(<SoftwareUpdateHistoryWidget size={SIZE_MEDIUM} />);
    const titles = screen.getAllByText(/^2024\./).map((el) => el.textContent);
    expect(titles).toEqual(['2024.44.25', '2024.20.1', '2024.8.9']);
    expect(screen.getAllByText('Current')).toHaveLength(1);
    expect(screen.getAllByText('Installed')).toHaveLength(2);
  });

  it('falls back to the first vehicle when no vehicleId prop is supplied', () => {
    renderWidget(<SoftwareUpdateHistoryWidget size={SIZE_MEDIUM} />);
    expect(softwareUpdatesMock).toHaveBeenCalledWith('42');
  });

  it('uses the explicit vehicleId prop (stringified) when provided', () => {
    renderWidget(<SoftwareUpdateHistoryWidget vehicleId={7} size={SIZE_MEDIUM} />);
    expect(softwareUpdatesMock).toHaveBeenCalledWith('7');
  });

  it('passes an empty id (disabling the query) and shows empty state when there are no vehicles', () => {
    vehiclesMock.mockReturnValue({ data: [] });
    softwareUpdatesMock.mockReturnValue(makeQuery(undefined));

    renderWidget(<SoftwareUpdateHistoryWidget size={SIZE_MEDIUM} />);

    expect(softwareUpdatesMock).toHaveBeenCalledWith('');
    expect(screen.getByText('No update history')).toBeInTheDocument();
  });

  it('renders a loading skeleton with no body while the first fetch is in flight', () => {
    softwareUpdatesMock.mockReturnValue(makeQuery(undefined, { isLoading: true }));

    const { container } = renderWidget(<SoftwareUpdateHistoryWidget size={SIZE_MEDIUM} />);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Update History')).not.toBeInTheDocument();
    expect(screen.queryByText('2024.44.25')).not.toBeInTheDocument();
  });

  it('keeps the feed on a mid-poll error instead of blanking the panel', () => {
    softwareUpdatesMock.mockReturnValue(
      makeQuery([makeUpdate({ version: '2024.44.25' })], { isError: true }),
    );

    renderWidget(<SoftwareUpdateHistoryWidget size={SIZE_MEDIUM} />);

    // Error is surfaced by the freshness chip; the last-known feed still renders.
    expect(screen.getByText('2024.44.25')).toBeInTheDocument();
  });

  it('shows the feed empty message when the update list is empty at medium size', () => {
    softwareUpdatesMock.mockReturnValue(makeQuery([]));

    renderWidget(<SoftwareUpdateHistoryWidget size={SIZE_MEDIUM} />);

    expect(screen.getByText('No update history')).toBeInTheDocument();
  });

  it('invokes refetch when the freshness/refresh control is activated', () => {
    const refetch = vi.fn();
    softwareUpdatesMock.mockReturnValue(
      makeQuery([makeUpdate()], { refetch, isFetching: false, dataUpdatedAt: Date.now() }),
    );

    renderWidget(<SoftwareUpdateHistoryWidget size={SIZE_MEDIUM} />);

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshBtn);

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
