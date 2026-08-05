/**
 * Software update summary — installed firmware/software version history.
 */
import { useTranslation } from 'react-i18next';
import { GlassPanel, Badge } from '@/components/ui';
import { PanelTitle } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import type { SoftwareUpdateEvidence } from '../lib/types';

export interface SoftwareUpdateSummaryPanelProps {
  softwareUpdates: SoftwareUpdateEvidence | null;
}

export function SoftwareUpdateSummaryPanel({ softwareUpdates }: SoftwareUpdateSummaryPanelProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <div className="flex items-center justify-between">
        <PanelTitle>{t('resaleVault.software.title', 'Software Updates')}</PanelTitle>
        {softwareUpdates?.latest_version && <Badge variant="info">{softwareUpdates.latest_version}</Badge>}
      </div>

      {!softwareUpdates ? (
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
                <li key={`${v.version}-${i}`} className="flex justify-between text-[var(--text-secondary)]">
                  <span>{v.version}</span>
                  <span className="text-[var(--text-muted)]">{v.installed_at ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </GlassPanel>
  );
}
