/**
 * Command Reliability — which remote commands can you actually trust?
 *
 * "Send command, hope for the best" is the normal experience of controlling a
 * car over the internet. The vehicle may be asleep, the Fleet API may be rate
 * limiting, the signing proxy may have expired a key. Each command type fails
 * for different reasons and at very different rates, but the raw command log
 * shows only an undifferentiated wall of rows.
 *
 * This module turns that log into a per-command reliability profile. Two
 * decisions make it more than a `GROUP BY`:
 *
 *  1. **Wilson score intervals, not naive percentages.** Three successes out of
 *     three is not "100 % reliable" — it is "somewhere above 44 %". The Wilson
 *     interval is used because it stays inside [0, 1] and behaves sensibly at
 *     the tiny sample sizes that dominate a personal command log, where the
 *     normal approximation produces impossible bounds like 112 %.
 *  2. **Retry-storm detection.** Users who get no response mash the button. The
 *     module detects repeats of the same command inside a short window and
 *     reports both the storm count and the eventual outcome, which separates
 *     "the command failed" from "the command worked, the user just did not
 *     believe it".
 *
 * The lower Wilson bound is what drives ranking: it is the honest pessimistic
 * estimate, and it automatically demotes commands with too little evidence
 * instead of letting a lucky 2/2 outrank a solid 180/200.
 *
 * Pure and React-free.
 */

import type { CommandLogEntry } from '@/api/hooks/useCommands';

export type ReliabilityGrade = 'excellent' | 'good' | 'flaky' | 'unreliable' | 'unproven';

export interface ConfidenceInterval {
  lower: number;
  upper: number;
}

export interface CommandStats {
  command: string;
  label: string;
  total: number;
  success: number;
  failure: number;
  pending: number;
  /** Naive success share over resolved attempts. */
  successRate: number;
  /** Wilson 95 % interval over resolved attempts. */
  interval: ConfidenceInterval;
  grade: ReliabilityGrade;
  /** Distinct user intents after collapsing retry storms. */
  intents: number;
  /** Intents that needed more than one attempt. */
  retriedIntents: number;
  /** Attempts per intent — 1.0 means it always worked first time. */
  attemptsPerIntent: number;
  /** Most frequent error text, when any attempt failed. */
  topError: string | null;
  topErrorCount: number;
  firstMs: number;
  lastMs: number;
  /** Success rate over the most recent attempts, for a trend read. */
  recentSuccessRate: number | null;
}

export interface RetryStorm {
  command: string;
  startMs: number;
  attempts: number;
  /** True when any attempt in the storm eventually succeeded. */
  succeeded: boolean;
}

export interface CommandReliabilitySummary {
  commands: CommandStats[];
  storms: RetryStorm[];
  totalAttempts: number;
  totalIntents: number;
  overallSuccessRate: number;
  /** Commands graded `unreliable`. */
  unreliableCount: number;
  /** The command with the worst lower bound and enough evidence to judge. */
  worstCommand: CommandStats | null;
}

export interface CommandReliabilityOptions {
  /** Repeats of one command inside this window count as the same intent. */
  retryWindowMin?: number;
  /** Resolved attempts required before a grade is assigned. */
  minAttempts?: number;
  /** Attempts included in the recent-trend sample. */
  recentWindow?: number;
  /** Lower-bound thresholds for the grades. */
  excellentBound?: number;
  goodBound?: number;
  flakyBound?: number;
}

const DEFAULTS = {
  retryWindowMin: 5,
  minAttempts: 5,
  recentWindow: 10,
  excellentBound: 0.9,
  goodBound: 0.7,
  flakyBound: 0.4,
} as const;

/** Statuses the backend uses for a completed, successful command. */
const SUCCESS_STATUSES = new Set(['success', 'ok', 'completed', 'sent', 'delivered', 'result']);
/** Statuses meaning the attempt has not resolved yet — excluded from rates. */
const PENDING_STATUSES = new Set(['pending', 'queued', 'in_progress', 'sending']);

/**
 * Wilson score interval for a binomial proportion at 95 % confidence.
 *
 * Exported and separately tested because the whole ranking rests on it: an
 * error here would quietly reorder every command on the page.
 */
export function wilsonInterval(successes: number, total: number, z = 1.96): ConfidenceInterval {
  if (total <= 0) return { lower: 0, upper: 1 };
  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return {
    lower: Math.max(0, (centre - margin) / denom),
    upper: Math.min(1, (centre + margin) / denom),
  };
}

/** Classify a raw status string into the three outcomes that matter. */
export function classifyStatus(status: string): 'success' | 'failure' | 'pending' {
  const s = (status ?? '').trim().toLowerCase();
  if (PENDING_STATUSES.has(s)) return 'pending';
  if (SUCCESS_STATUSES.has(s)) return 'success';
  return 'failure';
}

