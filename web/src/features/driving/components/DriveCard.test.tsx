/**
 * DriveCard — behaviour, branch, interaction, a11y and null-safety coverage for
 * the file's sole runtime export (`DriveCard`, plus its `DriveCardProps` type).
 *
 * The component composes a shared `HistoryListRow` (which renders a Router
 * `<Link>` to `/drives/{id}`), a leading `ScoreBadge`, a `RouteDisplay`, a
 * `BatteryDelta`, and a set of `InlineMetric` / efficiency / cost chips. All the
 * interesting logic lives in the derivations: the primary status badge
 * (distance / "No telemetry" / "In progress"), the high-speed + anomaly badges,
 * the avg-speed fallback chain, the battery-friendly grade, and the metric
 * chips.
 *
 * This file also pins the hardening pass's fixes:
 *   - a11y — every decorative lucide icon (Gauge / TrendingUp / Zap / DollarSign)
 *     is `aria-hidden`, matching the sibling ChargingSessionCard convention;
 *   - the `{number && jsx}` FOOTGUN — the efficiency chip is guarded with
 *     `effConverted != null` so a converter that rounds to 0 renders the chip
 *     ("0 Wh/km") instead of leaking a bare stray "0" text node.
 *
 * Strategy: the component takes its drive + unit converters + cost formatter as
 * props, so no network data is fetched and no QueryClient is required. Only
 * `react-i18next` is mocked so `t(key, fallback)` / `t(key, fallback, { vars }})`
 * render the English fallback (with {{var}} interpolation) deterministically.
 * The converters mirror production semantics (metres→km, m/s→km/h, Wh/km
 * identity) so every assertion reads the value straight back out of the chip.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { Drive } from '@/types/driving';
import { DriveCard, type DriveCardProps } from './DriveCard';

// jsdom lacks matchMedia; shared UI can reach framer-motion's useReducedMotion
// transitively via the data-display barrel. Install a benign stub before any
// shared module evaluates.
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

// i18n → return the developer fallback string, interpolating {{vars}} so the
// badges + aria-labels read as real English. Handles the call shapes the
// component (and the shared leaves) use: t(key, 'fallback') and
// t(key, 'fallback', { vars }).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (template: string, vars?: Record<string, unknown>) =>
    vars
      ? template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        )
      : template;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined;
          return interpolate(second, vars);
        }
        if (second && typeof second === 'object') {
          const opts = second as Record<string, unknown>;
          const template = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
          return interpolate(template, opts);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

/* ── Production-faithful display converters ─────────────────────────────── */
const toDistanceDisplay = (m: number) => m / 1000; // SI metres → km
const toSpeedDisplay = (mps: number) => mps * 3.6; // SI m/s → km/h
const toEfficiencyDisplay = (whPerKm: number) => whPerKm; // km identity

/** A completed 50 km / 30 min drive: 80 → 70 % battery ⇒ 150 Wh/km ⇒ grade A. */
function makeDrive(over: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    vehicleId: 1,
    startTs: '2024-06-01T14:30:00Z',
    endTs: '2024-06-01T15:00:00Z',
    durationS: 1800,
    distanceM: 50000,
    startAddress: 'Home, Fremont',
    endAddress: 'Office, San Jose',
    startLat: 37.5,
    startLon: -121.9,
    endLat: 37.3,
    endLon: -121.8,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 11000,
    regenEnergyWh: 2000,
    avgSpeedMps: 25, // ×3.6 = 90 km/h
    maxSpeedMps: 40, // ×3.6 = 144 km/h (< 58.1152 m/s high-speed threshold)
    avgPowerW: 15000,
    outsideTempAvgC: 18,
    insideTempAvgC: 21,
    score: null,
    endedStatus: null,
    createdAt: '2024-06-01T14:30:00Z',
    updatedAt: '2024-06-01T15:00:00Z',
    ...over,
  };
}

/** A cost formatter spy: 1 kWh ⇒ $0.12 so we can assert the exact kWh input. */
function costSpy() {
  return vi.fn((kwh: number) => `$${(kwh * 0.12).toFixed(2)}`);
}

