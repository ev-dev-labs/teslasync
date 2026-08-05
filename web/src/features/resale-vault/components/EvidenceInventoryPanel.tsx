/**
 * Evidence inventory — shows, for every possible evidence section, whether
 * data was actually found for this vehicle AND whether the current
 * disclosure selection would include it in the assembled report. This is
 * the "what do we actually have to work with" overview, separate from the
 * privacy/redaction preview (which shows what would be REMOVED).
 */
import { useTranslation } from 'react-i18next';
import { GlassPanel, Badge } from '@/components/ui';
import { PanelTitle, HelperText } from '@/components/ui';
import { InlineCallout } from '@/components/feedback';
import { AlertTriangle } from 'lucide-react';
import { ALL_EVIDENCE_SECTIONS, type EvidenceSectionId } from '../lib/constants';
import type { VaultEvidence, DisclosureSelection } from '../lib/types';
import { SECTION_LABEL_KEYS } from './sectionLabels';

export interface EvidenceInventoryPanelProps {
  evidence: VaultEvidence;
  selection: DisclosureSelection;
  isLoading: boolean;
  hasPartialErrors: boolean;
}

export function EvidenceInventoryPanel({ evidence, selection, isLoading, hasPartialErrors }: EvidenceInventoryPanelProps) {
  const { t } = useTranslation();
  const selectedSet = new Set(selection.sections);

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <div>
        <PanelTitle>{t('resaleVault.inventory.title', 'Evidence Inventory')}</PanelTitle>
        <HelperText className="mt-1">
          {t('resaleVault.inventory.subtitle', 'What data is available for this vehicle, and whether the current disclosure profile would include it.')}
        </HelperText>
      </div>

      {hasPartialErrors && (
        <InlineCallout variant="warning" icon={<AlertTriangle />}>
          {t(
            'resaleVault.inventory.partialError',
            'One or more evidence sources failed to load. Affected sections are shown as unavailable rather than guessed.',
          )}
        </InlineCallout>
      )}

      <ul className="divide-y divide-white/[0.06]">
        {ALL_EVIDENCE_SECTIONS.map((section: EvidenceSectionId) => {
          const labels = SECTION_LABEL_KEYS[section];
          const hasData = evidence[section] != null;
          const isSelected = selectedSet.has(section);
          return (
            <li key={section} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-sm text-[var(--text-primary)]">{t(labels.key, labels.fallback)}</span>
              <span className="flex items-center gap-2">
                <Badge variant={hasData ? 'success' : 'neutral'}>
                  {isLoading
                    ? t('resaleVault.inventory.loading', 'Loading…')
                    : hasData
                      ? t('resaleVault.inventory.dataFound', 'Data found')
                      : t('resaleVault.inventory.noData', 'No data')}
                </Badge>
                <Badge variant={isSelected ? 'info' : 'neutral'}>
                  {isSelected
                    ? t('resaleVault.inventory.included', 'Included')
                    : t('resaleVault.inventory.excluded', 'Excluded by profile')}
                </Badge>
              </span>
            </li>
          );
        })}
      </ul>
    </GlassPanel>
  );
}
