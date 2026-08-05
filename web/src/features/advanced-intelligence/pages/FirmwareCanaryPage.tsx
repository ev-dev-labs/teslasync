import { useState } from 'react';
import { GitCompareArrows, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFirmwareCanary } from '@/api/hooks/useAdvancedIntelligence';
import { StatCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Pagination, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { EvidencePanel, InsightPanel } from '../components';

const PAGE_SIZE = 10;

function decisionVariant(decision: string) {
  if (decision === 'rollout') return 'success' as const;
  if (decision === 'hold') return 'danger' as const;
  if (decision === 'investigate') return 'warning' as const;
  return 'neutral' as const;
}

export default function FirmwareCanaryPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const [page, setPage] = useState(1);
  const query = useFirmwareCanary(vehicleId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const items = query.data?.items ?? [];
  const latest = items[0] ?? null;
  usePageTitle(t('advancedIntelligence.firmware.title', 'Firmware Canary'));

  return (
    <PageContainer
      title={t('advancedIntelligence.firmware.title', 'Firmware Canary')}
      subtitle={t(
        'advancedIntelligence.firmware.subtitle',
        'Compare a target vehicle with matched peer windows before deciding rollout readiness.',
      )}
      actions={<VehicleSelect withIcon />}
      loading={vehicleId != null && query.isLoading}
      error={query.error instanceof Error ? query.error : null}
    >
      <AlertBanner
        variant="warning"
        icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}
        title={t('advancedIntelligence.firmware.notice.title', 'Decision support, not deployment control')}
      >
        {t(
          'advancedIntelligence.firmware.notice.body',
          'Canary decisions summarize matched observations. TeslaSync does not install, hold, or roll back firmware.',
        )}
      </AlertBanner>

      <FadeIn>
        <InsightPanel
          title={t('advancedIntelligence.firmware.decision.title', 'Matched cohort decisions')}
          description={t(
            'advancedIntelligence.firmware.decision.subtitle',
            'Target and peer regressions use comparable pre/post observation windows.',
          )}
          empty={items.length === 0}
          emptyMessage={vehicleId == null
            ? t('advancedIntelligence.vehicle.empty', 'Select a vehicle to load intelligence.')
            : t('advancedIntelligence.firmware.empty', 'No firmware canary windows are available.')}
        >
          <div className="space-y-4">
            {items.map((item, index) => (
              <article key={`${item.generated_at}-${index}`} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <GitCompareArrows className="h-5 w-5 text-cyan-300" aria-hidden="true" />
                    <Text as="h3" variant="subhead">
                      {item.version ?? t('advancedIntelligence.firmware.version.unsupported', 'Version unsupported')}
                    </Text>
                  </div>
                  <Badge variant={decisionVariant(item.decision)} dot>{item.decision}</Badge>
                </div>
                <Grid cols={{ default: 1, sm: 2, lg: 4 }} gap={3}>
                  <StatCard
                    label={t('advancedIntelligence.firmware.targetDelta', 'Target regression')}
                    value={item.vehicle_regression_pct != null
                      ? `${fmtNumber(item.vehicle_regression_pct, 2)}%` : null}
                  />
                  <StatCard
                    label={t('advancedIntelligence.firmware.peerDelta', 'Peer regression')}
                    value={item.peer_regression_pct != null
                      ? `${fmtNumber(item.peer_regression_pct, 2)}%` : null}
                  />
                  <StatCard
                    label={t('advancedIntelligence.firmware.excessDelta', 'Matched excess')}
                    value={item.matched_excess_pct != null
                      ? `${fmtNumber(item.matched_excess_pct, 2)}%` : null}
                  />
                  <StatCard
                    label={t('advancedIntelligence.firmware.generated', 'Decision generated')}
                    value={formatDateTime(item.generated_at)}
                  />
                </Grid>
                <div className="mt-4 rounded-lg border border-white/[0.06] p-3">
                  <Text as="p" variant="label">
                    {t('advancedIntelligence.firmware.rationale.title', 'Decision rationale')}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {item.decision === 'insufficient'
                      ? t(
                        'advancedIntelligence.firmware.rationale.insufficient',
                        'The matched windows do not contain enough supported observations for a rollout decision.',
                      )
                      : t(
                        'advancedIntelligence.firmware.rationale.supported',
                        'The decision reflects target regression relative to the matched peer change and window quality.',
                      )}
                  </Text>
                </div>
              </article>
            ))}
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
          quality={latest?.window_quality}
          evidence={latest?.evidence}
          limitations={latest?.limitations}
          unsupported={[
            t('advancedIntelligence.firmware.unsupported.causality', 'Proof that firmware caused a measured change'),
            t('advancedIntelligence.firmware.unsupported.deployment', 'Firmware deployment or rollback commands'),
          ]}
        />
      </FadeIn>
    </PageContainer>
  );
}
