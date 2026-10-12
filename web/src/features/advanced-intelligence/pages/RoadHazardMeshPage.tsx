import { useEffect, useId, useState } from 'react';
import { Clock3, MapPinned, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRoadHazards } from '@/api/hooks/useAdvancedIntelligence';
import { AlertBanner } from '@/components/feedback';

import { Grid, PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Table, Badge, Card, Icon, Pagination, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { formatRelative } from '@/lib/dateFormat';
import { typography } from '@/lib/tokens';

import { EvidencePanel, InsightPanel } from '../components';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const PAGE_SIZE = 18;

function severityVariant(severity: string) {
  if (severity === 'critical' || severity === 'high') return 'danger' as const;
  if (severity === 'medium' || severity === 'warning') return 'warning' as const;
  return 'info' as const;
}

export default function RoadHazardMeshPage() {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const headingId = useId();
  const [pagination, setPagination] = useState({ vehicleId, page: 1 });
  const page = pagination.vehicleId === vehicleId ? pagination.page : 1;
  const setPage = (nextPage: number) => setPagination({ vehicleId, page: nextPage });
  const query = useRoadHazards(vehicleId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const items = query.data?.items ?? [];
  useEffect(() => {
    setPagination({ vehicleId, page: 1 });
  }, [vehicleId]);
  useEffect(() => {
    if (!query.data || query.error || query.isFetching || query.data.offset !== (page - 1) * PAGE_SIZE) return;
    const lastPage = Math.max(1, Math.ceil(query.data.total / PAGE_SIZE));
    if (page > lastPage) setPagination({ vehicleId, page: lastPage });
  }, [page, query.data, query.error, query.isFetching, vehicleId]);
  usePageTitle(t('advancedIntelligence.hazards.title', 'Road hazard mesh'));

  return (
    <PageLayout
      title={t('advancedIntelligence.hazards.title', 'Road hazard mesh')}
      subtitle={t(
        'advancedIntelligence.hazards.subtitle',
        'Privacy-preserving hazard clusters shown only at coarse-cell resolution.',
      )}
    >
      <AlertBanner
        variant="info"
        icon={<Icon icon={ShieldCheck} size="lg" />}
        title={t('advancedIntelligence.hazards.privacy.title', 'Coarse cells protect location privacy')}
      >
        {t(
          'advancedIntelligence.hazards.privacy.body',
          'No exact coordinates, routes, or driver identities are exposed or inferred. Cells are identifiers, not map pins.',
        )}
      </AlertBanner>

      <FadeIn>
        <InsightPanel
          query={vehicleId != null ? query : undefined}
          title={t('advancedIntelligence.hazards.clusters.title', 'Hazard clusters')}
          description={t(
            'advancedIntelligence.hazards.clusters.subtitle',
            'Prioritize clusters using severity, confidence, recency, and observation coverage together.',
          )}
          empty={items.length === 0}
          emptyMessage={vehicleId == null
            ? t('advancedIntelligence.vehicle.empty', 'Select a vehicle to load intelligence.')
            : t(
              'advancedIntelligence.hazards.empty',
              'No coarse-cell hazard clusters meet the privacy and evidence thresholds.',
            )}
        >
          <div className="@container">
            <Grid gap={4} className="@2xl:grid-cols-2 @5xl:grid-cols-3">
            {items.map((cluster, index) => (
              <article key={`${cluster.coarse_cell}-${cluster.hazard_type}-${index}`} className="min-w-0">
                <Card className="h-full bg-[var(--surface-2)] shadow-none">
                <div className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Icon icon={MapPinned} size="lg" className={typography.color.secondary} />
                    <Text id={`${headingId}-${index}-hazard`} as="h3" variant="subhead" className="min-w-0 break-all">{cluster.hazard_type}</Text>
                  </div>
                  <Badge variant={severityVariant(cluster.severity)} className="max-w-full break-all">{cluster.severity}</Badge>
                </div>
                <Table variant="embedded" aria-label={t('advancedIntelligence.hazards.title', 'Road hazard mesh')}
                  aria-describedby={`${headingId}-${index}-hazard ${headingId}-${index}-cell`}><tbody>
                  <tr>
                    <th scope="row" className={typography.color.secondary}>
                      {t('advancedIntelligence.hazards.cell', 'Coarse cell')}
                    </th>
                    <td id={`${headingId}-${index}-cell`} className="font-mono break-all">{cluster.coarse_cell}</td>
                  </tr>
                  <tr>
                    <th scope="row" className={typography.color.secondary}>
                      {t('advancedIntelligence.hazards.confidence', 'Confidence')}
                    </th>
                    <td className="text-right">{fmtNumber(cluster.confidence_pct)}%</td>
                  </tr>
                  <tr>
                    <th scope="row" className={typography.color.secondary}>
                      {t('advancedIntelligence.hazards.coverage', 'Observations')}
                    </th>
                    <td className="text-right">{fmtInt(cluster.observation_count)}</td>
                  </tr>
                  <tr>
                    <th scope="row" className={typography.color.secondary}>
                      <Icon icon={Clock3} size="sm" className="me-1 inline-block" />
                      {t('advancedIntelligence.hazards.recency', 'Last seen')}
                    </th>
                    <td>{formatRelative(cluster.last_seen)}</td>
                  </tr>
                </tbody></Table>
                </Card>
              </article>
            ))}
            </Grid>
          </div>
        </InsightPanel>
          {((query.data?.total ?? 0) > PAGE_SIZE || page > 1) ? (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={query.data?.total ?? 0}
              onPageChange={setPage}
            />
          ) : null}
      </FadeIn>

      <FadeIn delay={0.05}>
        <EvidencePanel
          quality={query.data?.data_quality}
          evidence={items.flatMap((item) => item.evidence ?? [])}
          limitations={query.data?.limitations}
          unsupported={[
            t('advancedIntelligence.hazards.unsupported.coordinates', 'Exact coordinates or route reconstruction'),
            t('advancedIntelligence.hazards.unsupported.navigation', 'Automatic rerouting or vehicle commands'),
          ]}
        />
      </FadeIn>
    </PageLayout>
  );
}
