/**
 * EventHistoryTable contract.
 *
 * The security-event history panel wraps a shared <DataTable> with five
 * columns (Time / Lock / Sentry / Doors / Windows) and the three data-source
 * states every panel owes the user: error, loading, and empty. This suite
 * pins the behaviour that matters and guards the bugs the hardening pass fixed:
 *
 *   1. Structure — panel title + all five column headers + a data row render.
 *   2. Sentry classification — `sentryMode` arrives as a string enum, so the
 *      non-empty "SentryModeStateOff" must be labelled "Off". A naive
 *      truthiness check (`row.sentryMode ? …`) would mislabel it "On"; the fix
 *      routes through `isSentryActive()`. This is the headline regression pin.
 *   3. Door / window branches — closed states render emerald + a translated
 *      label; open states render amber + the raw enum / an interpolated count.
 *   4. Empty + null-safety — `[]` and an (untyped-at-runtime) `undefined`
 *      history both render the empty message instead of crashing on `.map`.
 *   5. Loading — the skeleton shows and the table does not.
 *   6. Error precedence — an error wins over a concurrent loading flag; the
 *      QueryError banner shows and the Retry CTA invokes `onRetry`.
 *   7. Sortable "Time" header — previously a dead affordance (no sort wiring).
 *      Clicking it now sorts chronologically and reflects `aria-sort`.
 *
 * react-i18next is mocked (mirroring SecurityAccessPage.test) so fallback
 * strings + `{{count}}` interpolation render deterministically. <TimeStamp> is
 * stubbed to its raw value so row ORDER is assertable without pulling in the
 * settings/timezone query stack it depends on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SecurityEvent } from '@/types/admin';

/* ── i18n: return the English fallback, interpolating {{vars}}. ────── */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, second?: unknown, third?: unknown) => {
      const interpolate = (tpl: string, vars?: Record<string, unknown>) => {
        if (!vars) return tpl;
        let out = tpl;
        for (const [k, v] of Object.entries(vars)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
        return out;
      };
      if (typeof second === 'string') {
        return interpolate(
          second,
          third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined,
        );
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

/* ── TimeStamp: render the raw value so row order is assertable. ───── */
vi.mock('@/components/data-display', () => ({
  TimeStamp: ({ value, className }: { value: unknown; className?: string }) => (
    <span data-testid="ts" className={className}>
      {String(value)}
    </span>
  ),
}));

import { EventHistoryTable } from './EventHistoryTable';

/* ── Fixtures ─────────────────────────────────────────────────────── */

// A fully-populated, "secure" event: locked, sentry off, all doors + windows
// closed. Individual tests override only the fields under test.
function makeEvent(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    id: 'e1',
    locked: true,
    sentryMode: false,
    doorState: false,
    fdWindow: 'Closed',
    fpWindow: 'Closed',
    rdWindow: 'Closed',
    rpWindow: 'Closed',
    homelinkNearby: false,
    guestMode: false,
    homelinkDeviceCount: 0,
    guestModeMobileAccessState: null,
    driverSeatOccupied: false,
    centerDisplay: false,
    speedLimitMode: false,
    valetModeEnabled: false,
    serviceMode: false,
    pairedPhoneKeyCount: 0,
    lightsHazardsActive: false,
    lightsHighBeams: false,
    lightsTurnSignal: null,
    driverSeatBelt: null,
    passengerSeatBelt: null,
    createdAt: '2020-01-01T00:00:00Z',
    ...overrides,
  };
}

interface RenderProps {
  history?: SecurityEvent[];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

function renderTable({ history = [], isLoading = false, error = null, onRetry }: RenderProps = {}) {
  return render(
    <MemoryRouter>
      <EventHistoryTable history={history} isLoading={isLoading} error={error} onRetry={onRetry} />
    </MemoryRouter>,
  );
}

const rowTimes = () => screen.getAllByTestId('ts').map((el) => el.textContent);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

/* ── Tests ────────────────────────────────────────────────────────── */

describe('EventHistoryTable — structure', () => {
  it('renders the panel title, all five column headers, and a data row', () => {
    renderTable({ history: [makeEvent({ locked: true, sentryMode: true })] });

    expect(screen.getByText('Security Event History')).toBeInTheDocument();

    // Every column header is present (Time is a sortable button, the rest spans).
    expect(screen.getByRole('button', { name: 'Time' })).toBeInTheDocument();
    for (const header of ['Lock', 'Sentry', 'Doors', 'Windows']) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }

    // The row renders through the real DataTable (a <table> landmark).
    expect(screen.getByRole('table')).toBeInTheDocument();
    // locked=true + sentryMode=true → the positive labels.
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
  });

  it('labels an unlocked event "Unlocked" and a disarmed event "Off"', () => {
    renderTable({ history: [makeEvent({ locked: false, sentryMode: false })] });

    expect(screen.getByText('Unlocked')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.queryByText('Locked')).toBeNull();
    expect(screen.queryByText('On')).toBeNull();
  });
});

describe('EventHistoryTable — sentry string-enum classification (regression)', () => {
  it('treats the non-empty "SentryModeStateOff" enum as Off, not a truthy On', () => {
    // The bug: `row.sentryMode ? 'On' : 'Off'` sees a truthy string and prints
    // "On" for a disarmed vehicle. isSentryActive() must classify it as Off.
    renderTable({ history: [makeEvent({ sentryMode: 'SentryModeStateOff' })] });

    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.queryByText('On')).toBeNull();
  });

  it('treats an armed enum string as On', () => {
    renderTable({ history: [makeEvent({ sentryMode: 'SentryModeStateArmed' })] });

    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.queryByText('Off')).toBeNull();
  });
});

