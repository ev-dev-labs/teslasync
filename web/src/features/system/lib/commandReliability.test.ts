import { describe, it, expect } from 'vitest';
import type { CommandLogEntry } from '@/api/hooks/useCommands';
import {
  analyzeCommandReliability,
  classifyStatus,
  humanizeCommand,
  wilsonInterval,
} from './commandReliability';

const ANCHOR = Date.UTC(2026, 2, 1, 8, 0, 0);

let nextId = 1;

interface EntrySpec {
  /** Minutes after the anchor. */
  min: number;
  command: string;
  status?: string;
  error?: string;
}

function entry(spec: EntrySpec): CommandLogEntry {
  return {
    id: nextId++,
    vehicle_id: 1,
    command: spec.command,
    params: '{}',
    status: spec.status ?? 'success',
    error: spec.error ?? '',
    created_at: new Date(ANCHOR + spec.min * 60_000).toISOString(),
  };
}

/** n attempts of one command, well separated so each is its own intent. */
function attempts(command: string, n: number, status = 'success', startMin = 0) {
  return Array.from({ length: n }, (_, i) =>
    entry({ min: startMin + i * 60, command, status }),
  );
}

describe('wilsonInterval', () => {
  it('never leaves the unit interval, even at the extremes', () => {
    for (const [s, n] of [
      [0, 1],
      [1, 1],
      [0, 10],
      [10, 10],
      [3, 3],
    ] as const) {
      const ci = wilsonInterval(s, n);
      expect(ci.lower).toBeGreaterThanOrEqual(0);
      expect(ci.upper).toBeLessThanOrEqual(1);
      expect(ci.lower).toBeLessThanOrEqual(ci.upper);
    }
  });

  it('is wide with little evidence and narrow with a lot', () => {
    const few = wilsonInterval(3, 3);
    const many = wilsonInterval(300, 300);
    expect(few.lower).toBeLessThan(0.6);
    expect(many.lower).toBeGreaterThan(0.98);
  });

  it('matches the published value for 3 of 3 successes', () => {
    // Textbook Wilson 95 % lower bound for 3/3 is ≈ 0.4385.
    expect(wilsonInterval(3, 3).lower).toBeCloseTo(0.4385, 3);
  });

  it('is symmetric about a half', () => {
    const a = wilsonInterval(3, 10);
    const b = wilsonInterval(7, 10);
    expect(a.lower).toBeCloseTo(1 - b.upper, 9);
  });

  it('degrades safely with no observations', () => {
    expect(wilsonInterval(0, 0)).toEqual({ lower: 0, upper: 1 });
  });
});

describe('classifyStatus', () => {
  it('recognises the success vocabulary the backend uses', () => {
    for (const s of ['success', 'OK', 'completed', ' Sent ', 'delivered']) {
      expect(classifyStatus(s)).toBe('success');
    }
  });

  it('treats unresolved statuses as pending, not failure', () => {
    for (const s of ['pending', 'queued', 'in_progress', 'sending']) {
      expect(classifyStatus(s)).toBe('pending');
    }
  });

  it('treats anything else as failure', () => {
    for (const s of ['error', 'timeout', 'vehicle_asleep', '']) {
      expect(classifyStatus(s)).toBe('failure');
    }
  });
});

describe('humanizeCommand', () => {
  it('renders snake, kebab and camel case as words', () => {
    expect(humanizeCommand('honk_horn')).toBe('Honk Horn');
    expect(humanizeCommand('set-charge-limit')).toBe('Set Charge Limit');
    expect(humanizeCommand('flashLights')).toBe('Flash Lights');
  });
});

