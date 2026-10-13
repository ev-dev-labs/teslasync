import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@/api/types';
import english from '@/i18n/en.json';
import { typography } from '@/lib/tokens';
import type {
  ActionCenterRecommendation,
  ActionCenterState,
} from '@/types/actionCenter';

vi.unmock('react-i18next');
vi.unmock('@/lib/timezone');
const preferences = vi.hoisted(() => ({
  locale: 'en-US',
  tz_display_default: 'user',
  timezone_user: 'UTC',
  decimal_precision: 2,
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
} satisfies Pick<AppSettings,
  'locale' | 'tz_display_default' | 'timezone_user' | 'decimal_precision'
  | 'unit_of_length' | 'unit_of_temp' | 'unit_of_pressure'
>));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: preferences,
    locale: preferences.locale,
    decimals: preferences.decimal_precision,
  }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: { timezone: 'Asia/Tokyo' } }),
}));
vi.mock('@/api/hooks/useActionCenter', () => ({
  useActionCenterHistory: () => ({
    data: { items: [], total: 0, limit: 25, offset: 0 },
    isPending: false,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    fetchStatus: 'idle',
    dataUpdatedAt: Date.parse('2026-10-12T15:31:00Z'),
    refetch: vi.fn(),
  }),
}));

import { RecommendationCard } from './RecommendationCard';

const i18n = createInstance();
const onAction = vi.fn();
const recommendation: ActionCenterRecommendation = {
  id: 'ac_card_access',
  fingerprint: 'c'.repeat(64),
  source_feature: 'active_alerts',
  related_sources: ['active_alerts'],
  vehicle: { id: 7, display_name: 'Fixture vehicle' },
  title: 'Review the persisted alert',
  summary: 'A warning remains active.',
  rationale: 'The persisted alert is unacknowledged.',
  priority: 'critical',
  severity: 'critical',
  rank: { score: 450, basis: ['Priority contributes 300'] },
  confidence: { score: 0.855, label: 'high', basis: ['Direct persisted alert'] },
  evidence: [{
    id: 'alert:73',
    kind: 'active_alert',
    summary: 'Persisted evidence remains available.',
    provenance: { source: 'notification_logs', record_id: '73', source_url: null },
    observed_at: null,
  }],
  projected_impact: null,
  safe_actions: ['acknowledge', 'snooze', 'dismiss', 'restore', 'navigate'],
  navigation_path: '/alerts',
  expires_at: '2026-10-20T00:00:00Z',
  freshness: { status: 'unknown', observed_at: null, age_s: null },
  limitations: ['Not a diagnosis.'],
  current_state: { status: 'open', version: 0, snoozed_until: null, updated_at: null },
  action_history: [],
};

function card(
  item = recommendation,
  props: { actionsDisabled?: boolean; actionsDisabledReason?: string } = {},
) {
  return (
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <RecommendationCard recommendation={item} onAction={onAction} {...props} />
      </MemoryRouter>
    </I18nextProvider>
  );
}

