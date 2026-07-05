/**
 * SecurityStatusCards contract tests.
 *
 * SecurityStatusCards is a pure, prop-driven presentational panel that selects
 * exactly one of four mutually-exclusive states — error / loading / empty /
 * data — and always renders its "Security Status" panel title. When data is
 * present it renders six always-visible status tiles (lock, sentry, doors,
 * windows, homelink, guest), each conveying state via icon + text. These tests
 * pin:
 *
 *  1. The panel title heading renders in EVERY state (never a headless panel).
 *  2. Each branch renders its expected child and nothing from the others.
 *  3. Branch PRIORITY: error > (loading && !latest) > empty > data. A
 *     background refetch (isLoading && latest) keeps showing the tiles rather
 *     than flashing back to skeletons.
 *  4. The loading branch is an accessible live region (role="status" +
 *     aria-busy) with six skeleton placeholders.
 *  5. onRetry is forwarded to <QueryError> and fires on click.
 *  6. Every tile's value reflects the SecurityEvent it is given, across the
 *     locked / unlocked / unknown, sentry, door, window, homelink and guest
 *     variants — including the null-safety fix that renders an *unknown* lock
 *     state as "Unknown" instead of a false red "Unlocked" alarm.
 *  7. className is forwarded to the underlying GlassPanel.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        // t(key, defaultStr, opts) signature — return the default, with
        // {{token}} interpolation when options are supplied.
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>;
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            );
          }
          return fallbackOrOpts;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { SecurityStatusCards } from './SecurityStatusCards';
import type { SecurityEvent } from '@/types/admin';

function makeEvent(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    id: 'evt-1',
    locked: true,
    sentryMode: 'SentryModeStateOff',
    doorState: 'Closed',
    fdWindow: 'Closed',
    fpWindow: 'Closed',
    rdWindow: 'Closed',
    rpWindow: 'Closed',
    homelinkNearby: false,
    guestMode: false,
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
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

type Props = Parameters<typeof SecurityStatusCards>[0];

function renderCards(overrides: Partial<Props> = {}) {
  const props: Props = {
    latest: makeEvent(),
    isLoading: false,
    error: null,
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <SecurityStatusCards {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

const TILE_LABELS = ['Lock Status', 'Sentry Mode', 'Doors', 'Windows', 'HomeLink', 'Guest Mode'];

describe('SecurityStatusCards', () => {
  it('renders the "Security Status" panel title heading in every state', () => {
    const states: Partial<Props>[] = [
      { latest: makeEvent() }, // data
      { latest: undefined, isLoading: true }, // loading
      { latest: undefined, isLoading: false }, // empty
      { latest: undefined, error: new Error('x') }, // error
    ];
    for (const s of states) {
      const { unmount } = renderCards(s);
      expect(
        screen.getByRole('heading', { name: /security status/i }),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it('renders an accessible loading region (role=status + aria-busy) with six skeletons and no data when loading without data', () => {
    renderCards({ latest: undefined, isLoading: true });

    const region = screen.getByRole('status', { name: /loading/i });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-busy', 'true');
    // Six skeleton placeholders — one per tile the grid will eventually show.
    expect(region.querySelectorAll('.animate-pulse')).toHaveLength(6);
    // Neither the empty message nor the tiles render while loading.
    expect(
      screen.queryByText(/no security state available/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Lock Status')).not.toBeInTheDocument();
  });

  it('renders the empty state (no tiles) when there is no data, no loading and no error', () => {
    renderCards({ latest: undefined, isLoading: false, error: null });

    expect(
      screen.getByText(/no security state available for this vehicle yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Lock Status')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: /loading/i }),
    ).not.toBeInTheDocument();
  });

  it('renders <QueryError> and forwards onRetry, firing it on click; no tiles render', () => {
    const onRetry = vi.fn();
    renderCards({ error: new Error('boom'), onRetry, latest: undefined });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Lock Status')).not.toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders all six status tiles with their labels and secure default values', () => {
    renderCards({ latest: makeEvent() });

    for (const label of TILE_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument(); // doors
    expect(screen.getByText('All Closed')).toBeInTheDocument(); // windows
    expect(screen.getByText('Away')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('shows "Unlocked" when locked is false', () => {
    renderCards({ latest: makeEvent({ locked: false }) });

    expect(screen.getByText('Unlocked')).toBeInTheDocument();
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
  });

  it('treats a null lock state as "Unknown" rather than a false "Unlocked" alarm', () => {
    renderCards({ latest: makeEvent({ locked: null }) });

    // The lock tile must degrade to an unknown/neutral state — reporting a
    // car with no lock signal as red "Unlocked" would be a false alarm.
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('Unlocked')).not.toBeInTheDocument();
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
  });

  it('shows sentry "Active" when sentryMode is an armed enum', () => {
    renderCards({ latest: makeEvent({ sentryMode: 'SentryModeStateArmed' }) });

    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
  });

  it('shows the raw door label when a door is open (string doorState)', () => {
    renderCards({ latest: makeEvent({ doorState: 'OpenDriverFront' }) });

    expect(screen.getByText('OpenDriverFront')).toBeInTheDocument();
    expect(screen.queryByText('Closed')).not.toBeInTheDocument();
  });

  it('falls back to "Open" when doorState is a non-string truthy value', () => {
    // A boolean `true` must NOT be coerced to a string — the tile shows the
    // generic "Open" fallback instead of crashing or printing "true".
    renderCards({ latest: makeEvent({ doorState: true }) });

    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('summarises open/venting windows as a count', () => {
    renderCards({ latest: makeEvent({ fdWindow: 'Open', rpWindow: 'Vented' }) });

    expect(screen.getByText('2 Open/Venting')).toBeInTheDocument();
    expect(screen.queryByText('All Closed')).not.toBeInTheDocument();
  });

  it('reflects homelink-nearby and guest-mode-enabled states', () => {
    renderCards({ latest: makeEvent({ homelinkNearby: true, guestMode: true }) });

    expect(screen.getByText('Nearby')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.queryByText('Away')).not.toBeInTheDocument();
    expect(screen.queryByText('Disabled')).not.toBeInTheDocument();
  });

  it('prioritises the error state over loading and data (error wins)', () => {
    renderCards({ error: new Error('down'), isLoading: true, latest: makeEvent() });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: /loading/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Lock Status')).not.toBeInTheDocument();
  });

  it('keeps showing the tiles during a background refetch (isLoading && latest → tiles, not skeletons)', () => {
    renderCards({ isLoading: true, latest: makeEvent(), error: null });

    expect(screen.getByText('Lock Status')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: /loading/i }),
    ).not.toBeInTheDocument();
  });

  it('forwards className to the underlying GlassPanel', () => {
    const { container } = renderCards({ className: 'xl:col-span-2' });

    const panel = container.querySelector('[data-print-card]');
    expect(panel).not.toBeNull();
    expect(panel).toHaveClass('xl:col-span-2');
  });
});
