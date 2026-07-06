/**
 * LiveVehicleState — live security-signal grid contract.
 *
 * `<LiveVehicleState>` is a pure, prop-driven view over a single
 * `/security/latest` snapshot. It fans the raw `SecurityEvent` out into ten
 * `<StatusTile>`s via the module-private `buildLiveSignals` builder. The facets
 * pinned here exercise every branch of that builder plus the four section
 * states of the panel:
 *
 *   • the four self-sufficient section states — error / loading / empty /
 *     populated — each render their own affordance and NEVER blank the panel
 *     title, and error takes priority over a concurrent loading flag;
 *   • the error branch's Retry invokes `onRetry` (failure-path interaction);
 *   • boolean light signals map through On / Off / — with an active→cyan vs
 *     inactive→muted tone;
 *   • string-enum signals (Turn Signal) treat any "off" variant as inactive and
 *     degrade a null to "—" without throwing;
 *   • numeric counts render their value, clamp a null to "—", and treat 0 as a
 *     shown-but-inactive tile (a section is never hidden);
 *   • Speed Limit and Center Display accept EITHER a native boolean OR a string
 *     enum — the Center Display boolean path is a regression pin: a boolean used
 *     to fall through `asNonEmptyString` and degrade to "—", it must now mirror
 *     Speed Limit and render On/Off;
 *   • an all-null snapshot still renders all ten tiles (each "—", muted) so no
 *     section vanishes, and the "Live" badge only appears once a snapshot exists;
 *   • a11y: the title is a level-3 heading and decorative icons are aria-hidden.
 *
 * react-i18next is mocked to echo each call's English fallback (and interpolate
 * `{{token}}` placeholders) so copy is deterministic. Renders are wrapped in
 * <MemoryRouter> because the error branch's <QueryError> uses `useNavigate`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let out = fallback ?? _key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { LiveVehicleState } from './LiveVehicleState';
import type { SecurityEvent } from '@/types/admin';

type Props = {
  latest: SecurityEvent | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  className?: string;
};

/** The ten tile labels the builder always emits for a defined snapshot,
 *  in render order. */
const LABELS = [
  'Hazards',
  'High Beams',
  'Turn Signal',
  'Driver Seat',
  'Paired Keys',
  'Valet Mode',
  'Service Mode',
  'Speed Limit',
  'HomeLink Devices',
  'Center Display',
] as const;

/** A fully-null `SecurityEvent` (every signal field defaults to null) with
 *  targeted overrides. Mirrors the raw `signal.SignalValue` shape the backend
 *  serializes, where a value may be absent (null), a bool, a number, or a
 *  string enum. */
function makeEvent(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    id: 'evt-1',
    locked: null,
    sentryMode: null,
    doorState: null,
    fdWindow: null,
    fpWindow: null,
    rdWindow: null,
    rpWindow: null,
    homelinkNearby: null,
    guestMode: null,
    homelinkDeviceCount: null,
    guestModeMobileAccessState: null,
    driverSeatOccupied: null,
    centerDisplay: null,
    speedLimitMode: null,
    valetModeEnabled: null,
    serviceMode: null,
    pairedPhoneKeyCount: null,
    lightsHazardsActive: null,
    lightsHighBeams: null,
    lightsTurnSignal: null,
    driverSeatBelt: null,
    passengerSeatBelt: null,
    createdAt: '2026-07-04T00:00:00Z',
    ...overrides,
  };
}

function renderState(props: Partial<Props> = {}) {
  const merge = (p: Partial<Props>): Props => ({
    latest: undefined,
    isLoading: false,
    error: null,
    ...p,
  });
  const utils = render(
    <MemoryRouter>
      <LiveVehicleState {...merge(props)} />
    </MemoryRouter>,
  );
  return {
    ...utils,
    rerenderWith: (p: Partial<Props>) =>
      utils.rerender(
        <MemoryRouter>
          <LiveVehicleState {...merge(p)} />
        </MemoryRouter>,
      ),
  };
}

/** Resolve the `<StatusTile>` container that wraps a given label. */
function tile(label: string): HTMLElement {
  const root = screen.getByText(label).closest('div.rounded-xl');
  if (!root) throw new Error(`no tile container for "${label}"`);
  return root as HTMLElement;
}

