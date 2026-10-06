/**
 * Security incidents summary — counts and type breakdown of TeslaSync
 * "Guard"/security events. Deliberately never renders free-form
 * `details`/`acknowledged_by` fields — those are excluded upstream in
 * `evidenceNormalizers.ts::normalizeSecurityIncidents` because they can be
 * identity-bearing free text.
 */
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { KVList } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import type { SecurityIncidentsEvidence } from '../lib/types';
import { VaultSummaryBrief } from './operationalbrief-all/VaultSummaryBrief';
import type { VaultEvidenceSource } from '../hooks/useVaultEvidence';
import type { StatMetric } from '@/components/data-display/stat-reference/types';

export interface IncidentSummaryPanelProps {
  incidents: SecurityIncidentsEvidence | null;
  sources?: readonly VaultEvidenceSource[];
}

export function IncidentSummaryPanel({ incidents, sources }: IncidentSummaryPanelProps) {
  const { t } = useTranslation();
  const description = t('resaleVault.brief.incidents.description', 'Observed Guard events and acknowledgements; no incident severity or legal conclusion is inferred.');
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'events', label: t('resaleVault.incidents.count', 'Events observed'), rawValue: incidents?.observed_event_count, description, display: { notation: 'source' } },
    { metricId: 'count', occurrenceId: 'acknowledged', label: t('resaleVault.incidents.acknowledged', 'Acknowledged'), rawValue: incidents?.acknowledged_count, description, display: { notation: 'source' } },
  ];

  return (
    <LayoutCard title={t('resaleVault.incidents.title', 'Security incidents')}>
      <VaultSummaryBrief id="incidents" title={t('resaleVault.brief.incidents.title', 'Observed security history')}
        description={description} metrics={metrics} hasEvidence={incidents != null} sources={sources}
        scope={t('resaleVault.brief.window', 'Observed evidence: {{start}} → {{end}}', {
          start: incidents?.earliest_event_at ?? '—', end: incidents?.latest_event_at ?? '—',
        })} />
      {!incidents ? (
        // no-action: mirrors this vehicle's Guard security-event history as currently cached; the panel receives no refetch handler and the Evidence tab has no manual sync control.
        <EmptyState message={t('resaleVault.incidents.empty', 'No security incident evidence in this report.')} />
      ) : (
        <>
          <KVList
            items={[
              { label: t('resaleVault.incidents.earliest', 'Earliest event'), value: incidents.earliest_event_at ?? '—' },
              { label: t('resaleVault.incidents.latest', 'Latest event'), value: incidents.latest_event_at ?? '—' },
            ]}
          />
          {incidents.by_type.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {incidents.by_type.map((entry) => (
                <Badge key={entry.event_type} variant="warning">
                  {entry.event_type}: {entry.count}
                </Badge>
              ))}
            </div>
          )}
        </>
      )}
    </LayoutCard>
  );
}
