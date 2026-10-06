/**
 * Software update summary — installed firmware/software version history.
 */
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { KVList } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import type { SoftwareUpdateEvidence } from '../lib/types';

export interface SoftwareUpdateSummaryPanelProps {
  softwareUpdates: SoftwareUpdateEvidence | null;
}

export function SoftwareUpdateSummaryPanel({ softwareUpdates }: SoftwareUpdateSummaryPanelProps) {
  const { t } = useTranslation();

  return (
    <LayoutCard title={t('resaleVault.software.title', 'Software updates')}
      actions={softwareUpdates?.latest_version ? <Badge variant="info">{softwareUpdates.latest_version}</Badge> : undefined}>

      {!softwareUpdates ? (
        // no-action: mirrors this vehicle's software-update history as currently cached; the panel receives no refetch handler and the Evidence tab has no manual sync control.
        <EmptyState message={t('resaleVault.software.empty', 'No software update evidence in this report.')} />
      ) : (
        <>
          <KVList
            items={[
              { label: t('resaleVault.software.count', 'Updates observed'), value: String(softwareUpdates.update_count) },
              { label: t('resaleVault.software.latest', 'Latest installed version'), value: softwareUpdates.latest_version ?? '—' },
            ]}
          />
          {softwareUpdates.installed_versions.length > 0 && (
            <ul className="space-y-1 text-xs">
              {softwareUpdates.installed_versions.map((v, i) => (
                <li key={`${v.version}-${i}`} className="flex flex-wrap justify-between gap-2 text-[var(--text-secondary)]">
                  <span>{v.version}</span>
                  <span className="text-[var(--text-muted)]">{v.installed_at ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </LayoutCard>
  );
}
