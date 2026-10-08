import { AlertTriangle, Database, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { Badge, Icon, Text, type BadgeProps } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { formatDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import { neonColorMap, typography } from '@/lib/tokens';

import type { DataQuality, Evidence } from '@/types/advancedIntelligence';
import { InsightPanel } from './InsightPanel';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface EvidencePanelProps {
  quality?: DataQuality | null;
  evidence?: Evidence[] | null;
  limitations?: string[] | null;
  unsupported?: string[] | null;
}

function qualityVariant(status: DataQuality['status'] | undefined): BadgeProps['variant'] {
  if (status === 'sufficient') return 'success';
  if (status === 'limited') return 'warning';
  return 'danger';
}

export function EvidencePanel({
  quality,
  evidence,
  limitations,
  unsupported,
}: EvidencePanelProps) {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const evidenceItems = evidence ?? [];
  const limitationItems = limitations ?? [];
  const unsupportedItems = unsupported ?? [];

  return (
    <InsightPanel
      title={t('advancedIntelligence.evidence.title', 'Evidence, quality, and limitations')}
      description={t(
        'advancedIntelligence.evidence.subtitle',
        'Supported observations are separated from assumptions and unsupported fields.',
      )}
    >
      <div className="grid min-w-0 gap-5 break-words lg:grid-cols-3">
        <section aria-label={t('advancedIntelligence.quality.title', 'Data quality')} className="min-w-0 space-y-3">
          <div className="flex items-center gap-2">
            <Icon icon={ShieldCheck} className={typography.color.secondary} aria-hidden={true} />
            <Text as="h3" variant="label">
              {t('advancedIntelligence.quality.title', 'Data quality')}
            </Text>
          </div>
          {quality ? (
            <>
              <Badge variant={qualityVariant(quality.status)} dot>{quality.status}</Badge>
              <KVList layout="responsive" wrap items={[
                { id: 'samples', label: t('advancedIntelligence.quality.samples', 'Samples'), value: fmtInt(quality.sample_count) },
                { id: 'coverage', label: t('advancedIntelligence.quality.coverage', 'Coverage'), value: quality.coverage_pct != null ? `${fmtNumber(quality.coverage_pct)}%` : '—' },
                { id: 'window', label: t('advancedIntelligence.quality.window', 'Observation window'), value: quality.window_start || quality.window_end
                  ? `${formatDateTime(quality.window_start)} – ${formatDateTime(quality.window_end)}` : '—' },
              ]} />
              {(quality.reasons ?? []).map((reason, index) => (
                <Text as="p" variant="caption" key={`${reason}-${index}`}>• {reason}</Text>
              ))}
            </>
          ) : (
            <Text as="p" variant="bodySm">
              {t('advancedIntelligence.quality.unsupported', 'Quality metadata is unsupported.')}
            </Text>
          )}
        </section>

        <section aria-label={t('advancedIntelligence.evidence.sources', 'Evidence sources')} className="min-w-0 space-y-3">
          <div className="flex items-center gap-2">
            <Icon icon={Database} className={typography.color.secondary} aria-hidden={true} />
            <Text as="h3" variant="label">
              {t('advancedIntelligence.evidence.sources', 'Evidence sources')}
            </Text>
          </div>
          {evidenceItems.length > 0 ? evidenceItems.map((item, index) => (
            <div key={`${item.source}-${index}`} className="min-w-0 rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
              <Text as="p" variant="label">{item.source}</Text>
              <Text as="p" variant="caption">{item.summary}</Text>
              <Text as="p" variant="caption" className="mt-1">
                {item.sample_count != null
                  ? t('advancedIntelligence.evidence.sampleLine', '{{count}} samples · {{date}}', {
                    count: item.sample_count,
                    date: formatDateTime(item.observed_at),
                  })
                  : formatDateTime(item.observed_at)}
              </Text>
            </div>
          )) : (
            // no-action: which evidence sources a calc run returns is determined server-side by that specific run; there is no client action that adds evidence after the fact.
            <EmptyState
              className="py-8"
              message={t('advancedIntelligence.evidence.empty', 'No supporting evidence was returned.')}
            />
          )}
        </section>

        <section aria-label={t('advancedIntelligence.limitations.title', 'Limitations')} className="min-w-0 space-y-3">
          <div className="flex items-center gap-2">
            <Icon icon={AlertTriangle} className={neonColorMap.amber.text} aria-hidden={true} />
            <Text as="h3" variant="label">
              {t('advancedIntelligence.limitations.title', 'Limitations')}
            </Text>
          </div>
          {limitationItems.length > 0 ? limitationItems.map((item, index) => (
            <Text as="p" variant="bodySm" key={`${item}-${index}`}>• {item}</Text>
          )) : (
            <Text as="p" variant="bodySm">
              {t('advancedIntelligence.limitations.empty', 'No additional limitations were returned.')}
            </Text>
          )}
          {unsupportedItems.length > 0 ? (
            <div className={cn('min-w-0 rounded-lg border p-3', neonColorMap.amber.border, neonColorMap.amber.bg)}>
              <Text as="p" variant="label">
                {t('advancedIntelligence.unsupported.title', 'Explicitly unsupported')}
              </Text>
              {unsupportedItems.map((item, index) => (
                <Text as="p" variant="caption" key={`${item}-${index}`}>• {item}</Text>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </InsightPanel>
  );
}
