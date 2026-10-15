import type { StatMetric } from '@/components/data-display';
import type { PhysicsPage } from '../tesla-physics/PhysicsPageShell';
import { useDateFormat } from '@/hooks/useDateFormat';
import { VehicleEvidenceBrief } from './VehicleEvidenceBrief';

export function PhysicsEvidenceBrief({ physics, id, metrics, description, available = true }: {
  physics: PhysicsPage;
  id: string;
  metrics: readonly StatMetric[];
  description?: string;
  available?: boolean;
}) {
  const { report, state, t } = physics;
  const { formatDateTime } = useDateFormat();
  const time = (value: string | null | undefined) => value ? formatDateTime(value) : t('teslaOnly.unknown', 'unknown');
  const evidence = report?.evidence;
  const limited = evidence && (!evidence.history_available || !evidence.black_box_available ||
    evidence.history_truncated || evidence.black_box_truncated ||
    evidence.drive_sessions_truncated || evidence.charge_sessions_truncated);
  return <VehicleEvidenceBrief refreshFailed={state.refreshError != null} id={id} title={t('teslaOnly.briefTitle', '{{title}} evidence summary', { title: physics.title })}
    description={description ?? t('teslaOnly.briefLimits', 'Returned observations only; missing readings and row caps do not establish lifetime completeness.')}
    metrics={metrics} status={state.status === 'ok' && (!available || limited) ? 'partial' : state.status}
    scope={evidence ? <>
      <div>{t('teslaOnly.scopeRequested', 'Requested: {{from}} → {{to}}', {
        from: time(evidence.requested_from), to: time(evidence.requested_to),
      })}</div>
      <div>{t('teslaOnly.scopeObserved', 'Recorded: {{from}} → {{to}}', {
        from: time(evidence.first_recorded_at), to: time(evidence.last_recorded_at),
      })}</div>
    </> : t('teslaOnly.briefCoverageUnknown', 'Source coverage metadata unavailable; returned counts cannot establish completeness.')}
    freshness={state.updatedAt == null ? undefined : t('teslaOnly.briefFetchedAt', 'Report received {{at}}', { at: formatDateTime(new Date(state.updatedAt)) })}
    provenance={t('teslaOnly.briefSource', 'Bounded exclusive physics report')} />;
}