function renderCard(over: Partial<DriveCardProps> = {}) {
  const props: DriveCardProps = {
    drive: makeDrive(),
    toDistanceDisplay,
    toSpeedDisplay,
    toEfficiencyDisplay,
    distanceUnit: 'km',
    speedUnit: 'km/h',
    efficiencyUnit: 'Wh/km',
    ...over,
  };
  const utils = render(
    <MemoryRouter>
      <DriveCard {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

describe('DriveCard — primary line + status badge', () => {
  it('renders duration, the SI-converted distance badge, the grade badge and a detail link', () => {
    renderCard();

    // 1800 s → "30m"; 50 000 m → 50 km.
    expect(screen.getByText('30m')).toBeInTheDocument();
    expect(screen.getByText('50.00 km')).toBeInTheDocument();
    // 80 → 70 % over 50 km ⇒ 150 Wh/km ⇒ grade A, exposed via aria-label.
    expect(screen.getByLabelText('Score A')).toHaveTextContent('A');
    // The whole row is a single navigable link.
    expect(screen.getByRole('link')).toHaveAttribute('href', '/drives/1');
  });

  it('shows the "No telemetry" badge for a completed drive with no distance or duration', () => {
    renderCard({
      drive: makeDrive({
        distanceM: 0,
        durationS: 0,
        avgSpeedMps: null,
        maxSpeedMps: null,
        startBatteryPct: null,
        endBatteryPct: null,
      }),
    });

    expect(screen.getByText('No telemetry')).toBeInTheDocument();
    expect(screen.queryByText('In progress')).toBeNull();
    // The primary line is never blank — the avg chip still renders a placeholder.
    expect(screen.getByText('Avg — km/h')).toBeInTheDocument();
  });

  it('shows the "In progress" badge for an active drive (no endTs) with no data yet', () => {
    renderCard({
      drive: makeDrive({ endTs: null, distanceM: 0, durationS: 0, avgSpeedMps: null }),
    });

    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.queryByText('No telemetry')).toBeNull();
  });

  it('flags the "High speed" badge only when max speed crosses ~130 mph', () => {
    // 60 m/s ≈ 134 mph → over the 58.1152 m/s threshold.
    const over = renderCard({ drive: makeDrive({ maxSpeedMps: 60 }) });
    expect(within(over.container).getByText('High speed')).toBeInTheDocument();
    over.unmount();

    // 40 m/s is under the threshold → no badge.
    const under = renderCard({ drive: makeDrive({ maxSpeedMps: 40 }) });
    expect(within(under.container).queryByText('High speed')).toBeNull();
  });

  it('renders the anomaly "Low efficiency" badge when isAnomaly is set, and omits it otherwise', () => {
    const { unmount } = renderCard({ isAnomaly: true });
    expect(screen.getByText('Low efficiency')).toBeInTheDocument();
    unmount();

    renderCard({ isAnomaly: false });
    expect(screen.queryByText('Low efficiency')).toBeNull();
  });

  it('opens the quick preview without nesting the action in the detail link', () => {
    const onPreview = vi.fn();
    renderCard({ onPreview });

    const action = screen.getByRole('button', { name: 'Quick view drive' });
    fireEvent.click(action);

    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(screen.getByRole('link')).not.toContainElement(action);
  });
});

describe('DriveCard — metric chips', () => {
  it('renders avg + max speed chips converted at the display edge', () => {
    renderCard();
    expect(screen.getByText('Avg 90 km/h')).toBeInTheDocument(); // 25 m/s ×3.6
    expect(screen.getByText('Max 144 km/h')).toBeInTheDocument(); // 40 m/s ×3.6
  });

  it('derives avg speed from distance ÷ duration when avgSpeedMps is missing', () => {
    // 50 000 m / 1800 s = 27.78 m/s ×3.6 = 100 km/h.
    renderCard({ drive: makeDrive({ avgSpeedMps: null }) });
    expect(screen.getByText('Avg 100 km/h')).toBeInTheDocument();
  });

  it('placeholders avg speed and drops the max chip when neither is derivable', () => {
    renderCard({
      drive: makeDrive({ avgSpeedMps: null, maxSpeedMps: null, distanceM: 0, durationS: 0 }),
    });
    expect(screen.getByText('Avg — km/h')).toBeInTheDocument();
    expect(screen.queryByText(/^Max /)).toBeNull();
  });

  it('renders the battery delta with an accessible label, and hides it when a 0→0 drive completes', () => {
    const withBattery = renderCard();
    expect(within(withBattery.container).getByLabelText('Battery 80% to 70%')).toBeInTheDocument();
    withBattery.unmount();

    // Both endpoints 0 on a completed drive ⇒ treated as "no battery data".
    const zeroed = renderCard({ drive: makeDrive({ startBatteryPct: 0, endBatteryPct: 0 }) });
    expect(within(zeroed.container).queryByLabelText(/^Battery /)).toBeNull();
  });

  it('renders the efficiency chip with its Wh/km value, and omits it when there is no battery delta', () => {
    const graded = renderCard();
    expect(within(graded.container).getByText('150 Wh/km')).toBeInTheDocument();
    graded.unmount();

    // No usable battery delta ⇒ getEfficiency returns null ⇒ no chip.
    const ungraded = renderCard({ drive: makeDrive({ startBatteryPct: null, endBatteryPct: null }) });
    expect(within(ungraded.container).queryByText(/Wh\/km$/)).toBeNull();
  });

  it('renders the cost chip and calls formatEnergyCost with the derived kWh', () => {
    const formatEnergyCost = costSpy();
    renderCard({ formatEnergyCost });

    // (80 − 70) % × 0.75 kWh/% = 7.5 kWh ⇒ $0.90.
    expect(formatEnergyCost).toHaveBeenCalledWith(7.5);
    expect(screen.getByText('~$0.90')).toBeInTheDocument();
  });

  it('omits the cost chip entirely when no formatEnergyCost is supplied', () => {
    renderCard();
    expect(screen.queryByText(/~\$/)).toBeNull();
    // …while the rest of the metrics row still renders.
    expect(screen.getByText('150 Wh/km')).toBeInTheDocument();
  });
});

describe('DriveCard — selection', () => {
  it('omits the checkbox when no selection handler is supplied', () => {
    renderCard();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('renders a labelled, controlled checkbox and reports the toggled id when clicked', () => {
    const onToggleSelect = vi.fn();
    renderCard({ drive: makeDrive({ id: 7 }), onToggleSelect, selected: false });

    const box = screen.getByRole('checkbox', { name: /^Select drive on / });
    expect(box).not.toBeChecked();

    fireEvent.click(box);
    expect(onToggleSelect).toHaveBeenCalledWith(7, true);
  });

  it('reflects the selected prop as the checked state', () => {
    const onToggleSelect = vi.fn();
    renderCard({ onToggleSelect, selected: true });
    expect(screen.getByRole('checkbox', { name: /^Select drive on / })).toBeChecked();
  });
});

describe('DriveCard — route line', () => {
  it('renders the from → to route when start and end addresses differ', () => {
    renderCard();
    expect(screen.getByText(/Home, Fremont → Office, San Jose/)).toBeInTheDocument();
  });

  it('collapses to a round-trip label when start and end addresses match', () => {
    renderCard({ drive: makeDrive({ startAddress: 'Home', endAddress: 'Home' }) });
    expect(screen.getByText(/round trip/)).toBeInTheDocument();
  });

  it('falls back to the "No location data" placeholder when no address or coords exist', () => {
    renderCard({
      drive: makeDrive({
        startAddress: null,
        endAddress: null,
        startLat: null,
        startLon: null,
        endLat: null,
        endLon: null,
      }),
    });
    expect(screen.getByText('No location data')).toBeInTheDocument();
  });
});

describe('DriveCard — accessibility', () => {
  it('marks every decorative metric icon aria-hidden', () => {
    const { container } = renderCard({ formatEnergyCost: costSpy() });

    // Gauge (avg) + TrendingUp (max) live inside their InlineMetric chip.
    const gauge = screen.getByText('Avg 90 km/h').parentElement?.querySelector('svg');
    const trend = screen.getByText('Max 144 km/h').parentElement?.querySelector('svg');
    // Zap + DollarSign sit directly inside their chip span.
    const zap = screen.getByText('150 Wh/km').querySelector('svg');
    const dollar = screen.getByText('~$0.90').querySelector('svg');

    for (const icon of [gauge, trend, zap, dollar]) {
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
    // Sanity: the row still exposes exactly one navigable link.
    expect(within(container).getByRole('link')).toBeInTheDocument();
  });

  it('gives the score badge and selection checkbox descriptive labels', () => {
    const onToggleSelect = vi.fn();
    renderCard({ onToggleSelect });

    expect(screen.getByLabelText('Score A')).toBeInTheDocument();
    expect(screen.getByRole('checkbox').getAttribute('aria-label')).toMatch(/^Select drive on /);
  });

  it('renders the drive time in the supplied IANA timezone (tz flows to the label)', () => {
    const onToggleSelect = vi.fn();
    const drive = makeDrive({ startTs: '2024-06-01T14:30:00Z' });

    const utc = renderCard({ drive, onToggleSelect, tz: 'UTC' });
    const utcLabel = within(utc.container).getByRole('checkbox').getAttribute('aria-label') ?? '';
    utc.unmount();

    const la = renderCard({ drive, onToggleSelect, tz: 'America/Los_Angeles' });
    const laLabel = within(la.container).getByRole('checkbox').getAttribute('aria-label') ?? '';

    expect(utcLabel).toMatch(/^Select drive on /);
    expect(laLabel).toMatch(/^Select drive on /);
    // Same instant, different zone ⇒ the rendered wall-clock (and thus label) differs.
    expect(utcLabel).not.toBe(laLabel);
  });
});

describe('DriveCard — null safety + hardening', () => {
  it('renders without crashing or "NaN" when every optional field is null', () => {
    const { container } = renderCard({
      drive: makeDrive({
        endTs: null,
        distanceM: 0,
        durationS: 0,
        startAddress: null,
        endAddress: null,
        startLat: null,
        startLon: null,
        endLat: null,
        endLon: null,
        startBatteryPct: null,
        endBatteryPct: null,
        avgSpeedMps: null,
        maxSpeedMps: null,
      }),
    });

    expect(screen.getByRole('link')).toHaveAttribute('href', '/drives/1');
    expect(screen.getByText('No location data')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN/);
  });

  it('renders the efficiency chip (not a stray "0") when the converter rounds toward zero', () => {
    // A real drive (batteryUsed > 0) keeps getEfficiency non-null, but a
    // converter that yields 0 previously tripped the `{number && jsx}` footgun.
    renderCard({ toEfficiencyDisplay: () => 0 });

    expect(screen.getByText('0 Wh/km')).toBeInTheDocument();
    // The bare "0" must never leak as its own text node.
    expect(screen.queryByText('0', { selector: 'span' })).toBeNull();
  });
});
