/**
 * Privacy preview — shows exactly what a built (unsigned) `VaultReport`
 * would contain from a redaction/limitation standpoint: hard exclusions,
 * section exclusions, coarsened fields, and the fields the user explicitly
 * opted into (each carrying its warning), plus the report's fixed
 * limitations and attestation statement. This is the "read before you
 * export" surface.
 */
import { useTranslation } from 'react-i18next';
import { GlassPanel, Badge } from '@/components/ui';
import { PanelTitle, HelperText } from '@/components/ui';
import { InlineCallout } from '@/components/feedback';
import { Accordion } from '@/components/ui';
import { ShieldCheck, ShieldAlert, EyeOff, Clock } from 'lucide-react';
import type { VaultReport } from '../lib/types';

export interface PrivacyPreviewPanelProps {
  report: VaultReport | null;
}

export function PrivacyPreviewPanel({ report }: PrivacyPreviewPanelProps) {
  const { t } = useTranslation();

  if (!report) {
    return (
      <GlassPanel padding="lg">
        <PanelTitle>{t('resaleVault.preview.title', 'Privacy Preview')}</PanelTitle>
        <HelperText className="mt-2">
          {t('resaleVault.preview.empty', 'Build a report to see exactly what would be included, excluded, and warned about.')}
        </HelperText>
      </GlassPanel>
    );
  }

  const manifest = report.redaction_manifest;

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <div className="flex items-center justify-between">
        <PanelTitle>{t('resaleVault.preview.title', 'Privacy Preview')}</PanelTitle>
        <Badge variant="neutral">{report.report_id}</Badge>
      </div>

      <HelperText>
        {t('resaleVault.preview.timeBounds', 'Evidence window: {{earliest}} → {{latest}} ({{precision}} precision).', {
          earliest: report.time_bounds.earliest_evidence_at ?? '—',
          latest: report.time_bounds.latest_evidence_at ?? '—',
          precision: report.time_bounds.precision,
        })}
      </HelperText>

      <Accordion
        title={t('resaleVault.preview.hardExcluded', 'Always excluded ({{count}})', { count: manifest.hard_excluded.length })}
        icon={<ShieldCheck />}
        defaultOpen
      >
        <ul className="space-y-2 text-xs text-[var(--text-secondary)]">
          {manifest.hard_excluded.map((entry) => (
            <li key={entry.field}>
              <span className="font-medium text-[var(--text-primary)]">{entry.field}</span>: {entry.reason}
            </li>
          ))}
        </ul>
      </Accordion>

      <Accordion
        title={t('resaleVault.preview.sectionExcluded', 'Excluded by profile ({{count}})', { count: manifest.excluded_by_selection.length })}
        icon={<EyeOff />}
        defaultOpen
      >
        {manifest.excluded_by_selection.length === 0 ? (
          <HelperText>{t('resaleVault.preview.noneExcluded', 'Every evidence section is included in this profile.')}</HelperText>
        ) : (
          <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
            {manifest.excluded_by_selection.map((entry) => (
              <li key={entry.field}>{entry.field}</li>
            ))}
          </ul>
        )}
      </Accordion>

      <Accordion
        title={t('resaleVault.preview.coarsened', 'Coarsened ({{count}})', { count: manifest.coarsened.length })}
        icon={<Clock />}
        defaultOpen
      >
        <ul className="space-y-2 text-xs text-[var(--text-secondary)]">
          {manifest.coarsened.map((entry) => (
            <li key={entry.field}>
              <span className="font-medium text-[var(--text-primary)]">{entry.field}</span>: {entry.reason}
            </li>
          ))}
        </ul>
      </Accordion>

      {manifest.included_with_warning.length > 0 && (
        <div>
          <HelperText className="mb-2">{t('resaleVault.preview.includedWithWarning', 'Included with warning')}</HelperText>
          <div className="space-y-2">
            {manifest.included_with_warning.map((entry) => (
              <InlineCallout key={entry.field} variant="warning" icon={<ShieldAlert />}>
                <span className="font-medium">{entry.field}</span>: {entry.reason}
              </InlineCallout>
            ))}
          </div>
        </div>
      )}

      <div>
        <HelperText className="mb-1">{t('resaleVault.preview.limitations', 'Limitations')}</HelperText>
        <ul className="list-disc pl-5 text-xs text-[var(--text-secondary)] space-y-1">
          {report.limitations.map((limitation, i) => (
            <li key={i}>{limitation}</li>
          ))}
        </ul>
      </div>

      <InlineCallout variant="info" icon={<ShieldCheck />}>
        {report.attestation_statement}
      </InlineCallout>
    </GlassPanel>
  );
}
