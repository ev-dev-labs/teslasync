/**
 * Maintenance & service summary — scheduled item count, service record
 * history (date + odometer + notes), and category breakdown. Surfaces the
 * fleet-wide-scope backend limitation inline since it directly affects how
 * trustworthy this section's per-vehicle attribution is.
 */
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui';
import { PanelTitle, HelperText } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { InlineCallout } from '@/components/feedback';
import { Info } from 'lucide-react';
import { useUnits } from '@/hooks/useUnits';
import type { MaintenanceEvidence } from '../lib/types';

export interface MaintenanceSummaryPanelProps {
  maintenance: MaintenanceEvidence | null;
}

export function MaintenanceSummaryPanel({ maintenance }: MaintenanceSummaryPanelProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <PanelTitle>{t('resaleVault.maintenance.title', 'Maintenance & Service')}</PanelTitle>

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
              { label: t('resaleVault.maintenance.scheduledCount', 'Scheduled items'), value: String(maintenance.scheduled_item_count) },
              { label: t('resaleVault.maintenance.recordCount', 'Service records'), value: String(maintenance.service_record_count) },
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
                    <div className="flex items-center justify-between">
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
    </GlassPanel>
  );
}
