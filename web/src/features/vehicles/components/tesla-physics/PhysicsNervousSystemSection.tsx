import { useState } from 'react';
import { PhysicsEvidenceBrief } from '../operationalbrief-n-z/PhysicsEvidenceBrief';
import { DataTable, Select, Text } from '@/components/ui';

import { Evidence, RawRows } from './Evidence';
import { type PhysicsPage, pagination } from './PhysicsPageShell';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function PhysicsNervousSystemSection({ physics }: { physics: PhysicsPage }) {
  const { fmtNumber } = useNumberFormatting();
  const { report, t } = physics;
  const nerves = report?.nervous_system?.nerves ?? [];
  const alive = nerves.filter((r) => r.status === 'alive');
  const conflicting = nerves.filter((r) => r.status === 'contradicting');
  const other = nerves.filter((r) => r.status !== 'alive' && r.status !== 'contradicting');
  const statuses = [...new Set(nerves.map((r) => r.status))];
  const [filter, setFilter] = useState('');
  const selected = statuses.includes(filter) ? filter : '';
  const visible = selected ? nerves.filter((row) => row.status === selected) : nerves;
  const budgets = report?.unknown_os?.budgets ?? [];
  const matchedBudgets = [...conflicting, ...other].flatMap((nerve) => {
    const budget = budgets.find((row) => row.kind.toLowerCase() === nerve.field.toLowerCase());
    return budget ? [{ nerve, budget }] : [];
  });
  const columns = [
    { key: 'field', header: t('teslaOnly.field', 'Field'), render: (r: typeof nerves[number]) => r.field },
    { key: 'status', header: t('teslaOnly.status', 'Status'), render: (r: typeof nerves[number]) => r.status },
    { key: 'detail', header: t('teslaOnly.detail', 'Detail'), render: (r: typeof nerves[number]) => r.detail },
  ];
  return <>
    <Evidence title={physics.title} honesty={report?.nervous_system?.honesty}>
      <PhysicsEvidenceBrief physics={physics} id="physics-nerves-summary" available={report?.nervous_system != null}
        description={t('teslaOnly.nerveNote', 'Status compares the latest frame against the freshness window. A silent signal is not a measured zero; contradicting fields require inspecting their actual observations. Returned fields are not every sensor in the vehicle.')}
        metrics={[
          { metricId: 'count', occurrenceId: 'alive', label: t('teslaOnly.aliveSignals', 'Alive signals'), rawValue: report?.nervous_system ? alive.length : null },
          { metricId: 'count', occurrenceId: 'conflicting', label: t('teslaOnly.conflictingSignals', 'Contradicting signals'), rawValue: report?.nervous_system ? conflicting.length : null },
          { metricId: 'count', occurrenceId: 'other', label: t('teslaOnly.otherSignals', 'Other or silent signals'), rawValue: report?.nervous_system ? other.length : null },
          { metricId: 'percent', occurrenceId: 'share', label: t('teslaOnly.nervousShareLabel', 'Alive among returned fields'), rawValue: nerves.length ? 100 * alive.length / nerves.length : null, display: { formatter: raw => ({ value: `${fmtNumber(raw)}%`, unit: '' }) }, context: t('teslaOnly.nervousShare', 'Alive among returned fields: {{value}}', { value: nerves.length ? `${fmtNumber(100 * alive.length / nerves.length)}%` : t('teslaOnly.unknown', 'unknown') }) },
          ...statuses.map((status): import('@/components/data-display').StatMetric => ({ metricId: 'count', occurrenceId: `status-${status}`, label: status, rawValue: nerves.filter(row => row.status === status).length })),
        ]} />
    </Evidence>
    <Evidence title={t('teslaOnly.nervousDiagnostics', 'Signal-level diagnostic triage')}>
      <PhysicsEvidenceBrief physics={physics} id="physics-nerves-budget-match" available={report?.nervous_system != null && report?.unknown_os != null}
        description={t('teslaOnly.nervousBudgetCaution', 'Name matching is an exact cross-reference, not proof that a currently silent field was silent throughout its historical unknown budget.')}
        metrics={[{ metricId: 'count', occurrenceId: 'matched', label: t('teslaOnly.nervousMatchedLabel', 'Non-alive fields with a same-named unknown OS budget'), rawValue: report?.nervous_system && report?.unknown_os ? matchedBudgets.length : null, display: { countTotal: conflicting.length + other.length }, context: t('teslaOnly.nervousMatchedBudgets', 'Non-alive fields with a same-named unknown OS budget: {{count}} / {{total}}', { count: matchedBudgets.length, total: conflicting.length + other.length }) }]} />
      {nerves.length === 0 && <Text as="p" variant="bodySm">{t('teslaOnly.nervousNoFields', 'No signal status rows returned; there is no basis to assess signal freshness.')}</Text>}
      <Text as="p" variant="bodySm">{t('teslaOnly.nervousAttention', 'Signals needing attention')}</Text>
      <DataTable tableId="physics:nerves-attention" data={[...conflicting, ...other]} columns={columns} pagination={pagination}
        mobileColumns={['field', 'status']} keyExtractor={(r) => r.field} emptyMessage={t('teslaOnly.nervousNone', 'No non-alive signals returned in this frame.')} />
      {matchedBudgets.length ? matchedBudgets.slice(0, 5).map(({ nerve, budget }) =>
        <Text key={nerve.field} as="p" variant="caption">{t('teslaOnly.nervousBudgetReading', '{{field}}: {{status}} now; {{hours}} h unknown in returned budget', {
          field: nerve.field, status: nerve.status, hours: fmtNumber(budget.hours),
        })}</Text>) : <Text as="p" variant="caption">{t('teslaOnly.nervousNoBudgetMatch', 'No matching signal budget was returned; signal-specific unknown hours cannot be inferred.')}</Text>}
      <Select label={t('teslaOnly.nervousFilter', 'Filter returned signals by status')} value={selected} onChange={(event) => setFilter(event.target.value)}
        options={[{ value: '', label: t('teslaOnly.nervousAll', 'All returned statuses') }, ...statuses.map((status) => ({ value: status, label: status }))]} />
      <Text as="p" variant="caption">{t('teslaOnly.nervousScope', 'Only returned signal fields can be filtered. Status is a freshness/consistency classification, not proof that a vehicle component failed.')}</Text>
      <RawRows title={physics.title} rows={visible} columns={columns} tableId="physics:nerves" t={t}
        mobileColumns={['field', 'status']} keyExtractor={(r) => r.field} />
    </Evidence>
  </>;
}
