/**
 * VehicleStatePanel — behaviour + regression coverage.
 *
 * The panel is presentational (a live-signal bag in, a status grid out — no
 * buttons, inputs, or async), so this suite drives every branch and the
 * hardening applied while elevating it:
 *   - REGRESSION (real bug): `pairedKeyCount` / `homelinkDeviceCount` are Go
 *     `number`s but were rendered via `(value as string) || '—'`. That cast
 *     lied about the type AND the `|| '—'` fallback swallowed a legitimate `0`,
 *     conflating "zero devices" with "signal missing". The fix (`formatCount`)
 *     renders a finite number verbatim (incl. 0) and only em-dashes truly
 *     absent / non-numeric values — these tests lock that mapping in.
 *   - null / type safety: `centerDisplay` is typed `string | boolean | null`
 *     upstream; a boolean used to render as a blank (React drops booleans).
 *     `formatText` collapses non-strings to an em-dash instead.
 *   - unit boundary: the current speed limit is SI (m/s) — consistent with the
 *     app-wide `formatSpeed(state.speed)` contract — so it flows through
 *     `useUnits().formatSpeed`. The panel must only call the formatter when the
 *     limit is engaged, and pass the raw numeric value through.
 *   - a11y: decorative lucide glyphs + the pulsing "Live" dot are aria-hidden,
 *     the "Live" indicator is a polite `status` region, and the panel exposes
 *     an accessible heading.
 *
 * `react-i18next` is stubbed to echo the English fallback and `useUnits` is
 * stubbed with a hoisted `formatSpeed` spy. No network is touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { VehicleStatePanel } from './VehicleStatePanel';

// Hoisted spy so the `vi.mock` factory below can close over it. Echoes an
// obvious `<value> mph` string for numbers so we can assert both that the
// formatter ran and what it received; non-numbers fall through to a dash.
const { formatSpeed } = vi.hoisted(() => ({
  formatSpeed: vi.fn((value?: number | null) =>
    typeof value === 'number' ? `${value} mph` : '—',
  ),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatSpeed }),
}));

// Echo the English fallback so assertions read naturally.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

/** The value <span> (second child) of the row whose label text matches. */
function valueFor(label: string): HTMLElement {
  const labelSpan = screen.getByText(label);
  const row = labelSpan.parentElement as HTMLElement;
  return row.children[1] as HTMLElement;
}

const ALL_LABELS = [
  'High Beams',
  'Turn Signal',
  'Hazards',
  'Driver Seat',
  'Paired Keys',
  'Valet Mode',
  'Service Mode',
  'Speed Limit',
  'Center Display',
  'HomeLink Devices',
];

beforeEach(() => {
  formatSpeed.mockClear();
});

