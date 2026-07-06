/**
 * VehicleUpgradesWidget — comprehensive unit + integration coverage.
 *
 * Exercises every export of VehicleUpgradesWidget.tsx:
 *   - `parseUpgrades` — the pure envelope→ParsedUpgrade[] resolver (the
 *     `upgrades` array shape with name/title, price/cost, description/summary
 *     fallbacks + the `eligible !== false` default; the non-object filter; the
 *     top-level-key fallback shape; and the null/empty guard), and
 *   - `daysUntil` — the pure expiry-recency helper (null/invalid guards, the
 *     `Math.ceil` future rounding, and the negative past value), and
 *   - the default widget across every render branch: the compact tile
 *     (eligible-count / up-to-date), the standard feed (upgrade rows with
 *     price + eligibility badges, the "all applied" empty state), the wide
 *     branch (the extra eligibility caption), the share-links section (active
 *     count + nearest-expiry, the expired-filter, the empty state), vehicle
 *     selection + share-link wiring, the loading / mid-poll-error states, and
 *     the manual-refresh interaction.
 *
 * Strategy mirrors the repo convention (e.g. SoftwareUpdateHistoryWidget.test.tsx):
 *   - The data hooks (`useVehicles`, `useVehicleUpgrades`, `useShareLinks`,
 *     `useDrives`) are replaced with hoisted `vi.fn()` doubles so the network is
 *     never touched and every render is deterministic.
 *   - `react-i18next` is stubbed to resolve the developer fallback (2nd arg) and
 *     interpolate `{{vars}}`, so assertions read the real English copy (and the
 *     transitive <DataFreshness> header resolves).
 *   - `useDateFormat` is stubbed with an echoing `formatDate` so the
 *     nearest-expiry assertion verifies the widget selects the *soonest* link,
 *     decoupled from the platform date-format details.
 *
 * `@testing-library/user-event` is intentionally NOT a dependency of this
 * codebase — interactions use `fireEvent`, consistent with the other widget
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

// Deterministic, echoing date formatters. `formatDate` prefixes its input so a
// rendered "Nearest expiry" chip asserts the exact link the widget picked.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    opts: { locale: 'en-US', tz: 'UTC' },
    tz: 'UTC',
    locale: 'en-US',
    formatDate: (v: unknown) => (v ? `D:${String(v)}` : '—'),
    formatDateTime: (v: unknown) => (v ? `DT:${String(v)}` : '—'),
    formatTime: (v: unknown) => (v ? `T:${String(v)}` : '—'),
    formatDateShort: (v: unknown) => (v ? `DS:${String(v)}` : '—'),
    formatDateWithDay: (v: unknown) => (v ? `DD:${String(v)}` : '—'),
    formatRelative: (v: unknown) => (v ? `R:${String(v)}` : '—'),
    formatRelativeTime: (v: unknown) => (v ? `RT:${String(v)}` : '—'),
    formatRelativeDays: (v: unknown) => (v ? `RD:${String(v)}` : '—'),
  }),
}));

// Hoisted hook doubles — the network boundary. Never hit real endpoints.
const { vehiclesMock, upgradesMock, shareLinksMock, drivesMock } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  upgradesMock: vi.fn(),
  shareLinksMock: vi.fn(),
  drivesMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vehiclesMock,
  useVehicleUpgrades: upgradesMock,
}));
vi.mock('@/api/hooks/useSharing', () => ({ useShareLinks: shareLinksMock }));
vi.mock('@/api/hooks/useDriving', () => ({ useDrives: drivesMock }));

import VehicleUpgradesWidget, {
  parseUpgrades,
  daysUntil,
} from './VehicleUpgradesWidget';
import type { ShareToken } from '@/types/sharing';
import type { WidgetSize } from './types';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const SIZE_COMPACT: WidgetSize = { cols: 1, rows: 2 };
const SIZE_STD: WidgetSize = { cols: 2, rows: 3 };
const SIZE_WIDE: WidgetSize = { cols: 3, rows: 3 };

const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY_MS).toISOString();

/** An `{ upgrades: [...] }` envelope body with two representative rows. */
const UPGRADES_TWO = {
  upgrades: [
    {
      name: 'Full Self-Driving',
      price: '99',
      description: 'Autopilot suite',
      eligible: true,
    },
    {
      title: 'Acceleration Boost',
      cost: '2000',
      summary: 'Faster 0-60',
      eligible: false,
    },
  ],
};

