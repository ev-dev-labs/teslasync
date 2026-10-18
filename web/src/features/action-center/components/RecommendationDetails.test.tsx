import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import english from '@/i18n/en.json';
import { typography } from '@/lib/tokens';
import type {
  ActionCenterHistoryPage,
  ActionCenterProjectedImpact,
  ActionCenterRecommendation,
} from '@/types/actionCenter';

vi.unmock('react-i18next');
const historyMock = vi.hoisted(() => vi.fn());
const preferences = vi.hoisted(() => ({
  locale: 'en-US',
  decimal_precision: 2,
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  tz_display_default: 'user',
  timezone_user: 'UTC',
}));
vi.mock('@/api/hooks/useActionCenter', () => ({
  useActionCenterHistory: historyMock,
}));
vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>(
    '@/hooks/useSettings',
  );
  return {
    ...actual,
    useSettings: () => ({ settings: preferences, locale: preferences.locale }),
  };
});

describe('RecommendationDetails bounded history coverage', () => {
  function page(total: number, offset = 0, count = Math.min(25, Math.max(0, total - offset))): ActionCenterHistoryPage {
    return {
      ...historyPage, total, offset,
      items: Array.from({ length: count }, (_, index) => ({
        ...historyPage.items[0], id: offset + index + 1,
        action: offset === 0 ? 'acknowledge' : 'restore',
        from_state: offset === 0 ? 'open' : 'acknowledged',
        to_state: offset === 0 ? 'acknowledged' : 'open',
      })),
    };
  }

  it.each([
    { total: 0, count: 0, coverage: 'Showing 0–0 of 0', next: false },
    { total: 25, count: 25, coverage: 'Showing 1–25 of 25', next: false },
    { total: 26, count: 25, coverage: 'Showing 1–25 of 26', next: true },
    { total: 71, count: 25, coverage: 'Showing 1–25 of 71', next: true },
  ])('discloses actual loaded coverage and older access for total $total', ({ total, count, coverage, next }) => {
    setHistory({ data: page(total) });
    render(details());
    const history = screen.getByRole('region', { name: 'Action history' });
    expect(within(history).getByText(coverage)).toBeVisible();
    expect(within(history).getByText(`Action history loaded, ${count} items`)).toBeVisible();
    expect(within(history).getAllByRole('navigation', { name: 'Pagination' })).toHaveLength(1);
    expect(within(history).getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(within(history).getByRole('button', { name: 'Next page' })).toHaveProperty('disabled', !next);
    expect(within(history).queryAllByText('Acknowledge · Open → Acknowledged · Applied')).toHaveLength(count);
    if (total === 0) expect(within(history).getByText('No actions have been recorded yet.')).toBeVisible();
  });

  it('loads the older page and returns to the previous page with exact bounded offsets', () => {
    setHistory({ data: page(26) });
    const { rerender } = render(details());
    const history = screen.getByRole('region', { name: 'Action history' });
    fireEvent.click(within(history).getByRole('button', { name: 'Next page' }));
    expect(historyMock).toHaveBeenLastCalledWith(recommendation.id, true, { limit: 25, offset: 25 });
    setHistory({ data: page(26, 25) });
    rerender(details());
    expect(within(history).getByText('Showing 26–26 of 26')).toBeVisible();
    expect(within(history).getByText('Action history loaded, 1 item')).toBeVisible();
    expect(within(history).getByText('Restore · Acknowledged → Open · Applied')).toBeVisible();
    expect(within(history).getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.click(within(history).getByRole('button', { name: 'Previous page' }));
    expect(historyMock).toHaveBeenLastCalledWith(recommendation.id, true, { limit: 25, offset: 0 });
    setHistory({ data: page(26) });
    rerender(details());
    expect(within(history).getByText('Showing 1–25 of 26')).toBeVisible();
  });

  it('keeps observed coverage and every neighbor during page loading failure paused retry and recovery', () => {
    const original = page(26);
    setHistory({ data: original });
    const { rerender } = render(details());
    const history = screen.getByRole('region', { name: 'Action history' });
    fireEvent.click(within(history).getByRole('button', { name: 'Next page' }));
    setHistory({ data: undefined, isFetching: true, isPending: true });
    rerender(details());
    expect(within(history).getByText('Showing 1–25 of 26')).toBeVisible();
    expect(within(history).queryByText('Showing 26–26 of 26')).not.toBeInTheDocument();
    expect(within(history).getAllByText('Acknowledge · Open → Acknowledged · Applied')).toHaveLength(25);
    expect(within(history).getByRole('button', { name: 'Next page' })).toBeDisabled();

    setHistory({ data: undefined, isError: true, error: new Error('Older history failed') });
    rerender(details());
    expect(within(history).getByText('Showing 1–25 of 26')).toBeVisible();
    expect(within(history).getByTestId('stale-refresh-warning')).toBeVisible();
    expect(within(history).queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(within(history).getByRole('button', { name: 'Refresh' }));
    expect(historyRetry).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    setHistory({ data: undefined, fetchStatus: 'paused' });
    rerender(details());
    expect(within(history).getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(within(history).getByText('Action history loaded, 25 items')).toBeVisible();
    expect(within(history).queryByText(/offline/i)).not.toBeInTheDocument();
    expect(screen.getByText('Alert persisted.')).toBeVisible();
    expect(screen.getByText('Rank 450')).toBeVisible();
    expect(screen.getByText('1.25 kWh')).toBeVisible();
    screen.getAllByText('Not a diagnosis.').forEach((element) => expect(element).toBeVisible());

    setHistory({ data: page(26, 25) });
    rerender(details());
    expect(within(history).getByText('Showing 26–26 of 26')).toBeVisible();
    expect(within(history).getByText('Restore · Acknowledged → Open · Applied')).toBeVisible();
    expect(within(history).queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(original).toEqual(page(26));
  });

  it('resets paging and retained data immediately when the recommendation identifier changes', () => {
    setHistory({ data: page(71) });
    const { rerender } = render(details());
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    setHistory({ data: page(71, 25) });
    rerender(details());
    const other = { ...recommendation, id: 'ac_other' };
    setHistory({ data: undefined, isPending: true, isLoading: true });
    rerender(details(other));
    expect(historyMock).toHaveBeenLastCalledWith('ac_other', true, { limit: 25, offset: 0 });
    const history = screen.getByRole('region', { name: 'Action history' });
    expect(within(history).queryByText('Showing 26–50 of 71')).not.toBeInTheDocument();
    expect(within(history).queryByText('Restore · Acknowledged → Open · Applied')).not.toBeInTheDocument();
    expect(within(history).queryByRole('navigation')).not.toBeInTheDocument();
    rerender(details(recommendation));
    expect(historyMock).toHaveBeenLastCalledWith(recommendation.id, true, { limit: 25, offset: 0 });
    expect(within(history).queryByText('Showing 26–50 of 71')).not.toBeInTheDocument();
    expect(within(history).queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('uses returned row length and offset rather than nominal request coverage for short pages', () => {
    setHistory({ data: page(71, 25, 2) });
    render(details());
    const history = screen.getByRole('region', { name: 'Action history' });
    expect(within(history).getByText('Showing 26–27 of 71')).toBeVisible();
    expect(within(history).getByText('Action history loaded, 2 items')).toBeVisible();
    expect(within(history).queryByText('Showing 26–50 of 71')).not.toBeInTheDocument();
    expect(within(history).getAllByText('Restore · Acknowledged → Open · Applied')).toHaveLength(2);
  });

  it('stops older navigation at the backend offset cap without hiding the real total', () => {
    setHistory({ data: page(100026, 100000, 25) });
    render(details());
    const history = screen.getByRole('region', { name: 'Action history' });
    expect(within(history).getByText('Showing 100,001–100,025 of 100,026')).toBeVisible();
    expect(within(history).getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(within(history).getByRole('button', { name: 'Previous page' })).toBeEnabled();
    fireEvent.change(within(history).getByRole('textbox', { name: 'Go to page' }), { target: { value: '4002' } });
    fireEvent.click(within(history).getByRole('button', { name: 'Go' }));
    expect(historyMock).toHaveBeenLastCalledWith(recommendation.id, true, { limit: 25, offset: 0 });
  });

  it('does not relabel an empty older page as no recorded actions when the total remains positive', () => {
    setHistory({ data: page(26, 25, 0) });
    render(details());
    const history = screen.getByRole('region', { name: 'Action history' });
    expect(within(history).getByText('Showing 0–0 of 26')).toBeVisible();
    expect(within(history).getByText('Action history loaded, 0 items')).toBeVisible();
    expect(within(history).getByText('No data available')).toBeVisible();
    expect(within(history).queryByText('No actions have been recorded yet.')).not.toBeInTheDocument();
    expect(within(history).getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });

  it('preserves the selected history page while closed and only enables fetching again on reopen', () => {
    setHistory({ data: page(71) });
    const { rerender } = render(details());
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    setHistory({ data: page(71, 25) });
    rerender(details(recommendation, false));
    expect(historyMock).toHaveBeenLastCalledWith(recommendation.id, false, { limit: 25, offset: 25 });
    rerender(details());
    expect(historyMock).toHaveBeenLastCalledWith(recommendation.id, true, { limit: 25, offset: 25 });
    expect(screen.getByText('Showing 26–50 of 71')).toBeVisible();
  });

  it('retains observed history through a real older-page rejection and retries only that selected page', async () => {
    const api = await import('@/api/client');
    const hooks = await vi.importActual<typeof import('@/api/hooks/useActionCenter')>(
      '@/api/hooks/useActionCenter',
    );
    const original = page(26);
    const older = page(26, 25);
    let rejectOlder!: (error: Error) => void;
    const request = vi.spyOn(api, 'request')
      .mockResolvedValueOnce(original)
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectOlder = reject; }));
    historyMock.mockImplementation(hooks.useActionCenterHistory);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 60000 } },
    });
    const { unmount } = render(
      <QueryClientProvider client={client}>{details()}</QueryClientProvider>,
    );
    try {
      const history = screen.getByRole('region', { name: 'Action history' });
      await waitFor(() => expect(within(history).getByText('Showing 1–25 of 26')).toBeVisible());
      fireEvent.click(within(history).getByRole('button', { name: 'Next page' }));
      await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
      expect(within(history).getByText('Showing 1–25 of 26')).toBeVisible();
      expect(within(history).queryByText('Showing 26–26 of 26')).not.toBeInTheDocument();
      expect(within(history).getByRole('button', { name: 'Next page' })).toBeDisabled();
      await act(async () => { rejectOlder(new Error('Older history unavailable')); });
      await waitFor(() => expect(within(history).getByTestId('stale-refresh-warning')).toBeVisible());
      expect(within(history).queryByRole('alert')).not.toBeInTheDocument();
      expect(within(history).getAllByText('Acknowledge · Open → Acknowledged · Applied')).toHaveLength(25);
      expect(screen.getByText('Alert persisted.')).toBeVisible();
      expect(screen.getByText('Rank 450')).toBeVisible();
      expect(screen.getByText('1.25 kWh')).toBeVisible();
      request.mockResolvedValueOnce(older);
      fireEvent.click(within(history).getByRole('button', { name: 'Refresh' }));
      await waitFor(() => expect(within(history).getByText('Showing 26–26 of 26')).toBeVisible());
      expect(within(history).getByText('Restore · Acknowledged → Open · Applied')).toBeVisible();
      expect(within(history).queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
      expect(request.mock.calls.map(([url]) => url)).toEqual([
        `/action-center/${recommendation.id}/history?limit=25&offset=0`,
        `/action-center/${recommendation.id}/history?limit=25&offset=25`,
        `/action-center/${recommendation.id}/history?limit=25&offset=25`,
      ]);
      expect(client.getQueryData(hooks.actionCenterKeys.historyPage(recommendation.id))).toEqual(original);
      expect(client.getQueryData(hooks.actionCenterKeys.historyPage(recommendation.id, { offset: 25 }))).toEqual(older);
      expect(onOpenChange).not.toHaveBeenCalled();
    } finally {
      unmount();
      client.clear();
      request.mockRestore();
    }
  });
});
vi.mock('@/lib/timezone', () => ({
  useTimezone: () => preferences.timezone_user,
}));

import { RecommendationDetails } from './RecommendationDetails';

const i18n = createInstance();
const historyRetry = vi.fn();
const onOpenChange = vi.fn();
const recommendation: ActionCenterRecommendation = {
  id: 'ac_retained_history',
  fingerprint: 'a'.repeat(64),
  source_feature: 'active_alerts',
  related_sources: ['active_alerts'],
  vehicle: { id: 7, display_name: 'Fixture vehicle' },
  title: 'Review the persisted alert',
  summary: 'A warning remains active.',
  rationale: 'The persisted alert is unacknowledged.',
  priority: 'high',
  severity: 'warning',
  rank: { score: 450, basis: ['Priority contributes 300', 'Confidence contributes 80'] },
  confidence: { score: 0.8, label: 'high', basis: ['Direct persisted alert'] },
  evidence: [{
    id: 'alert:1',
    kind: 'active_alert',
    summary: 'Alert persisted.',
    provenance: { source: 'notification_logs', record_id: '1', source_url: null },
    observed_at: null,
  }],
  projected_impact: {
    energy_wh: 1250,
    cost_minor: -12345,
    currency: 'EUR',
    time_s: 125,
    risk_level: 'moderate',
    basis: ['Derived from persisted observations.'],
  },
  safe_actions: ['acknowledge'],
  navigation_path: '/alerts',
  expires_at: '2026-10-20T00:00:00Z',
  freshness: { status: 'unknown', observed_at: null, age_s: null },
  limitations: ['Not a diagnosis.'],
  current_state: { status: 'open', version: 0, snoozed_until: null, updated_at: null },
  action_history: [],
};
const historyPage: ActionCenterHistoryPage = {
  items: [{
    id: 17,
    recommendation_id: recommendation.id,
    fingerprint: recommendation.fingerprint,
    action: 'acknowledge',
    from_state: 'open',
    to_state: 'acknowledged',
    outcome: 'applied',
    state_version: 1,
    occurred_at: '2026-10-12T15:30:00Z',
  }],
  total: 71,
  limit: 25,
  offset: 0,
};

function setHistory(overrides: DataStateSource<ActionCenterHistoryPage> = {}) {
  historyMock.mockReturnValue({
    data: historyPage,
    error: null,
    isError: false,
    isPending: false,
    isLoading: false,
    isFetching: false,
    fetchStatus: 'idle',
    dataUpdatedAt: Date.parse('2026-10-12T15:31:00Z'),
    refetch: historyRetry,
    ...overrides,
  });
}

function details(item = recommendation, open = true) {
  return (
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <RecommendationDetails
          recommendation={item}
          open={open}
          onOpenChange={onOpenChange}
        />
      </MemoryRouter>
    </I18nextProvider>
  );
}

beforeEach(async () => {
  historyMock.mockReset();
  historyRetry.mockReset();
  onOpenChange.mockReset();
  preferences.locale = 'en-US';
  preferences.decimal_precision = 2;
  preferences.timezone_user = 'UTC';
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: english },
      de: { translation: { common: { low: 'Niedrig', high: 'Hoch' }, Moderate: 'Mäßig' } },
    },
    interpolation: { escapeValue: false },
  });
  setHistory();
});

