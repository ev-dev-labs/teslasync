import { useTranslation } from 'react-i18next';
import { Download, FileJson } from 'lucide-react';
import { GlassPanel, PanelTitle, Button, Caption } from '@/components/ui';
import { buildCanonicalPlan, downloadCanonicalPlan } from '../lib/planExport';
import type { OrchestrationInput, OrchestrationResult } from '../lib/types';

interface PlanExportPanelProps {
  input: OrchestrationInput;
  result: OrchestrationResult;
}

/** Canonical JSON plan export — the recommendation's only externally-visible side effect (a file download). */
export function PlanExportPanel({ input, result }: PlanExportPanelProps) {
  const { t } = useTranslation();

  function handleExport() {
    const plan = buildCanonicalPlan(input, result, new Date().toISOString());
    downloadCanonicalPlan(plan, `home-energy-plan-${input.startTimeIso.slice(0, 10)}.json`);
  }

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-2">{t('homeEnergy.export.title', 'Export Plan')}</PanelTitle>
      <Caption className="mb-3 block">
        {t(
          'homeEnergy.export.description',
          'Download the full recommendation — inputs, per-slot schedule, and scores — as a versioned JSON document. Nothing is sent to any vehicle, Powerwall, or utility.',
        )}
      </Caption>
      <Button size="sm" variant="primary" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExport}>
        <FileJson className="h-3.5 w-3.5" />
        {t('homeEnergy.export.download', 'Download canonical JSON plan')}
      </Button>
    </GlassPanel>
  );
}