describe('analyzeCommandReliability', () => {
  it('is empty and safe with no data', () => {
    const s = analyzeCommandReliability([]);
    expect(s.commands).toEqual([]);
    expect(s.storms).toEqual([]);
    expect(s.worstCommand).toBeNull();
    expect(s.overallSuccessRate).toBe(0);
  });

  it('grades a consistently working command as excellent', () => {
    const c = analyzeCommandReliability(attempts('honk_horn', 60)).commands[0]!;
    expect(c.grade).toBe('excellent');
    expect(c.successRate).toBe(1);
    expect(c.interval.lower).toBeGreaterThan(0.9);
  });

  it('grades a mostly-failing command as unreliable', () => {
    const logs = [
      ...attempts('remote_start', 3, 'success'),
      ...attempts('remote_start', 17, 'error', 500),
    ];
    const c = analyzeCommandReliability(logs).commands[0]!;
    expect(c.grade).toBe('unreliable');
    expect(c.failure).toBe(17);
    expect(c.interval.upper).toBeLessThan(0.5);
  });

  it('refuses to grade a command with too little evidence', () => {
    const c = analyzeCommandReliability(attempts('vent_windows', 3)).commands[0]!;
    expect(c.grade).toBe('unproven');
    // A perfect 3/3 must not masquerade as proven reliability.
    expect(c.successRate).toBe(1);
    expect(c.interval.lower).toBeLessThan(0.5);
  });

  it('does not let a lucky small sample outrank a large solid one', () => {
    const logs = [
      ...attempts('lucky', 3, 'success'),
      ...attempts('solid', 200, 'success', 1000),
    ];
    const s = analyzeCommandReliability(logs);
    const lucky = s.commands.find((c) => c.command === 'lucky')!;
    const solid = s.commands.find((c) => c.command === 'solid')!;
    expect(lucky.successRate).toBe(solid.successRate);
    expect(lucky.interval.lower).toBeLessThan(solid.interval.lower);
    expect(s.commands.indexOf(lucky)).toBeLessThan(s.commands.indexOf(solid));
  });

  it('excludes pending attempts from the success rate', () => {
    const logs = [
      ...attempts('door_unlock', 8, 'success'),
      ...attempts('door_unlock', 4, 'pending', 1000),
    ];
    const c = analyzeCommandReliability(logs).commands[0]!;
    expect(c.pending).toBe(4);
    expect(c.total).toBe(12);
    expect(c.successRate).toBe(1);
  });

  it('collapses a retry storm into one intent', () => {
    // Six presses inside two minutes, the last one working.
    const logs = [
      ...Array.from({ length: 5 }, (_, i) =>
        entry({ min: i * 0.4, command: 'wake_up', status: 'error' }),
      ),
      entry({ min: 2, command: 'wake_up', status: 'success' }),
    ];
    const s = analyzeCommandReliability(logs);
    const c = s.commands[0]!;
    expect(c.total).toBe(6);
    expect(c.intents).toBe(1);
    expect(c.retriedIntents).toBe(1);
    expect(c.attemptsPerIntent).toBe(6);
    expect(s.storms).toHaveLength(1);
    expect(s.storms[0]!.attempts).toBe(6);
    expect(s.storms[0]!.succeeded).toBe(true);
  });

  it('keeps well-separated attempts as distinct intents', () => {
    const c = analyzeCommandReliability(attempts('climate_on', 10)).commands[0]!;
    expect(c.intents).toBe(10);
    expect(c.retriedIntents).toBe(0);
    expect(c.attemptsPerIntent).toBe(1);
    expect(analyzeCommandReliability(attempts('climate_on', 10)).storms).toEqual([]);
  });

  it('reports the dominant error and groups near-identical text', () => {
    const logs = [
      ...Array.from({ length: 6 }, (_, i) =>
        entry({
          min: i * 60,
          command: 'set_charge_limit',
          status: 'error',
          error: `vehicle asleep after 30 s (attempt ${i})`,
        }),
      ),
      entry({ min: 500, command: 'set_charge_limit', status: 'error', error: 'rate limited' }),
    ];
    const c = analyzeCommandReliability(logs).commands[0]!;
    expect(c.topError).toContain('vehicle asleep after # s');
    expect(c.topErrorCount).toBe(6);
  });

  it('tracks a recent-trend rate distinct from the lifetime rate', () => {
    const logs = [
      ...attempts('trunk_open', 40, 'success'),
      ...attempts('trunk_open', 10, 'error', 5000),
    ];
    const c = analyzeCommandReliability(logs).commands[0]!;
    expect(c.successRate).toBeCloseTo(0.8, 2);
    expect(c.recentSuccessRate).toBe(0);
  });

  it('identifies the worst judged command and counts unreliable ones', () => {
    const logs = [
      ...attempts('good_cmd', 40, 'success'),
      ...attempts('bad_cmd', 20, 'error', 5000),
      ...attempts('tiny_cmd', 2, 'error', 9000),
    ];
    const s = analyzeCommandReliability(logs);
    expect(s.worstCommand!.command).toBe('bad_cmd');
    expect(s.unreliableCount).toBe(1);
    // The two-attempt command is too thin to be blamed.
    expect(s.commands.find((c) => c.command === 'tiny_cmd')!.grade).toBe('unproven');
  });

  it('ignores rows with unusable timestamps or blank commands', () => {
    const good = entry({ min: 0, command: 'honk_horn' });
    const s = analyzeCommandReliability([
      good,
      { ...good, id: 99, created_at: 'nope' },
      { ...good, id: 98, command: '  ' },
    ]);
    expect(s.commands).toHaveLength(1);
    expect(s.totalAttempts).toBe(1);
  });
});
