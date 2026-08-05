import { describe, expect, it } from 'vitest';
import type { NotificationLog } from '@/api/types';
import {
  analyzeNotificationBurnRate,
  classifyBurnBreach,
} from './notificationBurnRate';

const NOW = Date.UTC(2026, 7, 4, 12);
let id = 1;

function log(
  minutesAgo: number,
  status: NotificationLog['status'],
  severity = 'warning',
): NotificationLog {
  const timestamp = new Date(NOW - minutesAgo * 60_000).toISOString();
  return {
    id: id++,
    channel_id: 1,
    alert_id: null,
    title: 'Delivery',
    message: '',
    status,
    severity,
    error: '',
    created_at: timestamp,
    sent_at: status === 'sent' ? timestamp : null,
  };
}

describe('classifyBurnBreach', () => {
  it('reports no data when neither window has outcomes', () => {
    expect(classifyBurnBreach(null, null)).toBe('no_data');
  });

  it('requires sustained dual-window burn for critical', () => {
    expect(classifyBurnBreach(15, 7)).toBe('critical');
    expect(classifyBurnBreach(15, 1)).toBe('warning');
  });

  it('keeps in-budget windows healthy', () => {
    expect(classifyBurnBreach(0.5, 0.8)).toBe('healthy');
  });
});

describe('analyzeNotificationBurnRate', () => {
  it('returns safe empty windows', () => {
    const result = analyzeNotificationBurnRate([], { nowMs: NOW });
    expect(result.shortWindow.deliveryRate).toBeNull();
    expect(result.longWindow.burnRate).toBeNull();
    expect(result.breachStatus).toBe('no_data');
    expect(result.timeline).toHaveLength(24);
  });

  it('computes a 99% SLO burn rate from sent and failed outcomes', () => {
    const logs = [
      ...Array.from({ length: 99 }, () => log(30, 'sent')),
      log(30, 'failed'),
    ];
    const result = analyzeNotificationBurnRate(logs, { nowMs: NOW });
    expect(result.shortWindow.deliveryRate).toBeCloseTo(0.99, 6);
    expect(result.shortWindow.errorRate).toBeCloseTo(0.01, 6);
    expect(result.shortWindow.burnRate).toBeCloseTo(1, 6);
  });

  it('excludes deferred DND and pending rows from the SLO denominator', () => {
    const result = analyzeNotificationBurnRate([
      log(20, 'sent'),
      log(20, 'failed'),
      ...Array.from({ length: 8 }, () => log(20, 'deferred_dnd')),
      ...Array.from({ length: 5 }, () => log(20, 'pending')),
    ], { nowMs: NOW });
    expect(result.shortWindow.eligible).toBe(2);
    expect(result.shortWindow.deliveryRate).toBe(0.5);
    expect(result.shortWindow.deferred).toBe(8);
    expect(result.shortWindow.pending).toBe(5);
  });

  it('separates the one-hour and 24-hour windows', () => {
    const result = analyzeNotificationBurnRate([
      log(30, 'failed'),
      log(90, 'sent'),
      log(23 * 60, 'sent'),
      log(25 * 60, 'failed'),
    ], { nowMs: NOW });
    expect(result.shortWindow.total).toBe(1);
    expect(result.longWindow.total).toBe(3);
  });

  it('ignores future, invalid, and out-of-window rows', () => {
    const good = log(10, 'sent');
    const result = analyzeNotificationBurnRate([
      good,
      { ...good, id: 900, created_at: 'bad', sent_at: null },
      log(-10, 'failed'),
      log(2_000, 'failed'),
    ], { nowMs: NOW });
    expect(result.validLogCount).toBe(2);
    expect(result.longWindow.total).toBe(1);
  });

  it('builds severity cohorts with independent burn rates', () => {
    const result = analyzeNotificationBurnRate([
      ...Array.from({ length: 20 }, () => log(30, 'sent', 'info')),
      ...Array.from({ length: 4 }, () => log(30, 'failed', 'critical')),
      log(30, 'sent', 'critical'),
    ], { nowMs: NOW });
    expect(result.severities[0]!.severity).toBe('critical');
    expect(result.severities[0]!.burnRate).toBeGreaterThan(result.severities[1]!.burnRate!);
  });

  it('normalizes blank severity into an explicit unknown cohort', () => {
    const result = analyzeNotificationBurnRate([log(5, 'sent', '  ')], { nowMs: NOW });
    expect(result.severities[0]!.severity).toBe('unknown');
  });

  it('accounts for every 24-hour event in timeline buckets', () => {
    const logs = [
      log(5, 'sent'),
      log(65, 'failed'),
      log(125, 'deferred_dnd'),
      log(185, 'pending'),
    ];
    const result = analyzeNotificationBurnRate(logs, { nowMs: NOW });
    expect(result.timeline).toHaveLength(24);
    expect(result.timeline.reduce(
      (sum, bucket) => sum + bucket.sent + bucket.failed + bucket.deferred + bucket.pending,
      0,
    )).toBe(logs.length);
  });

  it('honors custom window and bucket sizes', () => {
    const result = analyzeNotificationBurnRate([log(10, 'sent')], {
      nowMs: NOW,
      shortWindowMs: 30 * 60_000,
      longWindowMs: 2 * 3_600_000,
      bucketMs: 30 * 60_000,
    });
    expect(result.shortWindow.windowMs).toBe(30 * 60_000);
    expect(result.timeline).toHaveLength(4);
  });

  it('flags sustained severe budget consumption', () => {
    const logs = [
      ...Array.from({ length: 20 }, () => log(30, 'failed')),
      ...Array.from({ length: 80 }, () => log(30, 'sent')),
      ...Array.from({ length: 20 }, () => log(120, 'failed')),
      ...Array.from({ length: 80 }, () => log(120, 'sent')),
    ];
    const result = analyzeNotificationBurnRate(logs, { nowMs: NOW });
    expect(result.shortWindow.burnRate).toBeCloseTo(20, 4);
    expect(result.longWindow.burnRate).toBeCloseTo(20, 4);
    expect(result.breachStatus).toBe('critical');
  });

  it('falls back to the documented objective for an invalid objective', () => {
    const result = analyzeNotificationBurnRate([log(1, 'sent')], {
      nowMs: NOW,
      objective: 1,
    });
    expect(result.objective).toBe(0.99);
    expect(result.errorBudget).toBeCloseTo(0.01, 8);
  });
});
