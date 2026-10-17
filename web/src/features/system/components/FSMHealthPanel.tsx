import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RotateCw, Timer } from 'lucide-react';
import { GlassPanel, PanelTitle, Text, MetricValue } from '@/components/ui';
import { Grid } from '@/components/layout';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import type { DataState } from '@/api/dataState';
import { severityTokens } from '@/lib/tokens';

import type { FSMTransition } from '@/types/fsm';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface FSMHealthPanelProps {
  transitions?: FSMTransition[];
  /** Query trust is separate from the bounded rows used by these heuristics. */
  sourceState?: DataState<unknown>;
  isLoading?: boolean;
  /** Suppress the panel's own stale-refresh warning when the owner already renders one for this source. */
  hideStaleWarning?: boolean;
}

interface HealthAlert {
  type: 'flap' | 'stuck' | 'recovery';
  severity: 'warning' | 'info';
  message: string;
  count: number;
}

const FLAP_WINDOW_MS = 60_000;
const FLAP_THRESHOLD = 5;
const STUCK_THRESHOLD_MS = 4 * 60 * 60 * 1000;
const SESSION_FSMS = new Set(['drive_session', 'charge_session']);
const STUCK_STATES = new Set(['pending', 'active']);

function parseTs(ts: string): number {
  return new Date(ts).getTime();
}

export function FSMHealthPanel({ transitions, sourceState, isLoading = false, hideStaleWarning = false }: FSMHealthPanelProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();

  const alerts = useMemo<HealthAlert[]>(() => {
    const list = transitions ?? [];
    const result: HealthAlert[] = [];

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
        message: t('fsm.health.loadedStuck', '{{count}} potentially stuck session(s): latest loaded state is pending/active for >4 hours', { count: stuckCount }),
        count: stuckCount,
      });
    }

    const recoveryCount = list.filter((tr) => tr.to_state === 'recovered').length;
    if (recoveryCount > 0) {
      result.push({
        type: 'recovery',
        severity: 'info',
        message: t('fsm.health.loadedRecoveries', '{{count}} transitions to recovered in loaded rows; the recovery cause is not established', { count: recoveryCount }),
        count: recoveryCount,
      });
    }

    return result;
  }, [transitions, t]);

  const hasEvidence = sourceState ? sourceState.hasData : (transitions?.length ?? 0) > 0;
  const hasRows = (transitions?.length ?? 0) > 0;
  const hasValidTimestamps = hasRows && (transitions ?? []).every((tr) => Number.isFinite(parseTs(tr.ts)));
  const evidenceMessage = !hasEvidence
    ? sourceState?.isRefreshBlocked
      ? t('fsm.health.pausedEvidence', 'Transition evidence is paused; FSM health is unknown.')
      : t('fsm.health.unknownEvidence', 'Transition evidence has not loaded; FSM health is unknown.')
    : !hasRows
      ? t('fsm.health.emptyEvidence', 'No transitions in the loaded result. This does not establish FSM health; try expanding the time range.')
      : !hasValidTimestamps
        ? t('fsm.health.invalidEvidence', 'Some loaded transitions have invalid timestamps; time-based FSM health is unknown.')
        : t('fsm.health.loadedEvidence', 'Heuristics cover only loaded transition rows, not authoritative current FSM health.');

  if (!hasEvidence) {
    return (
      <GlassPanel className="p-4 space-y-3" data-testid="fsm-health-panel">
        <PanelTitle as="h2">{t('fsm.health.title', 'FSM health')}</PanelTitle>
        {sourceState?.fatalError ? (
          <QueryError error={sourceState.fatalError} onRetry={sourceState.retry ?? undefined} />
        ) : isLoading && !sourceState?.isRefreshBlocked ? (
          <div role="status" aria-label={t('common.loading', 'Loading')}>
            <Skeleton height={24} />
          </div>
        ) : (
          <Text as="p" variant="bodySm" role="status">{evidenceMessage}</Text>
        )}
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="p-4 space-y-3" data-testid="fsm-health-panel">
      <PanelTitle as="h2">{t('fsm.health.title', 'FSM health')}</PanelTitle>
      {sourceState && !hideStaleWarning && <StaleRefreshWarning state={sourceState} />}
      <Text as="p" variant="bodySm" role="status">{evidenceMessage}</Text>
      {hasRows && hasValidTimestamps && alerts.length === 0 && (
        <Text as="p" variant="bodySm" role="status" data-testid="fsm-health-all-clear">
          {t('fsm.health.loadedClear', 'No flapping, potentially stuck sessions, or recovery transitions detected in loaded rows.')}
        </Text>
      )}
      <Grid cols={{ default: 1, md: Math.max(1, alerts.length) }} gap={3}>
        {alerts.map((alert) => {
          const Icon = alert.type === 'flap' ? AlertTriangle : alert.type === 'stuck' ? Timer : RotateCw;
          const tone = severityTokens[alert.severity === 'warning' ? 'warn' : 'info'];
          const title =
            alert.type === 'flap'
              ? t('fsm.health.flapTitle', 'State flapping')
              : alert.type === 'stuck'
                ? t('fsm.health.stuckTitle', 'Stuck sessions')
                : t('fsm.health.loadedRecoveryTitle', 'Recovery transitions');
          return (
            <div
              key={alert.type}
              role="status"
              data-testid={`fsm-health-alert-${alert.type}`}
              className={`flex items-start gap-3 rounded-lg border p-3 ${tone.border} ${tone.bg}`}
            >
              <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${tone.fg}`} aria-hidden="true" />
              <div>
                <Text variant="label" className={tone.fg}>{title}</Text>
                <Text as="p" variant="bodySm" className="mt-0.5">{alert.message}</Text>
              </div>
              <MetricValue className={`ml-auto ${tone.fg}`} aria-hidden="true">{fmtInt(alert.count)}</MetricValue>
            </div>
          );
        })}
      </Grid>
    </GlassPanel>
  );
}

/** Shared with the debugger KPI: same-FSM bursts above the sliding-window threshold. */
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
