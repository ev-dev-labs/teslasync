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
 *   8. Null-safety: weekday mask of 0 gates out, invalid `HH:MM` parses to
 *      inactive, and undefined `start_local`/`weekdays`/`bypass_severities`
 *      never throw.
 *   9. a11y: labelled landmark region, decorative (aria-hidden) icons, and the
 *      status stated in words (not colour alone).
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import '../../../i18n';

import { QuietHoursSummary } from './QuietHoursSummary';
import type { QuietHoursWindow } from '@/api/types';

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

// Read a MetricCard's rendered value by its (unique) label text. The label
// lives in a <span> inside <p class="metric-label">; the value is that
// paragraph's immediate sibling <p>.
function cardValue(label: string): string {
  const labelParagraph = screen.getByText(label).closest('p');
  return labelParagraph?.nextElementSibling?.textContent ?? '';
}

// Freeze the wall clock to a fixed *local* instant (no trailing Z → parsed in
// the runner's timezone, which is exactly what the component reads via
// Date#getHours/getDay). Only Date is faked so testing-library internals keep
// their real timers.
function freeze(localIso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(localIso));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('QuietHoursSummary — loading & error states', () => {
  it('renders a four-card skeleton grid inside the labelled region on first load', () => {
    renderSummary(makeQuery({ isLoading: true, isPending: true, isFetching: true }));

    expect(getRegion()).toBeInTheDocument();
    const skeleton = screen.getByTestId('stat-grid-skeleton');
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
    expect(skeleton.querySelectorAll('.animate-pulse')).toHaveLength(4);
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
    // Not loading → no skeleton either.
    expect(screen.queryByTestId('stat-grid-skeleton')).not.toBeInTheDocument();
  });

  it('treats an idle query with undefined data as empty (null-safety)', () => {
    renderSummary(makeQuery());

    expect(getRegion()).toBeInTheDocument();
    expect(cardValue('Windows')).toBe('0');
    expect(cardValue('Right now')).toBe('Delivering');
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
    expect(cardValue('Right now')).toBe('Quiet');
    expect(screen.getByText('2 window active now')).toBeInTheDocument();
    // Deduped, enabled-only union — "emergency" (disabled) is absent.
    expect(cardValue('Always allowed')).toBe('critical, warning');
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
    const today = new Date().getDay();
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
          // Malformed start time → parseHHMM returns null → inactive.
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
    // None of the three evaluate as active.
    expect(cardValue('Right now')).toBe('Delivering');
    expect(screen.getByText('No window active now')).toBeInTheDocument();
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
    // Card icons are purely decorative — hidden from the a11y tree so the
    // metric label + value carry the meaning.
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0);
    // Status is legible without colour: it renders a word, not just a hue.
    expect(cardValue('Right now')).toMatch(/^(Quiet|Delivering)$/);
  });
});
