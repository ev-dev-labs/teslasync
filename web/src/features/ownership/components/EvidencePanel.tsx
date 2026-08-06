import { AlertTriangle, Database, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { Badge, Text } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { DataQuality, Evidence } from '@/types/ownership';
import { OwnershipPanel } from './OwnershipPanel';

interface EvidencePanelProps {
  quality?: DataQuality | null;
  evidence?: Evidence[] | null;
  limitations?: string[] | null;
  unsupported?: string[] | null;
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
}: EvidencePanelProps) {
  const { t } = useTranslation();
  const evidenceItems = evidence ?? [];
  const limitationItems = limitations ?? [];
  const unsupportedItems = unsupported ?? [];
  const reasons = quality?.reasons ?? [];

  return (
    <OwnershipPanel
      title={t('ownership.evidence.title', 'Evidence, quality, and limitations')}
      description={t(
        'ownership.evidence.subtitle',
        'Measured observations are separated from modelled assumptions and from fields the engine will not compute.',
      )}
    >
      <div className="grid gap-5 lg:grid-cols-3">
        <section
          aria-label={t('ownership.quality.title', 'Data quality')}
          className="space-y-3"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <Text as="h3" variant="label">
              {t('ownership.quality.title', 'Data quality')}
            </Text>
          </div>
          {quality ? (
            <>
              <Badge variant={qualityVariant(quality.status)} dot>
                {quality.status}
              </Badge>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-muted)]">
                    {t('ownership.quality.samples', 'Samples')}
                  </dt>
                  <dd>{fmtNumber(quality.sample_count ?? 0, 0)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-muted)]">
                    {t('ownership.quality.coverage', 'Coverage')}
                  </dt>
                  <dd>
                    {quality.coverage_pct != null
                      ? `${fmtNumber(quality.coverage_pct, 1)}%`
                      : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-muted)]">
                    {t('ownership.quality.window', 'Observation window')}
                  </dt>
                  <dd className="text-right">
                    {quality.window_start || quality.window_end
                      ? `${formatDateTime(quality.window_start)} – ${formatDateTime(quality.window_end)}`
                      : '—'}
                  </dd>
                </div>
              </dl>
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
          className="space-y-3"
        >
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <Text as="h3" variant="label">
              {t('ownership.evidence.sources', 'Evidence sources')}
            </Text>
          </div>
          {evidenceItems.length > 0 ? (
            evidenceItems.map((item, index) => (
              <div
                key={`${item.source}-${index}`}
                className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-3"
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
          className="space-y-3"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden="true" />
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
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3">
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
