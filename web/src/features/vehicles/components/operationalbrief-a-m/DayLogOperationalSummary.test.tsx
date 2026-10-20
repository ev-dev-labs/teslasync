import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';
import type { DayLogResponse } from '@/api/types';
import { createEnglishI18n } from '@/test/createEnglishI18n';
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { DayLogOperationalSummary } from './DayLogOperationalSummary';

vi.unmock('react-i18next');

let i18n: Awaited<ReturnType<typeof createEnglishI18n>>;

beforeAll(async () => {
  i18n = await createEnglishI18n();
});

function response(overrides: Partial<DayLogResponse> = {}): DayLogResponse {
  return {
    vehicle_id: 1,
    date: '2026-10-11',
    timezone: 'UTC',
    day_start: '2026-10-11T00:00:00Z',
    day_end: '2026-10-12T00:00:00Z',
    truncated: false,
    total_events: 0,
    limit: 2000,
    offset: 0,
    layers: [],
    summary: {
      drive_count: 2,
      charge_count: 1,
      drive_duration_s: 3600,
      drive_distance_m: 25000,
      energy_added_wh: 12500,
      energy_used_wh: 5000,
    },
    sources: [
      { source: 'drives', status: 'ok', count: 2 },
      { source: 'charging_sessions', status: 'ok', count: 1 },
    ],
    events: [],
    ...overrides,
  };
}

