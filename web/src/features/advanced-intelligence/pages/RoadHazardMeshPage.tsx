import { useState } from 'react';
import { Clock3, MapPinned, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRoadHazards } from '@/api/hooks/useAdvancedIntelligence';
import { AlertBanner } from '@/components/feedback';

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Table, Badge, Pagination, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { formatRelative } from '@/lib/dateFormat';

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
  const [page, setPage] = useState(1);
  const query = useRoadHazards(vehicleId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const items = query.data?.items ?? [];
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
        icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
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
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((cluster, index) => (
              <article key={`${cluster.coarse_cell}-${cluster.hazard_type}-${index}`} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <MapPinned className="h-5 w-5 text-cyan-300" aria-hidden="true" />
                    <Text as="h3" variant="subhead">{cluster.hazard_type}</Text>
                  </div>
                  <Badge variant={severityVariant(cluster.severity)}>{cluster.severity}</Badge>
                </div>
                <Table aria-label={t('advancedIntelligence.hazards.title', 'Road hazard mesh')}><tbody>
                  <tr>
                    <th scope="row" className="text-[var(--text-muted)]">
                      {t('advancedIntelligence.hazards.cell', 'Coarse cell')}
                    </th>
                    <td className="font-mono">{cluster.coarse_cell}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="text-[var(--text-muted)]">
                      {t('advancedIntelligence.hazards.confidence', 'Confidence')}
                    </th>
                    <td className="text-right">{fmtNumber(cluster.confidence_pct)}%</td>
                  </tr>
                  <tr>
                    <th scope="row" className="text-[var(--text-muted)]">
                      {t('advancedIntelligence.hazards.coverage', 'Observations')}
                    </th>
                    <td className="text-right">{fmtInt(cluster.observation_count)}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="flex items-center gap-1 text-[var(--text-muted)]">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('advancedIntelligence.hazards.recency', 'Last seen')}
                    </th>
                    <td>{formatRelative(cluster.last_seen)}</td>
                  </tr>
                </tbody></Table>
              </article>
            ))}
          </div>
          {(query.data?.total ?? 0) > PAGE_SIZE ? (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={query.data?.total ?? 0}
              onPageChange={setPage}
            />
          ) : null}
        </InsightPanel>
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
