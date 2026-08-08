/**
 * Delivery SLO and error-budget burn analysis for notification outcomes.
 *
 * `sent` and `failed` are the only delivery outcomes in the SLO denominator.
 * `deferred_dnd` is intentional policy enforcement and is reported separately;
 * `pending` has not reached an outcome yet. Mixing either into failures would
 * make quiet hours and queue depth look like transport unreliability.
 *
 * Pure and React-free.
 */

import type { NotificationLog } from '@/api/types';

export type BurnBreachStatus = 'healthy' | 'warning' | 'critical' | 'no_data';

export interface DeliveryWindow {
  windowMs: number;
  sent: number;
  failed: number;
  deferred: number;
  pending: number;
  eligible: number;
  total: number;
  deliveryRate: number | null;
  errorRate: number | null;
  burnRate: number | null;
}

export interface SeverityBurn {
  severity: string;
  sent: number;
  failed: number;
  deferred: number;
  pending: number;
  eligible: number;
  deliveryRate: number | null;
  burnRate: number | null;
}

export interface BurnTimelineBucket {
  startMs: number;
  endMs: number;
  sent: number;
  failed: number;
  deferred: number;
  pending: number;
  deliveryRate: number | null;
  burnRate: number | null;
}

export interface NotificationBurnRateSummary {
  objective: number;
  errorBudget: number;
  shortWindow: DeliveryWindow;
  longWindow: DeliveryWindow;
  deferredDnd: number;
  breachStatus: BurnBreachStatus;
  severities: SeverityBurn[];
  timeline: BurnTimelineBucket[];
  validLogCount: number;
}

export interface BurnRateOptions {
  nowMs?: number;
  objective?: number;
  shortWindowMs?: number;
  longWindowMs?: number;
  bucketMs?: number;
  warningShortBurn?: number;
  warningLongBurn?: number;
  criticalShortBurn?: number;
  criticalLongBurn?: number;
}

interface TimedOutcome {
  ms: number;
  status: NotificationLog['status'];
  severity: string;
}

const HOUR_MS = 3_600_000;

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function eventTime(log: NotificationLog): number | null {
  const ms = Date.parse(log.sent_at ?? log.created_at);
  return Number.isFinite(ms) ? ms : null;
}

function summarizeOutcomes(
  events: readonly TimedOutcome[],
  errorBudget: number,
  windowMs: number,
): DeliveryWindow {
  let sent = 0;
  let failed = 0;
  let deferred = 0;
  let pending = 0;
  for (const event of events) {
    if (event.status === 'sent') sent += 1;
    else if (event.status === 'failed') failed += 1;
    else if (event.status === 'deferred_dnd') deferred += 1;
    else pending += 1;
  }
  const eligible = sent + failed;
  const total = eligible + deferred + pending;
  const errorRate = eligible > 0 ? failed / eligible : null;
  return {
    windowMs,
    sent,
    failed,
    deferred,
    pending,
    eligible,
    total,
    deliveryRate: eligible > 0 ? round(sent / eligible) : null,
    errorRate: errorRate == null ? null : round(errorRate),
    burnRate: errorRate == null ? null : round(errorRate / errorBudget),
  };
}

export function classifyBurnBreach(
  shortBurn: number | null,
  longBurn: number | null,
  thresholds: {
    warningShort: number;
    warningLong: number;
    criticalShort: number;
    criticalLong: number;
  } = {
    warningShort: 6,
    warningLong: 3,
    criticalShort: 14.4,
    criticalLong: 6,
  },
): BurnBreachStatus {
  if (shortBurn == null && longBurn == null) return 'no_data';
  if (
    shortBurn != null &&
    longBurn != null &&
    shortBurn >= thresholds.criticalShort &&
    longBurn >= thresholds.criticalLong
  ) return 'critical';
  if (
    (shortBurn != null && shortBurn >= thresholds.warningShort) ||
    (longBurn != null && longBurn >= thresholds.warningLong) ||
    (shortBurn != null && shortBurn > 1 && longBurn != null && longBurn > 1)
  ) return 'warning';
  return 'healthy';
}

