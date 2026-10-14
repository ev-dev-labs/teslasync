import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Children, isValidElement, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import type { CommandLogEntry } from '@/api/hooks/useCommands';
import type { StatMetric } from '@/components/data-display';
import { getGlobalLocale, getGlobalPrecision, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { analyzeCommandReliability } from '../../lib/commandReliability';
import { commandHistoryMetrics, commandReliabilityMetrics } from './commandSummaryMetrics';

const t = ((key: string, fallback: string, vars?: Record<string, unknown>) =>
  fallback.replace(/{{(\w+)}}/g, (match, name: string) =>
    vars && name in vars ? String(vars[name]) : match) || key) as TFunction;

function entry(status: string, index = 0, command = 'lock'): CommandLogEntry {
  return {
    id: index + 1, vehicle_id: 7, command, params: '', status,
    error: status === 'failed' ? 'offline' : '',
    created_at: new Date(Date.UTC(2026, 0, 15, 12, index)).toISOString(),
  };
}

function attemptsCaption(metric: StatMetric): ReactNode {
  if (!isValidElement<{ children: ReactNode }>(metric.context)) {
    throw new Error('Expected rich attempts context');
  }
  return Children.toArray(metric.context.props.children)[0];
}

describe('Command summary raw quantity contracts', () => {
  it('does not coerce history counts and rates into formatted text', () => {
    const metrics = commandHistoryMetrics({
      total: 5, total24h: 3, successRate: 60, failedCount: 2,
      mostUsed: 'lock',
      lastCommand: {
        id: 1, vehicle_id: 7, command: 'lock', params: '', status: 'success',
        error: '', created_at: '2026-01-15T12:00:00Z',
      },
    }, t, (command) => command === 'lock' ? 'Lock' : command, 2);
    expect(metrics.map(metric => metric.metricId)).toEqual([
      'count', 'count', 'percent', 'count', 'text', 'text',
    ]);
    expect(metrics.slice(0, 4).map(metric => metric.rawValue)).toEqual([5, 3, 60, 2]);
    expect(metrics[4].rawValue).toBe('Lock');
    expect(metrics[1].context).toBe('Last 24 hours within the selected window');
    expect(metrics[5].context).toContain('2026');
  });

  it('retains the original empty-history zeros while text measurements remain missing', () => {
    const metrics = commandHistoryMetrics({
      total: 0, total24h: 0, successRate: 0, failedCount: 0,
      mostUsed: null, lastCommand: null,
    }, t, String, 2);
    expect(metrics.map(metric => metric.rawValue)).toEqual([0, 0, 0, 0, null, null]);
    expect(commandHistoryMetrics(null, t, String, 2).every(metric => metric.rawValue == null)).toBe(true);
  });

  it('keeps reliability definitions in the existing analyzer, with rounded percentage points only at display', () => {
    const entries = [
      { id: 1, vehicle_id: 7, command: 'lock', params: '', status: 'failed', error: 'offline', created_at: '2026-01-15T12:00:00Z' },
      { id: 2, vehicle_id: 7, command: 'lock', params: '', status: 'success', error: '', created_at: '2026-01-15T12:01:00Z' },
      { id: 3, vehicle_id: 7, command: 'lock', params: '', status: 'pending', error: '', created_at: '2026-01-15T12:02:00Z' },
    ];
    const summary = analyzeCommandReliability(entries);
    const metrics = commandReliabilityMetrics(summary, t);
    expect(metrics.map(metric => metric.rawValue)).toEqual([50, 0, 1, 1]);
    expect(summary.totalAttempts).toBe(3);
    expect(metrics[0].display?.precision).toBe(0);
    expect(metrics[1].context).toBe('Unknown');
    expect(metrics[2].context).toBe('after collapsing retry storms');
    expect(metrics[3].context).toBe('you pressed it again, and again');
  });
});

describe('Command reliability adapter truth and locale', () => {
  let previousLocale: string;
  let previousPrecision: number;

  beforeEach(() => {
    previousLocale = getGlobalLocale();
    previousPrecision = getGlobalPrecision();
  });

  afterEach(() => {
    setGlobalLocale(previousLocale);
    setGlobalPrecision(previousPrecision);
  });

  it.each(['pending', 'queued', 'in_progress', 'sending'])(
    'keeps nonempty %s-only outcomes unknown without changing analyzer zeros or counts',
    (status) => {
      const summary = analyzeCommandReliability([entry(status)]);
      const original = structuredClone(summary);
      const metrics = commandReliabilityMetrics(summary, t);

      expect(metrics.map(metric => metric.rawValue)).toEqual([null, 0, 1, 0]);
      expect(metrics[1].context).toBe('Unknown');
      expect(summary.totalAttempts).toBe(1);
      expect(summary.overallSuccessRate).toBe(0);
      expect(summary.commands[0]).toMatchObject({
        total: 1, success: 0, failure: 0, pending: 1, grade: 'unproven',
        interval: { lower: 0, upper: 1 },
      });
      expect(summary).toEqual(original);
    },
  );

  it('preserves the declared empty-array numeric convention and caption', () => {
    const metrics = commandReliabilityMetrics(analyzeCommandReliability([]), t);

    expect(metrics.map(metric => metric.rawValue)).toEqual([0, 0, 0, 0]);
    expect(metrics[1].context).toBe('Nothing failing');
    expect(attemptsCaption(metrics[0])).toBe('0 attempts');
  });

  it('keeps an absent summary missing instead of inventing zero attempts or success', () => {
    const metrics = commandReliabilityMetrics(null, t);

    expect(metrics.every(metric => metric.rawValue == null)).toBe(true);
    expect(metrics[1].context).toBeUndefined();
    expect(attemptsCaption(metrics[0])).toBe('— attempts');
  });

  it('retains measured zero for a resolved failure without falsely claiming nothing is failing', () => {
    const summary = analyzeCommandReliability([entry('failed')]);
    const metrics = commandReliabilityMetrics(summary, t);

    expect(metrics.map(metric => metric.rawValue)).toEqual([0, 0, 1, 0]);
    expect(metrics[1].context).toBe('Unknown');
    expect(summary.commands[0]).toMatchObject({
      failure: 1, success: 0, grade: 'unproven',
    });
    expect(summary.worstCommand).toBeNull();
  });

  it('preserves a measured perfect rate without upgrading a small sample to proven reliability', () => {
    const summary = analyzeCommandReliability([entry('success')]);
    const metrics = commandReliabilityMetrics(summary, t);

    expect(metrics[0].rawValue).toBe(100);
    expect(metrics[1].rawValue).toBe(0);
    expect(metrics[1].context).toBe('Unknown');
    expect(summary.commands[0].grade).toBe('unproven');
  });

  it('keeps the judged worst-command label, five-attempt threshold, raw rates and retry storms', () => {
    const summary = analyzeCommandReliability([
      ...Array.from({ length: 5 }, (_, index) => entry('failed', index, 'wake_up')),
      entry('success', 10, 'lock'),
    ]);
    const original = structuredClone(summary);
    const metrics = commandReliabilityMetrics(summary, t);

    expect(metrics.map(metric => metric.rawValue)).toEqual([17, 1, 2, 1]);
    expect(metrics[1].context).toBe('Wake up');
    expect(metrics[0].display).toEqual({ precision: 0 });
    expect(summary.worstCommand?.grade).toBe('unreliable');
    expect(summary.storms[0]).toMatchObject({ command: 'wake_up', attempts: 5, succeeded: false });
    expect(summary).toEqual(original);
  });

  it('uses analyzer-supplied grading options rather than introducing an adapter threshold', () => {
    const summary = analyzeCommandReliability([entry('failed')], { minAttempts: 1 });
    const metrics = commandReliabilityMetrics(summary, t);

    expect(metrics[1].rawValue).toBe(1);
    expect(metrics[1].context).toBe('Lock');
    expect(summary.worstCommand?.grade).toBe('unreliable');
  });

  it('uses the existing translated unknown label for unjudged evidence', () => {
    const requestedKeys: string[] = [];
    const translate = ((key: string, fallback: string, vars?: Record<string, unknown>) => {
      requestedKeys.push(key);
      return key === 'common.unknown' ? 'Unbekannt' : t(key, fallback, vars);
    }) as TFunction;
    const metrics = commandReliabilityMetrics(
      analyzeCommandReliability([entry('failed')]), translate,
    );

    expect(metrics[1].context).toBe('Unbekannt');
    expect(requestedKeys).toContain('common.unknown');
    expect(requestedKeys).not.toContain('commandReliability.allFine');
  });

  it.each([
    ['en-US', '1,234 attempts'],
    ['de-DE', '1.234 attempts'],
    ['ar-EG', '١٬٢٣٤ attempts'],
  ])('formats the attempts caption using effective %s locale without formatting raw stats', (locale, caption) => {
    setGlobalLocale(locale);
    setGlobalPrecision(7);
    const summary = analyzeCommandReliability(
      Array.from({ length: 1234 }, (_, index) => entry('success', index)),
    );
    const metrics = commandReliabilityMetrics(summary, t);

    expect(attemptsCaption(metrics[0])).toBe(caption);
    expect(metrics.map(metric => metric.rawValue)).toEqual([100, 0, 1, 1]);
    expect(summary.totalAttempts).toBe(1234);
    expect(summary.overallSuccessRate).toBe(1);
  });
});
