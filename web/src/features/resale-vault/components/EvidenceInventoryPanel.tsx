/**
 * Evidence inventory — shows, for every possible evidence section, whether
 * data was actually found for this vehicle AND whether the current
 * disclosure selection would include it in the assembled report. This is
 * the "what do we actually have to work with" overview, separate from the
 * privacy/redaction preview (which shows what would be REMOVED).
 */
import { useTranslation } from 'react-i18next';
import { Badge, Table, HelperText } from '@/components/ui';
import { LayoutCard, SourceContent } from '@/components/layout';
import { InlineCallout, StaleRefreshWarning } from '@/components/feedback';
import { AlertTriangle } from 'lucide-react';
import { ALL_EVIDENCE_SECTIONS, type EvidenceSectionId } from '../lib/constants';
import type { VaultEvidence, DisclosureSelection } from '../lib/types';
import { SECTION_LABEL_KEYS } from './sectionLabels';
import type { VaultEvidenceSource } from '../hooks/useVaultEvidence';

export interface EvidenceInventoryPanelProps {
  evidence: VaultEvidence;
  selection: DisclosureSelection;
  isLoading: boolean;
  hasPartialErrors: boolean;
  sources?: readonly VaultEvidenceSource[];
}

export function EvidenceInventoryPanel({ evidence, selection, isLoading, hasPartialErrors, sources }: EvidenceInventoryPanelProps) {
  const { t } = useTranslation();
  const selectedSet = new Set(selection.sections);

  return (
    <LayoutCard title={t('resaleVault.inventory.title', 'Evidence inventory')}>
      <div>
        <HelperText className="mt-1">
          {t('resaleVault.inventory.subtitle', 'What data is available for this vehicle, and whether the current disclosure profile would include it.')}
        </HelperText>
      </div>

      {hasPartialErrors && (
        <InlineCallout variant="warning" icon={<AlertTriangle />}>
          {t(
            'resaleVault.inventory.sourceFailures',
            'One or more evidence sources could not refresh. Previously loaded evidence remains visible; missing evidence is not guessed.',
          )}
        </InlineCallout>
      )}

      <Table aria-label={t('resaleVault.inventory.title', 'Evidence inventory')}>

        <tbody>
        {ALL_EVIDENCE_SECTIONS.map((section: EvidenceSectionId) => {
          const labels = SECTION_LABEL_KEYS[section];
          const hasData = evidence[section] != null;
          const isSelected = selectedSet.has(section);
          const pending = sources
            ? sources.some((source) => source.section === section && source.loading)
            : isLoading;
          const failed = sources?.some((source) => source.section === section && source.state.fatalError != null) ?? false;
          return (
            <tr key={section}>
              <th scope="row"><span className="text-sm text-[var(--text-primary)]">{t(labels.key, labels.fallback)}</span></th>
              <td>
                <Badge variant={hasData ? 'success' : 'neutral'}>
                  {pending && !hasData
                    ? t('resaleVault.inventory.loading', 'Loading…')
                    : hasData
                      ? t('resaleVault.inventory.dataFound', 'Data found')
                      : failed
                        ? t('resaleVault.inventory.unavailable', 'Unavailable')
                        : t('resaleVault.inventory.noData', 'No data')}
                </Badge>
              </td>
              <td>
                <Badge variant={isSelected ? 'info' : 'neutral'}>
                  {isSelected
                    ? t('resaleVault.inventory.included', 'Included')
                    : t('resaleVault.inventory.excluded', 'Excluded by profile')}
                </Badge>
              </td>
            </tr>
          );
        })}
        </tbody>
      </Table>
      {sources?.map(({ id, labelKey, label, state, loading }) => (
        <div key={id}>
          <StaleRefreshWarning state={state} label={t(labelKey, label)} />
          {state.fatalError || loading ? (
            <SourceContent
              state={state.fatalError ? 'error' : 'loading'}
              label={t(labelKey, label)}
              error={state.fatalError}
              errorMessage={t('resaleVault.inventory.sourceError', '{{source}} could not be loaded.', { source: t(labelKey, label) })}
              errorRecovery={state.retry ? { onRetry: state.retry } : undefined}
              emptyMessage=""
            >
              {null}
            </SourceContent>
          ) : null}
        </div>
      ))}
    </LayoutCard>
  );
}
