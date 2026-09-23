import { useState } from 'react';
import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { Badge, Select, Text } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import { Evidence, RawRows } from '../components/tesla-physics/Evidence';
import { PhysicsPageShell, time, unknown, usePhysicsPage, yesNo } from '../components/tesla-physics/PhysicsPageShell';

export default function PhysicsChargePortPage() {
  const physics = usePhysicsPage('charge-port');
  const { report, t } = physics;
  const port = report?.charge_port_court;
  const rows = port?.evidence ?? [];
  const byState = [...new Set(rows.map((r) => r.charge_state || unknown(t)))];
  const noCurrent = rows.filter((r) => r.pack_current_a == null).length;
  const [filter, setFilter] = useState('');
  const selected = byState.includes(filter) ? filter : '';
  const ordered = [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const last = ordered.length ? ordered[ordered.length - 1] : undefined;
  const transitions = ordered.filter((row, index) => index > 0 && row.charge_state !== ordered[index - 1].charge_state);
  const disconnected = rows.filter((row) => row.charge_state === 'Disconnected').length;
  const visible = selected ? ordered.filter((row) => (row.charge_state || unknown(t)) === selected) : ordered;
  const columns = [
    { key: 'at', header: t('teslaOnly.started', 'Started'), render: (r: typeof rows[number]) => time(r.at, t) },
    { key: 'state', header: t('teslaOnly.chargeState', 'Charge state'), render: (r: typeof rows[number]) => r.charge_state || unknown(t) },
    { key: 'gear', header: t('teslaOnly.gear', 'Gear'), render: (r: typeof rows[number]) => r.gear || unknown(t) },
    { key: 'firmware', header: t('teslaOnly.firmware', 'Firmware'), render: (r: typeof rows[number]) => r.firmware || unknown(t) },
    { key: 'current', header: t('teslaOnly.packCurrent', 'Pack current'), render: (r: typeof rows[number]) => r.pack_current_a == null ? unknown(t) : `${fmtNumber(r.pack_current_a, 1)} A` },
    { key: 'latch', header: t('teslaOnly.latch', 'Latch'), render: (r: typeof rows[number]) => r.latch || unknown(t) },
    { key: 'door', header: t('teslaOnly.door', 'Door'), render: (r: typeof rows[number]) => yesNo(r.door_open, t) },
    { key: 'schedule', header: t('teslaOnly.scheduleMode', 'Schedule mode'), render: (r: typeof rows[number]) => r.scheduled_mode || unknown(t) },
  ];
  return <PhysicsPageShell physics={physics}>
    <Evidence title={physics.title} honesty={port?.honesty}>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.portSamples', 'Returned port samples')} value={rows.length} color="cyan" />
        <MetricCard label={t('teslaOnly.workbench.latestChargeState', 'Latest returned charge state')} value={last?.charge_state || unknown(t)} color="green" />
        <MetricCard label={t('teslaOnly.workbench.latestCurrent', 'Latest returned pack current')} value={last?.pack_current_a == null ? unknown(t) : `${fmtNumber(last.pack_current_a, 1)} A`} color="amber" />
      </Grid>
      <Text as="p" variant="bodySm">{t('teslaOnly.workbench.portContext', 'Latest gear {{gear}} · firmware {{firmware}} · latch {{latch}} · schedule {{schedule}}', {
        gear: last?.gear || unknown(t), firmware: last?.firmware || unknown(t), latch: last?.latch || unknown(t), schedule: last?.scheduled_mode || unknown(t),
      })}</Text>
      <div className="flex flex-wrap gap-2">
        {byState.map((state) => <Badge key={state} variant="neutral" size="sm">{state}: {rows.filter((r) => (r.charge_state || unknown(t)) === state).length}</Badge>)}
        <Badge variant="warning" size="sm">{t('teslaOnly.portUnknownCurrent', 'Samples without current: {{count}}', { count: noCurrent })}</Badge>
      </div>
      <Text as="p" variant="caption">{t('teslaOnly.portNote', 'Compare adjacent state, latch, current, and schedule samples before treating a paused charge as unplugged. Only Disconnected marks unplugging. Park and firmware come from the same returned reading, not a continuous signal.')}</Text>
    </Evidence>
    <Evidence title={t('teslaOnly.portTransitions', 'Charge-port transitions and schedule context')}>
      <div className="flex flex-wrap gap-2">
        <Badge variant="neutral" size="sm">{t('teslaOnly.portChanges', 'Observed charge-state changes: {{count}}', { count: transitions.length })}</Badge>
        <Badge variant="neutral" size="sm">{t('teslaOnly.portDisconnects', 'Disconnected readings: {{count}}', { count: disconnected })}</Badge>
        <Badge variant="neutral" size="sm">{t('teslaOnly.portSchedule', 'Latest recorded schedule: {{value}}', { value: last?.scheduled_mode || unknown(t) })}</Badge>
      </div>
      {transitions.length ? transitions.slice(-5).reverse().map((row) => <Text key={row.at} as="p" variant="bodySm">
        {t('teslaOnly.portChangeReading', '{{at}}: {{state}} · latch {{latch}} · gear {{gear}} · current {{current}}', {
          at: time(row.at, t), state: row.charge_state || unknown(t), latch: row.latch || unknown(t),
          gear: row.gear || unknown(t), current: row.pack_current_a == null ? unknown(t) : `${fmtNumber(row.pack_current_a, 1)} A`,
        })}</Text>) : <Text as="p" variant="bodySm">{t('teslaOnly.portNoTransitions', 'No charge-state change among returned samples. The first reading is an observed state; missing samples cannot rule out transitions.')}</Text>}
      <Select label={t('teslaOnly.portFilter', 'Filter charge-port samples by state')} value={selected} onChange={(event) => setFilter(event.target.value)}
        options={[{ value: '', label: t('teslaOnly.portAllStates', 'All returned states') }, ...byState.map((state) => ({ value: state, label: state }))]} />
      <RawRows title={physics.title} rows={[...visible].reverse()} columns={columns} tableId="physics:port" t={t}
        mobileColumns={['at', 'state', 'gear', 'firmware', 'latch']} keyExtractor={(r) => r.at} />
    </Evidence>
  </PhysicsPageShell>;
}
