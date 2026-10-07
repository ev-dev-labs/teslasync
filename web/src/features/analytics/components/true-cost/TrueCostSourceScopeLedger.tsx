import { Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, Code, PanelTitle, Table, Text } from '@/components/ui';
import { TrueCostSectionBody } from './TrueCostSectionBody';
import type { TrueCostSectionProps } from './types';

export function TrueCostSourceScopeLedger({
  analysis,
  state,
}: TrueCostSectionProps) {
  const { t } = useTranslation();
  const payloadLabel = analysis.payloadAvailability === 'valid'
    ? t('tco.source.payloadValid', 'Valid object envelope')
    : analysis.payloadAvailability === 'invalid'
      ? t('tco.source.payloadInvalid', 'Malformed envelope')
      : t('tco.source.payloadMissing', 'Missing envelope');
  const rows = [
    {
      label: t('tco.source.endpoint', 'Canonical endpoint'),
      value: t('tco.source.endpointValue', 'GET /analytics/tco?vehicle_id=…'),
      detail: t('tco.source.endpointHint', 'One vehicle-scoped aggregate response'),
    },
    {
      label: t('tco.source.chargingFilter', 'Charging numerator filter'),
      value: t('tco.source.chargingFilterValue', 'cost_decimal > 0'),
      detail: t('tco.source.chargingFilterHint', 'Spend, energy, and sessions exclude free and missing-cost rows'),
    },
    {
      label: t('tco.source.driveFilter', 'Drive denominator filter'),
      value: t('tco.source.driveFilterValue', 'distance_m > 0'),
      detail: t('tco.source.driveFilterHint', 'Distance and dates use all positive-distance drives'),
    },
    {
      label: t('tco.source.monthFilter', 'Monthly row filter'),
      value: t('tco.source.monthFilterValue', 'Positive recorded charging cost'),
      detail: t('tco.source.monthFilterHint', '{{rows}} returned rows · {{eligible}} eligible months', {
        rows: analysis.monthlyAccounting.returnedRows,
        eligible: analysis.monthlyAccounting.eligibleRows,
      }),
    },
    {
      label: t('tco.source.payload', 'Top-level runtime validation'),
      value: payloadLabel,
      detail: t('tco.source.payloadHint', 'Missing and malformed metrics remain unavailable; they are never coerced to zero'),
    },
    {
      label: t('tco.source.dispositions', 'Monthly terminal dispositions'),
      value: t('tco.source.dispositionValue', '{{invalidRows}} invalid rows · {{invalidMonths}} invalid months · {{duplicates}} duplicates', {
        invalidRows: analysis.monthlyAccounting.invalidRowRows,
        invalidMonths: analysis.monthlyAccounting.invalidMonthRows,
        duplicates: analysis.monthlyAccounting.duplicateMonthRows,
      }),
      detail: t('tco.source.dispositionHint', '{{eligible}} unique YYYY-MM rows remain eligible for field-level support', {
        eligible: analysis.monthlyAccounting.eligibleRows,
      }),
    },
  ];

  return (
    <section
      data-testid="tco-source-scope"
      aria-label={t('tco.source.aria', 'True cost source filter and scope ledger')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Database className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('tco.source.title', 'Source, filter, and scope ledger')}
        </PanelTitle>
        <TrueCostSectionBody state={state}>
          <Table aria-label={t('tco.source.title', 'Source, filter, and scope ledger')}>

            <tbody>
            {rows.map((row) => (
              <tr
                key={row.label}
              >
                <th scope="row"><Text as="p" variant="metricLabel">{row.label}</Text></th>
                <td>
                <Code className="mt-1 block">{row.value}</Code>
                <Text as="p" variant="caption" className="mt-1">{row.detail}</Text>
                </td>
              </tr>
            ))}
            </tbody>
          </Table>
        </TrueCostSectionBody>
      </GlassPanel>
    </section>
  );
}
