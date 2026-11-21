import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@/api/types';
import english from '@/i18n/en.json';
import { setGlobalLocale } from '@/lib/numberFormat';
import { typography } from '@/lib/tokens';
import postcss from 'postcss';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import type {
  ActionCenterRecommendation,
  ActionCenterState,
} from '@/types/actionCenter';

vi.unmock('react-i18next');
vi.unmock('@/lib/timezone');
const preferences = vi.hoisted((): Pick<AppSettings,
  'locale' | 'tz_display_default' | 'timezone_user' | 'decimal_precision'
  | 'unit_of_length' | 'unit_of_temp' | 'unit_of_pressure'
> => ({
  locale: 'en-US',
  tz_display_default: 'user',
  timezone_user: 'UTC',
  decimal_precision: 2,
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
}));
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
const historyMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/hooks/useActionCenter', () => {
  const history = {
    data: { items: [], total: 0, limit: 25, offset: 0 },
    isPending: false,
    isLoading: false,
    isFetching: false,
    isError: false,
    isPlaceholderData: false,
    error: null,
    fetchStatus: 'idle',
    dataUpdatedAt: Date.parse('2026-10-12T15:31:00Z'),
    refetch: vi.fn(),
  };
  return { useActionCenterHistory: (...args: unknown[]) => { historyMock(...args); return history; } };
});

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
  historyMock.mockReset();
  preferences.locale = 'en-US';
  preferences.tz_display_default = 'user';
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
  it('localizes private charging evidence without requesting shared history', async () => {
    i18n.addResourceBundle('de', 'translation', {
      smartCharging: {
        actionTitle: 'Vor der Fahrt laden',
        actionSummary: 'Akku {{battery}}%; Rückkehr {{low}}-{{high}}%; Reserve {{reserve}}%; {{place}}.',
        actionRationale: 'Aktuelle Signale.',
        actionBasisSignals: 'Aktuelle Daten',
        actionBasisEstimate: 'Eigene Schätzung',
        actionLimitationEstimate: 'Nur eine Schätzung.',
        actionLimitationWrites: 'Keine Befehle.',
        privateHistory: 'Private Aktionen stehen in den Einstellungen.',
      },
    }, true, true);
    await i18n.changeLanguage('de');
    const item: ActionCenterRecommendation = {
      ...recommendation, source_feature: 'smart_charging', related_sources: ['smart_charging'],
      safe_actions: ['navigate'], navigation_path: '/settings?vehicle_id=7#smart-charging',
      evidence: [{
        id: 'charging_plan:8', kind: 'charging_readiness', summary: 'English server evidence',
        provenance: { source: 'live_signal_store', record_id: 'charging_plan:8', source_url: null },
        observed_at: '2026-10-12T15:00:00Z',
        charging_readiness: {
          plan_id: 8, place_name: 'Synthetic charger', battery_pct: 45, arrival_low_pct: 0,
          arrival_high_pct: 10, reserve_pct: 20, departure_at: '2026-10-20T00:00:00Z',
        },
      }],
    };
    const original = structuredClone(item);
    render(card(item));
    expect(screen.getByText('Vor der Fahrt laden')).toBeVisible();
    expect(screen.getByText(/Akku .*Rückkehr .*Reserve .*Synthetic charger/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Evidence, scoring, and outcomes/ }));
    await waitFor(() => expect(screen.getByText('Private Aktionen stehen in den Einstellungen.')).toBeVisible());
    expect(historyMock).toHaveBeenLastCalledWith(item.id, false, { limit: 25, offset: 0 });
    expect(item).toEqual(original);
  });

  it('explains an unreachable outbound leg without inventing a return projection', async () => {
    const item: ActionCenterRecommendation = {
      ...recommendation, source_feature: 'smart_charging', related_sources: ['smart_charging'],
      safe_actions: ['navigate'], navigation_path: '/settings/smart-charging?vehicle_id=7',
      evidence: [{
        id: 'charging_plan:8', kind: 'charging_readiness', summary: 'Synthetic trip review',
        provenance: { source: 'live_signal_store', record_id: 'charging_plan:8', source_url: null },
        observed_at: '2026-10-12T15:00:00Z',
        charging_readiness: {
          plan_id: 8, kind: 'trip_review', place_name: 'Synthetic charger', battery_pct: 45,
          arrival_low_pct: 0, arrival_high_pct: 0, reserve_pct: 20, departure_at: '2026-10-20T00:00:00Z',
          trip_projection: {
            starting_battery_pct: 45, destination_low_pct: 0, destination_high_pct: 0,
            destination_reachability: 'unreachable', return_low_pct: null, return_high_pct: null,
            return_reachability: 'unknown', destination_charge_pct: 90,
          },
        },
      }],
    };
    render(card(item));
    expect(screen.getByText('Review a charging stop before your trip')).toBeVisible();
    expect(screen.getByText(/even the lower outbound estimate exceeds the available charge/)).toBeVisible();
    expect(screen.queryByText(/estimated return charge is/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Evidence, scoring, and outcomes/ }));
    await waitFor(() => {
      expect(screen.getAllByText(/destination charge; it is not confirmed or guaranteed/)[0]).toBeVisible();
    });
  });

  it('localizes sampled charging feasibility without describing the car as unplugged', async () => {
    preferences.locale = 'de-DE';
    setGlobalLocale('de-DE');
    i18n.addResourceBundle('de', 'translation', {
      smartCharging: {
        slowActionTitle: 'Laden reicht möglicherweise nicht aus',
        slowActionSummary: 'Bei {{power}}: {{low}}-{{high}}% bei Rückkehr, Reserve {{reserve}}%.',
        slowActionRationale: 'Aktuelle Ladeproben.',
        slowActionBasis: 'Gemessene Ladeleistung',
        actionBasisEstimate: 'Eigene Schätzung',
        slowActionLimitationEstimate: 'Die Leistung kann sich ändern.',
        slowActionLimitationWrites: 'Keine Einstellungen geändert.',
        slowCurrentEvidence: 'Angeforderter Strom {{requested}} A; gemeldetes Maximum {{maximum}} A.',
        slowCurrentBasis: 'Aktuelle Stromwerte',
        slowCurrentSafety: 'Prüfen Sie die Einstellungen und elektrischen Grenzen; das Maximum garantiert keine sichere oder hilfreiche Erhöhung.',
        privateHistory: 'Private Aktionen stehen in den Einstellungen.',
      },
    }, true, true);
    await i18n.changeLanguage('de');
    const item: ActionCenterRecommendation = {
      ...recommendation, source_feature: 'smart_charging', related_sources: ['smart_charging'],
      safe_actions: ['navigate'], navigation_path: '/charging/schedule?vehicle_id=7',
      evidence: [{
        id: 'charging_plan:8', kind: 'charging_feasibility', summary: 'English server evidence',
        provenance: { source: 'live_signal_store', record_id: 'charging_plan:8', source_url: null },
        observed_at: '2026-10-12T15:00:00Z',
        charging_readiness: {
          plan_id: 8, kind: 'slow_charging', place_name: 'Synthetic charger', battery_pct: 40,
          arrival_low_pct: 0, arrival_high_pct: 8, reserve_pct: 20,
          charging_power_w: 1200, current_limit: { requested_a: 12, maximum_a: 32 },
          departure_at: '2026-10-20T00:00:00Z',
        },
      }],
    };
    const original = structuredClone(item);
    render(card(item));
    expect(screen.getByText('Laden reicht möglicherweise nicht aus')).toBeVisible();
    expect(screen.getByText(/Bei 1,20 kW:.*Reserve 20/)).toBeVisible();
    expect(screen.getByText(/Angeforderter Strom 12,00 A; gemeldetes Maximum 32,00 A/)).toBeVisible();
    expect(screen.getByText(/Prüfen Sie die Einstellungen und elektrischen Grenzen/)).toBeVisible();
    expect(screen.getByText('Aktuelle Ladeproben.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Evidence, scoring, and outcomes/ }));
    expect((await screen.findAllByText('Die Leistung kann sich ändern.'))[0]).toBeVisible();
    expect(screen.getAllByText('Prüfen Sie die Einstellungen und elektrischen Grenzen; das Maximum garantiert keine sichere oder hilfreiche Erhöhung.')[0]).toBeVisible();
    expect(item).toEqual(original);
  });

  it('distinguishes an entered charging start from the reported vehicle clock time', async () => {
    const item: ActionCenterRecommendation = {
      ...recommendation, source_feature: 'smart_charging', related_sources: ['smart_charging'],
      safe_actions: ['navigate'], navigation_path: '/charging/schedule?vehicle_id=7',
      evidence: [{
        id: 'charging_plan:8', kind: 'charging_readiness', summary: 'Synthetic server evidence',
        provenance: { source: 'live_signal_store', record_id: 'charging_plan:8', source_url: null },
        observed_at: '2026-10-12T15:00:00Z',
        charging_readiness: {
          plan_id: 8, kind: 'schedule_conflict', place_name: 'Synthetic charger', battery_pct: 40,
          arrival_low_pct: 0, arrival_high_pct: 5, reserve_pct: 20,
          scheduled_start_at: '2026-10-20T01:00:00Z', departure_at: '2026-10-20T00:00:00Z',
        },
      }],
    };
    render(card(item));
    expect(screen.getByText('Review charging scheduled for departure or later')).toBeVisible();
    expect(screen.getByText(/If charging starts at the time you entered.*it will not add charge before departure/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Evidence, scoring, and outcomes/ }));
    expect((await screen.findAllByText(/reports a clock time, not the date of the next start/))[0]).toBeVisible();
  });

  it('localizes private recurring-drive evidence without changing the action payload', async () => {
    i18n.addResourceBundle('de', 'translation', {
      smartCommute: {
        weekdays: { tuesday: 'Dienstag' },
        question: 'Regelmäßige Fahrt am {{day}}?',
        actionSummary_other: '{{count}} Fahrten von {{start}} bis {{end}} ({{zone}}); Ziel {{destination}}.',
        actionRationale: 'Ähnliche lokale Fahrten.',
        actionBasisSample: 'Sieben Tage',
        actionBasisDriver: 'Fahrer unbekannt',
        actionLimitationIdentity: 'Kein Name abgeleitet.',
        actionLimitationWrites: 'Keine Befehle.',
        actionFreshness: { fresh: 'Aktuelle Grundlage' },
      },
    }, true, true);
    await i18n.changeLanguage('de');
    const item: ActionCenterRecommendation = {
      ...recommendation,
      source_feature: 'smart_commute',
      related_sources: ['smart_commute'],
      safe_actions: ['navigate'],
      navigation_path: '/settings?vehicle_id=7#smart-commute',
      freshness: { status: 'fresh', observed_at: '2026-10-12T15:00:00Z', age_s: 30 },
      evidence: [{
        id: 'routine:8', kind: 'recurring_drive', summary: 'English server evidence',
        provenance: { source: 'local_drive_analysis', record_id: 'routine:8', source_url: null },
        observed_at: '2026-10-12T15:00:00Z',
        recurring_drive: {
          routine_id: 8, weekday: 2, matching_days: 7, window_start_s: 28500, window_end_s: 29100,
          time_zone: 'America/Los_Angeles', destination_latitude: 47.2, destination_longitude: -122.2,
        },
      }],
    };
    const original = structuredClone(item);
    render(card(item));
    expect(screen.getByText('Regelmäßige Fahrt am Dienstag?')).toBeVisible();
    expect(screen.getByText('7 Fahrten von 07:55:00 bis 08:05:00 (America/Los_Angeles); Ziel 47.20000, -122.20000.')).toBeVisible();
    expect(screen.getByText('Ähnliche lokale Fahrten.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Evidence, scoring, and outcomes/ }));
    await waitFor(() => {
      expect(screen.getAllByText('Kein Name abgeleitet.')[0]).toBeVisible();
      expect(screen.getAllByText('Keine Befehle.')[0]).toBeVisible();
      expect(screen.getAllByText('7 Fahrten von 07:55:00 bis 08:05:00 (America/Los_Angeles); Ziel 47.20000, -122.20000.').length).toBeGreaterThan(1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open source' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith(item, 'navigate');
    expect(item).toEqual(original);
  });

  it('renders locale-selected 12-hour and 24-hour expiry in user vehicle and UTC display modes', () => {
    preferences.timezone_user = 'America/Los_Angeles';
    const original = structuredClone(recommendation);
    const { rerender } = render(card());
    expect(screen.getByText('Fixture vehicle · Expires Oct 19, 2026, 05:00 PM')).toBeVisible();

    preferences.locale = 'en-GB';
    rerender(card());
    expect(screen.getByText('Fixture vehicle · Expires 19 Oct 2026, 17:00')).toBeVisible();

    preferences.tz_display_default = 'vehicle';
    rerender(card());
    expect(screen.getByText('Fixture vehicle · Expires 20 Oct 2026, 09:00')).toBeVisible();

    preferences.tz_display_default = 'utc';
    rerender(card());
    expect(screen.getByText('Fixture vehicle · Expires 20 Oct 2026, 00:00')).toBeVisible();
    expect(recommendation).toEqual(original);
    expect(onAction).not.toHaveBeenCalled();
  });

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
  it('activates real tile/readout consumers without converting rank or confidence into progress', () => {
    const feedbackCss = readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8');
    const { container } = render(card());
    container.setAttribute('data-app-design-preview', '');
    for (const [name, value] of Object.entries(getAppDesignAttributes('v3'))) container.setAttribute(name, value);
    const release = observeAppDesignScopes(container);
    try {
      const tiles = container.querySelectorAll('[data-app-metric="tile"]');
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toHaveAttribute('data-app-design-owner', expect.stringContaining('data-ledger'));
      expect(tiles[0]).toHaveAttribute('data-app-metric-kind', 'recommendation-rank');
      expect(tiles[1]).toHaveAttribute('data-app-metric-kind', 'recommendation-confidence');
      expect(tiles[0].querySelector('[data-app-part~="metric-label"]')).toHaveTextContent('Rank');
      expect(tiles[0].querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('450');
      expect(tiles[1].querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent('86%');
      expect(tiles[1].querySelector('[data-app-part~="metric-context"]')).toHaveTextContent('High');
      const matched: string[] = [];
      postcss.parse(feedbackCss).walkRules(rule => {
        if (rule.selector.includes('[data-app-metric="tile"]') && rule.nodes.some(node => node.type === 'decl' && node.prop === 'grid-template-columns')) {
          matched.push(...rule.selectors.filter(selector => tiles[0].matches(selector)));
        }
      });
      expect(matched.some(selector => selector.includes('data-ledger'))).toBe(true);
      tiles[0].removeAttribute('data-app-design-owner');
      expect(matched.every(selector => !tiles[0].matches(selector))).toBe(true);
      expect(container.querySelector('[role="progressbar"], [role="meter"]')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(onAction).toHaveBeenCalledExactlyOnceWith(recommendation, 'dismiss');
    } finally { release(); }
  });

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
