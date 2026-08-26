import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import { ListSkeleton, OperationalWriteNotice } from '@/components/feedback';
import { GlassPanel } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { RepairCaseWorkspace } from '../components/RepairCaseWorkspace';

const RepairDiagnosticsWorkspace = lazy(async () => {
  const module = await import('../components/RepairDiagnosticsWorkspace');
  return { default: module.RepairDiagnosticsWorkspace };
});

export default function DataRepairPage() {
  const { t } = useTranslation();
  usePageTitle(t('dataRepair.title', 'Data Repair'));

  const operationalMode = useOperationalMode();
  const { vehicleId } = useSelectedVehicle();

  return (
    <PageContainer
      title={t('dataRepair.title', 'Data Repair')}
      subtitle={t(
        'dataRepair.subtitle.workspace',
        'Review evidence-backed anomalies, coordinate decisions, and apply reversible corrections.',
      )}
      actions={<VehicleSelect withIcon />}
    >
      <OperationalWriteNotice
        title={t('dataRepair.readOnly.title', 'Data repair is read-only')}
      />

      <RepairCaseWorkspace
        vehicleId={vehicleId ?? undefined}
        canWrite={operationalMode.canWrite}
        writeBlockReason={operationalMode.writeBlockReason ?? undefined}
        diagnostics={(
          <Suspense
            fallback={(
              <GlassPanel className="p-5">
                <ListSkeleton
                  rows={4}
                  label={t('dataRepair.diagnostics.loading', 'Loading diagnostics workspace')}
                />
              </GlassPanel>
            )}
          >
            <RepairDiagnosticsWorkspace
              vehicleId={vehicleId ?? undefined}
              canWrite={operationalMode.canWrite}
              writeBlockReason={operationalMode.writeBlockReason ?? undefined}
            />
          </Suspense>
        )}
      />
    </PageContainer>
  );
}
