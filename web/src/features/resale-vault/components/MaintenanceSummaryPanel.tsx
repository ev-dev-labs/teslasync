/**
 * Maintenance & service summary — scheduled item count, service record
 * history (date + odometer + notes), and category breakdown. Surfaces the
 * fleet-wide-scope backend limitation inline since it directly affects how
 * trustworthy this section's per-vehicle attribution is.
 */
import { useTranslation } from 'react-i18next';
import { HelperText } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { KVList } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { InlineCallout } from '@/components/feedback';
import { Info } from 'lucide-react';
import { useUnits } from '@/hooks/useUnits';
import type { MaintenanceEvidence } from '../lib/types';
import { VaultSummaryBrief } from './operationalbrief-all/VaultSummaryBrief';
import type { VaultEvidenceSource } from '../hooks/useVaultEvidence';
import type { StatMetric } from '@/components/data-display/stat-reference/types';

export interface MaintenanceSummaryPanelProps {
  maintenance: MaintenanceEvidence | null;
  sources?: readonly VaultEvidenceSource[];
}

export function MaintenanceSummaryPanel({ maintenance, sources }: MaintenanceSummaryPanelProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const description = t('resaleVault.brief.maintenance.description', 'Account-wide scheduled items and service records, not verified per-vehicle attribution.');
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'scheduled-items', label: t('resaleVault.maintenance.scheduledCount', 'Scheduled items'), rawValue: maintenance?.scheduled_item_count, description, display: { notation: 'source' } },
    { metricId: 'count', occurrenceId: 'service-records', label: t('resaleVault.maintenance.recordCount', 'Service records'), rawValue: maintenance?.service_record_count, description, display: { notation: 'source' } },
  ];

  return (
    <LayoutCard title={t('resaleVault.maintenance.title', 'Maintenance & service')}>
      <VaultSummaryBrief id="maintenance" title={t('resaleVault.brief.maintenance.title', 'Maintenance record counts')}
        description={description} metrics={metrics} hasEvidence={maintenance != null} sources={sources}
        scope={t('resaleVault.brief.maintenance.scope', 'Account-wide source; observation bounds unavailable')} />
      {!maintenance ? (
        // no-action: mirrors Tesla's account-wide maintenance endpoint (see scope note below); no refetch handler reaches this panel.
        <EmptyState message={t('resaleVault.maintenance.empty', 'No maintenance or service evidence in this report.')} />
      ) : (
        <>
          <InlineCallout variant="info" icon={<Info />}>
            {t(
              'resaleVault.maintenance.scopeNote',
              'Maintenance data is read from an account-wide endpoint, not filtered per vehicle. If this account has more than one vehicle, some entries may not belong to this one.',
            )}
          </InlineCallout>

          <KVList
            items={[
              {
                label: t('resaleVault.maintenance.categories', 'Categories'),
                value: maintenance.categories.length > 0 ? maintenance.categories.join(', ') : '—',
              },
            ]}
          />

          {maintenance.service_records.length > 0 && (
            <div>
              <HelperText className="mb-2">{t('resaleVault.maintenance.records', 'Service records')}</HelperText>
              <ul className="space-y-2">
                {maintenance.service_records.map((record) => (
                  <li key={record.item_id} className="rounded-lg border border-white/[0.06] p-2.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-[var(--text-primary)]">{record.date}</span>
                      <span className="text-[var(--text-muted)]">
                        {record.odometer_m != null ? formatDistance(record.odometer_m) : '—'}
                      </span>
                    </div>
                    {record.notes && <p className="mt-1 text-[var(--text-secondary)]">{record.notes}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </LayoutCard>
  );
}
