/**
 * Security incidents summary — counts and type breakdown of TeslaSync
 * "Guard"/security events. Deliberately never renders free-form
 * `details`/`acknowledged_by` fields — those are excluded upstream in
 * `evidenceNormalizers.ts::normalizeSecurityIncidents` because they can be
 * identity-bearing free text.
 */
import { useTranslation } from 'react-i18next';
import { GlassPanel, Badge } from '@/components/ui';
import { PanelTitle } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import type { SecurityIncidentsEvidence } from '../lib/types';

export interface IncidentSummaryPanelProps {
  incidents: SecurityIncidentsEvidence | null;
}

export function IncidentSummaryPanel({ incidents }: IncidentSummaryPanelProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <PanelTitle>{t('resaleVault.incidents.title', 'Security Incidents')}</PanelTitle>

      {!incidents ? (
        <EmptyState message={t('resaleVault.incidents.empty', 'No security incident evidence in this report.')} />
      ) : (
        <>
          <KVList
            items={[
              { label: t('resaleVault.incidents.count', 'Events observed'), value: String(incidents.observed_event_count) },
              { label: t('resaleVault.incidents.acknowledged', 'Acknowledged'), value: String(incidents.acknowledged_count) },
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
    </GlassPanel>
  );
}
