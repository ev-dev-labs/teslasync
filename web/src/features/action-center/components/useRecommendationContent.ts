import { useTranslation } from 'react-i18next';
import { formatCommuteClock, useCommuteWeekdays } from '@/lib/smartCommuteDisplay';
import { useTripProjectionDisplay } from '@/lib/smartChargingDisplay';
import { useSitePerformanceDisplay } from '@/lib/sitePerformanceDisplay';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import type { ActionCenterRecommendation } from '@/types/actionCenter';

export function useRecommendationContent(recommendation: ActionCenterRecommendation): ActionCenterRecommendation {
  const { t } = useTranslation();
  const weekdays = useCommuteWeekdays();
  const { formatDateTime } = useDateFormat('user');
  const { fmtNumber } = useNumberFormatting();
  const { formatPower } = useUnits();
  const displayProjection = useTripProjectionDisplay();
  const performance = useSitePerformanceDisplay(recommendation.source_feature === 'charging_site_performance'
    ? recommendation.evidence.find((item) => item.kind === 'site_performance')?.site_performance
    : undefined);
  const charging = recommendation.source_feature === 'smart_charging'
    ? recommendation.evidence.find((item) =>
        item.kind === 'charging_readiness' || item.kind === 'charging_feasibility')?.charging_readiness
    : undefined;
  const overlap = recommendation.source_feature === 'smart_charging'
    ? recommendation.evidence.find((item) => item.kind === 'departure_overlap')?.departure_overlap
    : undefined;
  if (performance) {
    return {
      ...recommendation,
      title: performance.title,
      summary: performance.summary,
      rationale: performance.rationale,
      confidence: { ...recommendation.confidence, basis: [performance.basis] },
      evidence: recommendation.evidence.map((item) => item.site_performance
        ? { ...item, summary: `${performance.summary} ${performance.dates}` }
        : item),
      limitations: [performance.limitation],
    };
  }
  if (overlap) {
    const { kind, starts_at, ends_at } = overlap;
    const service = kind === 'service';
    const summary = t('smartCharging.overlapSummary', 'Review the window from {{start}} to {{end}} before your planned departure at {{departure}}.', {
      start: formatDateTime(starts_at), end: formatDateTime(ends_at), departure: formatDateTime(overlap.departure_at),
    });
    return {
      ...recommendation,
      title: service
        ? t('smartCharging.serviceOverlapTitle', 'Service appointment overlaps your planned departure')
        : t('smartCharging.installOverlapTitle', 'Scheduled software install overlaps your planned departure'),
      summary,
      rationale: service
        ? t('smartCharging.serviceOverlapRationale', 'The appointment window you entered includes the saved departure.')
        : t('smartCharging.installOverlapRationale', 'The software install window you entered includes the saved departure.'),
      confidence: { ...recommendation.confidence, basis: [
        t('smartCharging.overlapBasisPlan', 'Window and departure entered by you'),
        t('smartCharging.overlapBasisPark', 'Fresh parked gear observation'),
      ] },
      evidence: recommendation.evidence.map((item) =>
        item.departure_overlap ? { ...item, summary } : item),
      limitations: [t('smartCharging.overlapLimitation', 'The window is entered by you, not verified against a service or vehicle schedule. No schedule was changed.')],
    };
  }
  if (charging) {
    const projection = charging.trip_projection ? displayProjection(charging.trip_projection, charging.reserve_pct) : undefined;
    if (charging.kind === 'schedule_conflict' && charging.scheduled_start_at) {
      const { scheduled_power_ceiling_w: powerCeiling } = charging;
      const context = {
        battery: fmtNumber(charging.battery_pct), place: charging.place_name,
        start: formatDateTime(charging.scheduled_start_at), departure: formatDateTime(charging.departure_at),
      };
      const summary = [
        powerCeiling == null
          ? t('smartCharging.scheduleActionSummary', 'Battery {{battery}}% at {{place}}. If charging starts at the time you entered ({{start}}), it will not add charge before departure ({{departure}}).', context)
          : t('smartCharging.schedulePowerActionSummary', 'Battery {{battery}}% at {{place}}. If charging starts at {{start}}, even the {{power}} limit you entered may not leave enough charge for your {{departure}} departure.', {
            ...context, power: formatPower(powerCeiling),
          }),
        projection?.summary,
      ].filter(Boolean).join(' ');
      return {
        ...recommendation,
        title: powerCeiling == null
          ? t('smartCharging.scheduleActionTitle', 'Review charging scheduled for departure or later')
          : t('smartCharging.schedulePowerActionTitle', 'Scheduled charging may finish too late for your trip'),
        summary,
        rationale: t('smartCharging.scheduleActionRationale', 'The vehicle is plugged in and reports a pending schedule matching the clock time you entered.'),
        confidence: {
          ...recommendation.confidence,
          basis: [
            t('smartCharging.scheduleActionBasis', 'Fresh charging-port latch and pending schedule observations'),
            t('smartCharging.actionBasisEstimate', 'Trip consumption and reserve were entered by you'),
            ...(powerCeiling == null ? [] : [
              t('smartCharging.schedulePowerActionBasis', 'Fresh nominal pack energy and the site power limit you entered'),
            ]),
          ],
        },
        evidence: recommendation.evidence.map((item) =>
          item.charging_readiness ? { ...item, summary } : item),
        limitations: [
          t('smartCharging.scheduleActionLimitation', 'The vehicle reports a clock time, not the date of the next start. No schedule was changed.'),
          ...(powerCeiling == null ? [] : [
            t('smartCharging.schedulePowerActionLimitation', 'The estimate assumes uninterrupted charging at the entered limit without losses. The limit is not measured power.'),
          ]),
          ...(projection?.assumptions ?? []),
        ],
      };
    }
    if (charging.kind === 'trip_review') {
      const summary = [
        t('smartCharging.tripReviewSummary', 'Battery {{battery}}% at {{place}}. Review a charging stop or record planned destination charging. Departure: {{departure}}.', {
          battery: fmtNumber(charging.battery_pct), place: charging.place_name,
          departure: formatDateTime(charging.departure_at),
        }),
        projection?.summary,
      ].filter(Boolean).join(' ');
      return {
        ...recommendation,
        title: t('smartCharging.tripReviewTitle', 'Review a charging stop before your trip'),
        summary,
        rationale: t('smartCharging.tripReviewRationale', 'Even the lower entered trip-use estimates cannot meet the reserve by charging only at the selected place.'),
        confidence: {
          ...recommendation.confidence,
          basis: [
            t('smartCharging.actionBasisSignals', 'Fresh battery, gear, plug state and location observations'),
            t('smartCharging.actionBasisEstimate', 'Trip consumption and reserve were entered by you'),
          ],
        },
        evidence: recommendation.evidence.map((item) =>
          item.charging_readiness ? { ...item, summary } : item),
        limitations: [
          t('smartCharging.actionLimitationWrites', 'This recommendation cannot start charging or operate the vehicle.'),
          ...(projection?.assumptions ?? []),
        ],
      };
    }
    if (charging.kind === 'slow_charging') {
      if (charging.charging_power_w == null) return recommendation;
      const wholeTripSummary = t(
        'smartCharging.slowActionSummary',
        'Battery {{battery}}% at {{place}}. At the measured {{power}}, the estimated return is {{low}}-{{high}}% versus a {{reserve}}% reserve. Departure: {{departure}}.',
        {
          battery: fmtNumber(charging.battery_pct), place: charging.place_name,
          power: formatPower(charging.charging_power_w), low: fmtNumber(charging.arrival_low_pct),
          high: fmtNumber(charging.arrival_high_pct), reserve: fmtNumber(charging.reserve_pct),
          departure: formatDateTime(charging.departure_at),
        },
      );
      let summary = projection
        ? `${t('smartCharging.slowTripActionContext', 'Battery {{battery}}% at {{place}}; measured charging power is {{power}}. Departure: {{departure}}.', {
            battery: fmtNumber(charging.battery_pct), place: charging.place_name,
            power: formatPower(charging.charging_power_w), departure: formatDateTime(charging.departure_at),
          })} ${projection.summary}`
        : wholeTripSummary;
      const current = charging.current_limit;
      const currentSafety = current
        ? t('smartCharging.slowCurrentSafety', 'Review the current setting and site electrical limits; the reported maximum does not establish that increasing current is safe or will help.')
        : undefined;
      if (current) {
        summary += ` ${t('smartCharging.slowCurrentEvidence', 'The vehicle reports an AC current request of {{requested}} A and maximum request of {{maximum}} A.', {
          requested: fmtNumber(current.requested_a), maximum: fmtNumber(current.maximum_a),
        })} ${currentSafety}`;
      }
      return {
        ...recommendation,
        title: t('smartCharging.slowActionTitle', 'Charging may not be ready before your trip'),
        summary,
        rationale: t('smartCharging.slowActionRationale', 'Fresh samples over at least five minutes indicate the current charging rate may not meet the trip reserve.'),
        confidence: {
          ...recommendation.confidence,
          basis: [
            t('smartCharging.slowActionBasis', 'Fresh parked, charging, battery, pack-energy and charging-power observations'),
            t('smartCharging.actionBasisEstimate', 'Trip consumption and reserve were entered by you'),
            ...(current ? [t('smartCharging.slowCurrentBasis', 'Fresh AC current request and maximum request observations')] : []),
          ],
        },
        evidence: recommendation.evidence.map((item) =>
          item.charging_readiness ? { ...item, summary } : item),
        limitations: [
          t('smartCharging.slowActionLimitationEstimate', 'The estimate assumes constant power and nominal pack energy; actual power, taper and efficiency can change.'),
          t('smartCharging.slowActionLimitationWrites', 'This recommendation does not change a schedule, charging limit or vehicle setting.'),
          ...(currentSafety ? [currentSafety] : []),
          ...(projection?.assumptions ?? []),
        ],
      };
    }
    const wholeTripSummary = t(
      'smartCharging.actionSummary',
      'Battery {{battery}}% at {{place}}; the trip estimate suggests {{low}}-{{high}}% on return versus a {{reserve}}% reserve. Departure: {{departure}}.',
      {
        battery: fmtNumber(charging.battery_pct), place: charging.place_name,
        low: fmtNumber(charging.arrival_low_pct), high: fmtNumber(charging.arrival_high_pct),
        reserve: fmtNumber(charging.reserve_pct), departure: formatDateTime(charging.departure_at),
      },
    );
    const summary = projection
      ? `${t('smartCharging.tripActionContext', 'Battery {{battery}}% at {{place}}. Departure: {{departure}}.', {
          battery: fmtNumber(charging.battery_pct), place: charging.place_name,
          departure: formatDateTime(charging.departure_at),
        })} ${projection.summary}`
      : wholeTripSummary;
    return {
      ...recommendation,
      title: t('smartCharging.actionTitle', 'Plug in before your planned trip'),
      summary,
      rationale: t('smartCharging.actionRationale', 'Fresh parked and disconnected signals place the vehicle inside the selected charging location.'),
      confidence: {
        ...recommendation.confidence,
        basis: [
          t('smartCharging.actionBasisSignals', 'Fresh battery, gear, plug state and location observations'),
          t('smartCharging.actionBasisEstimate', 'Trip consumption and reserve were entered by you'),
        ],
      },
      evidence: recommendation.evidence.map((item) =>
        item.charging_readiness ? { ...item, summary } : item),
      limitations: [
        t('smartCharging.actionLimitationEstimate', 'Return charge is an estimate based on the range you entered, not a measurement.'),
        t('smartCharging.actionLimitationWrites', 'This recommendation cannot start charging or operate the vehicle.'),
        ...(projection?.assumptions ?? []),
      ],
    };
  }
  const traffic = recommendation.source_feature === 'smart_commute'
    ? recommendation.evidence.find((item) => item.kind === 'commute_traffic')?.commute_traffic
    : undefined;
  if (traffic) {
    const deadline = traffic.arrival_deadline_at && traffic.latest_departure_at
      ? t('smartCommute.traffic.deadline.recommendation', 'Estimated latest departure: {{latest}}. Your arrival deadline: {{deadline}}.', {
        latest: formatDateTime(traffic.latest_departure_at, { tz: traffic.time_zone }),
        deadline: formatDateTime(traffic.arrival_deadline_at, { tz: traffic.time_zone }),
      })
      : null;
    const summary = t('smartCommute.traffic.actionSummary', 'HERE estimates {{usual}} min on the usual route and {{alternative}} min on an alternative.', {
      usual: fmtNumber(Math.round(traffic.usual_s / 60)), alternative: fmtNumber(Math.round(traffic.alternative_s / 60)),
    });
    const coverage = t('smartCommute.traffic.coverage', 'Both routes had fresh directional HERE Traffic Flow coverage');
    return {
      ...recommendation,
      title: deadline
        ? t('smartCommute.traffic.deadline.title', 'Leave earlier to make your arrival deadline')
        : t('smartCommute.traffic.actionTitle', 'A faster route is available before your departure'),
      summary: deadline ? `${deadline} ${summary}` : summary,
      rationale: deadline
        ? t('smartCommute.traffic.deadline.rationale', 'Even the fastest qualifying estimate misses your deadline at the planned departure time.')
        : t('smartCommute.traffic.rationale', 'Fresh HERE Traffic Flow covered both routes; the estimated difference exceeds your selected threshold.'),
      confidence: { ...recommendation.confidence, basis: [coverage] },
      evidence: recommendation.evidence.map((item) => item.commute_traffic ? { ...item, summary } : item),
      limitations: [
        t('smartCommute.traffic.teslaRoute', 'These are estimates, not measured trip times. Tesla calculates its own route.'),
        ...(deadline ? [t('smartCommute.traffic.deadline.limitations', 'TeslaSync works backward from the fastest qualifying estimate and adds a three-minute buffer. Traffic at an earlier departure may differ.')] : []),
      ],
    };
  }
  const drive = recommendation.source_feature === 'smart_commute'
    ? recommendation.evidence.find((item) => item.kind === 'recurring_drive')?.recurring_drive
    : undefined;
  if (!drive) return recommendation;

  const summary = t(
    'smartCommute.actionSummary',
    '{{count}} matching departure days between {{start}} and {{end}} ({{zone}}). Candidate destination: {{destination}}.',
    {
      count: drive.matching_days,
      start: formatCommuteClock(drive.window_start_s),
      end: formatCommuteClock(drive.window_end_s),
      zone: drive.time_zone,
      destination: `${drive.destination_latitude.toFixed(5)}, ${drive.destination_longitude.toFixed(5)}`,
    },
  );
  const freshnessBasis = {
    fresh: t('smartCommute.actionFreshness.fresh', "Evidence is within the provider's fresh window"),
    aging: t('smartCommute.actionFreshness.aging', 'Aging evidence reduces confidence by 0.12'),
    stale: t('smartCommute.actionFreshness.stale', 'Stale evidence reduces confidence by 0.28'),
    unknown: t('smartCommute.actionFreshness.unknown', 'Unknown observation age reduces confidence by 0.22'),
  };
  return {
    ...recommendation,
    title: t('smartCommute.question', 'Is this your regular {{day}} drive?', {
      day: weekdays[drive.weekday] ?? t('smartCommute.unknownDay', 'unknown day'),
    }),
    summary,
    rationale: t('smartCommute.actionRationale', 'Locally analyzed completed drives have similar departure times and endpoints.'),
    confidence: {
      ...recommendation.confidence,
      basis: [
        t('smartCommute.actionBasisSample', 'At least seven distinct local days within a bounded eight-week window'),
        t('smartCommute.actionBasisDriver', 'Similar endpoints and departure times do not identify the driver'),
        freshnessBasis[recommendation.freshness.status],
      ],
    },
    evidence: recommendation.evidence.map((item) =>
      item.recurring_drive ? { ...item, summary } : item),
    limitations: [
      t('smartCommute.actionLimitationIdentity', 'The driver and destination name are not inferred.'),
      t('smartCommute.actionLimitationWrites', 'This suggestion does not send notifications or operate the vehicle.'),
    ],
  };
}
