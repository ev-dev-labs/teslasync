import type { TFunction } from 'i18next';
import type {
  SleepAvailabilityKey,
  SleepAvailabilityReason,
  SleepAvailabilityStatus,
  SleepEventRecency,
  SleepRangeStatus,
} from '../../lib/sleepEfficiencyAnalysis';

export function sleepStateLabel(t: TFunction, state: string): string {
  const labels: Record<string, string> = {
    asleep: t('sleep.state.asleep', 'Asleep'),
    online: t('sleep.state.online', 'Online'),
    driving: t('sleep.state.driving', 'Driving'),
    charging: t('sleep.state.charging', 'Charging'),
    updating: t('sleep.state.updating', 'Updating'),
    suspended: t('sleep.state.suspended', 'Suspended'),
  };
  return labels[state] ?? state;
}

export function availabilityStatusLabel(
  t: TFunction,
  status: SleepAvailabilityStatus,
): string {
  if (status === 'available') {
    return t('sleep.availability.status.available', 'Available');
  }
  if (status === 'partial') {
    return t('sleep.availability.status.partial', 'Partial');
  }
  return t('sleep.availability.status.unavailable', 'Unavailable');
}

export function availabilityKeyLabel(
  t: TFunction,
  key: SleepAvailabilityKey,
): string {
  const labels: Record<SleepAvailabilityKey, string> = {
    transition_counts: t(
      'sleep.availability.source.transitionCounts',
      'Transition destination counts',
    ),
    state_dwell: t(
      'sleep.availability.source.stateDwell',
      'State dwell minutes',
    ),
    sleep_efficiency: t(
      'sleep.availability.source.sleepEfficiency',
      'Duration-based sleep efficiency',
    ),
    time_to_sleep: t(
      'sleep.availability.source.timeToSleep',
      'Average time-to-sleep',
    ),
    sentry_comparison: t(
      'sleep.availability.source.sentryComparison',
      'Sentry on/off comparison',
    ),
    drain_events: t(
      'sleep.availability.source.drainEvents',
      'Drain events',
    ),
    cost_inputs: t(
      'sleep.availability.source.costInputs',
      'Capacity and electricity-price inputs',
    ),
  };
  return labels[key];
}

export function availabilityReasonLabel(
  t: TFunction,
  reason: SleepAvailabilityReason,
): string {
  const labels: Record<SleepAvailabilityReason, string> = {
    valid_transition_destinations: t(
      'sleep.availability.reason.validTransitions',
      'At least one valid transition destination was counted.',
    ),
    valid_rows_without_destinations: t(
      'sleep.availability.reason.zeroTransitions',
      'State rows are valid but contain no transition destinations.',
    ),
    no_valid_transition_rows: t(
      'sleep.availability.reason.noTransitions',
      'No valid state row is available.',
    ),
    positive_dwell_minutes: t(
      'sleep.availability.reason.positiveDwell',
      'At least one state has positive reconstructed dwell minutes.',
    ),
    no_positive_dwell_minutes: t(
      'sleep.availability.reason.noDwell',
      'Unavailable pending dwell reconstruction.',
    ),
    duration_ratio_derived: t(
      'sleep.availability.reason.durationRatio',
      'Computed from asleep minutes divided by all valid dwell minutes.',
    ),
    withheld_without_dwell: t(
      'sleep.availability.reason.efficiencyWithheld',
      'Withheld because positive dwell minutes are absent.',
    ),
    positive_reported_value: t(
      'sleep.availability.reason.positiveTimeToSleep',
      'The response carries a positive finite value.',
    ),
    placeholder_or_missing: t(
      'sleep.availability.reason.placeholder',
      'The zero or missing contract value has no supporting observations.',
    ),
    both_sentry_groups: t(
      'sleep.availability.reason.bothSentry',
      'Both groups carry positive sample counts.',
    ),
    one_sentry_group: t(
      'sleep.availability.reason.oneSentry',
      'Only one group carries a positive sample count.',
    ),
    no_count_bearing_sentry_groups: t(
      'sleep.availability.reason.noSentry',
      'No Sentry group carries a positive sample count.',
    ),
    validated_events: t(
      'sleep.availability.reason.validEvents',
      'At least one drain event passed validation.',
    ),
    events_excluded: t(
      'sleep.availability.reason.eventsExcluded',
      'Events were returned, but all were excluded by validation.',
    ),
    no_events: t(
      'sleep.availability.reason.noEvents',
      'No drain events were returned.',
    ),
    capacity_and_price: t(
      'sleep.availability.reason.capacityAndPrice',
      'A positive capacity estimate and nonnegative price are present.',
    ),
    one_cost_input: t(
      'sleep.availability.reason.oneCostInput',
      'Only one context input is usable.',
    ),
    no_cost_inputs: t(
      'sleep.availability.reason.noCostInputs',
      'Neither context input is usable.',
    ),
  };
  return labels[reason];
}

export function eventRecencyLabel(
  t: TFunction,
  recency: SleepEventRecency,
): string {
  if (recency === 'last_24_hours') {
    return t('sleep.events.recency.last24Hours', 'Last 24 hours');
  }
  if (recency === 'last_7_days') {
    return t('sleep.events.recency.last7Days', 'Last 7 days');
  }
  if (recency === 'older') {
    return t('sleep.events.recency.older', 'Older');
  }
  return t('sleep.events.recency.unclassified', 'Unclassified');
}

export function rangeStatusLabel(
  t: TFunction,
  status: SleepRangeStatus,
): string {
  if (status === 'valid') {
    return t('sleep.coverage.range.valid', 'Valid');
  }
  if (status === 'reversed') {
    return t('sleep.coverage.range.reversed', 'Reversed');
  }
  if (status === 'invalid') {
    return t('sleep.coverage.range.invalid', 'Invalid');
  }
  return t('sleep.coverage.range.missing', 'Missing');
}
