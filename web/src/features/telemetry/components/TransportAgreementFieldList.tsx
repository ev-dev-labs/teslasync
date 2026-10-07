import { useTranslation } from 'react-i18next';
import { CircleHelp } from 'lucide-react';

import type { TransportAgreementField } from '@/api/types';
import { EmptyState } from '@/components/feedback';
import { PanelTitle, Text } from '@/components/ui';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';

export interface TransportAgreementFieldListProps {
  fields: TransportAgreementField[];
}

const MAX_VISIBLE_FIELDS = 20;

export function TransportAgreementFieldList({ fields }: TransportAgreementFieldListProps) {
  const { t } = useTranslation();
  const visibleFields = fields.slice(0, MAX_VISIBLE_FIELDS);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <PanelTitle>
          {t('signalTransportAgreement.fieldTitle', 'Per-signal evidence')}
        </PanelTitle>
        <Text as="span" variant="caption">
          {t(
            'signalTransportAgreement.fieldCount',
            'Showing {{shown}} of {{total}} signals',
            { shown: visibleFields.length, total: fields.length },
          )}
        </Text>
      </div>

      {visibleFields.length === 0 ? (
        <EmptyState /* no-action: per-signal rows are derived from the same automatically recorded evidence. */
          icon={<CircleHelp className="h-8 w-8" aria-hidden="true" />}
          message={t(
            'signalTransportAgreement.noFields',
            'No eligible per-signal evidence is available.',
          )}
          className="py-8"
        />
      ) : (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2" role="list">
          {visibleFields.map((field) => (
            <div
              key={field.field}
              role="listitem"
              className="flex items-center justify-between gap-4 rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3"
            >
              <div className="min-w-0 space-y-1">
                <Text as="p" variant="bodySm" weight="medium" mono className="truncate">
                  {field.field}
                </Text>
                <Text as="p" variant="caption">
                  {t(
                    'signalTransportAgreement.fieldEvidence',
                    '{{pairs}} pairs / {{http}} HTTP / {{mqtt}} MQTT',
                    {
                      pairs: fmtInt(field.comparable_pairs),
                      http: fmtInt(field.http_evidence_rows),
                      mqtt: fmtInt(field.mqtt_evidence_rows),
                    },
                  )}
                </Text>
              </div>
              <div className="shrink-0 text-right">
                <Text as="p" variant="bodySm" weight="semibold">
                  {field.agreement_pct == null
                    ? t('signalTransportAgreement.notMeasured', 'Not measured')
                    : fmtPercent(field.agreement_pct, 1)}
                </Text>
                <Text as="p" variant="caption">
                  {t(
                    'signalTransportAgreement.disagreements',
                    'Disagreements: {{count}}',
                    { count: field.disagreeing_pairs },
                  )}
                </Text>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
