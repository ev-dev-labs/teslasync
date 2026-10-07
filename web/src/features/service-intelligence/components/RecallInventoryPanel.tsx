import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { GlassPanel, PanelTitle } from '@/components/ui';
import type { ServiceIntelligenceFinding } from '@/api/hooks/useServiceIntelligence';
import { PanelState } from './PanelState';
import { RecallFindingCard } from './RecallFindingCard';

export interface RecallInventoryPanelProps {
  selected: boolean;
  loading: boolean;
  error: unknown;
  findings: ServiceIntelligenceFinding[];
  onRetry: () => void;
}

export function RecallInventoryPanel({
  selected,
  loading,
  error,
  findings,
  onRetry,
}: RecallInventoryPanelProps) {
  const { t } = useTranslation();
  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {t('serviceIntelligence.recall.title', 'Recall inventory')}
      </PanelTitle>
      <PanelState
        selected={selected}
        loading={loading}
        error={error}
        empty={findings.length === 0}
        icon={<ShieldAlert className="h-9 w-9" />}
        selectTitle={t('serviceIntelligence.common.selectTitle', 'Select a vehicle')}
        selectMessage={t(
          'serviceIntelligence.recall.select',
          'Choose a vehicle to load its model-year recall candidates.',
        )}
        emptyTitle={t('serviceIntelligence.recall.emptyTitle', 'No recall candidates')}
        emptyMessage={t(
          'serviceIntelligence.recall.empty',
          'NHTSA returned no recall campaigns for the decoded make, model, and model year.',
        )}
        onRetry={onRetry}
      >
        <ol className="space-y-3">
          {findings.map((finding) => (
            <RecallFindingCard key={finding.id} finding={finding} />
          ))}
        </ol>
      </PanelState>
    </GlassPanel>
  );
}