describe('RecommendationDetails retained history trust', () => {
  it('distinguishes unresolved initial history from an authoritative empty result', () => {
    setHistory({ data: undefined, isPending: true, isLoading: true });
    const { container, rerender } = render(details());
    const history = screen.getByRole('region', { name: 'Action history' });
    expect(history.querySelector('.bg-\\[var\\(--skeleton-bg\\)\\]')).not.toBeNull();
    expect(within(history).queryByText('No actions have been recorded yet.')).not.toBeInTheDocument();
    expect(screen.getByText('A warning remains active.')).toBeVisible();
    expect(screen.getByText('Rank 450')).toBeVisible();

    setHistory({ data: { ...historyPage, items: [], total: 0 } });
    rerender(details());
    expect(within(history).getByText('No actions have been recorded yet.')).toBeVisible();
    expect(container.querySelector('.bg-\\[var\\(--skeleton-bg\\)\\]')).toBeNull();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('limits an initial failure and its independent retry to history', () => {
    setHistory({ data: undefined, error: new Error('History unavailable'), isError: true });
    const { rerender } = render(details());
    const history = screen.getByRole('region', { name: 'Action history' });
    expect(within(history).getByRole('alert')).toBeVisible();
    expect(within(history).queryByText('No actions have been recorded yet.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText('A warning remains active.')).toBeVisible();
    expect(screen.getByText('Derived from persisted observations.')).toBeVisible();
    expect(screen.getByText('Rank 450')).toBeVisible();
    fireEvent.click(within(history).getByRole('button', { name: 'Retry' }));
    expect(historyRetry).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    setHistory();
    rerender(details());
    expect(within(history).getByText('Acknowledge · Open → Acknowledged · Applied')).toBeVisible();
    expect(within(history).queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText('Derived from persisted observations.')).toBeVisible();
  });

  it('retains every event field through refresh failure independent retry and recovery', () => {
    const originalPage = structuredClone(historyPage);
    setHistory({ error: new Error('Refresh failed'), isError: true });
    const { rerender } = render(details());
    const history = screen.getByRole('region', { name: 'Action history' });
    const eventText = 'Acknowledge · Open → Acknowledged · Applied';
    expect(within(history).getByText(eventText)).toBeVisible();
    expect(within(history).getByText('Oct 12, 2026, 03:30 PM')).toBeVisible();
    expect(within(history).getByTestId('stale-refresh-warning')).toHaveTextContent(
      'Previously loaded data remains visible while affected sources recover.',
    );
    expect(within(history).queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Priority contributes 300')).toBeVisible();
    expect(screen.getByText('Alert persisted.')).toBeVisible();
    screen.getAllByText('Not a diagnosis.').forEach((element) => expect(element).toBeVisible());
    fireEvent.click(within(history).getByRole('button', { name: 'Refresh' }));
    expect(historyRetry).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    setHistory({
      error: new Error('Refresh failed'), isError: true, isFetching: true, isLoading: true,
    });
    rerender(details());
    expect(within(history).getByText(eventText)).toBeVisible();
    expect(within(history).getByRole('button', { name: english.freshness.updating })).toBeDisabled();

    setHistory({
      data: {
        ...historyPage,
        items: [...historyPage.items, {
          ...historyPage.items[0],
          id: 18,
          action: 'restore',
          from_state: 'acknowledged',
          to_state: 'open',
          state_version: 2,
        }],
        total: 72,
      },
      dataUpdatedAt: Date.parse('2026-10-12T15:32:00Z'),
    });
    rerender(details());
    expect(within(history).getByText(eventText)).toBeVisible();
    expect(within(history).getByText('Restore · Acknowledged → Open · Applied')).toBeVisible();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(within(history).queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(historyPage).toEqual(originalPage);
  });

  it('retains a previously empty history without turning refresh failure into initial failure', () => {
    setHistory({
      data: { ...historyPage, items: [], total: 0 },
      error: new Error('Refresh failed'),
      isError: true,
    });
    render(details());
    const history = screen.getByRole('region', { name: 'Action history' });
    expect(within(history).getByText('No actions have been recorded yet.')).toBeVisible();
    expect(within(history).getByTestId('stale-refresh-warning')).toBeVisible();
    expect(within(history).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(history).getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it('retains paused history with deferred trust rather than an invented server error', () => {
    setHistory({ fetchStatus: 'paused' });
    render(details());
    const history = screen.getByRole('region', { name: 'Action history' });
    expect(within(history).getByText('Acknowledge · Open → Acknowledged · Applied')).toBeVisible();
    expect(within(history).getByTestId('stale-refresh-warning')).toHaveAttribute(
      'data-refresh-blocked', 'true',
    );
    expect(within(history).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(history).queryByText(/offline/i)).not.toBeInTheDocument();
  });

  it('preserves query identity enablement and the public accordion callback', async () => {
    const { rerender } = render(details(recommendation, false));
    expect(historyMock).toHaveBeenLastCalledWith(recommendation.id, false, { limit: 25, offset: 0 });
    fireEvent.click(screen.getByRole('button', { name: /Evidence, scoring, and outcomes/ }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    rerender(details(recommendation, true));
    expect(historyMock).toHaveBeenLastCalledWith(recommendation.id, true, { limit: 25, offset: 0 });
    await waitFor(() => expect(screen.getByRole('region', { name: 'Action history' })).toBeVisible());
  });
});

describe('RecommendationDetails projection presentation', () => {
  it('renders actual signed source currency SI energy time and neutral scoring without mutating input', () => {
    const original = structuredClone(recommendation);
    render(details());
    const impact = screen.getByRole('region', { name: 'Projected impact' });
    expect(within(impact).getByText('1.25 kWh')).toBeVisible();
    expect(within(impact).getByText('-€123.45')).toBeVisible();
    expect(within(impact).getByText('2m')).toBeVisible();
    expect(within(impact).getByText('Moderate')).toBeVisible();
    expect(screen.getByText('Rank 450')).toHaveClass(typography.color.secondary);
    expect(screen.getByText('Rank 450')).not.toHaveClass('text-cyan-300');
    expect(screen.getByText('Confidence contributes 80')).toBeVisible();
    expect(recommendation).toEqual(original);
  });

  it('reacts to real locale precision timezone and translated risk settings without refetching history', async () => {
    const { rerender } = render(details());
    preferences.locale = 'de-DE';
    preferences.decimal_precision = 1;
    preferences.timezone_user = 'Europe/Berlin';
    await i18n.changeLanguage('de');
    rerender(details());
    const impact = screen.getByRole('region', { name: 'Projected impact' });
    expect(within(impact).getByText('1,3 kWh')).toBeVisible();
    expect(within(impact).getByText('-123,45 €')).toBeVisible();
    expect(within(impact).getByText('Mäßig')).toBeVisible();
    expect(screen.getByText('12. Okt. 2026, 17:30')).toBeVisible();
    expect(historyRetry).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'low risk', risk: 'low' as const, label: 'Niedrig' },
    { name: 'moderate risk', risk: 'moderate' as const, label: 'Mäßig' },
    { name: 'high risk', risk: 'high' as const, label: 'Hoch' },
  ])('localizes $name using an existing catalog label', async ({ risk, label }) => {
    await i18n.changeLanguage('de');
    render(details({
      ...recommendation,
      projected_impact: { ...recommendation.projected_impact!, risk_level: risk },
    }));
    const impact = screen.getByRole('region', { name: 'Projected impact' });
    expect(within(impact).getByText(label)).toBeVisible();
    expect(within(impact).queryByText(risk)).not.toBeInTheDocument();
  });

  it('keeps unknown projections distinct from measured zero and never invents a currency', () => {
    const unknown: ActionCenterProjectedImpact = {
      energy_wh: null, cost_minor: null, currency: null, time_s: null, risk_level: null, basis: [],
    };
    const { rerender } = render(details({ ...recommendation, projected_impact: unknown }));
    const impact = screen.getByRole('region', { name: 'Projected impact' });
    expect(within(impact).getByText(
      'No defensible energy, cost, time, or risk projection is available.',
    )).toBeVisible();
    expect(within(impact).queryByText('0.00 kWh')).not.toBeInTheDocument();

    rerender(details({
      ...recommendation,
      projected_impact: { ...unknown, energy_wh: 0, cost_minor: 0, currency: 'EUR', time_s: 0 },
    }));
    expect(within(impact).getByText('0.00 kWh')).toBeVisible();
    expect(within(impact).getByText('€0.00')).toBeVisible();
    expect(within(impact).getByText('0m')).toBeVisible();

    rerender(details({ ...recommendation, projected_impact: { ...unknown, cost_minor: 12345 } }));
    expect(within(impact).getByText(
      'No defensible energy, cost, time, or risk projection is available.',
    )).toBeVisible();
    expect(within(impact).queryByText(/123/)).not.toBeInTheDocument();
  });

  it('preserves the explicit raw fallback for unsupported source currency without assuming user currency', () => {
    render(details({
      ...recommendation,
      projected_impact: { ...recommendation.projected_impact!, currency: 'invalid-code' },
    }));
    const impact = screen.getByRole('region', { name: 'Projected impact' });
    expect(within(impact).getByText('-12345 invalid-code')).toBeVisible();
    expect(within(impact).queryByText(/€/)).not.toBeInTheDocument();
  });
});