describe('EventHistoryTable — door + window branches', () => {
  it('renders a secure event with emerald "Closed" door and "All Closed" windows', () => {
    renderTable({ history: [makeEvent()] });

    const door = screen.getByText('Closed', { exact: true });
    expect(door.className).toContain('text-emerald-300');

    const windows = screen.getByText('All Closed');
    expect(windows.className).toContain('text-emerald-300');
  });

  it('renders an open door (raw enum) and an interpolated window count in amber', () => {
    renderTable({
      history: [makeEvent({ doorState: 'DriverFrontOpen', fdWindow: 'Open' })],
    });

    const door = screen.getByText('DriverFrontOpen');
    expect(door.className).toContain('text-amber-300');

    // 3 closed + 1 open → windowSummary interpolates "1 Open/Venting".
    const windows = screen.getByText('1 Open/Venting');
    expect(windows.className).toContain('text-amber-300');
  });
});

describe('EventHistoryTable — empty + null safety', () => {
  it('shows the empty message for an explicitly empty history', () => {
    renderTable({ history: [] });

    expect(screen.getByText('No security events recorded yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('ts')).toBeNull();
  });

  it('does not crash and shows the empty message when history is undefined', () => {
    // The prop is typed non-null, but the untyped API can transiently omit it.
    // A missing `?? []` guard would throw inside DataTable's `data.map`.
    expect(() =>
      renderTable({ history: undefined as unknown as SecurityEvent[] }),
    ).not.toThrow();
    expect(screen.getByText('No security events recorded yet.')).toBeInTheDocument();
  });
});

describe('EventHistoryTable — loading + error states', () => {
  it('renders the skeleton (not the table) while loading', () => {
    const { container } = renderTable({ history: [], isLoading: true });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    // The panel chrome is still present so the surface never goes blank.
    expect(screen.getByText('Security Event History')).toBeInTheDocument();
  });

  it('an error wins over a concurrent loading flag and suppresses the table + skeleton', () => {
    const { container } = renderTable({
      history: [makeEvent()],
      isLoading: true,
      error: new Error('boom'),
    });

    // QueryError's network branch (jsdom is "online" → not-found/5xx skipped).
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('invokes onRetry when the error banner Retry button is clicked', () => {
    const onRetry = vi.fn();
    renderTable({ history: [], error: new Error('down'), onRetry });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('EventHistoryTable — sortable Time column', () => {
  const older = makeEvent({ id: 'old', createdAt: '2020-01-01T00:00:00Z' });
  const newer = makeEvent({ id: 'new', createdAt: '2021-06-15T00:00:00Z' });

  it('preserves the supplied order until the header is clicked, then sorts by time', () => {
    const { container } = renderTable({ history: [older, newer] });

    // No active sort key → order matches what the parent supplied.
    expect(rowTimes()).toEqual(['2020-01-01T00:00:00Z', '2021-06-15T00:00:00Z']);
    const th = container.querySelector('th[data-column-key="createdAt"]');
    expect(th?.getAttribute('aria-sort')).toBeNull();

    // First click → descending (newest first) + aria-sort reflects it.
    fireEvent.click(screen.getByRole('button', { name: 'Time' }));
    expect(rowTimes()).toEqual(['2021-06-15T00:00:00Z', '2020-01-01T00:00:00Z']);
    expect(th?.getAttribute('aria-sort')).toBe('descending');

    // Second click toggles ascending.
    fireEvent.click(screen.getByRole('button', { name: 'Time' }));
    expect(rowTimes()).toEqual(['2020-01-01T00:00:00Z', '2021-06-15T00:00:00Z']);
    expect(th?.getAttribute('aria-sort')).toBe('ascending');
  });
});
