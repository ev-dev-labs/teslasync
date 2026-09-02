import type {
  FsdDriveAnalytics,
  FsdInsights,
  FsdInsightsDay,
  FsdInsightsQuality,
  FsdInsightsTotals,
} from '@/types/fsd';

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

const BASE_DRIVE_ANALYTICS: FsdDriveAnalytics = {
  comparison: {
    previous_period: {
      ...BASE_PERIOD,
      start_date: '2026-01-03',
      end_date: '2026-02-01',
      start_at: '2026-01-03T08:00:00Z',
      end_at: '2026-02-02T07:59:59Z',
    },
    previous_fsd_distance_m: 12_000,
    previous_driving_distance_m: 60_000,
    previous_fsd_share_pct: 20,
    fsd_distance_change_m: 4_093.44,
    fsd_distance_change_pct: 34.11,
    fsd_share_change_pct_points: 5,
  },
  attribution: {
    attributed_distance_m: 12_000,
    estimated_distance_m: 2_000,
    ambiguous_distance_m: 1_000,
    unattributed_distance_m: 1_093.44,
    unknown_drive_distance_m: 5_000,
  },
  contributing_drives: [{
    drive_id: 295,
    started_at: '2026-03-02T17:00:00Z',
    ended_at: '2026-03-02T17:30:00Z',
    start_place: 'Home',
    end_place: 'Office',
    distance_m: 10_000,
    energy_used_wh: 1_800,
    fsd_distance_m: 8_000,
    fsd_share_pct: 80,
    confidence: 'high',
    reset_affected: false,
    firmware_version: '2026.20.3',
    evidence_truncated: false,
    evidence: [{
      start_at: '2026-03-02T17:05:00Z',
      end_at: '2026-03-02T17:20:00Z',
      fsd_distance_m: 8_000,
      confidence: 'high',
      approximate: true,
    }],
  }],
  reset_events: [],
  commute_identities: [{
    route_key: 'place:home:office',
    route_label: 'Home to Office',
    window_key: 'evening',
    window_label: 'Evening (17:00-21:59)',
    this_month: {
      month: '2026-03',
      drive_count: 2,
      fsd_distance_m: 16_000,
      driving_distance_m: 20_000,
      fsd_share_pct: 80,
      confidence: 'high',
      unknown_days: 0,
    },
    last_month: {
      month: '2026-02',
      drive_count: 3,
      fsd_distance_m: 12_000,
      driving_distance_m: 30_000,
      fsd_share_pct: 40,
      confidence: 'high',
      unknown_days: 0,
    },
    share_change_pct_points: 40,
    honesty: 'Same route and time-of-day window. Month-over-month supervised share is a trip-meter correlation, not proof FSD improved.',
  }],
  repeated_routes: [{
    key: 'geofence:1:2',
    label: 'Home to Office',
    drive_count: 4,
    driving_distance_m: 40_000,
    fsd_distance_m: 24_000,
    fsd_share_pct: 60,
  }],
  time_of_day: [{
    key: 'morning',
    label: 'Morning (05:00-11:59)',
    drive_count: 3,
    driving_distance_m: 30_000,
    fsd_distance_m: 18_000,
    fsd_share_pct: 60,
  }],
  firmware: [{
    key: '2026.20.3',
    label: '2026.20.3',
    drive_count: 4,
    driving_distance_m: 40_000,
    fsd_distance_m: 24_000,
    fsd_share_pct: 60,
  }],
  firmware_spotlight: {
    from_version: '2026.8.1',
    to_version: '2026.20.3',
    changed_at: '2026-03-01T08:00:00Z',
    routes: [{
      route_key: 'geofence:1:2',
      route_label: 'Home to Office',
      before_drive_count: 3,
      after_drive_count: 2,
      before_fsd_distance_m: 12_000,
      after_fsd_distance_m: 16_000,
      before_driving_distance_m: 30_000,
      after_driving_distance_m: 20_000,
      before_fsd_share_pct: 40,
      after_fsd_share_pct: 80,
      share_change_pct_points: 40,
    }],
  },
  route_efficiency: [],
  observatory: {
    honesty:
      'Every kilometre here is a reset-safe counter change, not an FSD engagement segment. Unknown and ambiguous distance are shown instead of guessed.',
    truncated: false,
    totals: {
      stitched_fsd_distance_m: 14_000,
      high_fsd_distance_m: 12_000,
      estimated_fsd_distance_m: 2_000,
      ambiguous_fsd_distance_m: 1_000,
      unknown_drive_distance_m: 5_000,
      reset_break_count: 1,
      drive_count: 3,
      measured_drive_count: 2,
      unknown_drive_count: 1,
    },
    timeline: [
      {
        kind: 'drive',
        at: '2026-03-01T17:00:00Z',
        end_at: '2026-03-01T17:30:00Z',
        drive_id: 280,
        route_key: 'place:home:office',
        route_label: 'Home to Office',
        firmware_version: '2026.8.1',
        fsd_distance_m: null,
        driving_distance_m: 10_000,
        confidence: 'unknown',
        reset_break: false,
        approximate: false,
        field: null,
      },
      {
        kind: 'reset',
        at: '2026-03-02T12:00:00Z',
        end_at: null,
        drive_id: null,
        route_key: null,
        route_label: null,
        firmware_version: null,
        fsd_distance_m: null,
        driving_distance_m: null,
        confidence: null,
        reset_break: true,
        approximate: false,
        field: 'SelfDrivingMilesSinceReset',
      },
      {
        kind: 'drive',
        at: '2026-03-02T17:00:00Z',
        end_at: '2026-03-02T17:30:00Z',
        drive_id: 295,
        route_key: 'place:home:office',
        route_label: 'Home to Office',
        firmware_version: '2026.20.3',
        fsd_distance_m: 8_000,
        driving_distance_m: 10_000,
        confidence: 'high',
        reset_break: false,
        approximate: true,
        field: null,
      },
    ],
    commute_stories: [{
      route_key: 'place:home:office',
      route_label: 'Home to Office',
      drive_count: 3,
      chapters: [
        {
          firmware_version: '2026.8.1',
          first_at: '2026-03-01T17:00:00Z',
          last_at: '2026-03-01T17:30:00Z',
          drive_count: 1,
          high_count: 0,
          estimated_count: 0,
          ambiguous_count: 0,
          unknown_count: 1,
          reset_breaks: 0,
          fsd_distance_m: null,
          driving_distance_m: 10_000,
          fsd_share_pct: null,
        },
        {
          firmware_version: '2026.20.3',
          first_at: '2026-03-02T17:00:00Z',
          last_at: '2026-03-02T17:30:00Z',
          drive_count: 2,
          high_count: 2,
          estimated_count: 0,
          ambiguous_count: 0,
          unknown_count: 0,
          reset_breaks: 0,
          fsd_distance_m: 16_000,
          driving_distance_m: 20_000,
          fsd_share_pct: 80,
        },
      ],
    }],
  },
  correlation_disclaimer: 'This is a same-route correlation, not proof that supervised driving caused an efficiency difference.',
};

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
    drive_analytics: overrides.drive_analytics ?? BASE_DRIVE_ANALYTICS,
  };
}
