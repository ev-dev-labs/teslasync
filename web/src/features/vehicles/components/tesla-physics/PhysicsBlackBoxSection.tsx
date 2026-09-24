import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { Badge, Text } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import { Evidence, RawRows } from './Evidence';
import { type PhysicsPage, time, unknown, yesNo } from './PhysicsPageShell';

export default function PhysicsBlackBoxSection({ physics }: { physics: PhysicsPage }) {
  const { report, t } = physics;
  const box = report?.black_box;
  const frames = box?.frames ?? [];
  const source = report?.evidence;
  const newest = frames.length ? frames[frames.length - 1] : undefined;
  const knownCurrent = frames.filter((r) => r.pack_current_a != null).length;
  const ordered = [...frames].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const changes = ordered.filter((frame, index) => index > 0 &&
    (frame.charge_state !== ordered[index - 1].charge_state ||
      frame.latch !== ordered[index - 1].latch || frame.gear !== ordered[index - 1].gear));
  const windowSpan = box?.from && box.to && Number.isFinite(Date.parse(box.from)) && Number.isFinite(Date.parse(box.to))
    ? (Date.parse(box.to) - Date.parse(box.from)) / 1000 : null;
  const gears = [...new Set(frames.map((frame) => frame.gear).filter((gear): gear is string => !!gear))];
  const versions = [...new Set(frames.map((frame) => frame.firmware).filter((version): version is string => !!version))];
  return <>
    <Evidence title={physics.title} honesty={box?.honesty}>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.blackBoxTrigger', 'Latest selected trigger')} value={box?.trigger || unknown(t)} color="amber" />
        <MetricCard label={t('teslaOnly.blackBoxFrameCount', 'Returned frames')} value={frames.length} color="cyan" />
        <MetricCard label={t('teslaOnly.blackBoxCurrentCoverage', 'Frames with pack current')} value={frames.length ? `${knownCurrent} / ${frames.length}` : unknown(t)} color="green" />
      </Grid>
      <Text as="p" variant="bodySm">{t('teslaOnly.blackBoxWindow', 'Evidence window: {{from}} to {{to}}', { from: time(box?.from, t), to: time(box?.to, t) })}</Text>
      <Text as="p" variant="bodySm">{t('teslaOnly.blackBoxSpan', 'Selected window span: {{span}}; first returned frame: {{first}}', {
        span: windowSpan != null && windowSpan >= 0 ? `${fmtNumber(windowSpan, 0)} s` : unknown(t), first: time(ordered[0]?.at, t),
      })}</Text>
      <Text as="p" variant="bodySm">{t('teslaOnly.blackBoxLatest', 'Latest returned frame: {{at}} · gear {{gear}} · firmware {{firmware}}', {
        at: time(newest?.at, t), gear: newest?.gear || unknown(t), firmware: newest?.firmware || unknown(t),
      })}</Text>
      {source ? <div className="flex flex-wrap gap-2">
        <Badge variant="neutral" size="sm">{t('teslaOnly.blackBoxSourceRows', '{{count}} bounded source rows; source {{status}}', {
          count: source.black_box_rows, status: source.black_box_available ? t('teslaOnly.sourceAvailable', 'available') : t('teslaOnly.sourceUnavailable', 'unavailable'),
        })}</Badge>
        {source.black_box_truncated && <Badge variant="warning" size="sm">{t('teslaOnly.blackBoxPartial', 'Black-box row cap reached: frames and selected trigger may omit earlier evidence')}</Badge>}
        {!source.black_box_available && <Badge variant="warning" size="sm">{t('teslaOnly.blackBoxMissing', 'Black-box source unavailable: an empty frame list cannot exclude an event')}</Badge>}
        {(!source.history_available || source.history_truncated) && <Badge variant="warning" size="sm">{t('teslaOnly.blackBoxTriggerPartial', 'Trigger selection may be incomplete because report history is unavailable or capped')}</Badge>}
      </div> : <Text as="p" variant="caption">{t('teslaOnly.scopeUnavailable', 'Evidence coverage metadata was not returned; counts cannot establish completeness.')}</Text>}
      <Text as="p" variant="caption">{t('teslaOnly.blackBoxNote', 'Only the latest selected trigger is shown. Empty frames mean no sample in this 90-second window, not that no event occurred.')}</Text>
    </Evidence>
    <Evidence title={t('teslaOnly.blackBoxFrameChanges', 'Frame changes inside the selected window')}>
      <div className="flex flex-wrap gap-2">
        <Badge variant="neutral" size="sm">{t('teslaOnly.blackBoxChanges', '{{count}} observed state, latch or gear changes after the first frame', { count: changes.length })}</Badge>
        <Badge variant="neutral" size="sm">{t('teslaOnly.blackBoxKnownGear', 'Recorded gears: {{values}}', { values: gears.length ? gears.join(', ') : unknown(t) })}</Badge>
        <Badge variant="neutral" size="sm">{t('teslaOnly.blackBoxKnownFirmware', 'Recorded firmware: {{values}}', { values: versions.length ? versions.join(', ') : unknown(t) })}</Badge>
      </div>
      {changes.length ? changes.slice(-5).reverse().map((frame) =>
        <Text key={frame.at} as="p" variant="bodySm">{t('teslaOnly.blackBoxChangeRow', '{{at}}: {{state}} / {{latch}} / gear {{gear}}', {
          at: time(frame.at, t), state: frame.charge_state || unknown(t), latch: frame.latch || unknown(t), gear: frame.gear || unknown(t),
        })}</Text>) : <Text as="p" variant="bodySm">{t('teslaOnly.blackBoxNoChanges', 'No changes among returned frames; missing or sparse frames cannot rule out events.')}</Text>}
      <Text as="p" variant="caption">{t('teslaOnly.blackBoxChangeCaution', 'The first frame establishes observed state, not the start of a transition. Compare event timestamps before interpreting a change as causal.')}</Text>
      <RawRows title={physics.title} rows={frames} tableId="physics:black-box" t={t} keyExtractor={(r) => r.at}
        mobileColumns={['at', 'state', 'gear', 'firmware', 'current']} columns={[
          { key: 'at', header: t('teslaOnly.started', 'Started'), render: (r) => time(r.at, t) },
          { key: 'state', header: t('teslaOnly.chargeState', 'Charge state'), render: (r) => r.charge_state || unknown(t) },
          { key: 'gear', header: t('teslaOnly.gear', 'Gear'), render: (r) => r.gear || unknown(t) },
          { key: 'firmware', header: t('teslaOnly.firmware', 'Firmware'), render: (r) => r.firmware || unknown(t) },
          { key: 'latch', header: t('teslaOnly.latch', 'Latch'), render: (r) => r.latch || unknown(t) },
          { key: 'door', header: t('teslaOnly.door', 'Door'), render: (r) => yesNo(r.door_open, t) },
          { key: 'current', header: t('teslaOnly.packCurrent', 'Pack current'), render: (r) => r.pack_current_a == null ? unknown(t) : `${fmtNumber(r.pack_current_a, 1)} A` },
          { key: 'schedule', header: t('teslaOnly.scheduleMode', 'Schedule mode'), render: (r) => r.scheduled_mode || unknown(t) },
        ]} />
    </Evidence>
  </>;
}
