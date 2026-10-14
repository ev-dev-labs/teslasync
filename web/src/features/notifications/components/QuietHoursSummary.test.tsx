/**
 * QuietHoursSummary contract tests.
 *
 * QuietHoursSummary is a presentational KPI band: it receives a TanStack
 * `UseQueryResult<QuietHoursWindow[]>` as a prop and never fetches itself, so
 * the tests drive it with hand-built query objects rather than mocking the
 * network. The interesting logic is the client-side schedule evaluation
 * (`isWindowActiveNow`), which is exercised through the rendered "Right now"
 * card with a frozen clock (`vi.setSystemTime`). Coverage:
 *   1. First-load skeleton grid (4 cards) inside the labelled region, no KPIs.
 *   2. Background refetch with cached windows keeps the KPIs on screen
 *      (firstLoad guard) rather than flashing an empty skeleton over them.
 *   3. Error branch renders a QueryError alert; Retry calls refetch().
 *   4. Empty / idle input renders the band as zeros — never a blank panel and
 *      never a redundant empty-state (the adjacent panel owns the CTA).
 *   5. Active-now evaluation: same-day window in range → "Quiet" with the live
 *      count; enabled ratio; bypass severities deduped and collected from
 *      enabled windows only.
 *   6. A window whose time has not started → "Delivering" / "No window active".
 *   7. Cross-midnight crediting: the after-midnight leg is credited to the
 *      previous day's weekday bit, and a today-only mask is NOT enough.
 *   8. Null-safety: weekday mask of 0 gates out; malformed or incomplete
 *      enabled schedules remain unknown rather than claiming delivery.
 *   9. a11y: labelled landmark region, decorative (aria-hidden) icons, and the
 *      status stated in words (not colour alone).
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import '../../../i18n';

import { QuietHoursSummary } from './QuietHoursSummary';
import type { QuietHoursWindow } from '@/api/types';

const translations = vi.hoisted(() => ({ labels: {} as Record<string, string> }));
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      let text = translations.labels[key]
        ?? (typeof fallback === 'string' ? fallback : String(fallback?.defaultValue ?? key));
      for (const [name, value] of Object.entries(options ?? (typeof fallback === 'object' ? fallback : {}))) {
        text = text.replaceAll(`{{${name}}}`, String(value));
      }
      return text;
    },
    i18n: { language: 'en' },
  }),
}));

let winId = 1;
function makeWindow(overrides: Partial<QuietHoursWindow> = {}): QuietHoursWindow {
  return {
    id: winId++,
    user_id: 'u1',
    enabled: true,
    start_local: '09:00',
    end_local: '17:00',
    timezone: 'UTC',
    weekdays: 0b1111111, // every day
    bypass_severities: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeQuery(
  overrides: Partial<UseQueryResult<QuietHoursWindow[], Error>> = {},
): UseQueryResult<QuietHoursWindow[], Error> {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    isSuccess: false,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as UseQueryResult<QuietHoursWindow[], Error>;
}

function renderSummary(query: UseQueryResult<QuietHoursWindow[], Error>) {
  return render(
    <MemoryRouter>
      <QuietHoursSummary query={query} />
    </MemoryRouter>,
  );
}

function getRegion() {
  return screen.getByRole('region', { name: /quiet hours summary/i });
}

// The real canonical tile owns its labelled value; do not depend on old card siblings.
function cardValue(label: string): string {
  const tile = screen.getByText(label).closest('[data-operational-metric]');
  expect(tile).not.toBeNull();
  return tile?.querySelector('[data-operational-value]')?.textContent ?? '';
}

// Schedules explicitly use UTC unless a test supplies another IANA zone.
function freeze(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso.endsWith('Z') ? iso : `${iso}Z`));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  translations.labels = {};
});

describe('QuietHoursSummary — loading & error states', () => {
  it('renders a four-card skeleton grid inside the labelled region on first load', () => {
    renderSummary(makeQuery({ isLoading: true, isPending: true, isFetching: true }));

    expect(getRegion()).toBeInTheDocument();
    const skeleton = screen.getByTestId('stat-grid-skeleton');
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
    expect(skeleton).toHaveAttribute('role', 'status');
    expect(skeleton).toHaveAttribute('aria-label', 'Loading stat cards');
    expect(getRegion()).toContainElement(skeleton);
    const cards = skeleton.querySelectorAll('[aria-hidden="true"][class~="bg-[var(--skeleton-bg)]"]');
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card).toHaveClass('h-24', 'w-full', 'rounded-xl');
    }
    // No KPI cards while first-loading.
    expect(screen.queryByText('Windows')).not.toBeInTheDocument();
  });

  it('keeps the KPI cards on screen during a background refetch that has data', () => {
    // isLoading true *with* cached windows must NOT flash the skeleton — the
    // firstLoad guard keeps the band populated.
    renderSummary(
      makeQuery({
        isLoading: true,
        isFetching: true,
        data: [makeWindow(), makeWindow({ enabled: false })],
      }),
    );

    expect(cardValue('Windows')).toBe('2');
    expect(cardValue('Enabled')).toBe('1/2');
    expect(screen.queryByTestId('stat-grid-skeleton')).not.toBeInTheDocument();
  });

  it('retains cached windows after a refresh failure, including an authoritative empty schedule', () => {
    const refetch = vi.fn();
    const { container } = renderSummary(makeQuery({
      data: [], isError: true, error: new Error('refresh failed'), refetch,
    }));
    expect(container.querySelector('[data-operational-brief]')).toBeInTheDocument();
    expect(screen.getByText('Data may be stale')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(cardValue('Windows')).toBe('0');
    expect(cardValue('Enabled')).toBe('—');
    expect(cardValue('Right now')).toBe('Delivering');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('renders a QueryError alert and retries on demand when the query fails', () => {
    const refetch = vi.fn();
    renderSummary(makeQuery({ isError: true, error: new Error('boom'), refetch }));

    expect(getRegion()).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Error branch replaces the KPI cards entirely.
    expect(screen.queryByText('Windows')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('QuietHoursSummary — empty & idle (zeros, never blank)', () => {
  it('renders the band as zeros — not an empty-state — when no windows exist', () => {
    renderSummary(makeQuery({ isSuccess: true, data: [] }));

    // Band stays visible with real zeros rather than a blank/CTA panel.
    expect(getRegion()).toBeInTheDocument();
    expect(cardValue('Windows')).toBe('0');
    expect(cardValue('Enabled')).toBe('—');
    expect(cardValue('Right now')).toBe('Delivering');
    expect(screen.getByText('No window active now')).toBeInTheDocument();
    expect(cardValue('Always allowed')).toBe('—');
    expect(screen.getByText('No configured windows')).toBeInTheDocument();
    expect(screen.getByText('No bypass severities configured')).toBeInTheDocument();
    // Not loading → no skeleton either.
    expect(screen.queryByTestId('stat-grid-skeleton')).not.toBeInTheDocument();
  });

  it('keeps an idle query with undefined data unknown, not empty', () => {
    renderSummary(makeQuery());

    expect(getRegion()).toBeInTheDocument();
    expect(cardValue('Windows')).toBe('—');
    expect(cardValue('Right now')).toBe('Unknown');
    expect(screen.queryByText('No schedules')).not.toBeInTheDocument();
    expect(screen.queryByText('No window active now')).not.toBeInTheDocument();
  });
});

describe('QuietHoursSummary — active-now status (schedule evaluation)', () => {
  it('reports "Quiet" with the live count, enabled ratio and deduped bypass list', () => {
    freeze('2026-03-04T14:30:00'); // inside 09:00–17:00, weekday irrelevant (mask=all)
    renderSummary(
      makeQuery({
        isSuccess: true,
        data: [
          makeWindow({ bypass_severities: ['critical'] }), // active + enabled
          makeWindow({ bypass_severities: ['critical', 'warning'] }), // active + enabled
          // Disabled window: excluded from enabled count, active count AND the
          // bypass roll-up (its severities must not leak through).
          makeWindow({ enabled: false, bypass_severities: ['emergency'] }),
        ],
      }),
    );

    expect(cardValue('Windows')).toBe('3');
    expect(cardValue('Enabled')).toBe('2/3');
    expect(screen.getByText('Configured schedules')).toBeInTheDocument();
    expect(screen.getByText('Active on schedule')).toBeInTheDocument();
    expect(screen.getByText('Severities that break through')).toBeInTheDocument();
    expect(cardValue('Right now')).toBe('Quiet');
    expect(screen.getByText('2 window active now')).toBeInTheDocument();
    // Deduped, enabled-only union — "emergency" (disabled) is absent.
    expect(cardValue('Always allowed')).toBe('Critical, warning');
    expect(cardValue('Always allowed')).not.toContain('emergency');
  });

  it('reports "Delivering" when the current time is before the window starts', () => {
    freeze('2026-03-04T08:00:00'); // before 09:00
    renderSummary(makeQuery({ isSuccess: true, data: [makeWindow()] }));

    expect(cardValue('Windows')).toBe('1');
    expect(cardValue('Enabled')).toBe('1/1');
    expect(cardValue('Right now')).toBe('Delivering');
    expect(screen.getByText('No window active now')).toBeInTheDocument();
  });

  it('credits the post-midnight leg of a cross-midnight window to the previous day', () => {
    freeze('2026-03-04T02:00:00'); // 02:00, inside the tail of a 22:00–06:00 window
    const today = new Date().getUTCDay();
    const yesterday = (today + 6) % 7;

    renderSummary(
      makeQuery({
        isSuccess: true,
        data: [
          // Credited to yesterday's bit → active at 02:00.
          makeWindow({ start_local: '22:00', end_local: '06:00', weekdays: 1 << yesterday }),
          // Today-only mask is NOT enough for the after-midnight leg → inactive.
          makeWindow({ start_local: '22:00', end_local: '06:00', weekdays: 1 << today }),
        ],
      }),
    );

    expect(cardValue('Right now')).toBe('Quiet');
    expect(screen.getByText('1 window active now')).toBeInTheDocument();
    expect(cardValue('Windows')).toBe('2');
  });
});

describe('QuietHoursSummary — null-safety & weekday gating', () => {
  it('gates on the weekday mask and survives invalid/undefined schedule fields', () => {
    freeze('2026-03-04T14:30:00'); // time is inside 09:00–17:00 for every window below
    renderSummary(
      makeQuery({
        isSuccess: true,
        data: [
          // In range by time, but no weekday is enabled → inactive.
          makeWindow({ weekdays: 0 }),
          // Malformed start time is unknown, not inactive.
          makeWindow({ start_local: '99:99' }),
          // Missing fields (as the loose API shape can produce) must not throw.
          makeWindow({
            start_local: undefined as unknown as string,
            weekdays: undefined as unknown as number,
            bypass_severities: undefined as unknown as string[],
          }),
        ],
      }),
    );

    expect(cardValue('Windows')).toBe('3');
    expect(cardValue('Enabled')).toBe('3/3');
    expect(cardValue('Right now')).toBe('Unknown');
    expect(screen.getByText('Partial data')).toBeInTheDocument();
    expect(screen.queryByText('No window active now')).not.toBeInTheDocument();
    // No enabled bypass severities anywhere → em-dash placeholder.
    expect(cardValue('Always allowed')).toBe('—');
  });
});

describe('QuietHoursSummary — accessibility', () => {
  it('exposes a labelled region, decorative icons, and states status in words', () => {
    freeze('2026-03-04T14:30:00');
    const { container } = renderSummary(
      makeQuery({ isSuccess: true, data: [makeWindow()] }),
    );

    expect(getRegion()).toHaveAttribute('aria-label', 'Quiet hours summary');
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    // Card icons are purely decorative — hidden from the a11y tree so the
    // metric label + value carry the meaning.
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0);
    // Status is legible without colour: it renders a word, not just a hue.
    expect(cardValue('Right now')).toMatch(/^(Quiet|Delivering)$/);
  });

  it('reviews configured schedule fractions and complete policy captions in the shared drawer', () => {
    freeze('2026-03-04T14:30:00');
    renderSummary(makeQuery({ data: [makeWindow({ bypass_severities: ['critical'] })], isSuccess: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('1/1');
    expect(drawer).toHaveTextContent('Configured schedules');
    expect(drawer).toHaveTextContent('Active on schedule');
    expect(drawer).toHaveTextContent('1 window active now');
    expect(drawer).toHaveTextContent('Severities that break through');
    expect(drawer).toHaveTextContent('Critical');
  });
});

describe('QuietHoursSummary — configured zone and clock', () => {
  it.each([
    ['2026-10-14T16:30:00Z', 'America/Los_Angeles', '09:00', '10:00', 127, 'Quiet'],
    ['2026-10-14T00:30:00Z', 'America/Los_Angeles', '17:00', '18:00', 1 << 2, 'Quiet'],
    ['2026-10-14T17:00:00Z', 'America/Los_Angeles', '09:00', '10:00', 127, 'Delivering'],
    ['2026-10-14T09:00:00Z', 'America/Los_Angeles', '22:00', '06:00', 1 << 2, 'Quiet'],
    ['2026-10-14T09:00:00Z', 'America/Los_Angeles', '22:00', '06:00', 1 << 3, 'Delivering'],
    ['2026-10-14T15:00:00Z', 'Asia/Tokyo', '00:00', '01:00', 1 << 4, 'Quiet'],
    ['2026-03-08T09:30:00Z', 'America/Los_Angeles', '01:00', '03:00', 127, 'Quiet'],
    ['2026-03-08T10:00:00Z', 'America/Los_Angeles', '01:00', '03:00', 127, 'Delivering'],
    ['2026-11-01T08:30:00Z', 'America/Los_Angeles', '01:00', '02:00', 127, 'Quiet'],
    ['2026-11-01T09:30:00Z', 'America/Los_Angeles', '01:00', '02:00', 127, 'Quiet'],
  ])('evaluates %s in %s with the configured weekday and boundary', (
    instant, timezone, start_local, end_local, weekdays, expected,
  ) => {
    freeze(instant);
    renderSummary(makeQuery({ data: [makeWindow({ timezone, start_local, end_local, weekdays })] }));
    expect(cardValue('Right now')).toBe(expected);
  });

  it('updates at minute boundaries without replacing the query or shared windows, and disposes its timer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T08:59:30Z'));
    const data = [makeWindow({ start_local: '09:00', end_local: '09:01' })];
    const query = makeQuery({ data, isSuccess: true });
    const timersBefore = vi.getTimerCount();
    const view = renderSummary(query);
    expect(cardValue('Right now')).toBe('Delivering');
    act(() => vi.advanceTimersByTime(30_000));
    expect(cardValue('Right now')).toBe('Quiet');
    act(() => vi.advanceTimersByTime(60_000));
    expect(cardValue('Right now')).toBe('Delivering');
    expect(query.data).toBe(data);
    view.unmount();
    expect(vi.getTimerCount()).toBe(timersBefore);
  });

  it.each(['focus', 'visibilitychange'])('reevaluates on %s after a suspended clock', event => {
    freeze('2026-03-04T09:59:00Z');
    const view = renderSummary(makeQuery({ data: [makeWindow({ end_local: '10:00' })] }));
    expect(cardValue('Right now')).toBe('Quiet');
    vi.setSystemTime(new Date('2026-03-04T10:01:00Z'));
    fireEvent(event === 'focus' ? window : document, new Event(event));
    expect(cardValue('Right now')).toBe('Delivering');
    view.unmount();
    vi.setSystemTime(new Date('2026-03-04T11:00:00Z'));
    fireEvent(event === 'focus' ? window : document, new Event(event));
  });
});

describe('QuietHoursSummary — unresolved and incomplete policy', () => {
  it('keeps four unknown metrics for an initial paused query without claiming an empty policy', () => {
    const { container } = renderSummary(makeQuery({
      isPending: true, fetchStatus: 'paused', isLoading: false,
    }));
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(cardValue('Windows')).toBe('—');
    expect(cardValue('Enabled')).toBe('—');
    expect(cardValue('Right now')).toBe('Unknown');
    expect(cardValue('Always allowed')).toBe('—');
    expect(screen.getAllByText('Refresh paused').length).toBeGreaterThan(0);
    expect(screen.queryByText('No schedules')).not.toBeInTheDocument();
    expect(screen.queryByText('No window active now')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stat-grid-skeleton')).not.toBeInTheDocument();
  });

  it('retains an authoritative empty policy while its refresh is paused', () => {
    renderSummary(makeQuery({ data: [], fetchStatus: 'paused', isPending: false }));
    expect(cardValue('Windows')).toBe('0');
    expect(cardValue('Right now')).toBe('Delivering');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });

  it.each([
    { start_local: '99:99' }, { end_local: '24:00' },
    { start_local: '09:00', end_local: '09:00' },
    { timezone: 'Not/AZone' }, { timezone: '' },
    { weekdays: -1 }, { weekdays: 128 }, { weekdays: 1.5 },
  ])('does not classify malformed schedule %j as inactive', overrides => {
    freeze('2026-03-04T14:30:00Z');
    renderSummary(makeQuery({ data: [makeWindow(overrides)] }));
    expect(cardValue('Right now')).toBe('Unknown');
    expect(screen.getByText('Partial data')).toBeInTheDocument();
    expect(screen.queryByText('No window active now')).not.toBeInTheDocument();
  });

  it.each(['start_local', 'end_local', 'timezone', 'weekdays', 'enabled'])(
    'keeps a schedule with missing %s unknown without changing its raw fields', field => {
      freeze('2026-03-04T14:30:00Z');
      const window = makeWindow();
      Reflect.deleteProperty(window, field);
      renderSummary(makeQuery({ data: [window] }));
      expect(cardValue('Right now')).toBe('Unknown');
      expect(screen.getByText('Partial data')).toBeInTheDocument();
      expect(Object.hasOwn(window, field)).toBe(false);
      if (field === 'enabled') expect(cardValue('Enabled')).toBe('—');
    },
  );

  it('keeps known active windows visible with a partial warning for an unknown companion', () => {
    freeze('2026-03-04T14:30:00Z');
    renderSummary(makeQuery({ data: [makeWindow(), makeWindow({ timezone: 'Not/AZone' })] }));
    expect(cardValue('Right now')).toBe('Quiet');
    expect(screen.getByText('1 window active now')).toBeInTheDocument();
    expect(screen.getByText('Partial data')).toBeInTheDocument();
  });

  it('preserves known inactivity for a zero mask and disabled malformed windows', () => {
    freeze('2026-03-04T14:30:00Z');
    renderSummary(makeQuery({ data: [
      makeWindow({ weekdays: 0 }),
      makeWindow({ enabled: false, start_local: '99:99', timezone: 'Not/AZone' }),
    ] }));
    expect(cardValue('Right now')).toBe('Delivering');
    expect(screen.queryByText('Partial data')).not.toBeInTheDocument();
  });

  it('localizes recognized severity IDs, deduplicates them, and preserves unknown identifiers and raw input', () => {
    freeze('2026-03-04T14:30:00Z');
    const key = 'quietHours.severity.critical';
    translations.labels[key] = 'Critique';
    const data = [
      makeWindow({ bypass_severities: ['critical', 'warn', 'info', 'vendor-level'] }),
      makeWindow({ bypass_severities: ['critical'] }),
    ];
    renderSummary(makeQuery({ data }));
    expect(cardValue('Always allowed')).toBe('Critique, Warning, Info, vendor-level');
    expect(data[0].bypass_severities).toEqual(['critical', 'warn', 'info', 'vendor-level']);
  });
});
