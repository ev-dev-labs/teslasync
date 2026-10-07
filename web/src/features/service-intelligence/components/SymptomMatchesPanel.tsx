import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { GlassPanel, PanelTitle, Badge, Caption, Text } from '@/components/ui';
import { DateTime } from '@/components/data-display';
import type {
  ServiceIntelligenceSeverity,
  ServiceIntelligenceSymptomMatch,
} from '@/api/hooks/useServiceIntelligence';
import { PanelState } from './PanelState';

export interface SymptomMatchesPanelProps {
  selected: boolean;
  loading: boolean;
  error: unknown;
  symptoms: ServiceIntelligenceSymptomMatch[];
  onRetry: () => void;
}

function severityVariant(severity: ServiceIntelligenceSeverity): 'danger' | 'warning' | 'info' {
  if (severity === 'critical') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'info';
}

export function SymptomMatchesPanel({
  selected,
  loading,
  error,
  symptoms,
  onRetry,
}: SymptomMatchesPanelProps) {
  const { t } = useTranslation();
  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('serviceIntelligence.symptoms.title', 'Ranked observed symptoms')}
      </PanelTitle>
      <PanelState
        selected={selected}
        loading={loading}
        error={error}
        empty={symptoms.length === 0}
        icon={<Activity className="h-9 w-9" />}
        selectTitle={t('serviceIntelligence.common.selectTitle', 'Select a vehicle')}
        selectMessage={t(
          'serviceIntelligence.symptoms.select',
          'Choose a vehicle to compare recent signal deviations with campaign components.',
        )}
        emptyTitle={t('serviceIntelligence.symptoms.emptyTitle', 'No overlapping symptoms')}
        emptyMessage={t(
          'serviceIntelligence.symptoms.empty',
          'No recent statistical signal deviations overlapped the returned safety campaign components.',
        )}
        onRetry={onRetry}
      >
        <ol className="space-y-3">
          {symptoms.map((symptom, index) => (
            <li
              key={`${symptom.finding_id}-${symptom.signal}-${symptom.observed_at}-${index}`}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Text variant="body" mono>{symptom.signal}</Text>
                  <Caption className="mt-1 block">
                    {t('serviceIntelligence.symptoms.campaign', 'Campaign {{id}}', {
                      id: symptom.finding_id,
                    })}
                  </Caption>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={severityVariant(symptom.severity)}>
                    {t(
                      `serviceIntelligence.symptoms.severity.${symptom.severity}`,
                      symptom.severity === 'critical'
                        ? 'Critical'
                        : symptom.severity === 'warning'
                          ? 'Warning'
                          : 'Information',
                    )}
                  </Badge>
                  <Badge variant="neutral">
                    {t('serviceIntelligence.symptoms.score', '{{value}}% match', {
                      value: Math.round(symptom.score * 100),
                    })}
                  </Badge>
                </div>
              </div>
              <Text as="p" variant="bodySm" className="mt-2">{symptom.evidence}</Text>
              <Caption className="mt-2 block">
                <DateTime value={symptom.observed_at} variant="full" />
              </Caption>
            </li>
          ))}
        </ol>
      </PanelState>
    </GlassPanel>
  );
}
