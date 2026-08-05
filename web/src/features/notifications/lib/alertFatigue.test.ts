import { describe, it, expect } from 'vitest';
import type { NotificationLog } from '@/api/types';
import { analyzeAlertFatigue, noiseScoreOf, normalizeTitle } from './alertFatigue';

const ANCHOR = Date.UTC(2026, 5, 1, 9, 0, 0);

let nextId = 1;

interface LogSpec {
  /** Minutes after the anchor. */
  min: number;
  title: string;
  status?: NotificationLog['status'];
  /** Minutes after delivery that the user read it; omit for unread. */
  readAfterMin?: number;
  /** Set false to model a backend that never tracked reads. */
  tracked?: boolean;
  severity?: string;
}

function log(spec: LogSpec): NotificationLog {
  const ms = ANCHOR + spec.min * 60_000;
  const sent = new Date(ms).toISOString();
  const entry: NotificationLog = {
    id: nextId++,
    channel_id: 1,
    alert_id: 7,
    title: spec.title,
    message: '',
    status: spec.status ?? 'sent',
    severity: spec.severity,
    error: '',
    created_at: sent,
    sent_at: sent,
  };
  if (spec.tracked !== false) {
    entry.read_at =
      spec.readAfterMin == null
        ? null
        : new Date(ms + spec.readAfterMin * 60_000).toISOString();
  }
  return entry;
}

/** n firings of one title spread `everyMin` apart. */
function series(title: string, n: number, everyMin: number, extra: Partial<LogSpec> = {}) {
  return Array.from({ length: n }, (_, i) => log({ min: i * everyMin, title, ...extra }));
}

describe('normalizeTitle', () => {
  it('collapses embedded percentages and numbers', () => {
    expect(normalizeTitle('Battery at 19%')).toBe(normalizeTitle('Battery at 18%'));
    expect(normalizeTitle('Drive 4821 finished')).toBe(normalizeTitle('Drive 9 finished'));
    expect(normalizeTitle('Tyre at 2.3 bar')).toBe(normalizeTitle('Tyre at 2.7 bar'));
  });

  it('is case- and whitespace-insensitive', () => {
    expect(normalizeTitle('  Charge   Complete ')).toBe(normalizeTitle('charge complete'));
  });

  it('keeps genuinely different rules apart', () => {
    expect(normalizeTitle('Battery low')).not.toBe(normalizeTitle('Charge complete'));
  });
});

describe('noiseScoreOf', () => {
  it('grows with volume', () => {
    expect(noiseScoreOf(0.2, 0, 0)).toBeLessThan(noiseScoreOf(2, 0, 0));
    expect(noiseScoreOf(2, 0, 0)).toBeLessThan(noiseScoreOf(20, 0, 0));
  });

  it('grows with burstiness at equal volume', () => {
    expect(noiseScoreOf(3, 0, 0)).toBeLessThan(noiseScoreOf(3, 0.9, 0));
  });

  it('grows when notifications go unread', () => {
    expect(noiseScoreOf(3, 0.2, 0)).toBeLessThan(noiseScoreOf(3, 0.2, 1));
  });

  it('stays bounded to 0–100 under extreme input', () => {
    expect(noiseScoreOf(10_000, 5, 5)).toBeLessThanOrEqual(100);
    expect(noiseScoreOf(0, -1, -1)).toBeGreaterThanOrEqual(0);
  });

  it('redistributes weight when read tracking is absent', () => {
    // Without tracking the score must not silently collapse toward zero the
    // way it would if a missing rate were treated as "all read".
    expect(noiseScoreOf(5, 0.8, null)).toBeGreaterThan(noiseScoreOf(5, 0.8, 0));
  });
});

