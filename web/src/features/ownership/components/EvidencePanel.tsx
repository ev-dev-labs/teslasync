import { AlertTriangle, Database, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { Table, Badge, Icon, Text } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';

import type { DataQuality, Evidence } from '@/types/ownership';
import type { DataStateSource } from '@/api/dataState';
import { OwnershipPanel } from './OwnershipPanel';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface EvidencePanelProps {
  quality?: DataQuality | null;
  evidence?: Evidence[] | null;
  limitations?: string[] | null;
  unsupported?: string[] | null;
  source?: DataStateSource<unknown>;
  sourceEnabled?: boolean;
}

function qualityVariant(status: DataQuality['status'] | undefined) {
  if (status === 'sufficient') return 'success' as const;
  if (status === 'limited') return 'warning' as const;
  return 'danger' as const;
}

/**
 * Renders the provenance trailer that closes every ownership page: how much
 * evidence backed the answer, which sources it came from, and what the engine
 * explicitly refuses to compute. Engines downgrade `quality.status` rather than
 * fabricating a zero, so an "insufficient" badge here is a real signal.
 */
export function EvidencePanel({
  quality,
  evidence,
  limitations,
  unsupported,
  source,
  sourceEnabled,
}: EvidencePanelProps) {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const evidenceItems = evidence ?? [];
  const limitationItems = limitations ?? [];
  const unsupportedItems = unsupported ?? [];
  const reasons = quality?.reasons ?? [];

  return (
    <OwnershipPanel
      source={source}
      sourceEnabled={sourceEnabled}
      title={t('ownership.evidence.title', 'Evidence, quality, and limitations')}
      description={t(
        'ownership.evidence.subtitle',
        'Measured observations are separated from modelled assumptions and from fields the engine will not compute.',
      )}
    >
      <div className="grid gap-5 lg:grid-cols-3">
        <section
          aria-label={t('ownership.quality.title', 'Data quality')}
          className="min-w-0 space-y-3 break-words"
        >
          <div className="flex items-center gap-2">
            <Icon icon={ShieldCheck} size="md" className="text-[var(--text-muted)]" />
            <Text as="h3" variant="label">
              {t('ownership.quality.title', 'Data quality')}
            </Text>
          </div>
          {quality ? (
            <>
              <Badge variant={qualityVariant(quality.status)} dot>
                {quality.status}
              </Badge>
              <Table aria-label={t('ownership.evidence.title', 'Evidence, quality, and limitations')}><tbody>
                <tr>
                  <th scope="row" className="text-[var(--text-muted)]">
                    {t('ownership.quality.samples', 'Samples')}
                  </th>
                  <td className="text-right">
                    {quality.sample_count != null ? fmtInt(quality.sample_count) : '—'}
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="text-[var(--text-muted)]">
                    {t('ownership.quality.coverage', 'Coverage')}
                  </th>
                  <td className="text-right">
                    {quality.coverage_pct != null
                      ? `${fmtNumber(quality.coverage_pct)}%`
                      : '—'}
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="text-[var(--text-muted)]">
                    {t('ownership.quality.window', 'Observation window')}
                  </th>
                  <td className="text-right">
                    {quality.window_start || quality.window_end
                      ? `${formatDateTime(quality.window_start)} – ${formatDateTime(quality.window_end)}`
                      : '—'}
                  </td>
                </tr>
              </tbody></Table>
              {reasons.map((reason) => (
                <Text as="p" variant="caption" key={reason}>
                  • {reason}
                </Text>
              ))}
            </>
          ) : (
            <Text as="p" variant="bodySm">
              {t('ownership.quality.unavailable', 'Quality metadata has not been computed yet.')}
            </Text>
          )}
        </section>

        <section
          aria-label={t('ownership.evidence.sources', 'Evidence sources')}
          className="min-w-0 space-y-3 break-words"
        >
          <div className="flex items-center gap-2">
            <Icon icon={Database} size="md" className="text-[var(--text-muted)]" />
            <Text as="h3" variant="label">
              {t('ownership.evidence.sources', 'Evidence sources')}
            </Text>
          </div>
          {evidenceItems.length > 0 ? (
            evidenceItems.map((item, index) => (
              <div
                key={`${item.source}-${index}`}
                className="min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <Text as="p" variant="label">
                  {item.source}
                </Text>
                <Text as="p" variant="caption">
                  {item.summary}
                </Text>
                <Text as="p" variant="caption" className="mt-1">
                  {item.sample_count != null
                    ? t('ownership.evidence.sampleLine', '{{count}} samples · {{date}}', {
                        count: item.sample_count,
                        date: formatDateTime(item.observed_at),
                      })
                    : formatDateTime(item.observed_at)}
                </Text>
              </div>
            ))
          ) : (
            <EmptyState /* no-action: mirrors exactly what the analysis engine returned for its evidence array — engines intentionally omit rows rather than fabricate placeholders, and the Data quality badge in the column to the left already explains why. */
              className="py-8"
              message={t('ownership.evidence.empty', 'No supporting evidence was returned.')}
            />
          )}
        </section>

        <section
          aria-label={t('ownership.limitations.title', 'Limitations')}
          className="min-w-0 space-y-3 break-words"
        >
          <div className="flex items-center gap-2">
            <Icon icon={AlertTriangle} size="md" className="text-[var(--semantic-warning)]" />
            <Text as="h3" variant="label">
              {t('ownership.limitations.title', 'Limitations')}
            </Text>
          </div>
          {limitationItems.length > 0 ? (
            limitationItems.map((item) => (
              <Text as="p" variant="bodySm" key={item}>
                • {item}
              </Text>
            ))
          ) : (
            <Text as="p" variant="bodySm">
              {t('ownership.limitations.empty', 'No additional limitations were returned.')}
            </Text>
          )}
          {unsupportedItems.length > 0 ? (
            <div className="min-w-0 rounded-lg border border-[var(--semantic-warning-border)] bg-[var(--semantic-warning-bg)] p-3">
              <Text as="p" variant="label">
                {t('ownership.unsupported.title', 'Explicitly not computed')}
              </Text>
              {unsupportedItems.map((item) => (
                <Text as="p" variant="caption" key={item}>
                  • {item}
                </Text>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </OwnershipPanel>
  );
}
