/**
 * JourneyDetailsPanel — the drive-detail "Journey Details" card.
 *
 * The panel is a prop-driven presentational card with two exports: the pure
 * `formatCoordinates` helper and the `JourneyDetailsPanel` component. It renders
 * two endpoint columns (Start / Destination), each composed of a labelled
 * header row, an address-or-coordinates line, a timestamp line and a battery
 * line. This suite pins the branches + the hardening fixes rather than smoke
 * rendering, and never touches the network (the component has no data source of
 * its own — everything arrives via the `drive` prop):
 *
 *   1. formatCoordinates — N/E vs S/W hemispheres; the absolute-value fix (a
 *      southern/western pair must read "37.77°S", never "-37.77°S"); the
 *      exact-zero fix (0° is the equator / prime meridian, NOT "no data"); and
 *      the null / non-finite guards.
 *   2. Chrome — the i18n heading, both endpoint labels, and the three decorative
 *      icons all carrying aria-hidden so only the text labels are announced.
 *   3. Start endpoint — address preferred over coordinates; coordinate fallback;
 *      the 0°-coordinate regression; the "No address data" placeholder; the
 *      start timestamp threaded into <DateTime in="vehicle">; and the battery %
 *      (including the "?" null-safety fallback).
 *   4. Destination (ended) — address + end timestamp; the "No address data" vs
 *      "In progress" distinction for an ended-but-address-less drive; battery %.
 *   5. In-progress drive — both destination slots read "In progress"; NO end
 *      <DateTime> is emitted (only the start one); and a live position still
 *      surfaces coordinates while the timestamp slot stays "In progress".
 *
 * Per the repo convention (see DriveDetailHeader.test.tsx / ElevationChart.test.tsx):
 * react-i18next is stubbed to echo the English fallback so asserted copy is
 * decoupled from the locale bundle; <FadeIn> is flattened; and <DateTime> is a
 * light double surfacing value + tz-mode so the timestamp composition is
 * observable without the timezone/settings subtree. The real <GlassPanel> and
 * the pure fmtNumber/isFiniteNumber modules render for real.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { DriveDetail } from '@/types/driving';

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

// <DateTime> double: surface value + tz mode so the composition (which timestamp
// renders where, and that an in-progress drive emits NO end timestamp) is
// deterministically assertable without the timezone/settings machinery.
vi.mock('@/components/data-display', () => ({
  DateTime: ({ value, in: tzMode }: { value: string | Date | null | undefined; in?: string }) => (
    <time
      data-testid="dt"
      data-value={typeof value === 'string' ? value : ''}
      data-in={tzMode ?? ''}
    >
      {typeof value === 'string' ? value : ''}
    </time>
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
const startColumn = () => screen.getByText('Start').parentElement as HTMLElement;
const destColumn = () => screen.getByText('Destination').parentElement as HTMLElement;

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
    expect(col.querySelector('.font-mono')).toBeNull();
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

  it('threads the start timestamp into <DateTime> in the vehicle timezone', () => {
    renderPanel();

    const dt = within(startColumn()).getByTestId('dt');
    expect(dt).toHaveAttribute('data-value', START_TS);
    expect(dt).toHaveAttribute('data-in', 'vehicle');
  });

  it('renders the start battery percentage', () => {
    renderPanel({ startBatteryPct: 90 });

    expect(within(startColumn()).getByText(/Battery/)).toHaveTextContent('Battery: 90%');
  });

  it('falls back to "?" for an unknown start battery level', () => {
    renderPanel({ startBatteryPct: null });

    expect(within(startColumn()).getByText(/Battery/)).toHaveTextContent('Battery: ?%');
  });
});

// ── 4. Destination endpoint (ended drive) ────────────────────────────────────

describe('JourneyDetailsPanel — destination endpoint (ended drive)', () => {
  it('shows the destination address and the end timestamp for a completed drive', () => {
    renderPanel({ endAddress: '500 Center Rd, Palo Alto', endTs: END_TS });

    const col = destColumn();
    expect(within(col).getByText('500 Center Rd, Palo Alto')).toBeInTheDocument();
    expect(within(col).getByTestId('dt')).toHaveAttribute('data-value', END_TS);
  });

  it('renders "No address data" (not "In progress") when an ended drive lacks an address and coordinates', () => {
    renderPanel({ endAddress: null, endLat: null, endLon: null, endTs: END_TS });

    const col = destColumn();
    expect(within(col).getByText('No address data')).toBeInTheDocument();
    expect(within(col).queryByText('In progress')).toBeNull();
  });

  it('renders the end battery percentage', () => {
    renderPanel({ endBatteryPct: 72 });

    expect(within(destColumn()).getByText(/Battery/)).toHaveTextContent('Battery: 72%');
  });
});

// ── 5. In-progress drive ─────────────────────────────────────────────────────

describe('JourneyDetailsPanel — in-progress drive', () => {
  it('labels both destination slots "In progress" when the drive has not ended', () => {
    renderPanel({ endAddress: null, endLat: null, endLon: null, endTs: null });

    // Both the destination line and its timestamp line read "In progress".
    expect(within(destColumn()).getAllByText('In progress')).toHaveLength(2);
  });

  it('emits only the start timestamp (no end <DateTime>) for an in-progress drive', () => {
    renderPanel({ endTs: null });

    expect(screen.getAllByTestId('dt')).toHaveLength(1);
    expect(within(destColumn()).queryByTestId('dt')).toBeNull();
  });

  it('still surfaces destination coordinates from a live position while the timestamp stays "In progress"', () => {
    renderPanel({ endAddress: null, endTs: null, endLat: 40, endLon: -74 });

    const col = destColumn();
    expect(col.querySelector('.font-mono')?.textContent).toBe('40.00°N, 74.00°W');
    // Address slot shows coords, but the timestamp slot is still in progress.
    expect(within(col).getByText('In progress')).toBeInTheDocument();
  });
});
