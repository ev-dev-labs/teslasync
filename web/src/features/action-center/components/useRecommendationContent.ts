import { useTranslation } from 'react-i18next';
import { formatCommuteClock, useCommuteRouteEnergyDisplay, useCommuteWeekdays } from '@/lib/smartCommuteDisplay';
import { useTripProjectionDisplay } from '@/lib/smartChargingDisplay';
import { useSitePerformanceDisplay } from '@/lib/sitePerformanceDisplay';
import { useSolarChargingDisplay } from '@/lib/solarChargingDisplay';
import { formatWarrantyReminder } from '@/lib/warrantyReminderDisplay';
import { formatTripMaintenance } from '@/lib/tripMaintenanceDisplay';
import { useColdTireDisplay } from '@/lib/coldTireDisplay';
import { formatRecallWatchMatch } from '@/lib/recallWatchDisplay';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import type { ActionCenterRecommendation } from '@/types/actionCenter';

export function useRecommendationContent(recommendation: ActionCenterRecommendation): ActionCenterRecommendation {
  const { t } = useTranslation();
  const weekdays = useCommuteWeekdays();
  const displayEnergy = useCommuteRouteEnergyDisplay();
  const { formatDateTime, formatDate } = useDateFormat();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { formatPower, formatDistance } = useUnits();
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
  const solar = useSolarChargingDisplay(recommendation.source_feature === 'smart_charging'
    ? recommendation.evidence.find((item) => item.kind === 'solar_surplus')?.solar_surplus
    : undefined);
  const warranty = recommendation.source_feature === 'warranty_distance'
    ? recommendation.evidence.find((item) => item.kind === 'warranty_distance')?.warranty_distance
    : undefined;
  const maintenance = recommendation.source_feature === 'trip_maintenance'
    ? recommendation.evidence.find((item) => item.kind === 'trip_maintenance')?.trip_maintenance
    : undefined;
  const coldTire = useColdTireDisplay(recommendation.source_feature === 'cold_tire_drift'
    ? recommendation.evidence.find((item) => item.kind === 'cold_tire_drift')?.cold_tire_drift
    : undefined);
  const recall = recommendation.source_feature === 'recall_watch'
    ? recommendation.evidence.find((item) => item.kind === 'recall_watch_match')?.recall_watch_match
    : undefined;
  const scheduledClimate = recommendation.evidence.find(item => item.climate_schedule)?.climate_schedule;
  const backup = recommendation.evidence.find(item => item.kind === 'backup_charging')?.backup_charging;
  const failure = recommendation.evidence.find(item => item.kind === 'automation_failure')?.automation_failure;
  const incident = recommendation.evidence.find(item => item.upstream_incident)?.upstream_incident;
  if (recommendation.source_feature === 'system_health' && incident) {
    const feed = incident.feed === 'here_import'
      ? t('actionCenter.estimateIncident.import', 'HERE route import')
      : incident.feed === 'here_routes'
        ? t('actionCenter.estimateIncident.routing', 'HERE road routing')
        : t('actionCenter.estimateIncident.flow', 'HERE traffic flow');
    const recovered = incident.transition === 'recovery';
    const basis = t('actionCenter.estimateIncident.basis', 'A direct provider response verified this change in availability.');
    const summary = recovered
      ? t('actionCenter.estimateIncident.resumed', 'A fresh, usable response from {{feed}} verified recovery. Predictions using this feed can resume.', { feed })
      : t('actionCenter.estimateIncident.paused', '{{feed}} reported that it was unavailable. Predictions using this feed pause until a fresh, usable response is verified.', { feed });
    return {
      ...recommendation,
      title: recovered
        ? t('actionCenter.estimateIncident.recoveryTitle', 'Estimates resumed: {{feed}}', { feed })
        : t('actionCenter.estimateIncident.outageTitle', 'Estimates paused: {{feed}}', { feed }),
      summary, rationale: basis,
      confidence: { ...recommendation.confidence, basis: [basis] },
      evidence: recommendation.evidence.map(item => item.upstream_incident ? { ...item, summary } : item),
      limitations: [t('actionCenter.estimateIncident.limit', 'This notice does not indicate a vehicle fault or start a vehicle command.')],
    };
  }
  if (recommendation.source_feature === 'automation_failure' && failure) {
    const basis = t('actionCenter.automationFailure.basis', 'Counts separate completed runs with a failed or partial outcome, not retries within one run.');
    return {
      ...recommendation,
      title: t('actionCenter.automationFailure.title', 'Review repeated automation failures'),
      summary: t('actionCenter.automationFailure.summary', '{{rule}} recorded {{runs}} failed or partial runs in a row.', {
        rule: failure.name, runs: fmtInt(failure.failure_count),
      }),
      rationale: basis,
      confidence: { ...recommendation.confidence, basis: [basis] },
      evidence: recommendation.evidence.map(item => item.kind === 'automation_failure' ? { ...item, summary: basis } : item),
    };
  }
  if (backup) {
    const basis = t('smartCharging.backup.cardBasis', 'Your outage and circuit confirmations, two Tesla Energy meter readings, and vehicle charging telemetry.');
    const summary = t('smartCharging.backup.evidence', 'Two consistent readings after your outage confirmation show {{vehicle}} of vehicle charging and at least {{minimum}} coming from the home battery. This is a conservative estimate from the site meters, not a backup runtime forecast.', {
      vehicle: formatPower(backup.vehicle_power_w), minimum: formatPower(backup.minimum_battery_to_load_w),
    });
    return {
      ...recommendation,
      title: t('smartCharging.backup.reviewTitle', 'Vehicle charging is drawing from household backup'),
      summary, rationale: basis,
      confidence: { ...recommendation.confidence, basis: [basis] },
      evidence: recommendation.evidence.map(item => item.kind === 'backup_charging' ? { ...item, summary } : item),
      limitations: [t('smartCharging.backup.cardLimit', 'This estimate is not a backup runtime forecast. Nothing changes automatically.')],
    };
  }
  if (recommendation.source_feature === 'subscription_renewal') {
    const basis = t('ownership.subscription.renewal.cardBasis', 'Owner-confirmed renewal date and stored subscription terms.');
    return {
      ...recommendation,
      title: t('ownership.subscription.renewal.ready', 'Review the recorded subscription renewal'),
      summary: t('ownership.subscription.renewal.cardSummary', 'Check the recorded price and observed activity before the renewal date.'),
      rationale: basis,
      confidence: { ...recommendation.confidence, basis: [basis] },
      evidence: recommendation.evidence.map(item => item.kind === 'subscription_renewal' ? { ...item, summary: basis } : item),
      limitations: [t('ownership.subscription.renewal.cardLimit', 'Observed activity does not prove subscription use. No renewal or cancellation is made automatically.')],
    };
  }
  if (recommendation.source_feature === 'climate_schedule' && scheduledClimate) {
    const basis = t('preconditioningEffectiveness.scheduledClimate.cardBasis', 'Accepted scheduled command for this vehicle, observed HVAC changes and parked telemetry');
    return {
      ...recommendation,
      title: t('preconditioningEffectiveness.scheduledClimate.cardTitle', 'Review a recurring climate schedule'),
      summary: t('preconditioningEffectiveness.scheduledClimate.summary', 'Climate started near {{count}} matching scheduled runs with no observed drive in the next 90 minutes.', {
        count: (scheduledClimate.run_times ?? []).length,
      }),
      rationale: t('preconditioningEffectiveness.scheduledClimate.cardRationale', 'Review whether this schedule still fits your routine. Nothing changes automatically.'),
      confidence: { ...recommendation.confidence, basis: [basis] },
      evidence: recommendation.evidence.map(item => item.climate_schedule ? { ...item, summary: basis } : item),
      limitations: [t('preconditioningEffectiveness.scheduledClimate.cardLimit', 'The observed time window does not explain why climate ran or what happened later.')],
    };
  }
  if (recommendation.source_feature === 'service_case') {
    const basis = t('serviceEvidencePack.privateCase.cardBasis', 'User-recorded case evidence, not a diagnosis');
    return {
      ...recommendation,
      title: t('serviceEvidencePack.privateCase.cardTitle', 'Review your private service case'),
      summary: t('serviceEvidencePack.privateCase.cardSummary', 'Choose which recorded details and timestamps to include in a local export.'),
      rationale: t('serviceEvidencePack.privateCase.cardRationale', 'You opened this case and recorded evidence for this vehicle.'),
      confidence: { ...recommendation.confidence, basis: [basis] },
      evidence: recommendation.evidence.map(item => item.kind === 'service_case' ? { ...item, summary: basis } : item),
      limitations: [t('serviceEvidencePack.privateCase.cardLimit', 'Nothing is sent to a service provider. Review the export before sharing it.')],
    };
  }
  if (recall) {
    const display = formatRecallWatchMatch(recall, t, formatDate);
    return {
      ...recommendation,
      title: display.title,
      summary: display.applicability,
      rationale: display.basis,
      confidence: { ...recommendation.confidence, basis: [display.basis] },
      evidence: recommendation.evidence.map(item => item.recall_watch_match ? {
        ...item,
        summary: t('maintenance.recallWatch.remedy', 'Published remedy: {{remedy}}', { remedy: recall.remedy }),
      } : item),
      limitations: [t('maintenance.recallWatch.limit', 'Verify your VIN separately. The public catalog cannot confirm whether this car is affected or whether the remedy is complete.')],
    };
  }
  if (coldTire) {
    return {
      ...recommendation,
      title: coldTire.title,
      summary: coldTire.summary,
      rationale: coldTire.basis,
      confidence: { ...recommendation.confidence, basis: [coldTire.basis] },
      evidence: recommendation.evidence.map((item) => item.cold_tire_drift ? { ...item, summary: coldTire.basis } : item),
      limitations: [coldTire.limitation],
    };
  }
  if (maintenance) {
    const display = formatTripMaintenance(maintenance, t, formatDateTime, formatDistance);
    return {
      ...recommendation,
      title: display.title,
      summary: display.summary,
      rationale: display.basis,
      confidence: { ...recommendation.confidence, basis: [display.basis] },
      evidence: recommendation.evidence.map((item) => item.trip_maintenance ? { ...item, summary: display.basis } : item),
      limitations: [display.limitation],
    };
  }
  if (warranty) {
    const display = formatWarrantyReminder(warranty, t, formatDate, fmtInt, formatDistance);
    return {
      ...recommendation,
      title: display.title,
      summary: display.summary,
      rationale: display.basis,
      confidence: { ...recommendation.confidence, basis: [display.basis] },
      evidence: recommendation.evidence.map((item) =>
        item.warranty_distance ? { ...item, summary: `${item.summary}. ${display.basis}` } : item),
      limitations: [display.limitation],
    };
  }
  if (solar) {
    return {
      ...recommendation,
      title: solar.title,
      summary: solar.summary,
      rationale: solar.rationale,
      confidence: { ...recommendation.confidence, basis: [solar.basis] },
      evidence: recommendation.evidence.map((item) => item.solar_surplus ? { ...item, summary: solar.summary } : item),
      limitations: [solar.timing],
    };
  }
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
    if (charging.kind === 'early_stop' && charging.interrupted_at) {
      const basis = t('smartCharging.earlyStopBasis', 'Observed charging, then no power while connected at the selected place.');
      const summary = [
        t('smartCharging.earlyStopSummary', 'At {{stopped}}, the vehicle reported no charging power. If charging does not resume, {{battery}}% may not be enough for your {{departure}} departure.', {
          stopped: formatDateTime(charging.interrupted_at), battery: fmtNumber(charging.battery_pct),
          departure: formatDateTime(charging.departure_at),
        }),
        projection?.summary,
      ].filter(Boolean).join(' ');
      return {
        ...recommendation,
        title: t('smartCharging.earlyStopTitle', 'Inspect charging before your planned departure'),
        summary,
        rationale: basis,
        confidence: { ...recommendation.confidence, basis: [basis, t('smartCharging.actionBasisEstimate', 'Trip consumption and reserve were entered by you')] },
        evidence: recommendation.evidence.map(item => item.charging_readiness ? { ...item, summary } : item),
        limitations: [
          t('smartCharging.earlyStopLimitation', 'This does not identify why charging stopped. Check the vehicle or charger in person; TeslaSync does not restart charging.'),
          ...(projection?.assumptions ?? []),
        ],
      };
    }
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
    const energy = displayEnergy(traffic.route_energy);
    if (traffic.route_energy_only && !energy) return recommendation;
    const energyOnly = traffic.route_energy_only ? energy : null;
    const deadline = traffic.arrival_deadline_at && traffic.latest_departure_at
      ? t('smartCommute.traffic.deadline.recommendation', 'Estimated latest departure: {{latest}}. Your arrival deadline: {{deadline}}.', {
        latest: formatDateTime(traffic.latest_departure_at),
        deadline: formatDateTime(traffic.arrival_deadline_at),
      })
      : null;
    const timing = t('smartCommute.traffic.actionSummary', 'HERE estimates {{usual}} min on the usual route and {{alternative}} min on an alternative.', {
      usual: fmtNumber(Math.round(traffic.usual_s / 60)), alternative: fmtNumber(Math.round(traffic.alternative_s / 60)),
    });
    const summary = [energyOnly ? null : timing, energy?.fastest, energy?.saving].filter(Boolean).join(' ');
    const coverage = t('smartCommute.traffic.coverage', 'Both routes had fresh directional HERE Traffic Flow coverage');
    return {
      ...recommendation,
      title: energyOnly ? energyOnly.title : deadline
        ? t('smartCommute.traffic.deadline.title', 'Leave earlier to make your arrival deadline')
        : t('smartCommute.traffic.actionTitle', 'A faster route is available before your departure'),
      summary: deadline ? `${deadline} ${summary}` : summary,
      rationale: energyOnly ? energyOnly.rationale : deadline
        ? t('smartCommute.traffic.deadline.rationale', 'Even the fastest qualifying estimate misses your deadline at the planned departure time.')
        : t('smartCommute.traffic.rationale', 'Fresh HERE Traffic Flow covered both routes; the estimated difference exceeds your selected threshold.'),
      confidence: { ...recommendation.confidence, basis: energy ? [coverage, energy.conditions] : [coverage] },
      evidence: recommendation.evidence.map((item) => item.commute_traffic ? { ...item, summary } : item),
      limitations: [
        t('smartCommute.traffic.teslaRoute', 'These are estimates, not measured trip times. Tesla calculates its own route.'),
        ...(energy ? [energy.limits] : []),
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