export function analyzeNotificationBurnRate(
  logs: readonly NotificationLog[],
  options: BurnRateOptions = {},
): NotificationBurnRateSummary {
  const nowMs = options.nowMs ?? Date.now();
  const requestedObjective = options.objective ?? 0.99;
  const objective =
    requestedObjective > 0 && requestedObjective < 1 ? requestedObjective : 0.99;
  const errorBudget = 1 - objective;
  const shortWindowMs = Math.max(1, options.shortWindowMs ?? HOUR_MS);
  const longWindowMs = Math.max(shortWindowMs, options.longWindowMs ?? 24 * HOUR_MS);
  const bucketMs = Math.max(1, options.bucketMs ?? HOUR_MS);

  const validEvents: TimedOutcome[] = [];
  for (const log of logs) {
    const ms = eventTime(log);
    if (ms == null || ms > nowMs) continue;
    validEvents.push({
      ms,
      status: log.status,
      severity: log.severity?.trim().toLowerCase() || 'unknown',
    });
  }
  const inWindow = (windowMs: number) =>
    validEvents.filter((event) => event.ms >= nowMs - windowMs);
  const shortEvents = inWindow(shortWindowMs);
  const longEvents = inWindow(longWindowMs);
  const shortWindow = summarizeOutcomes(shortEvents, errorBudget, shortWindowMs);
  const longWindow = summarizeOutcomes(longEvents, errorBudget, longWindowMs);

  const bySeverity = new Map<string, TimedOutcome[]>();
  for (const event of longEvents) {
    const group = bySeverity.get(event.severity) ?? [];
    group.push(event);
    bySeverity.set(event.severity, group);
  }
  const severities = [...bySeverity.entries()]
    .map(([severity, events]) => {
      const window = summarizeOutcomes(events, errorBudget, longWindowMs);
      return {
        severity,
        sent: window.sent,
        failed: window.failed,
        deferred: window.deferred,
        pending: window.pending,
        eligible: window.eligible,
        deliveryRate: window.deliveryRate,
        burnRate: window.burnRate,
      };
    })
    .sort((a, b) => (b.burnRate ?? -1) - (a.burnRate ?? -1) || b.eligible - a.eligible);

  const startMs = nowMs - longWindowMs;
  const bucketCount = Math.max(1, Math.ceil(longWindowMs / bucketMs));
  const bucketEvents = Array.from({ length: bucketCount }, () => [] as TimedOutcome[]);
  for (const event of longEvents) {
    const index = Math.min(bucketCount - 1, Math.floor((event.ms - startMs) / bucketMs));
    if (index >= 0) bucketEvents[index]!.push(event);
  }
  const timeline = bucketEvents.map((events, index) => {
    const window = summarizeOutcomes(events, errorBudget, bucketMs);
    return {
      startMs: startMs + index * bucketMs,
      endMs: Math.min(nowMs, startMs + (index + 1) * bucketMs),
      sent: window.sent,
      failed: window.failed,
      deferred: window.deferred,
      pending: window.pending,
      deliveryRate: window.deliveryRate,
      burnRate: window.burnRate,
    };
  });

  return {
    objective,
    errorBudget: round(errorBudget),
    shortWindow,
    longWindow,
    deferredDnd: longWindow.deferred,
    breachStatus: classifyBurnBreach(shortWindow.burnRate, longWindow.burnRate, {
      warningShort: options.warningShortBurn ?? 6,
      warningLong: options.warningLongBurn ?? 3,
      criticalShort: options.criticalShortBurn ?? 14.4,
      criticalLong: options.criticalLongBurn ?? 6,
    }),
    severities,
    timeline,
    validLogCount: validEvents.length,
  };
}
