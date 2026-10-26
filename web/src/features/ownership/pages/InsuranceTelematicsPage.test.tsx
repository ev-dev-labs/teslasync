/**
 * InsuranceTelematicsPage — confirm-gated policy deletion.
 *
 * Removing the policy is destructive (telematics enrolment goes with it), so
 * the Remove button must open a danger confirm dialog naming the policy ref
 * instead of firing the mutation directly. Only the data hooks, vehicle
 * selection, and i18n are mocked; the page, buttons, and confirm dialog
 * render for real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const datePreferences = vi.hoisted(() => ({
  override: null as { locale: string; timezone: string } | null,
}));

vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return {
    ...actual,
    useSettings: () => {
      const result = actual.useSettings();
      const override = datePreferences.override;
      return override ? {
        ...result,
        locale: override.locale,
        settings: { ...result.settings, tz_display_default: 'user', timezone_user: override.timezone },
      } : result;
    },
  };
});

vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') {
      return interpolate(second, third as Record<string, unknown> | undefined);
    }
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/api/hooks/useOwnership', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useOwnership')>('@/api/hooks/useOwnership');
  return {
    ...actual,
    useInsuranceRiskProfile: vi.fn(),
    useUpsertInsurancePolicy: vi.fn(),
    useDeleteInsurancePolicy: vi.fn(),
  };
});

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useInsuranceRiskProfile,
  useUpsertInsurancePolicy,
  useDeleteInsurancePolicy,
} from '@/api/hooks/useOwnership';
import InsuranceTelematicsPage from './InsuranceTelematicsPage';
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { expectOperationalBand, summaryMetric } from '../components/operationalbrief-all/testAssertions';
import type { InsurancePolicy, InsuranceRiskProfile, RiskFactor, RiskLever, UpsertInsurancePolicyRequest } from '@/types/ownership';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockProfile = useInsuranceRiskProfile as unknown as ReturnType<typeof vi.fn>;
const mockUpsert = useUpsertInsurancePolicy as unknown as ReturnType<typeof vi.fn>;
const mockRemove = useDeleteInsurancePolicy as unknown as ReturnType<typeof vi.fn>;

function makePolicy(overrides: Partial<InsurancePolicy> = {}): InsurancePolicy {
  return {
    id: 1,
    vehicle_id: 7,
    insurer: 'SafeDrive',
    policy_ref: 'POL-001',
    currency: 'USD',
    annual_premium_minor: 120000,
    deductible_minor: 50000,
    coverage_start: '2026-01-01',
    coverage_end: null,
    telematics_program: true,
    max_discount_pct: 20,
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeQuery(data: unknown) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

function makeMutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, variables: undefined, ...overrides };
}

function makeProfile(overrides: Partial<InsuranceRiskProfile> = {}): InsuranceRiskProfile {
  return {
    vehicle_id: 7,
    timezone: 'UTC',
    window: { from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z', days: 60 },
    policy: makePolicy(),
    exposure_distance_m: 10000, exposure_duration_s: 3600,
    drive_count: 4, night_distance_m: 1000,
    risk_score: 35, risk_grade: 'standard', frequency_index: 1.1,
    severity_index: 0.9, loss_cost_index: 0.99, peer_percentile: null,
    factors: [], trend: [], levers: [],
    premium: {
      currency: 'USD', baseline_premium_minor: 120000, modelled_premium_minor: 108000,
      delta_minor: -12000, delta_pct: -10, applied_discount_pct: 10,
      max_discount_pct: 20, expected_loss_minor: 80000, deductible_minor: 50000,
      cost_per_distance_minor_per_m: 0.5,
    },
    evidence_packet_hash: 'untruncated-insurance-packet-digest',
    quality: { status: 'sufficient', sample_count: 4, coverage_pct: 100, window_start: null, window_end: null, reasons: [] },
    evidence: [],
    ...overrides,
  };
}

function card(title: string): HTMLElement {
  const element = screen.getByRole('heading', { name: title }).closest('[data-card]');
  if (!(element instanceof HTMLElement)) throw new Error(`Missing card: ${title}`);
  return element;
}

function briefByTitle(cardTitle: string, briefTitle: string): HTMLElement {
  const brief = within(card(cardTitle)).getByText(briefTitle).closest('[data-operational-brief]');
  if (!(brief instanceof HTMLElement)) throw new Error(`Missing brief: ${briefTitle}`);
  return brief;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <InsuranceTelematicsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  datePreferences.override = null;
  mockSelected.mockReturnValue({
    vehicleId: 7,
    vehicle: null,
    vehicles: [{ id: 7, display_name: 'Model 3' }],
    setVehicleId: vi.fn(),
  });
  mockProfile.mockReturnValue(
    makeQuery({
      vehicle_id: 7,
      policy: makePolicy(),
      premium: {
        currency: 'USD',
        delta_minor: -5000,
        delta_pct: -4,
        applied_discount_pct: 10,
        max_discount_pct: 20,
        expected_loss_minor: 80000,
        deductible_minor: 50000,
        cost_per_distance_minor_per_m: 5,
      },
      factors: [],
      levers: [],
    }),
  );
  mockUpsert.mockReturnValue(makeMutation());
  mockRemove.mockReturnValue(makeMutation());
});

describe('InsuranceTelematicsPage — confirm-gated delete', () => {
  it('refreshes chart and policy dates with locale and zone preferences without rewriting source or form instants', () => {
    const start = '2026-03-01T00:30:00Z';
    const end = '2026-03-02T00:30:00Z';
    const profile = makeProfile({
      window: { from: start, to: end, days: 1 },
      policy: makePolicy({ coverage_start: start, coverage_end: end }),
      trend: [
        { bucket_start: start, risk_score: 35, loss_cost_index: 0.99, distance_m: 10000, drive_count: 4 },
        { bucket_start: end, risk_score: 30, loss_cost_index: 0.9, distance_m: 5000, drive_count: 2 },
      ],
    });
    const source = JSON.stringify(profile);
    const mutate = vi.fn();
    mockProfile.mockReturnValue(makeQuery(profile));
    mockUpsert.mockReturnValue(makeMutation({ mutate }));
    datePreferences.override = { locale: 'en-US', timezone: 'America/Los_Angeles' };
    const view = renderScopePage();

    const trend = card('Risk trajectory');
    const premium = card('Premium simulation');
    expect(trend).toHaveTextContent('Feb 28, 2026');
    expect(mockProfile).toHaveBeenLastCalledWith(7, 90, 'America/Los_Angeles');
    expect(trend).not.toHaveTextContent('America/Los_Angeles');
    expect(premium).toHaveTextContent('Coverage Feb 28, 2026 → Mar 1, 2026');
    assertOperationalBriefDisclosure(
      briefByTitle('Underwriting position', 'Recorded driving exposure'),
      'Recorded bounds Feb 28, 2026, 04:30 PM',
      { contains: true },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit policy' }));
    expect(screen.getByLabelText('Coverage start', { exact: false })).toHaveValue('2026-03-01');
    expect(screen.getByLabelText('Coverage end (optional)')).toHaveValue('2026-03-02');

    datePreferences.override = { locale: 'en-US', timezone: 'UTC' };
    view.rerender(<InsuranceTelematicsPage />);
    expect(trend).toHaveTextContent('Mar 1, 2026');
    expect(trend).not.toHaveTextContent('Feb 28, 2026');
    expect(premium).toHaveTextContent('Coverage Mar 1, 2026 → Mar 2, 2026');

    datePreferences.override = { locale: 'de-DE', timezone: 'UTC' };
    view.rerender(<InsuranceTelematicsPage />);
    expect(trend).toHaveTextContent('1. März 2026');
    expect(premium).toHaveTextContent('Coverage 1. März 2026 → 2. März 2026');
    assertOperationalBriefDisclosure(
      briefByTitle('Underwriting position', 'Recorded driving exposure'),
      'Recorded bounds 1. März 2026',
      { contains: true },
    );
    expect(screen.getByLabelText('Coverage start', { exact: false })).toHaveValue('2026-03-01');
    const form = screen.getByRole('button', { name: 'Save policy baseline' }).closest('form');
    if (!form) throw new Error('Missing policy form');
    fireEvent.submit(form);
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ vehicle_id: 7, coverage_start: start, coverage_end: end }),
      expect.any(Object),
    );
    expect(JSON.stringify(profile)).toBe(source);
  });

  it.each([
    ['missing', undefined, 'neutral'],
    ['null', null, 'neutral'],
    ['invalid', Number.NaN, 'neutral'],
    ['positive infinity', Number.POSITIVE_INFINITY, 'neutral'],
    ['negative infinity', Number.NEGATIVE_INFINITY, 'neutral'],
    ['numeric text', '0.25', 'neutral'],
    ['measured zero', 0, 'neutral'],
    ['negative zero', -0, 'neutral'],
    ['positive fractional deviation', 0.25, 'warning'],
    ['small positive deviation', 0.001, 'warning'],
    ['negative fractional deviation', -0.25, 'success'],
    ['small negative deviation', -0.001, 'success'],
    ['maximum worsening', 3, 'warning'],
    ['maximum improving', -1, 'success'],
  ])('presents %s using signed factor semantics', (_label, score, tone) => {
    const factor: RiskFactor = {
      code: 'synthetic', label: 'Synthetic factor', narrative: 'Fixture evidence only',
      observed_rate: 3, baseline_rate: 2, rate_unit: 'fraction', score: 0,
      weight: 0.4, contribution_pct: 100, direction: 'higher_is_worse',
      sample_count: 19, percentile: null,
    };
    mockProfile.mockReturnValue(makeQuery({
      ...makeProfile(), factors: [{ ...factor, score }],
    }));
    renderPage();
    const row = within(card('Factor decomposition')).getAllByRole('row')[1];
    const scoreCell = within(row).getAllByRole('cell')[3];
    const value = scoreCell.querySelector('span');
    expect(value).toHaveClass(tone === 'neutral'
      ? 'text-[var(--text-secondary)]' : `text-[var(--semantic-${tone})]`);
    if (typeof score === 'number' && Number.isFinite(score)) {
      expect(scoreCell).not.toHaveTextContent('—');
      if (score !== 0) expect(scoreCell.textContent).toContain(String(score));
      else expect(scoreCell).toHaveTextContent('0');
    } else expect(scoreCell).toHaveTextContent('—');
    expect(row).toHaveTextContent('Higher is worse');
    expect(row).toHaveTextContent('Fixture evidence only');
  });

  it('does not invert an already normalized score for a higher-is-better factor', () => {
    mockProfile.mockReturnValue(makeQuery(makeProfile({
      factors: [{
        code: 'regen', label: 'Synthetic regen', narrative: 'Fixture evidence only',
        observed_rate: 0.175, baseline_rate: 0.14, rate_unit: 'fraction', score: -0.25,
        weight: 0.06, contribution_pct: 100, direction: 'higher_is_better',
        sample_count: 19, percentile: null,
      }],
    })));
    renderPage();
    const row = within(card('Factor decomposition')).getAllByRole('row')[1];
    expect(within(row).getAllByRole('cell')[3].querySelector('span'))
      .toHaveClass('text-[var(--semantic-success)]');
    expect(row).toHaveTextContent('-0.25');
    expect(row).toHaveTextContent('Higher is better');
  });

  it.each([null, 0, 35, 100])('does not present returned percentile %s as a peer or history comparison', (percentile) => {
    const profile = makeProfile({ peer_percentile: percentile });
    mockProfile.mockReturnValue(makeQuery(profile));
    renderPage();

    assertOperationalMetricUnavailable(
      briefByTitle('Underwriting position', 'Recorded driving exposure'),
      'Peer percentile',
    );
    expect(card('Underwriting position')).not.toHaveTextContent('Against your own history distribution');
    expect(card('Underwriting position')).not.toHaveTextContent('peer percentile compares against your own history');
    expect(summaryMetric('Underwriting position', 'score')).toHaveTextContent('35');
    expect(summaryMetric('Underwriting position', 'frequency')).toHaveTextContent('1.1');
    expect(summaryMetric('Underwriting position', 'severity')).toHaveTextContent('0.9');
    expect(summaryMetric('Underwriting position', 'exposure')).toHaveTextContent('10.00 km');
    expect(summaryMetric('Premium simulation', 'modelled')).toHaveTextContent('$1,080.00');
    const exposureBrief = briefByTitle('Underwriting position', 'Recorded driving exposure');
    fireEvent.click(within(exposureBrief).getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByRole('group', { name: 'Exposure distance' }))
      .toHaveTextContent('4 drives');
    expect(profile.peer_percentile).toBe(percentile);
  });

  it('separates measured zero exposure from an insufficient, uncomputed model without changing the response', () => {
    const reason = 'no completed drives with distance and duration in the selected window';
    const profile = makeProfile({
      exposure_distance_m: 0, exposure_duration_s: 0, drive_count: 0, night_distance_m: 0,
      risk_score: 0, risk_grade: 'standard', frequency_index: 1, severity_index: 1,
      loss_cost_index: 1, peer_percentile: 0,
      quality: { status: 'insufficient', sample_count: 0, coverage_pct: null,
        window_start: null, window_end: null, reasons: [reason] },
    });
    mockProfile.mockReturnValue(makeQuery(profile));
    renderPage();

    const modelBrief = briefByTitle('Underwriting position', 'Modelled underwriting indices');
    for (const label of ['Risk score', 'Frequency index', 'Severity index', 'Loss cost index']) {
      assertOperationalMetricUnavailable(modelBrief, label);
    }
    const exposureBrief = briefByTitle('Underwriting position', 'Recorded driving exposure');
    assertOperationalMetricUnavailable(exposureBrief, 'Peer percentile');
    for (const key of ['exposure', 'duration', 'night']) {
      expect(summaryMetric('Underwriting position', key)).toHaveAttribute('data-value-state', 'value');
    }
    expect(summaryMetric('Underwriting position', 'exposure')).toHaveTextContent('0.00 km');
    fireEvent.click(within(exposureBrief).getByRole('button', { name: 'Review details' }));
    const exposureDrawer = screen.getByRole('dialog');
    expect(within(exposureDrawer).getByRole('group', { name: 'Exposure distance' }))
      .toHaveTextContent('0 drives');
    fireEvent.keyDown(exposureDrawer, { key: 'Escape' });
    const premiumBrief = briefByTitle('Premium simulation', 'Policy-based premium model');
    for (const label of ['Modelled annual premium', 'Difference', 'Applied discount']) {
      assertOperationalMetricUnavailable(premiumBrief, label);
    }
    const costBrief = briefByTitle('Premium simulation', 'Policy loss and distance costs');
    for (const label of ['Expected annual loss', 'Cost per distance']) {
      assertOperationalMetricUnavailable(costBrief, label);
    }
    expect(summaryMetric('Premium simulation', 'baseline')).toHaveTextContent('$1,200.00');
    expect(summaryMetric('Premium simulation', 'deductible')).toHaveTextContent('$500.00');
    expect(card('Underwriting position')).toHaveTextContent('Not computed');
    expect(card('Risk trajectory')).toHaveTextContent(reason);
    expect(card('Underwriting position')).not.toHaveTextContent('Standard');
    expect(profile.risk_score).toBe(0);
    expect(profile.frequency_index).toBe(1);
    expect(profile.premium?.modelled_premium_minor).toBe(108000);
  });

  it.each([
    ['missing', undefined, 'missing'],
    ['invalid', Number.NaN, 'invalid'],
    ['infinite', Number.POSITIVE_INFINITY, 'invalid'],
    ['measured zero', 0, 'value'],
    ['fractional', 0.25, 'value'],
  ])('keeps %s risk input distinct from a computed numeric value', (_label, riskScore, state) => {
    mockProfile.mockReturnValue(makeQuery({ ...makeProfile(), risk_score: riskScore }));
    renderPage();
    if (state === 'value') {
      expect(summaryMetric('Underwriting position', 'score')).toHaveAttribute('data-value-state', state);
    } else {
      assertOperationalMetricUnavailable(
        briefByTitle('Underwriting position', 'Modelled underwriting indices'),
        'Risk score',
      );
    }
  });

  it.each([
    [null, 'missing'],
    [Number.NaN, 'invalid'],
    [Number.NEGATIVE_INFINITY, 'invalid'],
    [0, 'value'],
    [0.25, 'value'],
  ])('validates recorded exposure independently of model availability (%s)', (distance, state) => {
    mockProfile.mockReturnValue(makeQuery({
      ...makeProfile(),
      exposure_distance_m: distance,
      quality: { status: 'insufficient', sample_count: 0, coverage_pct: null,
        window_start: null, window_end: null, reasons: ['Insufficient driving evidence'] },
    }));
    renderPage();
    if (state === 'value') {
      expect(summaryMetric('Underwriting position', 'exposure')).toHaveAttribute('data-value-state', state);
    } else {
      assertOperationalMetricUnavailable(
        briefByTitle('Underwriting position', 'Recorded driving exposure'),
        'Exposure distance',
      );
    }
    assertOperationalMetricUnavailable(
      briefByTitle('Underwriting position', 'Modelled underwriting indices'),
      'Risk score',
    );
  });

  it.each([-1250, 1250])('preserves signed premium difference %s and fractional model indices', (delta) => {
    const profile = makeProfile({ risk_score: 0, frequency_index: 0.25, severity_index: 1.75 });
    mockProfile.mockReturnValue(makeQuery({
      ...profile, premium: { ...profile.premium, delta_minor: delta, delta_pct: delta / 1000 },
    }));
    renderPage();
    expect(summaryMetric('Underwriting position', 'score')).toHaveAttribute('data-value-state', 'value');
    expect(summaryMetric('Underwriting position', 'frequency')).toHaveTextContent('0.25');
    expect(summaryMetric('Underwriting position', 'severity')).toHaveTextContent('1.75');
    expect(summaryMetric('Premium simulation', 'delta')).toHaveTextContent(delta < 0 ? '-$12.50' : '$12.50');
  });

  it.each([1000, 0])('labels %s m as a selected-clock trip-start proxy without claiming measured night distance', (nightDistance) => {
    datePreferences.override = { locale: 'en-US', timezone: 'America/Los_Angeles' };
    const profile = makeProfile({ night_distance_m: nightDistance, timezone: 'America/Los_Angeles' });
    const source = JSON.stringify(profile);
    mockProfile.mockReturnValue(makeQuery(profile));
    renderPage();

    const metric = summaryMetric('Underwriting position', 'night');
    expect(metric).toHaveAttribute('data-value-state', 'value');
    expect(metric).toHaveTextContent('Distance of trips starting overnight');
    expect(metric).toHaveTextContent(nightDistance ? '1.00 km' : '0.00 km');
    const exposureBrief = briefByTitle('Underwriting position', 'Recorded driving exposure');
    fireEvent.click(within(exposureBrief).getByRole('button', { name: 'Review details' }));
    const group = within(screen.getByRole('dialog'))
      .getByRole('group', { name: 'Distance of trips starting overnight' });
    expect(group).toHaveTextContent('at or after 22:00 or before 05:00 in the selected clock');
    expect(group).toHaveTextContent('Includes distance outside the band on qualifying trips');
    expect(group).toHaveTextContent('excludes distance inside the band on other trips');
    expect(group).toHaveTextContent('neither an upper nor a lower bound on actual night distance');
    expect(group).toHaveTextContent('Actual night-distance measurement requires owned model support');
    expect(group).toHaveTextContent(nightDistance ? /10(?:\.0+)?%/ : /0(?:\.0+)?%/);
    expect(JSON.stringify(profile)).toBe(source);
  });

  it('retains all four real briefs with exposure, policy units, caps and no insurer-quote claim', () => {
    mockProfile.mockReturnValue(makeQuery(makeProfile()));
    renderPage();
    expectOperationalBand('Underwriting position', [
      'score', 'frequency', 'severity', 'losscost', 'exposure', 'duration', 'night',
    ]);
    const exposureBrief = briefByTitle('Underwriting position', 'Recorded driving exposure');
    assertOperationalMetricUnavailable(exposureBrief, 'Peer percentile');
    expectOperationalBand('Premium simulation', [
      'baseline', 'modelled', 'delta', 'discount', 'expected', 'deductible', 'perDistance',
    ]);
    fireEvent.click(within(exposureBrief).getByRole('button', { name: 'Review details' }));
    const exposureDrawer = screen.getByRole('dialog');
    expect(within(exposureDrawer).getByRole('group', { name: 'Distance of trips starting overnight' }))
      .toHaveTextContent(/10(?:\.0+)?%/);
    fireEvent.keyDown(exposureDrawer, { key: 'Escape' });
    expect(summaryMetric('Premium simulation', 'perDistance')).toHaveTextContent('$5.00 / 1000 m');
    expect(summaryMetric('Premium simulation', 'discount')).toHaveAttribute('data-value-state', 'value');
    const briefs = card('Premium simulation').querySelectorAll('[data-operational-brief]');
    expect(briefs).toHaveLength(2);
    const brief = briefs[0];
    if (!(brief instanceof HTMLElement)) throw new Error('Missing premium brief');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('never an insurer quote');
    expect(within(drawer).getByRole('group', { name: 'Applied discount' }))
      .toHaveTextContent(/Cap 20(?:\.0+)?%/);
    expect(mockUpsert().mutate).not.toHaveBeenCalled();
  });

  it.each([
    [0, '0'],
    [0.45, '45'],
    [0.545, '54.50'],
    [0.7, '70'],
    [0.95, '95'],
    [1, '100'],
  ])('displays confidence fraction %s as a percentage without changing the response', (confidence, percentage) => {
    const lever: RiskLever = {
      factor_code: 'speed_exposure', label: 'Lower motorway cruise speed',
      payoff_rank: 1, target_reduction_pct: 25, projected_score_delta: -4,
      projected_premium_save_minor: 900, difficulty: 'moderate',
      effort_hours_per_week: 0.25, confidence,
    };
    const profile = makeProfile({ levers: [lever] });
    mockProfile.mockReturnValue(makeQuery(profile));
    renderPage();

    const table = within(card('Ranked improvement levers')).getByRole('table');
    const headers = within(table).getAllByRole('columnheader');
    const confidenceIndex = headers.findIndex(header => header.textContent === 'Confidence');
    expect(confidenceIndex).toBeGreaterThanOrEqual(0);
    const row = within(table).getAllByRole('row')[1];
    const cell = within(row).getAllByRole('cell')[confidenceIndex];
    expect(cell.textContent).toMatch(new RegExp(`^${percentage.replace('.', '\\.')}(?:\\.0+)?%$`));
    expect(row).toHaveTextContent('Lower motorway cruise speed');
    expect(row).toHaveTextContent('$9.00');
    expect(profile.levers[0].confidence).toBe(confidence);
  });

  function renderScopePage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<InsuranceTelematicsPage />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter>
      ),
    });
  }

  function selectScope(id: number, profile = makeProfile({ vehicle_id: id, policy: null, premium: null })) {
    mockSelected.mockReturnValue({ vehicleId: id, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
    mockProfile.mockReturnValue(makeQuery(profile));
  }

  describe('InsuranceTelematicsPage — preserved scope and complete tables', () => {
    it('retains the original vehicle draft but blocks a cross-vehicle save', () => {
      const mutate = vi.fn();
      mockUpsert.mockReturnValue(makeMutation({ mutate }));
      const view = renderScopePage();
      fireEvent.click(screen.getByRole('button', { name: 'Edit policy' }));
      const insurer = screen.getByRole('textbox', { name: 'Insurer required' });
      expect(insurer).toHaveFocus();
      fireEvent.change(insurer, { target: { value: 'Synthetic draft' } });
      selectScope(8);
      view.rerender(<InsuranceTelematicsPage />);
      expect(insurer).toHaveValue('Synthetic draft');
      expect(screen.getByText(/This form belongs to Vehicle 7/)).toBeInTheDocument();
      const save = screen.getByRole('button', { name: 'Save policy baseline' });
      expect(save).toBeDisabled();
      const form = save.closest('form');
      if (!form) throw new Error('Missing policy form');
      fireEvent.submit(form);
      expect(mutate).not.toHaveBeenCalled();
    });

    it('initializes a new policy after cancel and restores the invoking action focus', () => {
      const view = renderScopePage();
      const edit = screen.getByRole('button', { name: 'Edit policy' });
      fireEvent.click(edit);
      fireEvent.change(screen.getByRole('textbox', { name: 'Insurer required' }), { target: { value: 'Discarded draft' } });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(edit).toHaveFocus();
      selectScope(8);
      view.rerender(<InsuranceTelematicsPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Add policy' }));
      expect(screen.getByRole('textbox', { name: 'Insurer required' })).toHaveValue('');
      expect(screen.getByRole('textbox', { name: 'Policy reference required' })).toHaveValue('');
      expect(screen.getByRole('spinbutton', { name: 'Annual premium required' })).toHaveValue(120000);
      expect(mockUpsert().mutate).not.toHaveBeenCalled();
    });

    it('pins submitted policy values and prevents duplicate submission while retaining a rejected draft', () => {
      const mutate = vi.fn((_request: UpsertInsurancePolicyRequest, _callbacks?: { onSettled?: () => void }) => undefined);
      mockUpsert.mockReturnValue(makeMutation({ mutate }));
      const view = renderScopePage();
      fireEvent.click(screen.getByRole('button', { name: 'Edit policy' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Insurer required' }), { target: { value: '  Synthetic edited  ' } });
      const form = screen.getByRole('button', { name: 'Save policy baseline' }).closest('form');
      if (!form) throw new Error('Missing policy form');
      fireEvent.submit(form);
      fireEvent.submit(form);
      expect(mutate).toHaveBeenCalledTimes(1);
      expect(mutate.mock.calls[0][0]).toMatchObject({
        vehicle_id: 7, insurer: '  Synthetic edited  ', policy_ref: 'POL-001',
        annual_premium_minor: 120000, deductible_minor: 50000, telematics_program: true,
      });
      mockUpsert.mockReturnValue(makeMutation({ mutate, error: new Error('Synthetic request rejected') }));
      act(() => mutate.mock.calls[0][1]?.onSettled?.());
      view.rerender(<InsuranceTelematicsPage />);
      expect(screen.getByRole('textbox', { name: 'Insurer required' })).toHaveValue('  Synthetic edited  ');
      expect(screen.getByText('Synthetic request rejected')).toBeInTheDocument();
      fireEvent.change(screen.getByRole('textbox', { name: 'Insurer required' }), { target: { value: 'Synthetic retry' } });
      fireEvent.submit(form);
      expect(mutate).toHaveBeenCalledTimes(2);
      expect(mutate.mock.calls[1][0]).toMatchObject({ vehicle_id: 7, insurer: 'Synthetic retry' });
    });

    it('retains a confirmed original-target save after scope change without allowing another submission', () => {
      const mutate = vi.fn((_request: UpsertInsurancePolicyRequest, _callbacks?: { onSuccess?: () => void; onSettled?: () => void }) => undefined);
      mockUpsert.mockReturnValue(makeMutation({ mutate }));
      const view = renderScopePage();
      fireEvent.click(screen.getByRole('button', { name: 'Edit policy' }));
      const form = screen.getByRole('button', { name: 'Save policy baseline' }).closest('form');
      if (!form) throw new Error('Missing policy form');
      fireEvent.submit(form);
      selectScope(8);
      view.rerender(<InsuranceTelematicsPage />);
      act(() => {
        mutate.mock.calls[0][1]?.onSuccess?.();
        mutate.mock.calls[0][1]?.onSettled?.();
      });
      expect(screen.getByRole('textbox', { name: 'Insurer required' })).toHaveValue('SafeDrive');
      expect(screen.getByText('Changes saved')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save policy baseline' })).toBeDisabled();
      selectScope(7);
      view.rerender(<InsuranceTelematicsPage />);
      fireEvent.submit(form);
      expect(mutate).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
    });

    it('does not delete a confirmed policy after the selected vehicle changes', async () => {
      const mutate = vi.fn();
      mockRemove.mockReturnValue(makeMutation({ mutate }));
      const view = renderScopePage();
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      selectScope(8);
      view.rerender(<InsuranceTelematicsPage />);
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(mutate).not.toHaveBeenCalled();
    });

    it('keeps all factor and lever fields reachable and sorts by raw values without changing source order', () => {
      const factor = (code: string, score: number, contribution: number): RiskFactor => ({
        code, label: `Synthetic ${code}`, narrative: 'Fixture evidence only', observed_rate: 3,
        baseline_rate: 2, rate_unit: 'events/m', score, weight: 0.4, contribution_pct: contribution,
        direction: 'higher_is_worse', sample_count: 19, percentile: null,
      });
      const lever = (factor_code: string, saving: number | null): RiskLever => ({
        factor_code, label: `Synthetic ${factor_code}`, payoff_rank: 1, target_reduction_pct: 10,
        projected_score_delta: 4, projected_premium_save_minor: saving, difficulty: 'moderate',
        effort_hours_per_week: 2, confidence: 0.7,
      });
      const factors = [factor('first', 12, 70), factor('second', 85, 20)];
      const levers = [lever('first', 100), lever('second', 900), lever('unknown', null)];
      mockProfile.mockReturnValue(makeQuery(makeProfile({ factors, levers })));
      renderPage();
      const factorTable = within(card('Factor decomposition')).getByRole('table');
      const leverTable = within(card('Ranked improvement levers')).getByRole('table');
      for (const name of ['Observed', 'Baseline', 'Weight', 'Direction', 'Samples']) {
        expect(within(factorTable).getByRole('columnheader', { name })).not.toHaveClass('hidden');
      }
      for (const name of ['Rank', 'Target reduction', 'Risk score delta', 'Effort', 'Confidence']) {
        expect(within(leverTable).getByRole('columnheader', { name })).not.toHaveClass('hidden');
      }
      const labels = (table: HTMLElement) => within(table).getAllByRole('row').slice(1).map(row => row.textContent);
      expect(labels(factorTable)[0]).toContain('Synthetic first');
      fireEvent.click(within(factorTable).getByRole('button', { name: /Score/ }));
      expect(labels(factorTable)[0]).toContain('Synthetic second');
      fireEvent.click(within(factorTable).getByRole('button', { name: /Contribution/ }));
      expect(labels(factorTable)[0]).toContain('Synthetic first');
      fireEvent.click(within(leverTable).getByRole('button', { name: /Projected saving/ }));
      expect(labels(leverTable)[0]).toContain('Synthetic second');
      expect(labels(leverTable).at(-1)).toContain('Synthetic unknown');
      expect(labels(leverTable).at(-1)).toContain('—');
      fireEvent.click(within(leverTable).getByRole('button', { name: /Projected saving/ }));
      expect(labels(leverTable)[0]).toContain('Synthetic first');
      expect(labels(leverTable).at(-1)).toContain('Synthetic unknown');
      expect(factors.map(row => row.code)).toEqual(['first', 'second']);
      expect(levers.map(row => row.factor_code)).toEqual(['first', 'second', 'unknown']);
    });
  });

  it('discloses the limited checksum scope without claiming complete evidence or verified identity', () => {
    const profile = makeProfile({
      factors: [{
        code: 'synthetic', label: 'Synthetic factor', narrative: 'Fixture evidence only',
        observed_rate: 3, baseline_rate: 2, rate_unit: 'events/m', score: 0.25,
        weight: 0.4, contribution_pct: 100, direction: 'higher_is_worse',
        sample_count: 19, percentile: null,
      }],
    });
    mockProfile.mockReturnValue(makeQuery(profile));
    renderPage();

    const checksum = card('Risk-summary checksum');
    expect(checksum).toHaveTextContent('Limited risk-summary checksum (SHA-256)');
    expect(checksum).toHaveTextContent('vehicle ID, window bounds');
    expect(checksum).toHaveTextContent('ordered factor codes and observed rates at fixed precision');
    expect(checksum).toHaveTextContent('It does not verify identity or hash the complete evidence packet');
    expect(checksum).toHaveTextContent('raw exposure, other factor details, policy, premium, trend and evidence are not included');
    expect(checksum).toHaveTextContent('Matching checksums do not establish that the complete datasets are identical');
    expect(within(checksum).getByText(profile.evidence_packet_hash)).toBeInTheDocument();
    expect(screen.queryByText(/A stable content hash over the exposure/)).not.toBeInTheDocument();
    expect(card('Factor decomposition')).toHaveTextContent('Synthetic factor');
    expect(card('Premium simulation')).toHaveTextContent('$1,080.00');
    expect(summaryMetric('Underwriting position', 'exposure')).toHaveAttribute('data-value-state', 'value');
    expect(summaryMetric('Underwriting position', 'duration')).toHaveAttribute('data-value-state', 'value');
    const exposureBrief = briefByTitle('Underwriting position', 'Recorded driving exposure');
    fireEvent.click(within(exposureBrief).getByRole('button', { name: 'Review details' }));
    const exposureDrawer = screen.getByRole('dialog');
    expect(within(exposureDrawer).getByRole('group', { name: 'Exposure distance' }))
      .toHaveTextContent('4 drives');
    expect(within(exposureDrawer).getByRole('group', { name: 'Distance of trips starting overnight' }))
      .toHaveTextContent(/10(?:\.0+)?%/);
    fireEvent.keyDown(exposureDrawer, { key: 'Escape' });
    assertOperationalBriefDisclosure(exposureBrief, 'Recorded bounds', { contains: true });
    expect(card('Underwriting position')).not.toHaveTextContent('Recorded analysis bounds not supplied');
    expect(profile.exposure_distance_m).toBe(10000);
    expect(profile.window).toEqual({ from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z', days: 60 });
  });

  it('keeps every modelled premium amount, cap and full digest during a refresh failure', () => {
    const refetch = vi.fn();
    mockProfile.mockReturnValue({ ...makeQuery(makeProfile()), error: new Error('refresh failed'), refetch });
    renderPage();

    const premium = card('Premium simulation');
    expect(premium).toHaveTextContent('Baseline annual premium');
    expect(premium).toHaveTextContent('$1,200.00');
    expect(premium).toHaveTextContent('Modelled annual premium');
    expect(premium).toHaveTextContent('$1,080.00');
    expect(premium).toHaveTextContent('-$120.00');
    expect(within(premium).getByText('Applied discount').parentElement).toHaveTextContent(/10(?:\.0+)?%/);
    const premiumBrief = briefByTitle('Premium simulation', 'Policy-based premium model');
    fireEvent.click(within(premiumBrief).getByRole('button', { name: 'Review details' }));
    const premiumDrawer = screen.getByRole('dialog');
    expect(within(premiumDrawer).getByRole('group', { name: 'Applied discount' }))
      .toHaveTextContent(/Cap 20(?:\.0+)?%/);
    fireEvent.keyDown(premiumDrawer, { key: 'Escape' });
    expect(premium).toHaveTextContent('Expected annual loss');
    expect(premium).toHaveTextContent('$800.00');
    expect(premium).toHaveTextContent('Deductible');
    expect(premium).toHaveTextContent('$500.00');
    expect(premium).toHaveTextContent('$5.00 / 1000 m');
    expect(premium).toHaveTextContent('SafeDrive · POL-001');
    expect(within(premium).getByRole('button', { name: 'Edit policy' })).toBeEnabled();
    expect(screen.getByText('untruncated-insurance-packet-digest')).toBeInTheDocument();
    expect(within(premium).getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(within(premium).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(mockUpsert().mutate).not.toHaveBeenCalled();
  });

  it('does not promote the default editor premium to an observed premium without a stored policy', () => {
    mockProfile.mockReturnValue(makeQuery(makeProfile({ policy: null, premium: null })));
    renderPage();

    const premium = card('Premium simulation');
    expect(within(premium).getByText('Register a policy below to simulate a telematics-adjusted premium.')).toBeInTheDocument();
    expect(within(premium).queryByText('$1,200.00')).not.toBeInTheDocument();
    expect(within(premium).queryByText('$0.00')).not.toBeInTheDocument();
    expect(card('Underwriting position')).toHaveTextContent('Frequency index');
    fireEvent.click(within(premium).getByRole('button', { name: 'Add policy' }));
    expect(screen.getByRole('spinbutton', { name: 'Annual premium required' })).toHaveValue(120000);
    expect(mockUpsert().mutate).not.toHaveBeenCalled();
  });

  it('keeps uncomputed loss and distance pricing unknown while preserving a real zero deductible', () => {
    const profile = makeProfile();
    mockProfile.mockReturnValue(makeQuery({
      ...profile,
      premium: { ...profile.premium, expected_loss_minor: null, cost_per_distance_minor_per_m: null, deductible_minor: 0 },
    }));
    renderPage();
    const premium = card('Premium simulation');
    const costBrief = briefByTitle('Premium simulation', 'Policy loss and distance costs');
    assertOperationalMetricUnavailable(costBrief, 'Expected annual loss');
    assertOperationalMetricUnavailable(costBrief, 'Cost per distance');
    expect(within(premium).getByText('Deductible').parentElement).toHaveTextContent('$0.00');
  });

  it('opens a danger confirm naming the policy instead of deleting on click', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete this policy?')).toBeInTheDocument();
    expect(dialog.textContent).toContain('POL-001');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('deletes only after the dialog is confirmed', async () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not delete when the dialog is cancelled', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks the button pending while the mutation is in flight', () => {
    mockRemove.mockReturnValue(makeMutation({ isPending: true, variables: 1 }));
    renderPage();

    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });
});