/** The single value `<p>` inside a tile (description is never passed, so the
 *  tile has exactly one `<p>`). */
function tileValue(label: string): HTMLElement {
  const p = tile(label).querySelector('p');
  if (!p) throw new Error(`no value <p> in tile "${label}"`);
  return p as HTMLElement;
}

const ACTIVE_TONE = 'text-cyan-300';
const MUTED_TONE = 'text-[var(--text-secondary)]';

function title() {
  return screen.getByRole('heading', { name: 'Live Vehicle State', level: 3 });
}

describe('LiveVehicleState', () => {
  it('renders a ten-cell skeleton grid while loading, with no tiles or live badge but an intact title', () => {
    const { container } = renderState({ isLoading: true });

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(10);
    // Loading must not leak the data grid or the "Live" indicator…
    expect(screen.queryByText('Hazards')).toBeNull();
    expect(screen.queryByText('Live')).toBeNull();
    // …but the section is never blank: its heading anchors the panel.
    expect(title()).toBeInTheDocument();
  });

  it('surfaces the query error (over a concurrent loading flag), wires Retry to onRetry, and keeps the title', () => {
    const onRetry = vi.fn();
    // error + isLoading both set → error must win (no skeletons render).
    const { container } = renderState({
      error: new Error('boom'),
      isLoading: true,
      onRetry,
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
    expect(screen.queryByText('Hazards')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    expect(title()).toBeInTheDocument();
  });

  it('shows the empty state (and hides the live badge) when there is no latest snapshot', () => {
    renderState({ latest: undefined });

    expect(
      screen.getByText('No live state data available'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.queryByText('Hazards')).toBeNull();
    expect(title()).toBeInTheDocument();
  });

  it('renders all ten signal tiles plus the live badge for a populated snapshot', () => {
    renderState({
      latest: makeEvent({ lightsHazardsActive: true, pairedPhoneKeyCount: 2 }),
    });

    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('maps boolean light signals through On / Off / — with an active→cyan, inactive→muted tone', () => {
    renderState({
      latest: makeEvent({
        lightsHazardsActive: true,
        lightsHighBeams: false,
        valetModeEnabled: null,
      }),
    });

    expect(tileValue('Hazards').textContent).toBe('On');
    expect(tileValue('Hazards').className).toContain(ACTIVE_TONE);

    expect(tileValue('High Beams').textContent).toBe('Off');
    expect(tileValue('High Beams').className).toContain(MUTED_TONE);

    // A null boolean is an unknown, not a false — it renders the em dash.
    expect(tileValue('Valet Mode').textContent).toBe('—');
    expect(tileValue('Valet Mode').className).toContain(MUTED_TONE);
  });

  it('renders the turn-signal string enum, treating any "off" variant (and null) as inactive', () => {
    const { rerenderWith } = renderState({
      latest: makeEvent({ lightsTurnSignal: 'TurnSignalStateLeft' }),
    });
    expect(tileValue('Turn Signal').textContent).toBe('TurnSignalStateLeft');
    expect(tileValue('Turn Signal').className).toContain(ACTIVE_TONE);

    rerenderWith({ latest: makeEvent({ lightsTurnSignal: 'TurnSignalStateOff' }) });
    expect(tileValue('Turn Signal').textContent).toBe('TurnSignalStateOff');
    expect(tileValue('Turn Signal').className).toContain(MUTED_TONE);

    rerenderWith({ latest: makeEvent({ lightsTurnSignal: null }) });
    expect(tileValue('Turn Signal').textContent).toBe('—');
    expect(tileValue('Turn Signal').className).toContain(MUTED_TONE);
  });

  it('renders driver-seat occupancy and numeric counts, guarding null and treating 0 as shown-but-inactive', () => {
    const { rerenderWith } = renderState({
      latest: makeEvent({
        driverSeatOccupied: true,
        pairedPhoneKeyCount: 3,
        homelinkDeviceCount: 0,
      }),
    });

    expect(tileValue('Driver Seat').textContent).toBe('Occupied');
    expect(tileValue('Driver Seat').className).toContain(ACTIVE_TONE);

    expect(tileValue('Paired Keys').textContent).toBe('3');
    expect(tileValue('Paired Keys').className).toContain(ACTIVE_TONE);

    // A zero count is real data — shown as "0" and muted, never hidden.
    expect(tileValue('HomeLink Devices').textContent).toBe('0');
    expect(tileValue('HomeLink Devices').className).toContain(MUTED_TONE);

    rerenderWith({
      latest: makeEvent({ driverSeatOccupied: false, pairedPhoneKeyCount: null }),
    });
    expect(tileValue('Driver Seat').textContent).toBe('Empty');
    expect(tileValue('Paired Keys').textContent).toBe('—');
  });

  it('handles speed-limit mode arriving as either a native boolean or a string enum', () => {
    const { rerenderWith } = renderState({
      latest: makeEvent({ speedLimitMode: true }),
    });
    expect(tileValue('Speed Limit').textContent).toBe('On');
    expect(tileValue('Speed Limit').className).toContain(ACTIVE_TONE);

    rerenderWith({ latest: makeEvent({ speedLimitMode: false }) });
    expect(tileValue('Speed Limit').textContent).toBe('Off');
    expect(tileValue('Speed Limit').className).toContain(MUTED_TONE);

    rerenderWith({ latest: makeEvent({ speedLimitMode: 'SpeedLimitActive' }) });
    expect(tileValue('Speed Limit').textContent).toBe('SpeedLimitActive');
    expect(tileValue('Speed Limit').className).toContain(ACTIVE_TONE);

    rerenderWith({ latest: makeEvent({ speedLimitMode: null }) });
    expect(tileValue('Speed Limit').textContent).toBe('—');
  });

  it('handles center-display state as boolean OR string — regression: a boolean must not degrade to "—"', () => {
    const { rerenderWith } = renderState({
      latest: makeEvent({ centerDisplay: true }),
    });
    // Regression pin: a boolean centerDisplay previously fell through
    // asNonEmptyString and rendered "—"; it must now mirror Speed Limit.
    expect(tileValue('Center Display').textContent).toBe('On');
    expect(tileValue('Center Display').className).toContain(ACTIVE_TONE);

    rerenderWith({ latest: makeEvent({ centerDisplay: false }) });
    expect(tileValue('Center Display').textContent).toBe('Off');
    expect(tileValue('Center Display').className).toContain(MUTED_TONE);

    rerenderWith({ latest: makeEvent({ centerDisplay: 'CenterDisplayModeOn' }) });
    expect(tileValue('Center Display').textContent).toBe('CenterDisplayModeOn');
    expect(tileValue('Center Display').className).toContain(ACTIVE_TONE);

    rerenderWith({ latest: makeEvent({ centerDisplay: 'CenterDisplayModeOff' }) });
    expect(tileValue('Center Display').className).toContain(MUTED_TONE);

    rerenderWith({ latest: makeEvent({ centerDisplay: null }) });
    expect(tileValue('Center Display').textContent).toBe('—');
  });

  it('renders every tile as a muted "—" placeholder for an all-null snapshot (never hides a section)', () => {
    renderState({ latest: makeEvent() });

    for (const label of LABELS) {
      expect(tileValue(label).textContent).toBe('—');
      expect(tileValue(label).className).toContain(MUTED_TONE);
    }
    // A blank-but-present snapshot still counts as "Live".
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('exposes the panel title as a level-3 heading and marks decorative icons aria-hidden (a11y)', () => {
    renderState({ latest: makeEvent({ lightsHazardsActive: true }) });

    expect(title()).toBeInTheDocument();

    // The tile's icon chip conveys no independent meaning → decorative.
    expect(tile('Hazards').querySelector('[aria-hidden="true"]')).not.toBeNull();

    // The pulsing live-badge dot is decorative; the word "Live" carries it.
    const badge = screen.getByText('Live');
    expect(badge.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('forwards a custom className onto the panel root', () => {
    const { container } = renderState({
      latest: makeEvent(),
      className: 'test-custom-class',
    });
    expect(container.querySelector('.test-custom-class')).not.toBeNull();
  });
});