function renderSummary(overrides: Partial<ComponentProps<typeof DayLogOperationalSummary>> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <DayLogOperationalSummary
          data={response()}
          date="2026-10-10"
          timezone="Europe/London"
          isLoading={false}
          error={null}
          status="ok"
          onRetry={vi.fn()}
          {...overrides}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function metric(label: string) {
  return within(screen.getByTestId('day-log-summary')).getByText(label).closest('[role="listitem"]')!;
}

/** Status badge assertions moved into the drawer header; tone class is pinned on the badge itself. */
function expectDrawerStatus(brief: HTMLElement, label: string, toneClass: string) {
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
  const drawer = screen.getByRole('dialog');
  try {
    const header = drawer.querySelector('[data-drawer-header]');
    if (!header) throw new Error('Missing drawer header');
    expect(within(header).getByText(label)).toHaveClass(toneClass);
  } finally {
    fireEvent.keyDown(drawer, { key: 'Escape' });
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

const capNotice = 'Some records may be missing — the day exceeded the signal read cap. What loaded is shown in full.';

describe('DayLogOperationalSummary', () => {
  it('honors explicit partial status without inventing unavailable sources or cap loss', () => {
    renderSummary({ status: 'partial' });

    expectDrawerStatus(screen.getByTestId('day-log-summary'), 'Partial data', 'text-[var(--semantic-warning)]');
    expect(screen.queryByText('Recorded day summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Some sources unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText(capNotice)).not.toBeInTheDocument();
    expect(within(screen.getByTestId('day-log-summary')).getAllByRole('listitem')).toHaveLength(6);
  });

  it('honors recorded source cap loss even when request status is ok and assembled paging is exhausted', () => {
    renderSummary({ data: response({ truncated: true }) });

    expect(screen.getByText(capNotice)).toBeVisible();
    expect(screen.queryByText('Recorded day summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Some sources unavailable')).not.toBeInTheDocument();
    expect(metric('Drives')).toHaveTextContent('2');
    expect(metric('Charges')).toHaveTextContent('1');
    expect(metric('Drive time')).toHaveTextContent('1.00 h');
    expect(metric('Distance')).toHaveTextContent('25.00 km');
    expect(metric('Energy added')).toHaveTextContent('12.50 kWh');
    expect(metric('Energy used')).toHaveTextContent('5.00 kWh');
  });

  it('retains unavailable source meaning without inventing a signal cap', () => {
    renderSummary({ data: response({ sources: [
      { source: 'drives', status: 'ok', count: 2 },
      { source: 'signal_log', status: 'unavailable', count: 0, reason: 'History read failed' },
    ] }) });

    expectDrawerStatus(screen.getByTestId('day-log-summary'), 'Some sources unavailable', 'text-[var(--semantic-warning)]');
    expect(screen.queryByText(capNotice)).not.toBeInTheDocument();
    expect(screen.queryByText('Recorded day summary')).not.toBeInTheDocument();
    expect(metric('Distance')).toHaveTextContent('25.00 km');
  });

  it('retains both source unavailability and independently recorded cap loss', () => {
    renderSummary({ data: response({ truncated: true, sources: [
      { source: 'signal_log', status: 'unavailable', count: 0 },
    ] }) });

    assertOperationalBriefDisclosure(screen.getByTestId('day-log-summary'), 'Some sources unavailable');
    expect(screen.getByText(capNotice)).toBeVisible();
    expect(metric('Energy used')).toHaveTextContent('5.00 kWh');
  });

  it('keeps retained stale history and its cap limitation distinct', () => {
    renderSummary({ data: response({ truncated: true }), status: 'stale' });

    expectDrawerStatus(screen.getByTestId('day-log-summary'), 'Retained recorded history', 'text-[var(--semantic-warning)]');
    expect(screen.getByText(capNotice)).toBeVisible();
    expect(metric('Distance')).toHaveTextContent('25.00 km');
    expect(screen.queryByText('History request failed')).not.toBeInTheDocument();
  });

  it('preserves measured zero and unknown SI totals independently under truncation', () => {
    renderSummary({ data: response({ truncated: true, summary: {
      drive_count: 1,
      charge_count: 1,
      drive_duration_s: 0,
      drive_distance_m: null,
      energy_added_wh: 0,
      energy_used_wh: null,
    } }) });

    expect(metric('Drive time')).toHaveAttribute('data-value-state', 'value');
    expect(metric('Drive time')).toHaveTextContent('0.00 h');
    expect(metric('Energy added')).toHaveAttribute('data-value-state', 'value');
    expect(metric('Energy added')).toHaveTextContent('0.00 kWh');
    for (const label of ['Distance', 'Energy used']) {
      assertOperationalMetricUnavailable(screen.getByTestId('day-log-summary'), label);
    }
    expect(screen.getByText(capNotice)).toBeVisible();
  });

  it.each([
    { caseName: 'explicit partial state', status: 'partial' as const, truncated: false, unavailable: false },
    { caseName: 'recorded cap loss', status: 'ok' as const, truncated: true, unavailable: false },
    { caseName: 'unavailable session source', status: 'ok' as const, truncated: false, unavailable: true },
  ])('qualifies zero-session empty state for $caseName without declaring a quiet complete day', ({ status, truncated, unavailable }) => {
    renderSummary({ status, data: response({
      truncated,
      sources: unavailable ? [{ source: 'drives', status: 'unavailable', count: 0 }] : [],
      summary: {
        drive_count: 0, charge_count: 0,
        drive_duration_s: null, drive_distance_m: null,
        energy_added_wh: null, energy_used_wh: null,
      },
    }) });

    expect(screen.queryByText('No drives or charging sessions this day.')).not.toBeInTheDocument();
    expect(screen.queryByText('Locks, sentry, and state changes below still tell the story when the car stayed put.')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open drives' })).toHaveAttribute('href', '/drives');
    expect(metric('Drives')).toHaveTextContent('0');
    expect(metric('Charges')).toHaveTextContent('0');
    expect(within(screen.getByTestId('day-log-summary')).getAllByRole('listitem')).toHaveLength(2);
    for (const label of ['Drive time', 'Distance', 'Energy added', 'Energy used']) {
      assertOperationalMetricUnavailable(screen.getByTestId('day-log-summary'), label);
    }
  });

  it('preserves authoritative empty session messaging and its original destination', () => {
    renderSummary({ data: response({ summary: {
      drive_count: 0, charge_count: 0,
      drive_duration_s: null, drive_distance_m: null,
      energy_added_wh: null, energy_used_wh: null,
    }, sources: [{ source: 'drives', status: 'empty', count: 0 }] }) });

    assertOperationalBriefDisclosure(screen.getByTestId('day-log-summary'), 'Recorded day summary');
    expect(screen.getByText('No drives or charging sessions this day.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open drives' })).toHaveAttribute('href', '/drives');
    assertOperationalMetricUnavailable(screen.getByTestId('day-log-summary'), 'Drive time');
  });

  it('preserves server scope and exclusive day bounds in the details provenance', () => {
    renderSummary({ data: response({ truncated: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));

    const details = screen.getByRole('dialog');
    expect(details).toHaveTextContent('2026-10-11 · UTC');
    expect(details).toHaveTextContent('[2026-10-11T00:00:00Z, 2026-10-12T00:00:00Z) · end exclusive');
    expect(details).toHaveTextContent('Recorded drives and charging sessions for the selected vehicle day. Signal transitions and per-source availability remain in Timeline and Sources.');
    expect(details).toHaveTextContent(capNotice);
    expect(within(details).getByText('Distance').parentElement?.parentElement).toHaveTextContent('25.00 km');
  });

  it('preserves loading suppression without fabricating complete or measured zero history', () => {
    renderSummary({ data: null, isLoading: true, status: 'initial' });

    assertOperationalBriefDisclosure(screen.getByTestId('day-log-summary'), 'Loading recorded history');
    expect(screen.getByTestId('day-log-summary')).toHaveAttribute('aria-busy', 'true');
    expect(within(screen.getByTestId('day-log-summary')).getAllByRole('listitem')).toHaveLength(6);
    expect(screen.queryByText('Recorded day summary')).not.toBeInTheDocument();
    expect(screen.queryByText('No drives or charging sessions this day.')).not.toBeInTheDocument();
    expect(screen.getByTestId('day-log-summary').querySelector('[data-operational-value]')).toBeNull();
  });

  it('preserves unknown summary values and unknown bounds without claiming cap loss', () => {
    renderSummary({ data: null, status: 'unavailable' });

    assertOperationalBriefDisclosure(screen.getByTestId('day-log-summary'), 'Day summary unavailable');
    assertOperationalBriefDisclosure(screen.getByTestId('day-log-summary'), 'Recorded day bounds unavailable');
    expect(screen.queryByText(capNotice)).not.toBeInTheDocument();
    for (const label of ['Drives', 'Charges', 'Drive time', 'Distance', 'Energy added', 'Energy used']) {
      assertOperationalMetricUnavailable(screen.getByTestId('day-log-summary'), label);
    }
    expect(screen.queryByText('No drives or charging sessions this day.')).not.toBeInTheDocument();
  });

  it('preserves failed request retry and retained SI metrics alongside actual cap loss', () => {
    const onRetry = vi.fn();
    renderSummary({ data: response({ truncated: true }), error: new Error('History request failed'), status: 'stale', onRetry });

    assertOperationalBriefDisclosure(screen.getByTestId('day-log-summary'), 'History request failed');
    expect(metric('Distance')).toHaveTextContent('25.00 km');
    expect(screen.getByText(capNotice)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
