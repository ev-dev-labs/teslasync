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

export function FSMHealthPanel({ transitions }: FSMHealthPanelProps) {
  const { t } = useTranslation();

  const { alerts } = useMemo(() => {
    const result: HealthAlert[] = [];
    const flapped = new Set<number>();

    // ── Flap detection: >5 transitions of same FSM within any 1-min window ──
    const byType = new Map<string, FSMTransition[]>();
    for (const tr of transitions) {
      const list = byType.get(tr.fsm_name) ?? [];
      list.push(tr);
      byType.set(tr.fsm_name, list);
    }

    for (const [, list] of byType) {
      const sorted = [...list].sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
      );
      for (let i = 0; i < sorted.length; i++) {
        const windowEnd = new Date(sorted[i].ts).getTime() + 60_000;
        let count = 0;
        for (let j = i; j < sorted.length; j++) {
          if (new Date(sorted[j].ts).getTime() <= windowEnd) {
            count++;
          } else break;
        }
        if (count > 5) {
          for (let j = i; j < sorted.length; j++) {
            if (new Date(sorted[j].ts).getTime() <= windowEnd) {
              flapped.add(sorted[j].id);
            } else break;
          }
        }
      }
      if (flapped.size > 0 && !result.some(a => a.type === 'flap')) {
        result.push({
          type: 'flap',
          severity: 'warning',
          message: t('fsm.health.flapping', '{{count}} transitions flagged as state flapping (>5 same-FSM transitions/min)', { count: flapped.size }),
          count: flapped.size,
        });
      }
    }

    // ── Stuck detection: session FSMs in pending/active for >4 hours ──
    const now = Date.now();
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    const sessionTypes = ['drive_session', 'charge_session'];
    const stuckStates = ['pending', 'active'];
    // Group by instance to find latest state
    const instanceLatest = new Map<string, FSMTransition>();
    for (const tr of transitions) {
      if (!sessionTypes.includes(tr.fsm_name)) continue;
      const key = `${tr.fsm_name}:${tr.vehicle_id ?? tr.vehicle_id}`;
      const existing = instanceLatest.get(key);
      if (!existing || new Date(tr.ts).getTime() > new Date(existing.ts).getTime()) {
        instanceLatest.set(key, tr);
      }
    }
    let stuckCount = 0;
    for (const [, tr] of instanceLatest) {
      if (stuckStates.includes(tr.to_state) && (now - new Date(tr.ts).getTime()) > FOUR_HOURS) {
        stuckCount++;
      }
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
    const recoveryCount = transitions.filter(tr => tr.to_state === 'recovered').length;
    if (recoveryCount > 0) {
      result.push({
        type: 'recovery',
        severity: 'info',
        message: t('fsm.health.recoveries', '{{count}} session(s) recovered after pod restart', { count: recoveryCount }),
        count: recoveryCount,
      });
    }

    return { alerts: result };
  }, [transitions, t]);

  if (alerts.length === 0) {
    return (
      <GlassPanel className="p-4">
        <div className="flex items-center gap-2 text-sm text-green-400">
          <span className="h-2 w-2 rounded-full bg-green-400" />
          {t('fsm.health.allClear', 'All FSMs healthy — no flapping, stuck sessions, or recoveries detected')}
        </div>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="p-4">
      <h2 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-3">
        {t('fsm.health.title', 'FSM Health')}
      </h2>
      <Grid cols={{ default: 1, md: alerts.length }} gap={3}>
        {alerts.map((alert) => {
          const Icon = alert.type === 'flap' ? AlertTriangle : alert.type === 'stuck' ? Timer : RotateCw;
          const borderColor = alert.severity === 'warning' ? 'border-amber-500/20' : 'border-blue-500/20';
          const bgColor = alert.severity === 'warning' ? 'bg-amber-500/5' : 'bg-blue-500/5';
          const textColor = alert.severity === 'warning' ? 'text-amber-400' : 'text-blue-400';
          return (
            <div
              key={alert.type}
              className={`flex items-start gap-3 rounded-lg border p-3 ${borderColor} ${bgColor}`}
            >
              <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${textColor}`} />
              <div>
                <span className={`text-xs font-medium ${textColor}`}>
                  {alert.type === 'flap' ? t('fsm.health.flapTitle', 'State Flapping') : alert.type === 'stuck' ? t('fsm.health.stuckTitle', 'Stuck Sessions') : t('fsm.health.recoveryTitle', 'Pod Recoveries')}
                </span>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">{alert.message}</p>
              </div>
              <span className={`ml-auto text-lg font-bold ${textColor}`}>{fmtInt(alert.count)}</span>
            </div>
          );
        })}
      </Grid>
    </GlassPanel>
  );
}

/** Re-export flapIds for use by parent */
export function computeFlapIds(transitions: FSMTransition[]): Set<number> {
  const flapped = new Set<number>();
  const byType = new Map<string, FSMTransition[]>();
  for (const tr of transitions) {
    const list = byType.get(tr.fsm_name) ?? [];
    list.push(tr);
    byType.set(tr.fsm_name, list);
  }
  for (const [, list] of byType) {
    const sorted = [...list].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );
    for (let i = 0; i < sorted.length; i++) {
      const windowEnd = new Date(sorted[i].ts).getTime() + 60_000;
      let count = 0;
      for (let j = i; j < sorted.length; j++) {
        if (new Date(sorted[j].ts).getTime() <= windowEnd) {
          count++;
        } else break;
      }
      if (count > 5) {
        for (let j = i; j < sorted.length; j++) {
          if (new Date(sorted[j].ts).getTime() <= windowEnd) {
            flapped.add(sorted[j].id);
          } else break;
        }
      }
    }
  }
  return flapped;
}