function makeShare(over: Partial<ShareToken> = {}): ShareToken {
  return {
    id: 1,
    token: 'tok',
    drive_id: 55,
    created_by: null,
    title: null,
    description: null,
    include_map: true,
    include_telemetry: true,
    include_speed: true,
    views: 0,
    expires_at: null,
    created_at: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

interface UpgradeQueryOverrides {
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

/** Wraps a raw upgrades record in the query-result the widget consumes. */
function upgradesResult(
  record: Record<string, unknown> | undefined,
  over: UpgradeQueryOverrides = {},
) {
  const envelope =
    record === undefined ? undefined : { data: record, fetched_at: '2025-01-01T00:00:00.000Z' };
  return {
    data: envelope,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: envelope ? Date.now() : 0,
    refetch: vi.fn(),
    ...over,
  };
}

function renderWidget(node: ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  vehiclesMock.mockReset();
  upgradesMock.mockReset();
  shareLinksMock.mockReset();
  drivesMock.mockReset();
  // Sensible defaults: one vehicle, two upgrades, one drive, no share links.
  vehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  upgradesMock.mockReturnValue(upgradesResult(UPGRADES_TWO));
  drivesMock.mockReturnValue({ data: [{ id: 55 }] });
  shareLinksMock.mockReturnValue({ data: [] });
});

// ── parseUpgrades (pure) ──────────────────────────────────────────────────────
describe('parseUpgrades', () => {
  it('returns an empty array for null, undefined or an empty envelope', () => {
    expect(parseUpgrades(null)).toEqual([]);
    expect(parseUpgrades(undefined)).toEqual([]);
    expect(parseUpgrades({})).toEqual([]);
  });

  it('parses an `upgrades` array with name/price/description + the eligible default', () => {
    const result = parseUpgrades(UPGRADES_TWO);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: 'Full Self-Driving',
      price: '99',
      description: 'Autopilot suite',
      eligible: true,
    });
    // Row 2 resolves name←title, price←cost, description←summary.
    expect(result[1]).toEqual({
      name: 'Acceleration Boost',
      price: '2000',
      description: 'Faster 0-60',
      eligible: false,
    });
  });

  it('defaults eligible to true unless the flag is exactly false, and nulls a missing price', () => {
    const [row] = parseUpgrades({ upgrades: [{ name: 'X' }] });
    expect(row.eligible).toBe(true);
    expect(row.price).toBeNull();
    expect(row.description).toBeNull();
    // A truthy-but-not-false eligible value still reads as eligible.
    expect(parseUpgrades({ upgrades: [{ name: 'Y', eligible: 0 }] })[0].eligible).toBe(true);
  });

  it('skips non-object entries in the upgrades array', () => {
    const result = parseUpgrades({ upgrades: [null, 'nope', 7, { name: 'Real' }] });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Real');
  });

  it('falls back to a synthetic "Unknown Upgrade" name when neither name nor title exist', () => {
    const [row] = parseUpgrades({ upgrades: [{ price: '10' }] });
    expect(row.name).toBe('Unknown Upgrade');
    expect(row.price).toBe('10');
  });

  it('treats top-level object keys as individual upgrades when there is no `upgrades` array', () => {
    const result = parseUpgrades({
      premium_connectivity: { price: '9.99', eligible: true },
      count: 5, // scalar → ignored
      note: null, // null → ignored
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('premium_connectivity');
    expect(result[0].price).toBe('9.99');
  });
});

// ── daysUntil (pure) ──────────────────────────────────────────────────────────
describe('daysUntil', () => {
  it('returns null for a null date or an unparseable string', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil('not-a-date')).toBeNull();
  });

  it('rounds a future expiry up with Math.ceil', () => {
    // +12h → 0.5 days → ceil → 1.
    expect(daysUntil(new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString())).toBe(1);
    const tenDays = daysUntil(inDays(10));
    expect(tenDays).toBeGreaterThan(0);
    expect(tenDays).toBeLessThanOrEqual(10);
  });

  it('returns a non-positive number for an expiry in the past', () => {
    expect(daysUntil(inDays(-10))).toBeLessThan(0);
  });
});