/** `honk_horn` / `HONK-HORN` → `Honk Horn`. */
export function humanizeCommand(command: string): string {
  return command
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Trim a raw error to a comparable signature so counts group sensibly. */
function errorSignature(error: string): string {
  return error
    .trim()
    .replace(/\d+/g, '#')
    .slice(0, 120);
}

export function analyzeCommandReliability(
  entries: readonly CommandLogEntry[],
  options: CommandReliabilityOptions = {},
): CommandReliabilitySummary {
  const opts = { ...DEFAULTS, ...options };
  const retryWindowMs = opts.retryWindowMin * 60_000;

  interface Attempt {
    ms: number;
    outcome: 'success' | 'failure' | 'pending';
    error: string;
  }

  const byCommand = new Map<string, Attempt[]>();

  for (const entry of entries) {
    const ms = new Date(entry.created_at).getTime();
    if (!Number.isFinite(ms)) continue;
    const command = (entry.command ?? '').trim();
    if (command.length === 0) continue;

    let list = byCommand.get(command);
    if (list == null) {
      list = [];
      byCommand.set(command, list);
    }
    list.push({ ms, outcome: classifyStatus(entry.status), error: entry.error ?? '' });
  }

  const commands: CommandStats[] = [];
  const storms: RetryStorm[] = [];
  let totalAttempts = 0;
  let totalIntents = 0;
  let totalSuccess = 0;
  let totalResolved = 0;

  for (const [command, unsorted] of byCommand) {
    const attempts = unsorted.sort((a, b) => a.ms - b.ms);
    const total = attempts.length;
    const success = attempts.filter((a) => a.outcome === 'success').length;
    const pending = attempts.filter((a) => a.outcome === 'pending').length;
    const failure = total - success - pending;
    const resolved = success + failure;

    // Collapse consecutive attempts inside the retry window into one intent:
    // the user pressed the button once and the UI (or the user) repeated it.
    let intents = 0;
    let retriedIntents = 0;
    let runStart = -1;
    let runLength = 0;
    let runSucceeded = false;

    const closeRun = () => {
      if (runLength === 0) return;
      intents += 1;
      if (runLength > 1) {
        retriedIntents += 1;
        storms.push({
          command,
          startMs: runStart,
          attempts: runLength,
          succeeded: runSucceeded,
        });
      }
    };

    for (let i = 0; i < total; i++) {
      const a = attempts[i]!;
      const continuesRun = i > 0 && a.ms - attempts[i - 1]!.ms <= retryWindowMs;
      if (continuesRun) {
        runLength += 1;
        runSucceeded = runSucceeded || a.outcome === 'success';
      } else {
        closeRun();
        runStart = a.ms;
        runLength = 1;
        runSucceeded = a.outcome === 'success';
      }
    }
    closeRun();

    const errorCounts = new Map<string, number>();
    for (const a of attempts) {
      if (a.outcome !== 'failure') continue;
      const sig = errorSignature(a.error);
      if (sig.length === 0) continue;
      errorCounts.set(sig, (errorCounts.get(sig) ?? 0) + 1);
    }
    let topError: string | null = null;
    let topErrorCount = 0;
    for (const [sig, count] of errorCounts) {
      if (count > topErrorCount) {
        topError = sig;
        topErrorCount = count;
      }
    }

    const interval = wilsonInterval(success, resolved);
    let grade: ReliabilityGrade = 'unproven';
    if (resolved >= opts.minAttempts) {
      if (interval.lower >= opts.excellentBound) grade = 'excellent';
      else if (interval.lower >= opts.goodBound) grade = 'good';
      else if (interval.lower >= opts.flakyBound) grade = 'flaky';
      else grade = 'unreliable';
    }

    const recentResolved = attempts
      .filter((a) => a.outcome !== 'pending')
      .slice(-opts.recentWindow);

    commands.push({
      command,
      label: humanizeCommand(command),
      total,
      success,
      failure,
      pending,
      successRate: resolved > 0 ? Math.round((success / resolved) * 1000) / 1000 : 0,
      interval: {
        lower: Math.round(interval.lower * 1000) / 1000,
        upper: Math.round(interval.upper * 1000) / 1000,
      },
      grade,
      intents,
      retriedIntents,
      attemptsPerIntent: intents > 0 ? Math.round((total / intents) * 100) / 100 : 0,
      topError,
      topErrorCount,
      firstMs: attempts[0]!.ms,
      lastMs: attempts[total - 1]!.ms,
      recentSuccessRate:
        recentResolved.length === 0
          ? null
          : Math.round(
              (recentResolved.filter((a) => a.outcome === 'success').length /
                recentResolved.length) *
                1000,
            ) / 1000,
    });

    totalAttempts += total;
    totalIntents += intents;
    totalSuccess += success;
    totalResolved += resolved;
  }

  // Least trustworthy first — that is the row worth acting on.
  commands.sort((a, b) => a.interval.lower - b.interval.lower || b.total - a.total);
  storms.sort((a, b) => b.attempts - a.attempts || b.startMs - a.startMs);

  const judged = commands.filter((c) => c.grade !== 'unproven');

  return {
    commands,
    storms,
    totalAttempts,
    totalIntents,
    overallSuccessRate:
      totalResolved > 0 ? Math.round((totalSuccess / totalResolved) * 1000) / 1000 : 0,
    unreliableCount: commands.filter((c) => c.grade === 'unreliable').length,
    worstCommand: judged.length === 0 ? null : judged[0] ?? null,
  };
}
