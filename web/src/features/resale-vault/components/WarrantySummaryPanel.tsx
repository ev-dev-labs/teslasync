/**
 * Warranty summary — renders the already-scrubbed Tesla warranty payload
 * (see `redaction.ts::scrubSensitiveRecord`) as a flat key/value list, plus
 * the account-level (not vehicle-scoped) backend limitation note.
 */
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui';
import { PanelTitle } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { EmptyState, InlineCallout } from '@/components/feedback';
import { Info } from 'lucide-react';
import type { WarrantyEvidence } from '../lib/types';

export interface WarrantySummaryPanelProps {
  warranty: WarrantyEvidence | null;
}

function flattenTopLevel(data: Record<string, unknown>): { label: string; value: string }[] {
  return Object.keys(data)
    .sort()
    .map((key) => {
      const value = data[key];
      const display =
        value == null
          ? '—'
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
      return { label: key, value: display };
    });
}

export function WarrantySummaryPanel({ warranty }: WarrantySummaryPanelProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <PanelTitle>{t('resaleVault.warranty.title', 'Warranty')}</PanelTitle>

      {!warranty || !warranty.data ? (
        <EmptyState message={t('resaleVault.warranty.empty', 'No warranty evidence in this report.')} />
      ) : (
        <>
          <InlineCallout variant="info" icon={<Info />}>
            {t(
              'resaleVault.warranty.scopeNote',
              'Warranty details are fetched at the Tesla account level, not scoped to an individual vehicle.',
            )}
          </InlineCallout>
          <KVList
            items={[
              { label: t('resaleVault.warranty.fetchedAt', 'Fetched at'), value: warranty.fetched_at ?? '—' },
              ...flattenTopLevel(warranty.data),
            ]}
          />
        </>
      )}
    </GlassPanel>
  );
}
