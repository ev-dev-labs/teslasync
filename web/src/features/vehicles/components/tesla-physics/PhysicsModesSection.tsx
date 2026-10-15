import { Link } from 'react-router-dom';
import { PhysicsEvidenceBrief } from '../operationalbrief-n-z/PhysicsEvidenceBrief';
import { Text } from '@/components/ui';
import { Evidence } from './Evidence';
import { type PhysicsPage, time, unknown, yesNo } from './PhysicsPageShell';

export default function PhysicsModesSection({ physics }: { physics: PhysicsPage }) {
  const { report, t } = physics;
  const modes = report?.modes;
  const active = [modes?.valet, modes?.service, modes?.transport].filter((v) => v === true).length;
  const unknowns = [modes?.valet, modes?.service, modes?.transport].filter((v) => v == null).length;
  const meterDrops = report?.meters?.resets;
  const uncertainDrops = meterDrops?.filter((row) => row.unknown).length;
  const versions = report?.firmware_epochs?.epochs ?? [];
  return <>
    <Evidence title={physics.title} honesty={modes?.honesty}>
      <PhysicsEvidenceBrief physics={physics} id="physics-modes-summary" available={modes != null}
        description={t('teslaOnly.modeNote', 'Mode fields are returned observations. An unknown flag is not false, and a rule is an interpretation boundary, not proof of what the vehicle did between readings. Compare meter drops and firmware changes.')}
        metrics={[
          { metricId: 'status', occurrenceId: 'valet', label: t('teslaOnly.valet', 'Valet'), rawValue: modes?.valet == null ? null : yesNo(modes.valet, t) },
          { metricId: 'status', occurrenceId: 'service', label: t('teslaOnly.service', 'Service'), rawValue: modes?.service == null ? null : yesNo(modes.service, t) },
          { metricId: 'status', occurrenceId: 'transport', label: t('teslaOnly.transport', 'Transport'), rawValue: modes?.transport == null ? null : yesNo(modes.transport, t) },
          { metricId: 'count', occurrenceId: 'active', label: t('teslaOnly.modesActiveLabel', 'Observed active modes'), rawValue: unknowns === 3 ? null : active, context: t('teslaOnly.modesActiveCount', 'Observed active modes: {{count}}', { count: unknowns === 3 ? unknown(t) : active }) },
          { metricId: 'count', occurrenceId: 'unknown', label: t('teslaOnly.modesUnknownLabel', 'Unknown mode fields'), rawValue: modes ? unknowns : null, context: t('teslaOnly.modesUnknownCount', 'Unknown mode fields: {{count}}', { count: unknowns }) },
          { metricId: 'count', occurrenceId: 'drops', label: t('teslaOnly.modesDropsLabel', 'Returned counter drops for comparison'), rawValue: meterDrops?.length, context: t('teslaOnly.modesDrops', 'Returned counter drops for comparison: {{count}}', { count: meterDrops?.length ?? unknown(t) }) },
        ]} />
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
    </Evidence>
    <Evidence title={t('teslaOnly.modesCrossCheck', 'Counter and firmware cross-check')}>
      <PhysicsEvidenceBrief physics={physics} id="physics-modes-crosscheck" available={meterDrops != null && report?.firmware_epochs != null}
        description={t('teslaOnly.modesCrossCaution', 'No historical mode-at-drop series is provided. A current valet, service or transport flag cannot be assigned to a past counter change or firmware version.')}
        metrics={[
          { metricId: 'count', occurrenceId: 'uncertain-drops', label: t('teslaOnly.modesUncertainDropsLabel', 'Meter drops with unknown cause'), rawValue: uncertainDrops, context: t('teslaOnly.modesUncertainDrops', 'Meter drops with unknown cause: {{count}}', { count: uncertainDrops ?? unknown(t) }) },
          { metricId: 'count', occurrenceId: 'epochs', label: t('teslaOnly.epochCount', 'Observed firmware epochs'), rawValue: report?.firmware_epochs ? versions.length : null, context: t('teslaOnly.modesVersionCount', 'Returned firmware epochs: {{count}}', { count: report?.firmware_epochs ? versions.length : unknown(t) }) },
          { metricId: 'text', occurrenceId: 'firmware', label: t('teslaOnly.firmware', 'Firmware'), rawValue: versions.length ? versions[versions.length - 1].version : null, context: t('teslaOnly.modesLatestFirmware', 'Last observed firmware: {{value}}', { value: versions.length ? versions[versions.length - 1].version : unknown(t) }) },
        ]} />
      {meterDrops ? meterDrops.length ? meterDrops.slice(-5).reverse().map((row) =>
        <Text key={`${row.meter}-${row.at}`} as="p" variant="bodySm">{t('teslaOnly.modesDropReading', '{{meter}} drop at {{at}}: classified {{cause}}', {
          meter: row.meter, at: time(row.at, t), cause: row.cause || unknown(t),
        })}</Text>) : <Text as="p" variant="bodySm">{t('teslaOnly.modesNoDrops', 'No meter drops in returned evidence; no historical mode conclusion follows.')}</Text>
        : <Text as="p" variant="bodySm">{t('teslaOnly.modesMeterMissing', 'Meter evidence was not returned; mode context cannot be cross-checked against counter drops.')}</Text>}
      <div className="flex flex-wrap gap-4">
        <Link to="/tesla-physics/meters" className="text-[var(--theme-primary)] underline-offset-4 hover:underline">{t('teslaOnly.modesOpenMeters', 'Inspect before/after meter evidence')} →</Link>
        <Link to="/tesla-physics/firmware-epochs" className="text-[var(--theme-primary)] underline-offset-4 hover:underline">{t('teslaOnly.modesOpenEpochs', 'Inspect observed firmware epochs')} →</Link>
      </div>
    </Evidence>
  </>;
}