describe('VehicleStatePanel', () => {
  it('always renders the accessible heading and every row label, even with no live data', () => {
    render(<VehicleStatePanel live={{}} sseConnected={false} />);

    expect(screen.getByRole('heading', { name: /Vehicle State/ })).toBeInTheDocument();
    for (const label of ALL_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows sensible off/empty placeholders (never a blank panel) when live is empty', () => {
    render(<VehicleStatePanel live={{}} sseConnected={false} />);

    expect(valueFor('High Beams')).toHaveTextContent('Off');
    expect(valueFor('Hazards')).toHaveTextContent('Off');
    expect(valueFor('Driver Seat')).toHaveTextContent('Empty');
    expect(valueFor('Valet Mode')).toHaveTextContent('Off');
    expect(valueFor('Service Mode')).toHaveTextContent('Off');
    expect(valueFor('Speed Limit')).toHaveTextContent('Off');
    // Missing counts / text collapse to an em-dash, not "undefined".
    expect(valueFor('Paired Keys')).toHaveTextContent('—');
    expect(valueFor('Center Display')).toHaveTextContent('—');
    expect(valueFor('HomeLink Devices')).toHaveTextContent('—');
    // The speed-limit formatter must NOT run while the limit is disengaged.
    expect(formatSpeed).not.toHaveBeenCalled();
  });

  it('renders active states with their values and the exact accent colours', () => {
    render(
      <VehicleStatePanel
        live={{
          lightsHighBeams: true,
          lightsTurnSignal: 'Left',
          lightsHazards: true,
          driverSeatOccupied: true,
          valetMode: true,
          serviceMode: true,
        }}
        sseConnected={false}
      />,
    );

    const highBeams = valueFor('High Beams');
    expect(highBeams).toHaveTextContent('On');
    expect(highBeams.className).toContain('text-cyan-300');

    const turn = valueFor('Turn Signal');
    expect(turn).toHaveTextContent('Left');
    expect(turn.className).toContain('text-amber-300');

    const hazards = valueFor('Hazards');
    expect(hazards).toHaveTextContent('Active');
    expect(hazards.className).toContain('text-rose-300');

    const seat = valueFor('Driver Seat');
    expect(seat).toHaveTextContent('Occupied');
    expect(seat.className).toContain('text-green-400');

    const valet = valueFor('Valet Mode');
    expect(valet).toHaveTextContent('Enabled');
    expect(valet.className).toContain('text-purple-400');

    const service = valueFor('Service Mode');
    expect(service).toHaveTextContent('Active');
    expect(service.className).toContain('text-amber-400');
  });

  it('mutes inactive status rows instead of colouring them', () => {
    render(<VehicleStatePanel live={{ lightsHighBeams: false }} sseConnected={false} />);

    const highBeams = valueFor('High Beams');
    expect(highBeams).toHaveTextContent('Off');
    expect(highBeams.className).toContain('text-[var(--text-muted)]');
    expect(highBeams.className).not.toContain('text-cyan-300');
  });

  it('treats an explicit "Off" turn-signal string as inactive', () => {
    render(<VehicleStatePanel live={{ lightsTurnSignal: 'Off' }} sseConnected={false} />);

    const turn = valueFor('Turn Signal');
    expect(turn).toHaveTextContent('Off');
    expect(turn.className).toContain('text-[var(--text-muted)]');
    expect(turn.className).not.toContain('text-amber-300');
  });

  it('renders counts verbatim including a real zero (regression for the as-string / falsy-0 bug)', () => {
    render(
      <VehicleStatePanel
        live={{ pairedKeyCount: 0, homelinkDeviceCount: 3 }}
        sseConnected={false}
      />,
    );

    // 0 is genuine data — it must read "0", not collapse to the "missing" dash.
    expect(valueFor('Paired Keys')).toHaveTextContent('0');
    expect(valueFor('Paired Keys').textContent).toBe('0');
    expect(valueFor('HomeLink Devices')).toHaveTextContent('3');
  });

  it('dashes non-numeric counts and blank / non-string center-display values', () => {
    render(
      <VehicleStatePanel
        // centerDisplay may arrive as a boolean upstream; it must not render blank.
        live={{ pairedKeyCount: undefined, centerDisplay: true, homelinkDeviceCount: 'oops' }}
        sseConnected={false}
      />,
    );

    expect(valueFor('Paired Keys').textContent).toBe('—');
    expect(valueFor('Center Display').textContent).toBe('—');
    expect(valueFor('HomeLink Devices').textContent).toBe('—');
  });

  it('renders a non-empty center-display string as-is', () => {
    render(<VehicleStatePanel live={{ centerDisplay: 'Driving' }} sseConnected={false} />);
    expect(valueFor('Center Display')).toHaveTextContent('Driving');
  });

  it('formats the engaged speed limit through useUnits and passes the raw SI value', () => {
    render(
      <VehicleStatePanel
        live={{ speedLimitMode: true, currentSpeedLimit: 25 }}
        sseConnected={false}
      />,
    );

    expect(formatSpeed).toHaveBeenCalledWith(25);
    const speedLimit = valueFor('Speed Limit');
    expect(speedLimit).toHaveTextContent('25 mph');
    expect(speedLimit.className).toContain('text-cyan-300');
  });

  it('does not format a speed limit whose value is missing while the mode is on', () => {
    render(<VehicleStatePanel live={{ speedLimitMode: true }} sseConnected={false} />);
    // The mode is engaged, so the formatter still runs — but with `undefined`,
    // which the null-safe formatter turns into a dash rather than crashing.
    expect(formatSpeed).toHaveBeenCalledWith(undefined);
    expect(valueFor('Speed Limit')).toHaveTextContent('—');
  });

  it('exposes the "Live" indicator as a polite status region only when connected', () => {
    const { rerender } = render(<VehicleStatePanel live={{}} sseConnected />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Live');
    // The pulsing dot is decorative and must be hidden from assistive tech.
    expect(status.querySelector('span[aria-hidden="true"]')).not.toBeNull();

    rerender(<VehicleStatePanel live={{}} sseConnected={false} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('marks decorative row glyphs as aria-hidden for screen readers', () => {
    render(<VehicleStatePanel live={{}} sseConnected={false} />);

    const icon = screen.getByText('High Beams').querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