beforeEach(async () => {
  onAction.mockReset();
  preferences.locale = 'en-US';
  preferences.timezone_user = 'UTC';
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: english },
      de: { translation: {
        operationalMode: { actionCenterDisabled: { title: 'Inbox-Aktionen sind schreibgeschützt' } },
        actionCenter: { action: {
          acknowledge: 'Diese ausführliche Empfehlung bestätigen und zur späteren Prüfung aufbewahren',
        } },
      } },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecommendationCard expiry preferences', () => {
  it('renders saved locale and timezone instead of explicit browser defaults and reacts to preference changes', () => {
    // Keep real Intl formatting while fixing browser fallbacks independently of the host.
    vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (
      this: Date,
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ) {
      return new Intl.DateTimeFormat(locales ?? 'en-US', {
        ...options,
        timeZone: options?.timeZone ?? 'UTC',
      }).format(this);
    });
    preferences.locale = 'fr-FR';
    preferences.timezone_user = 'America/Los_Angeles';
    const original = structuredClone(recommendation);
    const { rerender } = render(card());
    expect(screen.getByText('Fixture vehicle · Expires 19 oct. 2026, 17:00')).toBeVisible();
    expect(screen.queryByText('Fixture vehicle · Expires Oct 20, 2026, 12:00 AM')).not.toBeInTheDocument();

    preferences.timezone_user = 'Europe/Paris';
    rerender(card());
    expect(screen.getByText('Fixture vehicle · Expires 20 oct. 2026, 02:00')).toBeVisible();
    expect(screen.queryByText('Fixture vehicle · Expires 19 oct. 2026, 17:00')).not.toBeInTheDocument();

    preferences.locale = 'en-GB';
    rerender(card());
    expect(screen.getByText('Fixture vehicle · Expires 20 Oct 2026, 02:00')).toBeVisible();
    expect(screen.queryByText('Fixture vehicle · Expires 20 oct. 2026, 02:00')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open source' }));
    expect(onAction.mock.calls).toEqual([
      [recommendation, 'acknowledge'],
      [recommendation, 'navigate'],
    ]);
    expect(onAction.mock.calls[0][0]).toBe(recommendation);
    expect(onAction.mock.calls[1][0]).toBe(recommendation);
    expect(recommendation).toEqual(original);
    expect(recommendation.expires_at).toBe('2026-10-20T00:00:00Z');
  });

  it.each([
    { name: 'null expiry', expiresAt: null },
    { name: 'unknown expiry', expiresAt: 'unknown' },
  ])('keeps the expiry placeholder and original action payload for $name', ({ expiresAt }) => {
    preferences.locale = 'fr-FR';
    preferences.timezone_user = 'America/Los_Angeles';
    const item = {
      ...recommendation,
      // Runtime missing data remains unknown even though the wire type requires a timestamp.
      expires_at: expiresAt,
    } as ActionCenterRecommendation;
    const original = structuredClone(item);
    render(card(item));
    expect(screen.getByText('Fixture vehicle · Expires —')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith(item, 'dismiss');
    expect(onAction.mock.calls[0][0]).toBe(item);
    expect(item).toEqual(original);
  });
});

