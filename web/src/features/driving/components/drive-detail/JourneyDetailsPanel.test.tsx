/**
 * JourneyDetailsPanel — the drive-detail "Journey Details" card.
 *
 * The panel is a prop-driven presentational card with two exports: the pure
 * `formatCoordinates` helper and the `JourneyDetailsPanel` component. It renders
 * two endpoint columns (Start / Destination), each composed of a labelled
 * header row, an address-or-coordinates line, a timestamp line and a battery
 * line. This suite pins the branches + the hardening fixes rather than smoke
 * rendering, and never touches the network (the record vehicle lookup is mocked):
 *
 *   1. formatCoordinates — N/E vs S/W hemispheres; the absolute-value fix (a
 *      southern/western pair must read "37.77°S", never "-37.77°S"); the
 *      exact-zero fix (0° is the equator / prime meridian, NOT "no data"); and
 *      the null / non-finite guards.
 *   2. Chrome — the i18n heading, both endpoint labels, and the three decorative
 *      icons all carrying aria-hidden so only the text labels are announced.
 *   3. Start endpoint — address preferred over coordinates; coordinate fallback;
 *      the 0°-coordinate regression; the "No address data" placeholder; the
 *      start timestamp formatted in the record vehicle zone; and the battery %
 *      (including the "?" null-safety fallback).
 *   4. Destination (ended) — address + end timestamp; the "No address data" vs
 *      "In progress" distinction for an ended-but-address-less drive; battery %.
 *   5. In-progress drive — both destination slots read "In progress"; NO end
 *      timestamp is emitted; and a live position still
 *      surfaces coordinates while the timestamp slot stays "In progress".
 *
 * Per the repo convention (see DriveDetailHeader.test.tsx / ElevationChart.test.tsx):
 * react-i18next is stubbed to echo the English fallback so asserted copy is
 * decoupled from the locale bundle and <FadeIn> is flattened. Saved settings
 * and the record vehicle are controlled; the real date formatters, GlassPanel
 * and pure fmtNumber/isFiniteNumber modules render for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { DriveDetail } from '@/types/driving';
import { formatDateTime } from '@/lib/dateFormat';

const timeState = vi.hoisted(() => ({
  timezone: 'America/New_York' as string | undefined,
  userTimezone: 'Asia/Tokyo',
  mode: 'vehicle' as 'vehicle' | 'user' | 'utc',
  locale: 'de-DE',
  vehicleId: '',
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicle: (id: string) => {
    timeState.vehicleId = id;
    return { data: { timezone: timeState.timezone } };
  },
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      locale: timeState.locale,
      timezone_user: timeState.userTimezone,
      tz_display_default: timeState.mode,
      decimal_precision: 2,
    },
    locale: timeState.locale,
    decimals: 2,
  }),
}));

beforeEach(() => {
  timeState.timezone = 'America/New_York';
  timeState.mode = 'vehicle';
});

// Echo the English fallback (2nd arg) so assertions read real copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Flatten the entry animation — framer-motion / matchMedia are irrelevant here.
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

import { JourneyDetailsPanel, formatCoordinates } from './JourneyDetailsPanel';

// ── Fixtures ────────────────────────────────────────────────────────────────

const START_TS = '2026-07-04T18:30:00.000Z';
const END_TS = '2026-07-04T19:15:00.000Z';

function makeDrive(overrides: Partial<DriveDetail> = {}): DriveDetail {
  return {
    id: 42,
    vehicleId: 7,
    startTs: START_TS,
    endTs: END_TS,
    durationS: 2700,
    distanceM: 42000,
    startAddress: '1 Main St, San Francisco',
    endAddress: '500 Center Rd, Palo Alto',
    startLat: 37.7749,
    startLon: -122.4194,
    endLat: 37.4419,
    endLon: -122.143,
    startBatteryPct: 90,
    endBatteryPct: 72,
    energyUsedWh: 9800,
    regenEnergyWh: 1200,
    avgSpeedMps: 15.5,
    maxSpeedMps: 33.3,
    avgPowerW: 14000,
    outsideTempAvgC: 21,
    insideTempAvgC: 22,
    score: 88,
    endedStatus: 'parked',
    createdAt: START_TS,
    updatedAt: END_TS,
    positions: [],
    telemetry: [],
    ...overrides,
  };
}

function renderPanel(overrides: Partial<DriveDetail> = {}) {
  return render(<JourneyDetailsPanel drive={makeDrive(overrides)} />);
}

// Anchor on the section labels to isolate each column so start/destination
// assertions can never bleed into each other. getByText matches the label row
// (its only direct text is the label); its parent is the endpoint column.
const startColumn = () => screen.getAllByRole('cell')[0];
const destColumn = () => screen.getAllByRole('cell')[1];

// ── 1. formatCoordinates (pure) ──────────────────────────────────────────────

describe('formatCoordinates', () => {
  it('formats a northern/eastern pair with N and E hemispheres', () => {
    expect(formatCoordinates(37.77, 122.41)).toBe('37.77°N, 122.41°E');
  });

  it('uses the absolute value for a southern/western pair (no contradictory "-" sign)', () => {
    // Regression: the old inline JSX kept the raw (negative) latitude while
    // suffixing "S", rendering "-37.77°S"; longitude was already abs'd.
    expect(formatCoordinates(-37.77, -122.41)).toBe('37.77°S, 122.41°W');
  });

  it('renders a legitimate 0° coordinate (equator / prime meridian) rather than dropping it', () => {
    // Regression: the old `lat && lon` truthy test discarded exact-zero
    // coordinates as "no data".
    expect(formatCoordinates(0, 0)).toBe('0.00°N, 0.00°E');
  });

  it('returns null when either component is missing', () => {
    expect(formatCoordinates(null, 10)).toBeNull();
    expect(formatCoordinates(10, null)).toBeNull();
    expect(formatCoordinates(undefined, undefined)).toBeNull();
  });

  it('returns null for non-finite inputs (NaN / Infinity)', () => {
    expect(formatCoordinates(Number.NaN, 5)).toBeNull();
    expect(formatCoordinates(5, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

// ── 2. Panel chrome + a11y ───────────────────────────────────────────────────

describe('JourneyDetailsPanel — chrome', () => {
  it('frames the card with the i18n heading and both endpoint labels', () => {
    renderPanel();

    expect(screen.getByRole('heading', { name: /Journey Details/i })).toBeInTheDocument();
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('Destination')).toBeInTheDocument();
  });

  it('marks all three decorative icons aria-hidden so only the text labels are announced', () => {
    const { container } = renderPanel();

    // Navigation (heading) + MapPin (start) + Flag (destination).
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(3);
  });
});

// ── 3. Start endpoint ────────────────────────────────────────────────────────

describe('JourneyDetailsPanel — start endpoint', () => {
  it('prefers the reverse-geocoded start address over coordinates', () => {
    renderPanel({ startAddress: '1 Main St, San Francisco' });

    const col = startColumn();
    expect(within(col).getByText('1 Main St, San Francisco')).toBeInTheDocument();
    // The address wins, so no coordinate fallback span is rendered.
    expect(col.querySelector('.font-mono')).toHaveTextContent('37.77°N, 122.42°W');
  });

  it('falls back to formatted coordinates when the start address is missing', () => {
    renderPanel({ startAddress: null, startLat: -37.77, startLon: -122.41 });

    const mono = startColumn().querySelector('.font-mono');
    expect(mono).not.toBeNull();
    expect(mono?.textContent).toBe('37.77°S, 122.41°W');
  });

  it('renders exact-zero start coordinates instead of the empty label (0°-drop regression)', () => {
    renderPanel({ startAddress: null, startLat: 0, startLon: 0 });

    const col = startColumn();
    expect(within(col).queryByText('No address data')).toBeNull();
    expect(col.querySelector('.font-mono')?.textContent).toBe('0.00°N, 0.00°E');
  });

  it('shows the "No address data" placeholder when neither address nor coordinates exist', () => {
    renderPanel({ startAddress: null, startLat: null, startLon: null });

    expect(within(startColumn()).getByText('No address data')).toBeInTheDocument();
  });

  it('formats the start timestamp in the loaded drive vehicle timezone', () => {
    renderPanel();

    expect(startColumn()).toHaveTextContent(formatDateTime(START_TS, { locale: 'de-DE', tz: 'America/New_York' }));
    expect(timeState.vehicleId).toBe('7');
  });

  it('renders the start battery percentage', () => {
    renderPanel({ startBatteryPct: 90 });

    expect(within(startColumn()).getByText(/Battery/)).toHaveTextContent('Battery: 90.00%');
  });

  it('falls back to "?" for an unknown start battery level', () => {
    renderPanel({ startBatteryPct: null });

    expect(within(startColumn()).getByText(/Battery/)).toHaveTextContent('Battery: —');
  });
});

// ── 4. Destination endpoint (ended drive) ────────────────────────────────────

describe('JourneyDetailsPanel — destination endpoint (ended drive)', () => {
  it('shows the destination address and the end timestamp for a completed drive', () => {
    renderPanel({ endAddress: '500 Center Rd, Palo Alto', endTs: END_TS });

    const col = destColumn();
    expect(within(col).getByText('500 Center Rd, Palo Alto')).toBeInTheDocument();
    expect(col).toHaveTextContent(formatDateTime(END_TS, { locale: 'de-DE', tz: 'America/New_York' }));
  });

  it('renders "No address data" (not "In progress") when an ended drive lacks an address and coordinates', () => {
    renderPanel({ endAddress: null, endLat: null, endLon: null, endTs: END_TS });

    const col = destColumn();
    expect(within(col).getByText('No address data')).toBeInTheDocument();
    expect(within(col).queryByText('In progress')).toBeNull();
  });

  it('renders the end battery percentage', () => {
    renderPanel({ endBatteryPct: 72 });

    expect(within(destColumn()).getByText(/Battery/)).toHaveTextContent('Battery: 72.00%');
  });

  it('renders start and destination independently', () => {
    renderPanel({
      startAddress: '19720 Bothell Everett Highway, Bothell',
      endAddress: '1 Microsoft Way, Redmond',
      endTs: END_TS,
    });

    expect(within(startColumn()).getByText('19720 Bothell Everett Highway, Bothell')).toBeInTheDocument();
    expect(within(destColumn()).getByText('1 Microsoft Way, Redmond')).toBeInTheDocument();
    expect(within(destColumn()).queryByText('19720 Bothell Everett Highway, Bothell')).toBeNull();
  });

  it('shows end coordinates, never the start address, when the end address is unavailable', () => {
    renderPanel({
      startAddress: '19720 Bothell Everett Highway, Bothell',
      endAddress: null,
      endLat: 47.674,
      endLon: -122.1215,
      endTs: END_TS,
    });

    const col = destColumn();
    expect(col.querySelector('.font-mono')?.textContent).toContain('47.67');
    expect(within(col).queryByText('19720 Bothell Everett Highway, Bothell')).toBeNull();
  });
});

// ── 5. In-progress drive ─────────────────────────────────────────────────────

describe('JourneyDetailsPanel — in-progress drive', () => {
  it('labels both destination slots "In progress" when the drive has not ended', () => {
    renderPanel({ endAddress: null, endLat: null, endLon: null, endTs: null });

    // Both the destination line and its timestamp line read "In progress".
    expect(within(destColumn()).getAllByText('In progress')).toHaveLength(2);
  });

  it('emits only the start timestamp for an in-progress drive', () => {
    renderPanel({ endTs: null });

    expect(startColumn()).toHaveTextContent(formatDateTime(START_TS, { locale: 'de-DE', tz: 'America/New_York' }));
    expect(destColumn()).toHaveTextContent('In progress');
  });

  describe('JourneyDetailsPanel — saved timezone and locale', () => {
    it.each(['vehicle', 'user', 'utc'] as const)('respects %s mode across day boundaries', (mode) => {
      timeState.mode = mode;
      const startTs = '2026-01-02T00:30:00Z';
      const endTs = '2026-01-02T05:30:00Z';
      renderPanel({ startTs, endTs });
      const tz = mode === 'vehicle' ? 'America/New_York' : mode === 'user' ? 'Asia/Tokyo' : 'UTC';
      expect(startColumn()).toHaveTextContent(formatDateTime(startTs, { locale: 'de-DE', tz }));
      expect(destColumn()).toHaveTextContent(formatDateTime(endTs, { locale: 'de-DE', tz }));
    });

    it('falls back to the saved user zone before the vehicle timezone is available', () => {
      timeState.timezone = undefined;
      renderPanel();
      expect(startColumn()).toHaveTextContent(formatDateTime(START_TS, { locale: 'de-DE', tz: 'Asia/Tokyo' }));
    });

    it('keeps invalid and missing dates unknown rather than inventing timestamps', () => {
      renderPanel({ startTs: '', endTs: 'invalid' });
      expect(startColumn()).toHaveTextContent('—');
      expect(destColumn()).toHaveTextContent('—');
      expect(destColumn()).not.toHaveTextContent('In progress');
    });
  });

  it('still surfaces destination coordinates from a live position while the timestamp stays "In progress"', () => {
    renderPanel({ endAddress: null, endTs: null, endLat: 40, endLon: -74 });

    const col = destColumn();
    expect(col.querySelector('.font-mono')?.textContent).toBe('40.00°N, 74.00°W');
    // Address slot shows coords, but the timestamp slot is still in progress.
    expect(within(col).getByText('In progress')).toBeInTheDocument();
  });
});
