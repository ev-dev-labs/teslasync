import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { FileSearch, Info } from 'lucide-react';

import {
  useCommunicationsCatalogStatus,
  useImportCommunicationsCatalog,
  useServiceIntelligence,
  SudoCanceledError,
  type OfficialNHTSACommunicationsArtifactURL,
} from '@/api/hooks/useServiceIntelligence';
import { AlertBanner } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Button, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

import {
  CommunicationsPanel,
  CommunicationsCatalogPanel,
  EvidenceLimitationsPanel,
  RecallInventoryPanel,
  SourceFreshnessPanel,
  SymptomMatchesPanel,
  VehicleMatchPanel,
} from '../components';

export default function ServiceIntelligencePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { vehicleId } = useSelectedVehicle();
  const query = useServiceIntelligence(vehicleId);
  const catalogQuery = useCommunicationsCatalogStatus();
  const catalogImport = useImportCommunicationsCatalog();
  usePageTitle(t('serviceIntelligence.page.title', 'Recall & Service Intelligence'));

  const retry = useCallback(() => {
    void query.refetch();
  }, [query.refetch]);
  const retryCatalog = useCallback(() => {
    void catalogQuery.refetch();
  }, [catalogQuery.refetch]);
  const importCatalog = useCallback(
    (artifactURL: OfficialNHTSACommunicationsArtifactURL) => {
      catalogImport.mutate(artifactURL);
    },
    [catalogImport.mutate],
  );
  const selected = vehicleId != null;
  const data = query.data;
  const communicationsSource =
    data?.sources.find((source) => source.id === 'nhtsa_manufacturer_communications') ?? null;

  const actions = (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <VehicleSelect
        ariaLabel={t('serviceIntelligence.vehicle.select', 'Select vehicle')}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={!selected}
        icon={<FileSearch className="h-4 w-4" aria-hidden="true" />}
        onClick={() =>
          navigate(
            `/diagnostics/service-evidence${vehicleId == null ? '' : `?vehicle_id=${vehicleId}`}`,
          )
        }
      >
        {t('serviceIntelligence.actions.evidencePack', 'Open Service Evidence Pack')}
      </Button>
    </div>
  );

  return (
    <PageContainer
      title={t('serviceIntelligence.page.title', 'Recall & Service Intelligence')}
      subtitle={t(
        'serviceIntelligence.page.subtitle',
        'Compare decoded vehicle context and observed signal patterns with NHTSA safety records.',
      )}
      actions={actions}
      query={selected ? query : undefined}
    >
      <AlertBanner
        variant="info"
        icon={<Info className="h-5 w-5" aria-hidden="true" />}
        title={t('serviceIntelligence.disclaimer.title', 'Service hypotheses, not findings of fault')}
      >
        <Text as="p" variant="bodySm">
          {t(
            'serviceIntelligence.disclaimer.body',
            'Campaign applicability, completion, and symptom overlap require confirmation by NHTSA, Tesla, or a qualified technician.',
          )}
        </Text>
      </AlertBanner>

      <FadeIn>
        <CommunicationsCatalogPanel
          status={catalogQuery.data ?? null}
          loading={catalogQuery.isLoading}
          error={catalogQuery.error}
          importing={catalogImport.isPending}
          importingArtifactURL={
            catalogImport.isPending ? (catalogImport.variables ?? null) : null
          }
          importError={
            catalogImport.error instanceof SudoCanceledError ? null : catalogImport.error
          }
          onRetry={retryCatalog}
          onImport={importCatalog}
        />
      </FadeIn>

      <FadeIn delay={0.05}>
        <VehicleMatchPanel
          selected={selected}
          loading={query.isLoading}
          error={query.error}
          context={data?.vehicle_context ?? null}
          summary={data?.summary ?? null}
          onRetry={retry}
        />
      </FadeIn>

      <FadeIn delay={0.1}>
        <RecallInventoryPanel
          selected={selected}
          loading={query.isLoading}
          error={query.error}
          findings={data?.recall_findings ?? []}
          onRetry={retry}
        />
      </FadeIn>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <FadeIn delay={0.15}>
          <CommunicationsPanel
            selected={selected}
            loading={query.isLoading}
            error={query.error}
            communications={data?.communications ?? []}
            source={communicationsSource}
            onRetry={retry}
          />
        </FadeIn>
        <FadeIn delay={0.2}>
          <SymptomMatchesPanel
            selected={selected}
            loading={query.isLoading}
            error={query.error}
            symptoms={data?.ranked_symptoms ?? []}
            onRetry={retry}
          />
        </FadeIn>
      </div>

      <FadeIn delay={0.25}>
        <EvidenceLimitationsPanel
          selected={selected}
          loading={query.isLoading}
          error={query.error}
          evidence={data?.evidence ?? null}
          onRetry={retry}
        />
      </FadeIn>

      <FadeIn delay={0.3}>
        <SourceFreshnessPanel
          selected={selected}
          loading={query.isLoading}
          error={query.error}
          sources={data?.sources ?? []}
          onRetry={retry}
        />
      </FadeIn>
    </PageContainer>
  );
}