describe('RecommendationCard restrained accessible presentation', () => {
  it('preserves the article identity all metadata and neutral rank confidence roles', () => {
    const original = structuredClone(recommendation);
    render(card());
    const article = screen.getByRole('article', { name: recommendation.title });
    const title = within(article).getByRole('heading', { level: 3, name: recommendation.title });
    expect(title).toHaveAttribute('id', 'ac_card_access-title');
    expect(article).toHaveAttribute('aria-labelledby', 'ac_card_access-title');
    expect(title).toHaveClass(...typography.role.panelTitle.split(' '));
    expect(within(article).getByText(recommendation.summary)).toBeVisible();
    expect(within(article).getByText(recommendation.rationale)).toBeVisible();
    expect(within(article).getByText(/Fixture vehicle · Expires/)).toBeVisible();
    expect(within(article).getByText('Critical')).toBeVisible();
    expect(within(article).getByText('Open', { exact: true })).toBeVisible();
    const rank = within(article).getByText('450');
    const confidence = within(article).getByText('86%');
    expect(rank).toHaveClass(typography.color.primary, typography.size.xl, 'tabular-nums');
    expect(confidence).toHaveClass(typography.color.secondary, typography.size.xl, 'tabular-nums');
    expect(rank).not.toHaveClass('text-cyan-200');
    expect(confidence).not.toHaveClass('text-cyan-200');
    expect(rank.parentElement).toHaveClass('bg-[var(--surface-2)]');
    expect(confidence.parentElement).toHaveClass('bg-[var(--surface-2)]');
    expect(article.parentElement).not.toHaveClass('hover:border-[var(--semantic-purple-border)]');
    expect(article.parentElement).not.toHaveClass('hover:border-[var(--semantic-info-border)]');
    expect(recommendation).toEqual(original);
  });

  it('keeps every permitted callback bound to the original recommendation and action identity', () => {
    render(card());
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    fireEvent.click(screen.getByRole('button', { name: 'Snooze 24 hours' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open source' }));
    expect(onAction.mock.calls).toEqual([
      [recommendation, 'acknowledge'],
      [recommendation, 'snooze'],
      [recommendation, 'dismiss'],
      [recommendation, 'navigate'],
    ]);
    for (const [item] of onAction.mock.calls) expect(item).toBe(recommendation);
  });

  it.each([
    { name: 'open', state: 'open', allowed: ['Acknowledge', 'Snooze 24 hours', 'Dismiss'] },
    { name: 'acknowledged', state: 'acknowledged', allowed: ['Snooze 24 hours', 'Dismiss', 'Restore'] },
    { name: 'snoozed', state: 'snoozed', allowed: ['Acknowledge', 'Dismiss', 'Restore'] },
    { name: 'dismissed', state: 'dismissed', allowed: ['Restore'] },
  ] satisfies Array<{ name: string; state: ActionCenterState; allowed: string[] }>)(
    'preserves safe state transitions for $name',
    ({ state, allowed }) => {
      render(card({
        ...recommendation,
        current_state: { ...recommendation.current_state, status: state },
      }));
      for (const name of ['Acknowledge', 'Snooze 24 hours', 'Dismiss', 'Restore']) {
        const button = screen.queryByRole('button', { name });
        if (allowed.includes(name)) {
          expect(button).toBeEnabled();
        } else {
          expect(button).not.toBeInTheDocument();
        }
      }
    },
  );

  it('requires both a safe action and a navigation destination without hiding evidence', () => {
    const { rerender } = render(card({ ...recommendation, safe_actions: [] }));
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open source' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Evidence, scoring, and outcomes/ })).toBeEnabled();
    rerender(card({ ...recommendation, safe_actions: ['navigate'], navigation_path: null }));
    expect(screen.queryByRole('button', { name: 'Open source' })).not.toBeInTheDocument();
    rerender(card({ ...recommendation, safe_actions: ['acknowledge'] }));
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Snooze 24 hours' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open source' })).not.toBeInTheDocument();
  });

  it('exposes a persistent associated read-only reason while preserving navigation and evidence', async () => {
    const reason = i18n.t('operationalMode.cached.writeBlocked');
    render(card(recommendation, { actionsDisabled: true, actionsDisabledReason: reason }));
    const explanation = screen.getByText(reason);
    expect(explanation).toBeVisible();
    expect(explanation).toHaveAttribute('id', 'ac_card_access-actions-disabled-reason');
    for (const name of ['Acknowledge', 'Snooze 24 hours', 'Dismiss']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription(reason);
      fireEvent.click(button);
    }
    expect(onAction).not.toHaveBeenCalled();
    const navigate = screen.getByRole('button', { name: 'Open source' });
    expect(navigate).toBeEnabled();
    expect(navigate).not.toHaveAttribute('aria-describedby');
    fireEvent.click(navigate);
    expect(onAction).toHaveBeenCalledExactlyOnceWith(recommendation, 'navigate');
    const details = screen.getByRole('button', { name: /Evidence, scoring, and outcomes/ });
    fireEvent.click(details);
    expect(details).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => {
      expect(screen.getByText('Persisted evidence remains available.')).toBeVisible();
    });
    expect(screen.getByText('Priority contributes 300')).toBeVisible();
    expect(screen.getByText('Direct persisted alert')).toBeVisible();
    const limitations = screen.getAllByText('Not a diagnosis.');
    expect(limitations).toHaveLength(2);
    for (const limitation of limitations) expect(limitation).toBeVisible();
    expect(explanation).toBeVisible();
  });

  it.each([
    { name: 'omitted reason', reason: undefined },
    { name: 'empty reason', reason: '' },
    { name: 'blank reason', reason: '   ' },
  ])('localizes the default read-only explanation for $name without claiming a blocking cause', async ({ reason: suppliedReason }) => {
    await i18n.changeLanguage('de');
    render(card(recommendation, { actionsDisabled: true, actionsDisabledReason: suppliedReason }));
    const reason = 'Inbox-Aktionen sind schreibgeschützt';
    expect(screen.getByText(reason)).toBeVisible();
    expect(screen.getByRole('button', {
      name: 'Diese ausführliche Empfehlung bestätigen und zur späteren Prüfung aufbewahren',
    })).toHaveAccessibleDescription(reason);
    expect(screen.queryByText(/Reconnect before|Return to live/)).not.toBeInTheDocument();
  });

  it('clears the read-only explanation and associations when actions become enabled', () => {
    const reason = i18n.t('operationalMode.asOf.writeBlocked');
    const { rerender } = render(card(recommendation, {
      actionsDisabled: true, actionsDisabledReason: reason,
    }));
    expect(screen.getByText(reason)).toBeVisible();
    rerender(card(recommendation, { actionsDisabled: false, actionsDisabledReason: reason }));
    expect(screen.queryByText(reason)).not.toBeInTheDocument();
    const acknowledge = screen.getByRole('button', { name: 'Acknowledge' });
    expect(acknowledge).toBeEnabled();
    expect(acknowledge).not.toHaveAttribute('title');
    expect(acknowledge).not.toHaveAttribute('aria-describedby');
    fireEvent.click(acknowledge);
    expect(onAction).toHaveBeenCalledExactlyOnceWith(recommendation, 'acknowledge');
  });

  it('adopts mobile minimum and multiline label roles without claiming measured pixels', async () => {
    await i18n.changeLanguage('de');
    render(card());
    for (const name of [
      'Diese ausführliche Empfehlung bestätigen und zur späteren Prüfung aufbewahren',
      'Snooze 24 hours', 'Dismiss', 'Open source',
    ]) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass(
        'h-auto', 'min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-0',
        'max-w-full', 'whitespace-normal',
      );
      expect(button).not.toHaveClass('h-9');
      expect(within(button).getByText(name)).toHaveClass('min-w-0', 'break-words');
      expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('keeps measured zero and large ranks distinct from unknown vehicle projection and observation', async () => {
    const unknown = {
      ...recommendation,
      vehicle: null,
      confidence: { ...recommendation.confidence, score: 0, label: 'low' as const },
      rank: { ...recommendation.rank, score: 0 },
    };
    const original = structuredClone(unknown);
    const { rerender } = render(card(unknown));
    expect(screen.getByText('0', { exact: true })).toBeVisible();
    expect(screen.getByText('0%', { exact: true })).toBeVisible();
    expect(screen.getByText(/All vehicles · Expires/)).toBeVisible();
    expect(screen.getByText('No projected impact')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Evidence, scoring, and outcomes/ }));
    await waitFor(() => {
      expect(screen.getByText(
        'No defensible energy, cost, time, or risk projection is available.',
      )).toBeVisible();
    });
    expect(screen.queryByText('0.00 kWh')).not.toBeInTheDocument();
    expect(screen.queryByText('0m')).not.toBeInTheDocument();
    expect(screen.getByText('Persisted evidence remains available.')).toBeVisible();
    expect(unknown).toEqual(original);
    rerender(card({
      ...unknown,
      rank: { ...unknown.rank, score: 999999 },
      confidence: { ...unknown.confidence, score: 1 },
    }));
    expect(screen.getByText('999999', { exact: true })).toBeVisible();
    expect(screen.getByText('100%', { exact: true })).toBeVisible();
    expect(screen.getByText('Rank 999999')).toBeVisible();
  });
});
