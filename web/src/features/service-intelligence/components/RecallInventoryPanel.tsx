import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
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
    <LayoutCard title={t('serviceIntelligence.recall.title', 'Recall inventory')}
      actions={<ShieldAlert className="h-4 w-4 text-amber-300" aria-hidden="true" />}>
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
    </LayoutCard>
  );
}
