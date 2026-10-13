import { fireEvent, render, screen, within } from '@testing-library/react';
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
    expect(screen.getByText('Not a diagnosis.')).toBeVisible();
    fireEvent.click(within(history).getByRole('button', { name: 'Refresh' }));
    expect(historyRetry).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    setHistory({
      error: new Error('Refresh failed'), isError: true, isFetching: true, isLoading: true,
    });
    rerender(details());
    expect(within(history).getByText(eventText)).toBeVisible();
    expect(within(history).getByRole('button', { name: 'Updating…' })).toBeDisabled();

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

  it('preserves query identity enablement and the public accordion callback', () => {
    const { rerender } = render(details(recommendation, false));
    expect(historyMock).toHaveBeenLastCalledWith(recommendation.id, false);
    fireEvent.click(screen.getByRole('button', { name: /Evidence, scoring, and outcomes/ }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    rerender(details(recommendation, true));
    expect(historyMock).toHaveBeenLastCalledWith(recommendation.id, true);
    expect(screen.getByRole('region', { name: 'Action history' })).toBeVisible();
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