describe('analyzeAlertFatigue', () => {
  it('is empty and safe with no data', () => {
    const s = analyzeAlertFatigue([]);
    expect(s.groups).toEqual([]);
    expect(s.fatiguingCount).toBe(0);
    expect(s.overallIgnoredRate).toBeNull();
    expect(s.overallPerDay).toBe(0);
  });

  it('groups firings that differ only by an embedded value', () => {
    const logs = [
      log({ min: 0, title: 'Battery at 19%' }),
      log({ min: 200, title: 'Battery at 18%' }),
      log({ min: 400, title: 'Battery at 12%' }),
    ];
    const s = analyzeAlertFatigue(logs);
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0]!.total).toBe(3);
  });

  it('flags a high-volume, ignored, bursty rule as fatiguing', () => {
    const logs = series('Charge rate dropped', 40, 20); // every 20 min, all unread
    const g = analyzeAlertFatigue(logs).groups[0]!;
    expect(g.verdict).toBe('fatiguing');
    expect(g.ignoredRate).toBe(1);
    expect(g.burstRate).toBeGreaterThan(0.9);
    expect(g.perDay).toBeGreaterThan(20);
  });

  it('leaves a rare, promptly-read rule healthy', () => {
    const logs = series('Service due', 4, 60 * 24 * 30, { readAfterMin: 5 });
    const g = analyzeAlertFatigue(logs).groups[0]!;
    expect(g.verdict).toBe('healthy');
    expect(g.ignoredRate).toBe(0);
    expect(g.medianTimeToReadS).toBe(300);
  });

  it('detects bursts and reports the largest run', () => {
    const logs = [
      // Five firings inside ten minutes: a flapping threshold.
      ...Array.from({ length: 5 }, (_, i) => log({ min: i * 2, title: 'SoC threshold' })),
      // Then one a week later.
      log({ min: 60 * 24 * 7, title: 'SoC threshold' }),
    ];
    const g = analyzeAlertFatigue(logs).groups[0]!;
    expect(g.maxBurst).toBe(5);
    expect(g.burstRate).toBeCloseTo(4 / 5, 3);
  });

  it('does not count evenly-spaced firings as bursts', () => {
    const g = analyzeAlertFatigue(series('Daily summary', 10, 60 * 24)).groups[0]!;
    expect(g.burstRate).toBe(0);
    expect(g.maxBurst).toBe(1);
  });

  it('reports null ignored rate when the backend never tracked reads', () => {
    const g = analyzeAlertFatigue(series('Untracked rule', 10, 120, { tracked: false }))
      .groups[0]!;
    expect(g.ignoredRate).toBeNull();
    expect(g.trackable).toBe(0);
    expect(g.medianTimeToReadS).toBeNull();
    expect(g.noiseScore).toBeGreaterThan(0);
  });

  it('excludes failed deliveries from the read denominator', () => {
    const logs = [
      ...series('Flaky webhook', 4, 120, { status: 'failed' }),
      ...Array.from({ length: 4 }, (_, i) =>
        log({ min: 1000 + i * 120, title: 'Flaky webhook', readAfterMin: 1 }),
      ),
    ];
    const g = analyzeAlertFatigue(logs).groups[0]!;
    expect(g.failed).toBe(4);
    expect(g.delivered).toBe(4);
    expect(g.trackable).toBe(4);
    expect(g.ignoredRate).toBe(0);
  });

  it('withholds a verdict below the minimum firing count', () => {
    const g = analyzeAlertFatigue([log({ min: 0, title: 'One off' })]).groups[0]!;
    expect(g.verdict).toBe('healthy');
    expect(g.noiseScore).toBe(0);
    // Span is clamped so a lone event cannot report an infinite rate.
    expect(Number.isFinite(g.perDay)).toBe(true);
  });

  it('ranks the noisiest rule first', () => {
    const logs = [
      ...series('Quiet rule', 3, 60 * 24 * 20, { readAfterMin: 2 }),
      ...series('Screaming rule', 60, 15),
    ];
    const s = analyzeAlertFatigue(logs);
    expect(s.groups[0]!.title).toBe('Screaming rule');
    expect(s.groups[0]!.noiseScore).toBeGreaterThan(s.groups[1]!.noiseScore);
    expect(s.fatiguingCount).toBe(1);
  });

  it('builds weekday and hour histograms that account for every firing', () => {
    const logs = series('Hourly ping', 24, 60);
    const g = analyzeAlertFatigue(logs).groups[0]!;
    expect(g.weekdayCounts).toHaveLength(7);
    expect(g.hourCounts).toHaveLength(24);
    expect(g.weekdayCounts.reduce((a, b) => a + b, 0)).toBe(24);
    expect(g.hourCounts.reduce((a, b) => a + b, 0)).toBe(24);
  });

  it('ignores entries with unusable timestamps or empty titles', () => {
    const good = log({ min: 0, title: 'Real alert' });
    const s = analyzeAlertFatigue([
      good,
      { ...good, id: 99, sent_at: 'nonsense', created_at: 'nonsense' },
      { ...good, id: 98, title: '   ' },
    ]);
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0]!.total).toBe(1);
    expect(s.totalNotifications).toBe(3);
  });

  it('computes a fleet-wide ignored rate across rules', () => {
    const logs = [
      ...series('Read rule', 4, 120, { readAfterMin: 1 }),
      ...series('Unread rule', 4, 120),
    ];
    expect(analyzeAlertFatigue(logs).overallIgnoredRate).toBeCloseTo(0.5, 3);
  });
});