// ── Compact tile (cols === 1) ────────────────────────────────────────────────
describe('VehicleUpgradesWidget — compact tile', () => {
  it('shows the eligible-count and the "available" label when upgrades exist', () => {
    renderWidget(<VehicleUpgradesWidget size={SIZE_COMPACT} />);
    // Two upgrades, one eligible → count of 1.
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('available')).toBeInTheDocument();
    // The compact tile never renders the section chrome.
    expect(screen.queryByText('Upgrades & Sharing')).not.toBeInTheDocument();
  });

  it('shows the "Up to date" badge when there are no upgrades', () => {
    upgradesMock.mockReturnValue(upgradesResult({ upgrades: [] }));
    renderWidget(<VehicleUpgradesWidget size={SIZE_COMPACT} />);
    expect(screen.getByText('Up to date')).toBeInTheDocument();
    expect(screen.queryByText('available')).not.toBeInTheDocument();
  });
});

// ── Standard feed (cols === 2) ───────────────────────────────────────────────
describe('VehicleUpgradesWidget — standard feed', () => {
  it('renders the title, each upgrade row with its price + eligibility badge', () => {
    renderWidget(<VehicleUpgradesWidget size={SIZE_STD} />);

    expect(screen.getByText('Upgrades & Sharing')).toBeInTheDocument();
    expect(screen.getByText('Available Upgrades')).toBeInTheDocument();

    expect(screen.getByText('Full Self-Driving')).toBeInTheDocument();
    expect(screen.getByText('$99')).toBeInTheDocument();
    expect(screen.getByText('Autopilot suite')).toBeInTheDocument();
    expect(screen.getByText('Eligible')).toBeInTheDocument();

    expect(screen.getByText('Acceleration Boost')).toBeInTheDocument();
    expect(screen.getByText('$2000')).toBeInTheDocument();
    expect(screen.getByText('Not eligible')).toBeInTheDocument();
  });

  it('renders the "all applied" state when the upgrade list is empty', () => {
    upgradesMock.mockReturnValue(upgradesResult({ upgrades: [] }));
    renderWidget(<VehicleUpgradesWidget size={SIZE_STD} />);

    expect(screen.getByText('All upgrades applied')).toBeInTheDocument();
    expect(screen.queryByText('Full Self-Driving')).not.toBeInTheDocument();
  });

  it('renders duplicate-named upgrades as distinct rows (stable composite keys)', () => {
    upgradesMock.mockReturnValue(
      upgradesResult({
        upgrades: [
          { name: 'Bundle', price: '1', eligible: true },
          { name: 'Bundle', price: '2', eligible: true },
        ],
      }),
    );
    renderWidget(<VehicleUpgradesWidget size={SIZE_STD} />);
    // Both same-named rows survive reconciliation (no key collision).
    expect(screen.getAllByText('Bundle')).toHaveLength(2);
    expect(screen.getByText('$1')).toBeInTheDocument();
    expect(screen.getByText('$2')).toBeInTheDocument();
  });
});

// ── Wide branch (cols >= 3) ──────────────────────────────────────────────────
describe('VehicleUpgradesWidget — wide branch', () => {
  it('adds the per-row eligibility caption in addition to the badge', () => {
    renderWidget(<VehicleUpgradesWidget size={SIZE_WIDE} />);
    // The eligible row shows the label twice (caption + badge); ineligible too.
    expect(screen.getAllByText('Eligible')).toHaveLength(2);
    expect(screen.getAllByText('Not eligible')).toHaveLength(2);
  });
});

