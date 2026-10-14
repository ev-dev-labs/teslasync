import { useEffect, useState } from 'react';
import { Fingerprint, RadioTower, TerminalSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBehavioralSentinel } from '@/api/hooks/useAdvancedIntelligence';
import { AlertBanner } from '@/components/feedback';

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Icon, Pagination, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { typography } from '@/lib/tokens';

import { EvidencePanel, InsightPanel } from '../components';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const PAGE_SIZE = 20;

function findingIcon(kind: string) {
  if (kind.includes('identity')) return Fingerprint;
  if (kind.includes('telemetry')) return RadioTower;
  return TerminalSquare;
}

function severityVariant(severity: string) {
  if (severity === 'critical' || severity === 'high') return 'danger' as const;
  if (severity === 'medium' || severity === 'warning') return 'warning' as const;
  if (severity === 'low' || severity === 'info') return 'info' as const;
  return 'neutral' as const;
}

export default function BehavioralSentinelPage() {
  const { fmtNumber } = useNumberFormatting();
  const { formatDateTime } = useDateFormat();
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const [pagination, setPagination] = useState({ vehicleId, page: 1 });
  const page = pagination.vehicleId === vehicleId ? pagination.page : 1;
  if (pagination.vehicleId !== vehicleId) {
    setPagination({ vehicleId, page: 1 });
  }
  const query = useBehavioralSentinel(vehicleId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const findings = query.data?.items ?? [];
  const emptyMessage = vehicleId == null
    ? t('advancedIntelligence.vehicle.empty', 'Select a vehicle to load intelligence.')
    : t('advancedIntelligence.sentinel.empty', 'No supported sentinel findings were detected.');
  const total = query.data?.total;
  const hasTotal = typeof total === 'number' && Number.isSafeInteger(total) && total >= 0;
  useEffect(() => {
    if (!query.isSuccess || query.isPlaceholderData || !hasTotal ||
      query.data?.offset !== (page - 1) * PAGE_SIZE) return;
    const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > lastPage) setPagination({ vehicleId, page: lastPage });
  }, [query.isSuccess, query.isPlaceholderData, query.data?.offset, hasTotal, total, page, vehicleId]);
  usePageTitle(t('advancedIntelligence.sentinel.title', 'Behavioral sentinel'));

  return (
    <PageLayout
      title={t('advancedIntelligence.sentinel.title', 'Behavioral sentinel')}
      subtitle={t(
        'advancedIntelligence.sentinel.subtitle',
        'Explainable command, identity, and telemetry-integrity signals without personal attribution.',
      )}
    >
      <AlertBanner
        variant="warning"
        title={t('advancedIntelligence.sentinel.attribution.title', 'Anomaly is not attribution')}
      >
        {t(
          'advancedIntelligence.sentinel.attribution.body',
          'Findings identify unusual aggregate behavior. They do not identify a person, prove intent, or establish compromise.',
        )}
      </AlertBanner>

      <FadeIn>
        <InsightPanel
          query={vehicleId != null ? query : undefined}
          title={t('advancedIntelligence.sentinel.findings.title', 'Explainable findings')}
          empty={findings.length === 0}
          emptyMessage={emptyMessage}
        >
          <div className="space-y-4">
            {findings.length === 0 && <Text as="p" variant="bodySm">{emptyMessage}</Text>}
            {findings.map((finding, index) => {
              return (
                <article key={`${finding.finding_type}-${index}`} className="min-w-0 rounded-panel border border-[var(--border-default)] bg-[var(--surface-2)] p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <Icon icon={findingIcon(finding.finding_type)} size="lg" className={typography.color.secondary} />
                      <div className="min-w-0 break-words">
                        <Text as="h3" variant="subhead" className="break-words">{finding.finding_type}</Text>
                        <Text as="p" variant="caption">{formatDateTime(finding.observed_at)}</Text>
                      </div>
                    </div>
                    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                      <Badge variant={severityVariant(finding.severity)} className="max-w-full break-words">{finding.severity}</Badge>
                      <Badge variant="neutral" className="max-w-full break-words">
                        {Number.isFinite(finding.confidence_pct) ? t('advancedIntelligence.sentinel.confidence', '{{value}}% confidence', {
                          value: fmtNumber(finding.confidence_pct),
                        }) : t('common.unknown', 'Unknown')}
                      </Badge>
                    </div>
                  </div>
                  <Text as="p" variant="bodySm" className="mt-4 break-words">{finding.explanation}</Text>
                  <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
                    <div className="min-w-0 space-y-2 rounded-lg border border-[var(--border-default)] p-3">
                      <Text as="p" variant="label">
                        {t('advancedIntelligence.sentinel.evidence.title', 'Finding evidence')}
                      </Text>
                      {(finding.evidence ?? []).length > 0 ? (
                        <ul className="list-disc space-y-2 ps-4">
                          {finding.evidence.map((item, itemIndex) => (
                            <Text as="li" variant="caption" className="break-words" key={`${item.source}-${itemIndex}`}>
                              {item.source}: {item.summary}
                            </Text>
                          ))}
                        </ul>
                      ) : (
                        <Text as="p" variant="caption">
                          {t('advancedIntelligence.sentinel.evidence.empty', 'No detailed evidence was returned.')}
                        </Text>
                      )}
                    </div>
                    <div className="min-w-0 space-y-2 rounded-lg border border-[var(--border-default)] p-3">
                      <Text as="p" variant="label">
                        {t('advancedIntelligence.limitations.title', 'Limitations')}
                      </Text>
                      {(finding.limitations ?? []).length > 0 ? (
                        <ul className="list-disc space-y-2 ps-4">
                          {finding.limitations.map((item, itemIndex) => (
                            <Text as="li" variant="caption" className="break-words" key={`${item}-${itemIndex}`}>{item}</Text>
                          ))}
                        </ul>
                      ) : (
                        <Text as="p" variant="caption">
                          {t('advancedIntelligence.limitations.empty', 'No additional limitations were returned.')}
                        </Text>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </InsightPanel>
        {hasTotal && total > PAGE_SIZE ? (
          <div className="mt-4">
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              onPageChange={(nextPage) => setPagination({ vehicleId, page: nextPage })}
            />
          </div>
        ) : null}
      </FadeIn>

      <FadeIn delay={0.05}>
        <EvidencePanel
          query={query}
          quality={query.data?.data_quality}
          evidence={findings.flatMap((finding) => finding.evidence ?? [])}
          limitations={query.data?.limitations}
          unsupported={[
            t('advancedIntelligence.sentinel.unsupported.identity', 'Attribution to a specific person or identity'),
            t('advancedIntelligence.sentinel.unsupported.intent', 'Proof of malicious intent or compromise'),
          ]}
        />
      </FadeIn>
    </PageLayout>
  );
}
