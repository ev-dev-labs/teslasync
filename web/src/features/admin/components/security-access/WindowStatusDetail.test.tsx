/**
 * WindowStatusDetail — per-window status panel contract.
 *
 * The panel renders a 2×2 grid (front/rear × driver/passenger) inside a titled
 * glass panel and owns its own loading / error / placeholder states so it never
 * gates the surrounding security bento. These tests pin:
 *   - the title shell (present in every branch),
 *   - the data branch (four tiles, each raw window value parsed to its display
 *     state + semantic tone, exposed as one labelled a11y group),
 *   - null-safety (boolean/null/empty typed values render "Unknown", never crash
 *     — the Phase-42a `signal.SignalValue` contract),
 *   - the parse→display wiring across Closed / Venting / Open variants,
 *   - the placeholder branch (four "Unknown" tiles when there is no event —
 *     the grid is never blanked),
 *   - the loading branch (aria-hidden four-cell skeleton grid, no tiles),
 *   - the error branch (QueryError alert, working Retry, optional onRetry),
 *   - branch precedence (error > loading > data),
 *   - className pass-through onto the GlassPanel.
 */
import { type ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

import { WindowStatusDetail } from './WindowStatusDetail';
import type { SecurityEvent } from '@/types/admin';

// QueryError reaches for the browser online-state; pin it to the online
// (network-error → role="alert") branch so the Retry button is enabled and
// assertions don't depend on the jsdom navigator default. Mirrors the
// convention used in SecurityStatistics.test.tsx / QueryError.test.tsx.
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

function makeEvent(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    id: 'evt-1',
    locked: true,
    sentryMode: 'SentryModeStateOff',
    doorState: 'ClosedAll',
    fdWindow: 'Closed',
    fpWindow: 'Closed',
    rdWindow: 'Closed',
    rpWindow: 'Closed',
    homelinkNearby: false,
    guestMode: false,
    homelinkDeviceCount: 0,
    guestModeMobileAccessState: null,
    driverSeatOccupied: false,
    centerDisplay: 'Off',
    speedLimitMode: false,
    valetModeEnabled: false,
    serviceMode: false,
    pairedPhoneKeyCount: 1,
    lightsHazardsActive: false,
    lightsHighBeams: false,
    lightsTurnSignal: null,
    driverSeatBelt: null,
    passengerSeatBelt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

type Props = ComponentProps<typeof WindowStatusDetail>;

function renderDetail(overrides: Partial<Props> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props: Props = {
    latest: makeEvent(),
    isLoading: false,
    error: null,
    ...overrides,
    onRetry,
  };
  const utils = render(
    <MemoryRouter>
      <WindowStatusDetail {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

const WINDOW_LABELS = ['Front Driver', 'Front Passenger', 'Rear Driver', 'Rear Passenger'];

// StatusTile renders exactly one <p> (the value) per tile when no description
// is passed, wrapped in an outer `.rounded-xl` container next to its label.
// Navigate label → tile → value node without coupling to the value text.
function tileFor(label: string): HTMLElement {
  const labelEl = screen.getByText(label);
  const tile = labelEl.closest('div.rounded-xl');
  if (!tile) throw new Error(`no StatusTile container for "${label}"`);
  return tile as HTMLElement;
}

function windowValueNode(label: string): HTMLElement {
  const node = tileFor(label).querySelector('p');
  if (!node) throw new Error(`no value node for "${label}"`);
  return node as HTMLElement;
}

function windowValueText(label: string): string {
  return windowValueNode(label).textContent ?? '';
}

// windowTone() → StatusTile value accent class. Pins the state → tone wiring.
const TONE_VALUE_CLASS: Record<string, string> = {
  green: 'text-emerald-300',
  red: 'text-rose-300',
  amber: 'text-amber-300',
  muted: 'text-[var(--text-secondary)]',
};

describe('WindowStatusDetail — data', () => {
  it('renders the title and all four windows parsed to their display states', () => {
    renderDetail({
      latest: makeEvent({
        fdWindow: 'Closed',
        fpWindow: 'Open',
        rdWindow: 'Vented',
        rpWindow: null,
      }),
    });

    expect(screen.getByText('Window Status Detail')).toBeInTheDocument();

    // Every physical position is labelled and rendered — none hidden.
    for (const label of WINDOW_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    expect(windowValueText('Front Driver')).toBe('Closed');
    expect(windowValueText('Front Passenger')).toBe('Open');
    expect(windowValueText('Rear Driver')).toBe('Venting');
    expect(windowValueText('Rear Passenger')).toBe('Unknown');
  });

  it('maps each parsed window state to its semantic tone accent', () => {
    renderDetail({
      latest: makeEvent({
        fdWindow: 'Closed',
        fpWindow: 'Open',
        rdWindow: 'Vented',
        rpWindow: false,
      }),
    });

    expect(windowValueNode('Front Driver').className).toContain(TONE_VALUE_CLASS.green);
    expect(windowValueNode('Front Passenger').className).toContain(TONE_VALUE_CLASS.red);
    expect(windowValueNode('Rear Driver').className).toContain(TONE_VALUE_CLASS.amber);
    expect(windowValueNode('Rear Passenger').className).toContain(TONE_VALUE_CLASS.muted);
  });

  it('exposes the four windows as one labelled group with no loading/error affordances', () => {
    const { container } = renderDetail();

    const group = screen.getByRole('group', { name: /window status by position/i });
    expect(group).toBeInTheDocument();
    for (const label of WINDOW_LABELS) {
      expect(within(group).getByText(label)).toBeInTheDocument();
    }
    // Data branch → no skeletons, no error alert.
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['Closed', 'Closed'],
    ['0', 'Closed'],
    ['Vented', 'Venting'],
    ['PartialVent', 'Venting'],
    ['Open', 'Open'],
    ['FullyOpen', 'Open'],
  ])('parses raw window value %p to the displayed state %p', (raw, shown) => {
    renderDetail({ latest: makeEvent({ fdWindow: raw }) });
    expect(windowValueText('Front Driver')).toBe(shown);
  });
});

describe('WindowStatusDetail — null-safety (Phase-42a typed values)', () => {
  it('renders "Unknown" for boolean/null/empty window values instead of crashing', () => {
    // The backend serializes raw signal.SignalValue, so a window field can
    // arrive as a native boolean or null. The `?.` + parseWindowState guard
    // must degrade to "Unknown", never throw "x.toLowerCase is not a fn".
    renderDetail({
      latest: makeEvent({
        fdWindow: false,
        fpWindow: null,
        rdWindow: true,
        rpWindow: '',
      }),
    });

    // Render succeeded → group present, no error boundary tripped.
    expect(screen.getByRole('group', { name: /window status by position/i })).toBeInTheDocument();
    for (const label of WINDOW_LABELS) {
      expect(windowValueText(label)).toBe('Unknown');
      expect(windowValueNode(label).className).toContain(TONE_VALUE_CLASS.muted);
    }
  });
});

describe('WindowStatusDetail — placeholder (no event)', () => {
  it('renders four Unknown placeholder tiles when latest is undefined (never blank)', () => {
    const { container } = renderDetail({ latest: undefined });

    expect(screen.getByText('Window Status Detail')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /window status by position/i })).toBeInTheDocument();
    for (const label of WINDOW_LABELS) {
      expect(windowValueText(label)).toBe('Unknown');
    }
    // Placeholder is not a loading or error state.
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('WindowStatusDetail — loading', () => {
  it('renders an aria-hidden four-cell skeleton grid and no tiles', () => {
    const { container } = renderDetail({ isLoading: true, latest: undefined });

    // Title still anchors the panel while loading.
    expect(screen.getByText('Window Status Detail')).toBeInTheDocument();

    const skeletonGrid = container.querySelector('[aria-hidden="true"]');
    expect(skeletonGrid).not.toBeNull();
    expect(container.querySelectorAll('.animate-pulse').length).toBe(4);

    // Neither the window group nor its tiles may render yet.
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByText('Front Driver')).toBeNull();
  });

  it('prioritises the skeleton over stale event data when both are present', () => {
    const { container } = renderDetail({
      isLoading: true,
      latest: makeEvent({ fdWindow: 'Open' }),
    });

    expect(container.querySelectorAll('.animate-pulse').length).toBe(4);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByText('Front Driver')).toBeNull();
  });
});

describe('WindowStatusDetail — error', () => {
  it('renders a QueryError alert with a Retry that invokes onRetry', () => {
    const { onRetry } = renderDetail({ error: new Error('boom') });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The window group and skeletons must not render.
    expect(screen.queryByRole('group')).toBeNull();
    expect(document.querySelector('.animate-pulse')).toBeNull();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('prioritises the error over the loading skeleton', () => {
    const { container } = renderDetail({
      error: new Error('down'),
      isLoading: true,
      latest: makeEvent(),
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBe(0);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('renders the network error copy without a Retry button when onRetry is omitted', () => {
    render(
      <MemoryRouter>
        <WindowStatusDetail latest={undefined} isLoading={false} error={new Error('offline')} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});

describe('WindowStatusDetail — styling', () => {
  it('forwards className onto the GlassPanel shell and keeps base padding', () => {
    const { container } = renderDetail({ className: 'xl:col-span-2' });

    const panel = container.querySelector('[data-print-card]');
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain('xl:col-span-2');
    // The default padding classes remain applied alongside the override.
    expect(panel?.className).toContain('p-4');
  });
});