// ── Share-links section ──────────────────────────────────────────────────────
describe('VehicleUpgradesWidget — share links', () => {
  it('shows the active-link count and the nearest-expiry date, ignoring expired links', () => {
    const soon = inDays(5);
    const later = inDays(40);
    shareLinksMock.mockReturnValue({
      data: [
        makeShare({ id: 1, token: 'expired', expires_at: inDays(-3) }), // filtered out
        makeShare({ id: 2, token: 'later', expires_at: later }),
        makeShare({ id: 3, token: 'soon', expires_at: soon }),
        makeShare({ id: 4, token: 'forever', expires_at: null }), // active, no expiry
      ],
    });

    renderWidget(<VehicleUpgradesWidget size={SIZE_STD} />);

    expect(screen.getByText('Active links')).toBeInTheDocument();
    // 3 active (later + soon + forever); the expired one is excluded.
    expect(screen.getByText('3')).toBeInTheDocument();
    // Nearest expiry is the soonest future link, echoed by the mocked formatter.
    expect(screen.getByText('Nearest expiry')).toBeInTheDocument();
    expect(screen.getByText(`D:${soon}`)).toBeInTheDocument();
    expect(screen.queryByText(`D:${later}`)).not.toBeInTheDocument();
  });

  it('shows the empty state when every share link has expired', () => {
    shareLinksMock.mockReturnValue({
      data: [makeShare({ expires_at: inDays(-1) })],
    });
    renderWidget(<VehicleUpgradesWidget size={SIZE_STD} />);

    expect(screen.getByText('No active share links')).toBeInTheDocument();
    expect(screen.queryByText('Active links')).not.toBeInTheDocument();
  });

  it('wires useShareLinks to the most recent drive id, and to "" when there are no drives', () => {
    renderWidget(<VehicleUpgradesWidget size={SIZE_STD} />);
    expect(shareLinksMock).toHaveBeenCalledWith('55');

    shareLinksMock.mockClear();
    drivesMock.mockReturnValue({ data: [] });
    renderWidget(<VehicleUpgradesWidget size={SIZE_STD} />);
    expect(shareLinksMock).toHaveBeenCalledWith('');
  });
});

// ── Vehicle selection ────────────────────────────────────────────────────────
describe('VehicleUpgradesWidget — vehicle selection', () => {
  it('falls back to the first vehicle (stringified) when no vehicleId prop is given', () => {
    renderWidget(<VehicleUpgradesWidget size={SIZE_STD} />);
    expect(upgradesMock).toHaveBeenCalledWith('1');
    expect(drivesMock).toHaveBeenCalledWith('1');
  });

  it('uses the explicit vehicleId prop (stringified) when provided', () => {
    renderWidget(<VehicleUpgradesWidget vehicleId={7} size={SIZE_STD} />);
    expect(upgradesMock).toHaveBeenCalledWith('7');
  });

  it('passes undefined (disabling the query) and renders empty UI when there are no vehicles', () => {
    vehiclesMock.mockReturnValue({ data: [] });
    upgradesMock.mockReturnValue(upgradesResult(undefined));
    drivesMock.mockReturnValue({ data: [] });

    renderWidget(<VehicleUpgradesWidget size={SIZE_STD} />);

    expect(upgradesMock).toHaveBeenCalledWith(undefined);
    expect(screen.getByText('All upgrades applied')).toBeInTheDocument();
    expect(screen.getByText('No active share links')).toBeInTheDocument();
  });
});

// ── Loading / error states + refresh interaction ─────────────────────────────
describe('VehicleUpgradesWidget — states + interaction', () => {
  it('renders a loading skeleton with no feed while the first fetch is in flight', () => {
    upgradesMock.mockReturnValue(upgradesResult(undefined, { isLoading: true }));

    const { container } = renderWidget(<VehicleUpgradesWidget size={SIZE_STD} />);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Upgrades & Sharing')).not.toBeInTheDocument();
    expect(screen.queryByText('Full Self-Driving')).not.toBeInTheDocument();
  });

  it('keeps the last-known feed on a mid-poll error instead of blanking the panel', () => {
    upgradesMock.mockReturnValue(upgradesResult(UPGRADES_TWO, { isError: true }));

    renderWidget(<VehicleUpgradesWidget size={SIZE_STD} />);

    // Error is surfaced by the freshness chip; the feed still renders.
    expect(screen.getByText('Full Self-Driving')).toBeInTheDocument();
    expect(screen.getByText('Upgrades & Sharing')).toBeInTheDocument();
  });

  it('invokes refetch when the freshness/refresh control is activated', () => {
    const refetch = vi.fn();
    upgradesMock.mockReturnValue(
      upgradesResult(UPGRADES_TWO, { refetch, dataUpdatedAt: Date.now() }),
    );

    renderWidget(<VehicleUpgradesWidget size={SIZE_STD} />);

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshBtn);

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
