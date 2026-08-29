import type { FsdInsights, FsdInsightsDay, FsdInsightsQuality, FsdInsightsTotals } from '@/types/fsd';

/**
 * Shared FSD Insights fixtures.
 *
 * Values are canonical SI meters exactly as `internal/api/fsd` returns them,
 * so component tests exercise the real conversion path rather than a
 * pre-converted shortcut.
 */

/**
 * Build one dense-series day, defaulting to a "nothing reported" day — the
 * self-driving distance defaults to `null`, not `0`, because that is what the
 * API emits when the counter had nothing to say.
 */
export function fsdDay(overrides: Partial<FsdInsightsDay> & { date: string }): FsdInsightsDay {
  return {
    fsd_distance_m: null,
    driving_distance_m: null,
    fsd_share_pct: null,
    fsd_observation_count: 0,
    driving_observation_count: 0,
    reset_count: 0,
    has_counter_observation: false,
    ...overrides,
  };
}

const BASE_TOTALS: FsdInsightsTotals = {
  fsd_distance_m: 16_093.44, // exactly 10 miles / 16.09344 km
  driving_distance_m: 64_373.76, // exactly 40 miles
  fsd_share_pct: 25,
  active_days: 3,
  measured_days: 28,
  days_in_period: 30,
  avg_measured_day_fsd_distance_m: 574.766,
  avg_active_day_fsd_distance_m: 5_364.48,
  best_day: {
    date: '2026-03-02',
    fsd_distance_m: 8_046.72, // exactly 5 miles
    driving_distance_m: 16_093.44,
    fsd_share_pct: 50,
  },
};

const BASE_QUALITY: FsdInsightsQuality = {
  fsd_sample_count: 12,
  driving_sample_count: 14,
  fsd_invalid_sample_count: 0,
  driving_invalid_sample_count: 0,
  fsd_duplicate_sample_count: 0,
  driving_duplicate_sample_count: 0,
  fsd_reset_count: 0,
  driving_reset_count: 0,
  fsd_baseline_available: true,
  driving_baseline_available: true,
  fsd_reported_in_period: true,
  driving_reported_in_period: true,
  fsd_distance_derivable: true,
  driving_denominator_available: true,
  share_basis_available: true,
  fsd_measured_days: 28,
  historical_data_guarded: true,
  required_normalization_version: 1,
  fsd_untrusted_sample_count: 0,
  driving_untrusted_sample_count: 0,
  counter_observation_days: 28,
  days_without_counter_observation: 2,
  counter_observation_day_pct: 93.33,
  first_observation_at: '2026-02-04T10:00:00Z',
  last_observation_at: '2026-03-02T19:00:00Z',
  fsd_first_observation_at: '2026-02-04T10:00:00Z',
  fsd_last_observation_at: '2026-03-02T19:00:00Z',
  share_clamped: false,
};

/**
 * A vehicle that streams MilesSinceReset all period and never emits
 * SelfDrivingMilesSinceReset. Every self-driving value is null, which is the
 * regression this fixture exists to guard.
 */
export function fsdDrivingOnlyInsights(): FsdInsights {
  return fsdInsights({
    totals: {
      ...BASE_TOTALS,
      fsd_distance_m: null,
      fsd_share_pct: null,
      active_days: 0,
      measured_days: 0,
      avg_measured_day_fsd_distance_m: null,
      avg_active_day_fsd_distance_m: null,
      best_day: null,
    },
    quality: {
      ...BASE_QUALITY,
      fsd_sample_count: 0,
      fsd_baseline_available: false,
      fsd_reported_in_period: false,
      fsd_distance_derivable: false,
      share_basis_available: false,
      fsd_measured_days: 0,
      fsd_first_observation_at: null,
      fsd_last_observation_at: null,
    },
    daily: [
      fsdDay({
        date: '2026-03-01',
        driving_distance_m: 16_093.44,
        driving_observation_count: 3,
        has_counter_observation: true,
      }),
      fsdDay({
        date: '2026-03-02',
        driving_distance_m: 16_093.44,
        driving_observation_count: 3,
        has_counter_observation: true,
      }),
      fsdDay({ date: '2026-03-03' }),
    ],
  });
}

const BASE_PERIOD = {
  days: 30,
  timezone: 'America/Los_Angeles',
  start_date: '2026-02-02',
  end_date: '2026-03-03',
  start_at: '2026-02-02T08:00:00Z',
  end_at: '2026-03-03T18:00:00Z',
} as const;

const BASE_DAILY: FsdInsightsDay[] = [
  fsdDay({
    date: '2026-03-01',
    fsd_distance_m: 4_023.36,
    driving_distance_m: 16_093.44,
    fsd_share_pct: 25,
    fsd_observation_count: 2,
    driving_observation_count: 3,
    has_counter_observation: true,
  }),
  fsdDay({
    date: '2026-03-02',
    fsd_distance_m: 8_046.72,
    driving_distance_m: 16_093.44,
    fsd_share_pct: 50,
    fsd_observation_count: 3,
    driving_observation_count: 3,
    has_counter_observation: true,
  }),
  // A day on which neither relevant distance counter reported — not a true zero.
  fsdDay({ date: '2026-03-03' }),
];

export function fsdInsights(overrides: Partial<FsdInsights> = {}): FsdInsights {
  return {
    vehicle_id: overrides.vehicle_id ?? 7,
    period: { ...BASE_PERIOD, ...(overrides.period ?? {}) },
    totals: { ...BASE_TOTALS, ...(overrides.totals ?? {}) },
    quality: { ...BASE_QUALITY, ...(overrides.quality ?? {}) },
    daily: overrides.daily ?? BASE_DAILY,
  };
}
