import { Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { RepairSuggestion } from '@/api/hooks/useDataRepair';
import { KVList, type KVItem } from '@/components/data-display';
import { InlineCallout } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';

interface RepairChangeDetailsProps {
  suggestion: RepairSuggestion;
}

export function RepairChangeDetails({ suggestion }: RepairChangeDetailsProps) {
  const { t } = useTranslation();
  const { formatDuration } = useUnits();
  const at = (iso: string): string => formatDateTime(iso);
  const details: KVItem[] = [
    {
      label: t('dataRepair.detail.vehicle', 'Vehicle'),
      value: t('dataRepair.row.vehicle', 'Vehicle {{id}}', { id: suggestion.vehicle_id }),
    },
    {
      label: t('dataRepair.detail.storedEnd', 'Stored end'),
      value: suggestion.stored_ended_at
        ? at(suggestion.stored_ended_at)
        : t('dataRepair.detail.stillOpen', 'Still open'),
    },
    {
      label: t('dataRepair.detail.proposedEnd', 'Proposed end'),
      value: at(suggestion.suggested_ended_at),
    },
    {
      label: t('dataRepair.detail.proposedDuration', 'Proposed duration'),
      value: formatDuration(suggestion.suggested_duration_s),
    },
    {
      label: t('dataRepair.detail.evidenceGap', 'Unobserved gap'),
      value: formatDuration(suggestion.evidence_gap_s),
    },
  ];

  if (suggestion.stored_duration_s != null) {
    details.splice(3, 0, {
      label: t('dataRepair.detail.storedDuration', 'Stored duration'),
      value: formatDuration(suggestion.stored_duration_s),
    });
  }

  return (
    <>
      <section aria-label={t('dataRepair.card.details', 'Proposed change')}>
        <KVList items={details} />
      </section>
      <InlineCallout variant="warning" icon={<Wrench />}>
        {t(
          'dataRepair.card.risk',
          'Applying rewrites only the end timestamp (and the derived duration for drives). Measured totals such as distance, energy and speed are left untouched, so they may still reflect the original window.',
        )}
      </InlineCallout>
    </>
  );
}
