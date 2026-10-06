import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { analyzeCommandReliability } from '../../lib/commandReliability';
import { commandHistoryMetrics, commandReliabilityMetrics } from './commandSummaryMetrics';

const t = ((key: string, fallback: string, vars?: Record<string, unknown>) =>
  fallback.replace(/{{(\w+)}}/g, (match, name: string) =>
    vars && name in vars ? String(vars[name]) : match) || key) as TFunction;

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
    expect(metrics[1].context).toBe('Nothing failing');
    expect(metrics[2].context).toBe('after collapsing retry storms');
    expect(metrics[3].context).toBe('you pressed it again, and again');
  });
});
