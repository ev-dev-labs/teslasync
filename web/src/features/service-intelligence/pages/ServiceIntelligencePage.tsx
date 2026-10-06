import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { FileSearch, Info } from 'lucide-react';

import {
  useCommunicationsCatalogStatus,
  useImportCommunicationsCatalog,
  useServiceIntelligence,
  useWarrantyOutlook,
  SudoCanceledError,
  type OfficialNHTSACommunicationsArtifactURL,
} from '@/api/hooks/useServiceIntelligence';
import { AlertBanner, StaleRefreshWarning } from '@/components/feedback';

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Button, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useDataState } from '@/hooks/useDataState';

import {
  ClaimDraftPanel,
  CommunicationsPanel,
  CommunicationsCatalogPanel,
  EvidenceLimitationsPanel,
  RecallInventoryPanel,
  SourceFreshnessPanel,
  SymptomMatchesPanel,
  VehicleMatchPanel,
  WarrantyPanel,
} from '../components';

export default function ServiceIntelligencePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { vehicleId } = useSelectedVehicle();
  const query = useServiceIntelligence(vehicleId);
  const warrantyQuery = useWarrantyOutlook(vehicleId);
  const catalogQuery = useCommunicationsCatalogStatus();
  const serviceState = useDataState(query);
  const warrantyState = useDataState(warrantyQuery);
  const catalogState = useDataState(catalogQuery);
  const catalogImport = useImportCommunicationsCatalog();
  usePageTitle(t('serviceIntelligence.page.title', 'Recall & service intelligence'));

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
        {t('serviceIntelligence.actions.evidencePack', 'Open service evidence pack')}
      </Button>
    </div>
  );

  return (
    <PageLayout
      title={t('serviceIntelligence.page.title', 'Recall & service intelligence')}
      subtitle={t(
        'serviceIntelligence.page.subtitle',
        'Compare decoded vehicle context and observed signal patterns with NHTSA safety records.',
      )}
      secondaryActions={actions}
      query={selected ? [query, warrantyQuery, catalogQuery] : catalogQuery}
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
        <StaleRefreshWarning state={catalogState} label={t('serviceIntelligence.catalog.title', 'Official NHTSA TSB catalog')} />
        <CommunicationsCatalogPanel
          status={catalogQuery.data ?? null}
          loading={!catalogState.hasData && catalogQuery.isLoading}
          error={catalogState.fatalError}
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
        <StaleRefreshWarning state={serviceState} label={t('serviceIntelligence.page.title', 'Recall & service intelligence')} />
        <VehicleMatchPanel
          selected={selected}
          loading={!serviceState.hasData && query.isLoading}
          error={serviceState.fatalError}
          context={data?.vehicle_context ?? null}
          summary={data?.summary ?? null}
          onRetry={retry}
        />
      </FadeIn>

      <FadeIn delay={0.075}>
        <StaleRefreshWarning state={warrantyState} label={t('serviceIntelligence.warranty.title', 'Warranty countdown')} />
        <WarrantyPanel
          selected={selected}
          loading={!warrantyState.hasData && warrantyQuery.isLoading}
          error={warrantyState.fatalError}
          outlook={warrantyQuery.data ?? null}
          onRetry={() => void warrantyQuery.refetch()}
        />
      </FadeIn>

      <FadeIn delay={0.085}>
        <ClaimDraftPanel vehicleId={vehicleId} />
      </FadeIn>

      <FadeIn delay={0.1}>
        <RecallInventoryPanel
          selected={selected}
          loading={!serviceState.hasData && query.isLoading}
          error={serviceState.fatalError}
          findings={data?.recall_findings ?? []}
          onRetry={retry}
        />
      </FadeIn>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <FadeIn delay={0.15}>
          <CommunicationsPanel
            selected={selected}
            loading={!serviceState.hasData && query.isLoading}
            error={serviceState.fatalError}
            communications={data?.communications ?? []}
            source={communicationsSource}
            onRetry={retry}
          />
        </FadeIn>
        <FadeIn delay={0.2}>
          <SymptomMatchesPanel
            selected={selected}
            loading={!serviceState.hasData && query.isLoading}
            error={serviceState.fatalError}
            symptoms={data?.ranked_symptoms ?? []}
            onRetry={retry}
          />
        </FadeIn>
      </div>

      <FadeIn delay={0.25}>
        <EvidenceLimitationsPanel
          selected={selected}
          loading={!serviceState.hasData && query.isLoading}
          error={serviceState.fatalError}
          evidence={data?.evidence ?? null}
          onRetry={retry}
        />
      </FadeIn>

      <FadeIn delay={0.3}>
        <SourceFreshnessPanel
          selected={selected}
          loading={!serviceState.hasData && query.isLoading}
          error={serviceState.fatalError}
          sources={data?.sources ?? []}
          onRetry={retry}
        />
      </FadeIn>
    </PageLayout>
  );
}
