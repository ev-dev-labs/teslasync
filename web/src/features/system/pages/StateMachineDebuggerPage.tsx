import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui';
import { StatCard } from '@/components/data-display/StatCard';
import { useVehicleStateMachine, useStateTimeline } from '@/api/hooks/useAdmin';
import { useVehicles } from '@/api/hooks/useVehicles';

const stateColors: Record<string, 'success' | 'warning' | 'info' | 'danger' | 'neutral'> = {
  driving: 'success',
  charging: 'warning',
  parked: 'info',
  sleeping: 'neutral',
  online: 'info',
  offline: 'danger',
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function StateMachineDebuggerPage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? '';

  const { data: state, isLoading, error } = useVehicleStateMachine(activeId);
  const { data: timeline } = useStateTimeline(activeId);
  const transitions = timeline?.transitions ?? [];

  const durationByState = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of transitions) {
      map[t.state] = (map[t.state] ?? 0) + t.durationSeconds;
    }
    return map;
  }, [transitions]);

  const totalDuration = Object.values(durationByState).reduce((a, b) => a + b, 0);

  return (
    <PageContainer
      title={t('State Machine Debugger')}
      subtitle={t('Monitor vehicle state transitions and time distribution')}
      loading={isLoading}
      error={error as Error | null}
      empty={!state}
      emptyMessage={t('No state data available.')}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={(vehicles ?? []).map((v) => ({ value: String(v.id), label: v.displayName || v.vin }))}
            value={String(activeId)}
            onChange={(e) => setVehicleId(e.target.value)}
          />
        ) : undefined
      }
    >
      <Card>
        <CardHeader title={t('Current State')} />
        <div className="flex items-center gap-4 px-4 pb-4">
          <Badge variant={stateColors[state?.state ?? ''] ?? 'neutral'} size="lg" dot>
            {state?.state?.toUpperCase() ?? '--'}
          </Badge>
          <p className="text-sm text-gray-400">
            {state?.since ? `${t('Since')} ${state.since ? new Date(state.since).toLocaleString() : '—'}` : ''}
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title={t('State Duration Distribution')} />
        <div className="px-4 pb-4 space-y-2">
          {Object.entries(durationByState).map(([s, dur]) => {
            const pct = totalDuration > 0 ? (dur / totalDuration) * 100 : 0;
            return (
              <div key={s} className="flex items-center gap-3">
                <Badge variant={stateColors[s] ?? 'neutral'} size="sm" className="w-20 text-center">{s}</Badge>
                <div className="flex-1 h-4 bg-gray-700 rounded overflow-hidden">
                  <div className="h-4 bg-cyan-400 rounded" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-gray-400 w-20 text-right">{pct.toFixed(1)}%</span>
                <span className="text-xs text-gray-500 w-16 text-right">{formatDuration(dur)}</span>
              </div>
            );
          })}
        </div>
      </Card>

      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Transitions')} value={transitions.length} />
        <StatCard label={t('States Seen')} value={Object.keys(durationByState).length} />
        <StatCard label={t('Total Time')} value={formatDuration(totalDuration)} />
        <StatCard label={t('Current')} value={state?.state ?? '--'} />
      </Grid>

      <Card>
        <CardHeader title={t('Transition Timeline (24h)')} />
        <div className="max-h-64 overflow-y-auto divide-y divide-gray-800">
          {transitions.map((tr, i) => (
            <div key={i} className="flex items-center gap-4 px-3 py-2 text-sm">
              <Badge variant={stateColors[tr.state] ?? 'neutral'} size="sm">{tr.state}</Badge>
              <span className="w-36 text-gray-400 text-xs shrink-0">{tr.startedAt ? new Date(tr.startedAt).toLocaleString() : '—'}</span>
              <span className="w-36 text-xs shrink-0">
                {tr.endedAt ? (
                  <span className="text-gray-400">{tr.endedAt ? new Date(tr.endedAt).toLocaleString() : '—'}</span>
                ) : (
                  <Badge variant="success" size="sm">{t('ongoing')}</Badge>
                )}
              </span>
              <span className="w-16 text-right shrink-0">{formatDuration(tr.durationSeconds)}</span>
            </div>
          ))}
        </div>
      </Card>
    </PageContainer>
  );
}
