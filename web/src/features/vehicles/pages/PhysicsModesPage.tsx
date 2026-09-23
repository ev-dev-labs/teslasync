import { Link } from 'react-router-dom';
import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { Badge, Text } from '@/components/ui';
import { Evidence } from '../components/tesla-physics/Evidence';
import { PhysicsPageShell, time, unknown, usePhysicsPage, yesNo } from '../components/tesla-physics/PhysicsPageShell';

export default function PhysicsModesPage() {
  const physics = usePhysicsPage('modes');
  const { report, t } = physics;
  const modes = report?.modes;
  const active = [modes?.valet, modes?.service, modes?.transport].filter((v) => v === true).length;
  const unknowns = [modes?.valet, modes?.service, modes?.transport].filter((v) => v == null).length;
  const meterDrops = report?.meters?.resets;
  const uncertainDrops = meterDrops?.filter((row) => row.unknown).length;
  const versions = report?.firmware_epochs?.epochs ?? [];
  return <PhysicsPageShell physics={physics}>
    <Evidence title={physics.title} honesty={modes?.honesty}>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.valet', 'Valet')} value={yesNo(modes?.valet, t)} color="cyan" />
        <MetricCard label={t('teslaOnly.service', 'Service')} value={yesNo(modes?.service, t)} color="amber" />
        <MetricCard label={t('teslaOnly.transport', 'Transport')} value={yesNo(modes?.transport, t)} color="purple" />
      </Grid>
      <div className="flex flex-wrap gap-2">
        <Badge variant="neutral" size="sm">{t('teslaOnly.modesActiveCount', 'Observed active modes: {{count}}', { count: unknowns === 3 ? unknown(t) : active })}</Badge>
        <Badge variant="warning" size="sm">{t('teslaOnly.modesUnknownCount', 'Unknown mode fields: {{count}}', { count: unknowns })}</Badge>
        <Badge variant="neutral" size="sm">{t('teslaOnly.modesDrops', 'Returned counter drops for comparison: {{count}}', { count: meterDrops?.length ?? t('teslaOnly.unknown', 'unknown') })}</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-[var(--glass-border)] p-3">
          <Text as="p" variant="bodySm">{t('teslaOnly.allowed', 'Allowed')}</Text>
          {(modes?.allowed ?? []).length ? (modes?.allowed ?? []).map((rule, index) => <Text key={`${index}-${rule}`} as="p" variant="caption">{rule}</Text>) :
            <Text as="p" variant="caption">{t('teslaOnly.modesNoAllowed', 'No allowed interpretations returned.')}</Text>}
        </div>
        <div className="space-y-2 rounded-lg border border-[var(--glass-border)] p-3">
          <Text as="p" variant="bodySm">{t('teslaOnly.forbidden', 'Forbidden')}</Text>
          {(modes?.forbidden ?? []).length ? (modes?.forbidden ?? []).map((rule, index) => <Text key={`${index}-${rule}`} as="p" variant="caption">{rule}</Text>) :
            <Text as="p" variant="caption">{t('teslaOnly.modesNoForbidden', 'No forbidden interpretations returned.')}</Text>}
        </div>
      </div>
      <Text as="p" variant="caption">{t('teslaOnly.modeNote', 'Mode fields are returned observations. An unknown flag is not false, and a rule is an interpretation boundary, not proof of what the vehicle did between readings. Compare meter drops and firmware changes.')}</Text>
    </Evidence>
    <Evidence title={t('teslaOnly.modesCrossCheck', 'Counter and firmware cross-check')}>
      <div className="flex flex-wrap gap-2">
        <Badge variant="neutral" size="sm">{t('teslaOnly.modesUncertainDrops', 'Meter drops with unknown cause: {{count}}', { count: uncertainDrops ?? unknown(t) })}</Badge>
        <Badge variant="neutral" size="sm">{t('teslaOnly.modesVersionCount', 'Returned firmware epochs: {{count}}', { count: report?.firmware_epochs ? versions.length : unknown(t) })}</Badge>
        <Badge variant="neutral" size="sm">{t('teslaOnly.modesLatestFirmware', 'Last observed firmware: {{value}}', { value: versions.length ? versions[versions.length - 1].version : unknown(t) })}</Badge>
      </div>
      {meterDrops ? meterDrops.length ? meterDrops.slice(-5).reverse().map((row) =>
        <Text key={`${row.meter}-${row.at}`} as="p" variant="bodySm">{t('teslaOnly.modesDropReading', '{{meter}} drop at {{at}}: classified {{cause}}', {
          meter: row.meter, at: time(row.at, t), cause: row.cause || unknown(t),
        })}</Text>) : <Text as="p" variant="bodySm">{t('teslaOnly.modesNoDrops', 'No meter drops in returned evidence; no historical mode conclusion follows.')}</Text>
        : <Text as="p" variant="bodySm">{t('teslaOnly.modesMeterMissing', 'Meter evidence was not returned; mode context cannot be cross-checked against counter drops.')}</Text>}
      <Text as="p" variant="caption">{t('teslaOnly.modesCrossCaution', 'No historical mode-at-drop series is provided. A current Valet, Service or Transport flag cannot be assigned to a past counter change or firmware version.')}</Text>
      <div className="flex flex-wrap gap-4">
        <Link to="/tesla-physics/meters" className="text-[var(--theme-primary)] underline-offset-4 hover:underline">{t('teslaOnly.modesOpenMeters', 'Inspect before/after meter evidence')} →</Link>
        <Link to="/tesla-physics/firmware-epochs" className="text-[var(--theme-primary)] underline-offset-4 hover:underline">{t('teslaOnly.modesOpenEpochs', 'Inspect observed firmware epochs')} →</Link>
      </div>
    </Evidence>
  </PhysicsPageShell>;
}
