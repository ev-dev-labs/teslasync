import { useState } from 'react';
import { Fingerprint, RadioTower, TerminalSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBehavioralSentinel } from '@/api/hooks/useAdvancedIntelligence';
import { AlertBanner } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Pagination, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { EvidencePanel, InsightPanel } from '../components';

const PAGE_SIZE = 20;

function findingIcon(kind: string) {
  if (kind.includes('identity')) return Fingerprint;
  if (kind.includes('telemetry')) return RadioTower;
  return TerminalSquare;
}

function severityVariant(severity: string) {
  if (severity === 'critical' || severity === 'high') return 'danger' as const;
  if (severity === 'medium' || severity === 'warning') return 'warning' as const;
  return 'info' as const;
}

export default function BehavioralSentinelPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const [page, setPage] = useState(1);
  const query = useBehavioralSentinel(vehicleId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const findings = query.data?.items ?? [];
  usePageTitle(t('advancedIntelligence.sentinel.title', 'Behavioral Sentinel'));

  return (
    <PageContainer
      title={t('advancedIntelligence.sentinel.title', 'Behavioral Sentinel')}
      subtitle={t(
        'advancedIntelligence.sentinel.subtitle',
        'Explainable command, identity, and telemetry-integrity signals without personal attribution.',
      )}
      actions={<VehicleSelect withIcon />}
      loading={vehicleId != null && query.isLoading}
      error={query.error instanceof Error ? query.error : null}
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
          title={t('advancedIntelligence.sentinel.findings.title', 'Explainable findings')}
          empty={findings.length === 0}
          emptyMessage={vehicleId == null
            ? t('advancedIntelligence.vehicle.empty', 'Select a vehicle to load intelligence.')
            : t('advancedIntelligence.sentinel.empty', 'No supported sentinel findings were detected.')}
        >
          <div className="space-y-4">
            {findings.map((finding, index) => {
              const Icon = findingIcon(finding.finding_type);
              return (
                <article key={`${finding.finding_type}-${index}`} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 text-cyan-300" aria-hidden="true" />
                      <div>
                        <Text as="h3" variant="subhead">{finding.finding_type}</Text>
                        <Text as="p" variant="caption">{formatDateTime(finding.observed_at)}</Text>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={severityVariant(finding.severity)}>{finding.severity}</Badge>
                      <Badge variant="neutral">
                        {t('advancedIntelligence.sentinel.confidence', '{{value}}% confidence', {
                          value: fmtNumber(finding.confidence_pct, 1),
                        })}
                      </Badge>
                    </div>
                  </div>
                  <Text as="p" variant="bodySm" className="mt-4">{finding.explanation}</Text>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-white/[0.06] p-3">
                      <Text as="p" variant="label">
                        {t('advancedIntelligence.sentinel.evidence.title', 'Finding evidence')}
                      </Text>
                      {(finding.evidence ?? []).length > 0 ? finding.evidence.map((item, itemIndex) => (
                        <Text as="p" variant="caption" key={`${item.source}-${itemIndex}`}>
                          • {item.source}: {item.summary}
                        </Text>
                      )) : (
                        <Text as="p" variant="caption">
                          {t('advancedIntelligence.sentinel.evidence.empty', 'No detailed evidence was returned.')}
                        </Text>
                      )}
                    </div>
                    <div className="rounded-lg border border-amber-400/15 bg-amber-400/[0.04] p-3">
                      <Text as="p" variant="label">
                        {t('advancedIntelligence.limitations.title', 'Limitations')}
                      </Text>
                      {(finding.limitations ?? []).map((item) => (
                        <Text as="p" variant="caption" key={item}>• {item}</Text>
                      ))}
                    </div>
                  </div>
                </article>
              );
            })}
            {(query.data?.total ?? 0) > PAGE_SIZE ? (
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={query.data?.total ?? 0}
                onPageChange={setPage}
              />
            ) : null}
          </div>
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <EvidencePanel
          quality={query.data?.data_quality}
          evidence={findings.flatMap((finding) => finding.evidence ?? [])}
          limitations={query.data?.limitations}
          unsupported={[
            t('advancedIntelligence.sentinel.unsupported.identity', 'Attribution to a specific person or identity'),
            t('advancedIntelligence.sentinel.unsupported.intent', 'Proof of malicious intent or compromise'),
          ]}
        />
      </FadeIn>
    </PageContainer>
  );
}
