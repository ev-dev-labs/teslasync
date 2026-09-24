import { useState } from 'react';
import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { Badge, DataTable, Select, Text } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import { Evidence, RawRows } from '../components/tesla-physics/Evidence';
import { pagination, PhysicsPageShell, usePhysicsPage } from '../components/tesla-physics/PhysicsPageShell';

export default function PhysicsNervousSystemPage() {
  const physics = usePhysicsPage('nervous-system');
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
  return <PhysicsPageShell physics={physics}>
    <Evidence title={physics.title} honesty={report?.nervous_system?.honesty}>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.aliveSignals', 'Alive signals')} value={alive.length} color="green" />
        <MetricCard label={t('teslaOnly.conflictingSignals', 'Contradicting signals')} value={conflicting.length} color="amber" />
        <MetricCard label={t('teslaOnly.otherSignals', 'Other or silent signals')} value={other.length} color="purple" />
      </Grid>
      <div className="flex flex-wrap gap-2">{statuses.map((status) =>
        <Badge key={status} variant={status === 'alive' ? 'success' : 'warning'} size="sm">{status}: {nerves.filter((r) => r.status === status).length}</Badge>)}</div>
      <Text as="p" variant="bodySm">{t('teslaOnly.nervousShare', 'Alive among returned fields: {{value}}', {
        value: nerves.length ? `${fmtNumber(100 * alive.length / nerves.length, 1)}%` : t('teslaOnly.unknown', 'unknown'),
      })}</Text>
      <Text as="p" variant="caption">{t('teslaOnly.nerveNote', 'Status compares the latest frame against the freshness window. A silent signal is not a measured zero; contradicting fields require inspecting their actual observations. Returned fields are not every sensor in the vehicle.')}</Text>
    </Evidence>
    <Evidence title={t('teslaOnly.nervousDiagnostics', 'Signal-level diagnostic triage')}>
      {nerves.length === 0 && <Text as="p" variant="bodySm">{t('teslaOnly.nervousNoFields', 'No signal status rows returned; there is no basis to assess signal freshness.')}</Text>}
      <Text as="p" variant="bodySm">{t('teslaOnly.nervousAttention', 'Signals needing attention')}</Text>
      <DataTable tableId="physics:nerves-attention" data={[...conflicting, ...other]} columns={columns} pagination={pagination}
        mobileColumns={['field', 'status']} keyExtractor={(r) => r.field} emptyMessage={t('teslaOnly.nervousNone', 'No non-alive signals returned in this frame.')} />
      <Text as="p" variant="bodySm">{t('teslaOnly.nervousMatchedBudgets', 'Non-alive fields with a same-named Unknown OS budget: {{count}} / {{total}}', {
        count: matchedBudgets.length, total: conflicting.length + other.length,
      })}</Text>
      {matchedBudgets.length ? matchedBudgets.slice(0, 5).map(({ nerve, budget }) =>
        <Text key={nerve.field} as="p" variant="caption">{t('teslaOnly.nervousBudgetReading', '{{field}}: {{status}} now; {{hours}} h unknown in returned budget', {
          field: nerve.field, status: nerve.status, hours: fmtNumber(budget.hours, 1),
        })}</Text>) : <Text as="p" variant="caption">{t('teslaOnly.nervousNoBudgetMatch', 'No matching signal budget was returned; signal-specific unknown hours cannot be inferred.')}</Text>}
      <Text as="p" variant="caption">{t('teslaOnly.nervousBudgetCaution', 'Name matching is an exact cross-reference, not proof that a currently silent field was silent throughout its historical unknown budget.')}</Text>
      <Select label={t('teslaOnly.nervousFilter', 'Filter returned signals by status')} value={selected} onChange={(event) => setFilter(event.target.value)}
        options={[{ value: '', label: t('teslaOnly.nervousAll', 'All returned statuses') }, ...statuses.map((status) => ({ value: status, label: status }))]} />
      <Text as="p" variant="caption">{t('teslaOnly.nervousScope', 'Only returned signal fields can be filtered. Status is a freshness/consistency classification, not proof that a vehicle component failed.')}</Text>
      <RawRows title={physics.title} rows={visible} columns={columns} tableId="physics:nerves" t={t}
        mobileColumns={['field', 'status']} keyExtractor={(r) => r.field} />
    </Evidence>
  </PhysicsPageShell>;
}
