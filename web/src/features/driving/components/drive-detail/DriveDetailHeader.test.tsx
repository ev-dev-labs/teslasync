/**
 * DriveDetailHeader — the drive-detail page's top bar.
 *
 * DriveDetailHeader is a prop-driven presentational header that composes four
 * responsibilities into one row: a back affordance, the route title, the
 * vehicle + timestamp meta line, and the Replay / Share actions. This suite
 * pins the behaviours that would silently regress and that the hardening pass
 * fixed — never a smoke render, never real network:
 *
 *   1. Title — the "start → end" heading renders only when BOTH addresses are
 *      present; any missing address (null, or only one side) falls back to the
 *      i18n "Drive Details" title (the `startAddress && endAddress` branch).
 *   2. Back link a11y — the icon-only back link exposes an accessible name via
 *      aria-label (the surfaced bug: it previously had none) and points at
 *      /drives, with its arrow glyph marked decorative (aria-hidden).
 *   3. Replay navigation — the Replay link targets /drives/{id}/replay so the
 *      driveId prop is threaded into the route.
 *   4. Share — clicking Share invokes the onShare callback exactly once (and
 *      not before the click).
 *   5. Meta line — the vehicle name plus the start date + start time render,
 *      and the end time is appended ONLY when the drive has ended (endTs set);
 *      each timestamp is handed to <DateTime> with the correct variant/showTz.
 *   6. Null-safety hardening — an empty / whitespace-only vehicle name falls
 *      back to the i18n "Vehicle" label instead of a dangling "· …" separator.
 *
 * Per the repo convention (see SessionListSection.test.tsx): react-i18next is
 * stubbed to echo the English fallback so asserted copy is decoupled from the
 * locale bundle; <FadeIn> is flattened to a plain div (framer-motion +
 * matchMedia are irrelevant here); and <DateTime> is a light double that
 * surfaces the value/variant/showTz props so the header's composition contract
 * is observable without the timezone/settings subtree. The real <Button> and
 * react-router <Link> render for real inside a <MemoryRouter>.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { DriveDetail } from '@/types/driving';

// Echo the English fallback (2nd arg) so assertions read real copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Flatten the entry animation — framer-motion / matchMedia are irrelevant to
// this header's behaviour.
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// <DateTime> double: surface value + variant + showTz as data attributes so the
// meta-line composition (which timestamp, which variant) is deterministically
// assertable without pulling in the real timezone/settings machinery.
vi.mock('@/components/data-display', () => ({
  DateTime: ({
    value,
    variant,
    showTz,
  }: {
    value: string | Date | null | undefined;
    variant?: string;
    showTz?: boolean;
    in?: string;
  }) => (
    <time
      data-testid="dt"
      data-variant={variant ?? 'full'}
      data-value={typeof value === 'string' ? value : ''}
      data-showtz={showTz ? 'true' : 'false'}
    >
      {typeof value === 'string' ? value : ''}
    </time>
  ),
}));

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
    startAddress: 'Downtown SF',
    endAddress: 'Palo Alto',
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

interface RenderOverrides {
  drive?: Partial<DriveDetail>;
  driveId?: string;
  vehicleName?: string;
  onShare?: () => void;
}

async function renderHeader(overrides: RenderOverrides = {}) {
  // Import after the mocks are registered.
  const { DriveDetailHeader } = await import('./DriveDetailHeader');
  const onShare = overrides.onShare ?? vi.fn();
  const utils = render(
    <MemoryRouter>
      <DriveDetailHeader
        drive={makeDrive(overrides.drive)}
        driveId={overrides.driveId ?? '42'}
        vehicleName={overrides.vehicleName ?? 'Model 3'}
        onShare={onShare}
      />
    </MemoryRouter>,
  );
  return { ...utils, onShare };
}

const heading = () => screen.getByRole('heading', { level: 1 });
const metaLine = (container: HTMLElement) => container.querySelector('p') as HTMLParagraphElement;

// ── 1. Title ─────────────────────────────────────────────────────────────────

describe('DriveDetailHeader — title', () => {
  it('renders the "start → end" route heading when both addresses are present', async () => {
    await renderHeader({ drive: { startAddress: 'Downtown SF', endAddress: 'Palo Alto' } });

    const h1 = heading();
    expect(h1.textContent).toContain('Downtown SF');
    expect(h1.textContent).toContain('Palo Alto');
    expect(h1.textContent).toContain('→');
  });

  it('falls back to the i18n "Drive Details" title when both addresses are absent', async () => {
    await renderHeader({ drive: { startAddress: null, endAddress: null } });

    expect(heading().textContent).toContain('Drive Details');
    expect(heading().textContent).not.toContain('→');
  });

  it('falls back to the generic title when only one address is present', async () => {
    // hasRoute requires BOTH sides — a half-known route must not render a
    // lopsided "Downtown SF → " heading.
    await renderHeader({ drive: { startAddress: 'Downtown SF', endAddress: null } });

    expect(heading().textContent).toContain('Drive Details');
    expect(heading().textContent).not.toContain('Downtown SF');
  });
});

// ── 2. Back link accessibility ───────────────────────────────────────────────

describe('DriveDetailHeader — back link', () => {
  it('exposes an accessibly-labelled back link to the drives list', async () => {
    await renderHeader();

    const back = screen.getByRole('link', { name: 'Back to drives' });
    expect(back).toHaveAttribute('href', '/drives');
  });

  it('marks the back-arrow glyph decorative so the label is the sole announcement', async () => {
    await renderHeader();

    const back = screen.getByRole('link', { name: 'Back to drives' });
    const icon = back.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});

// ── 3. Replay navigation ─────────────────────────────────────────────────────

describe('DriveDetailHeader — replay navigation', () => {
  it("links Replay to the drive's replay route, threading the driveId", async () => {
    await renderHeader({ driveId: '99' });

    const replay = screen.getByRole('link', { name: /Replay/i });
    expect(replay).toHaveAttribute('href', '/drives/99/replay');
  });
});

// ── 4. Share interaction ─────────────────────────────────────────────────────

describe('DriveDetailHeader — share', () => {
  it('invokes onShare exactly once when the Share button is clicked', async () => {
    const onShare = vi.fn();
    await renderHeader({ onShare });

    expect(onShare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Share/i }));
    expect(onShare).toHaveBeenCalledTimes(1);
  });
});

// ── 5. Meta line composition ─────────────────────────────────────────────────

describe('DriveDetailHeader — meta line', () => {
  it('renders the vehicle name plus the start date and start time', async () => {
    const { container } = await renderHeader({ vehicleName: 'My Roadster' });

    expect(metaLine(container).textContent).toContain('My Roadster');

    const dts = within(metaLine(container)).getAllByTestId('dt');
    // Start date (variant=date) + start time (variant=time, showTz) + end time.
    const startDate = dts.find((d) => d.getAttribute('data-variant') === 'date');
    expect(startDate).toHaveAttribute('data-value', START_TS);

    const startTime = dts.find(
      (d) => d.getAttribute('data-variant') === 'time' && d.getAttribute('data-showtz') === 'true',
    );
    expect(startTime).toHaveAttribute('data-value', START_TS);
  });

  it('appends the end time only when the drive has ended', async () => {
    const ended = await renderHeader({ drive: { endTs: END_TS } });
    const endedDts = within(metaLine(ended.container)).getAllByTestId('dt');
    // start-date + start-time + end-time = three timestamps.
    expect(endedDts).toHaveLength(3);
    expect(endedDts.map((d) => d.getAttribute('data-value'))).toContain(END_TS);
    expect(metaLine(ended.container).textContent).toContain('→');
    ended.unmount();

    const live = await renderHeader({ drive: { endTs: null } });
    const liveDts = within(metaLine(live.container)).getAllByTestId('dt');
    // In-progress drive: only the two start timestamps, no end value.
    expect(liveDts).toHaveLength(2);
    expect(liveDts.map((d) => d.getAttribute('data-value'))).not.toContain(END_TS);
  });
});

// ── 6. Null-safety hardening ─────────────────────────────────────────────────

describe('DriveDetailHeader — null-safety hardening', () => {
  it('substitutes the "Vehicle" label for an empty vehicle name', async () => {
    const { container } = await renderHeader({ vehicleName: '' });

    // Falls back rather than leaving a dangling leading separator.
    expect(metaLine(container).textContent?.startsWith('Vehicle')).toBe(true);
    expect(metaLine(container).textContent?.startsWith('·')).toBe(false);
  });

  it('treats a whitespace-only vehicle name as empty and falls back', async () => {
    const { container } = await renderHeader({ vehicleName: '   ' });

    expect(metaLine(container).textContent?.startsWith('Vehicle')).toBe(true);
  });
});
