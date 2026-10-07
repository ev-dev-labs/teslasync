import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RotateCw, Timer } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { Grid } from '@/components/layout';
import { fmtInt } from '@/lib/numberFormat';
import type { FSMTransition } from '@/types/fsm';

interface FSMHealthPanelProps {
  transitions: FSMTransition[];
}

interface HealthAlert {
  type: 'flap' | 'stuck' | 'recovery';
  severity: 'warning' | 'info';
  message: string;
  count: number;
}

/** Sliding window in which repeated same-FSM transitions count as flapping. */
const FLAP_WINDOW_MS = 60_000;
/** More than this many same-FSM transitions inside the window = flapping. */
const FLAP_THRESHOLD = 5;
/** A session sitting in pending/active longer than this is considered stuck. */
const STUCK_THRESHOLD_MS = 4 * 60 * 60 * 1000;
/** Session FSMs whose latest state we watch for the "stuck" heuristic. */
const SESSION_FSMS = new Set(['drive_session', 'charge_session']);
/** Non-terminal states that indicate a session may be stuck. */
const STUCK_STATES = new Set(['pending', 'active']);

/** Epoch-ms for an ISO timestamp; NaN when the input is malformed. */
function parseTs(ts: string): number {
  return new Date(ts).getTime();
}

export function FSMHealthPanel({ transitions }: FSMHealthPanelProps) {
  const { t } = useTranslation();

  const alerts = useMemo<HealthAlert[]>(() => {
    const list = transitions ?? [];
    const result: HealthAlert[] = [];

    // ── Flap detection — reuse the single source of truth so the panel and
    //    the debugger page's flap KPI can never disagree, and so the count
    //    aggregates across *every* flapping FSM (not just the first one). ──
    const flapped = computeFlapIds(list);
    if (flapped.size > 0) {
      result.push({
        type: 'flap',
        severity: 'warning',
        message: t(
          'fsm.health.flapping',
          '{{count}} transitions flagged as state flapping (>5 same-FSM transitions/min)',
          { count: flapped.size },
        ),
        count: flapped.size,
      });
    }

    // ── Stuck detection: the latest state of each session-FSM instance sits
    //    in pending/active for longer than the stuck threshold. ──
    const now = Date.now();
    const instanceLatest = new Map<string, { state: string; t: number }>();
    for (const tr of list) {
      if (!SESSION_FSMS.has(tr.fsm_name)) continue;
      const ts = parseTs(tr.ts);
      if (!Number.isFinite(ts)) continue;
      const key = `${tr.fsm_name}:${tr.vehicle_id ?? 'unknown'}`;
      const existing = instanceLatest.get(key);
      if (!existing || ts > existing.t) {
        instanceLatest.set(key, { state: tr.to_state, t: ts });
      }
    }
    let stuckCount = 0;
    for (const { state, t: ts } of instanceLatest.values()) {
      if (STUCK_STATES.has(state) && now - ts > STUCK_THRESHOLD_MS) stuckCount++;
    }
    if (stuckCount > 0) {
      result.push({
        type: 'stuck',
        severity: 'warning',
        message: t('fsm.health.stuck', '{{count}} session(s) stuck in pending/active for >4 hours', { count: stuckCount }),
        count: stuckCount,
      });
    }

    // ── Recovery count: transitions to "recovered" state ──
    const recoveryCount = list.filter((tr) => tr.to_state === 'recovered').length;
    if (recoveryCount > 0) {
      result.push({
        type: 'recovery',
        severity: 'info',
        message: t('fsm.health.recoveries', '{{count}} session(s) recovered after pod restart', { count: recoveryCount }),
        count: recoveryCount,
      });
    }

    return result;
  }, [transitions, t]);

  if (alerts.length === 0) {
    return (
      <GlassPanel className="p-4" data-testid="fsm-health-all-clear">
        <div className="flex items-center gap-2 text-sm text-green-400" role="status">
          <span className="h-2 w-2 rounded-full bg-green-400" aria-hidden="true" />
          {t('fsm.health.allClear', 'All FSMs healthy — no flapping, stuck sessions, or recoveries detected')}
        </div>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="p-4" data-testid="fsm-health-panel">
      <h2 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-3">
        {t('fsm.health.title', 'FSM Health')}
      </h2>
      <Grid cols={{ default: 1, md: alerts.length }} gap={3}>
        {alerts.map((alert) => {
          const Icon = alert.type === 'flap' ? AlertTriangle : alert.type === 'stuck' ? Timer : RotateCw;
          const borderColor = alert.severity === 'warning' ? 'border-amber-500/20' : 'border-blue-500/20';
          const bgColor = alert.severity === 'warning' ? 'bg-amber-500/5' : 'bg-blue-500/5';
          const textColor = alert.severity === 'warning' ? 'text-amber-400' : 'text-blue-400';
          const title =
            alert.type === 'flap'
              ? t('fsm.health.flapTitle', 'State Flapping')
              : alert.type === 'stuck'
                ? t('fsm.health.stuckTitle', 'Stuck Sessions')
                : t('fsm.health.recoveryTitle', 'Pod Recoveries');
          return (
            <div
              key={alert.type}
              role="status"
              data-testid={`fsm-health-alert-${alert.type}`}
              className={`flex items-start gap-3 rounded-lg border p-3 ${borderColor} ${bgColor}`}
            >
              <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${textColor}`} aria-hidden="true" />
              <div>
                <span className={`text-xs font-medium ${textColor}`}>{title}</span>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">{alert.message}</p>
              </div>
              <span className={`ml-auto text-lg font-bold ${textColor}`} aria-hidden="true">{fmtInt(alert.count)}</span>
            </div>
          );
        })}
      </Grid>
    </GlassPanel>
  );
}

/**
 * Identify transition IDs that participate in "state flapping" — more than
 * FLAP_THRESHOLD transitions of the SAME FSM inside any FLAP_WINDOW_MS window.
 * Exported for the debugger page's flap KPI; {@link FSMHealthPanel} reuses it so
 * the detection logic lives in exactly one place.
 */
export function computeFlapIds(transitions: FSMTransition[]): Set<number> {
  const flapped = new Set<number>();

  // Group by FSM, dropping malformed timestamps up front so a single bad `ts`
  // can neither destabilise the sort nor truncate a window early.
  const byType = new Map<string, { id: number; t: number }[]>();
  for (const tr of transitions ?? []) {
    const t = parseTs(tr.ts);
    if (!Number.isFinite(t)) continue;
    const list = byType.get(tr.fsm_name) ?? [];
    list.push({ id: tr.id, t });
    byType.set(tr.fsm_name, list);
  }

  for (const list of byType.values()) {
    const sorted = [...list].sort((a, b) => a.t - b.t);
    for (let i = 0; i < sorted.length; i++) {
      const windowEnd = sorted[i].t + FLAP_WINDOW_MS;
      let count = 0;
      for (let j = i; j < sorted.length && sorted[j].t <= windowEnd; j++) count++;
      if (count > FLAP_THRESHOLD) {
        for (let j = i; j < sorted.length && sorted[j].t <= windowEnd; j++) {
          flapped.add(sorted[j].id);
        }
      }
    }
  }
  return flapped;
}
