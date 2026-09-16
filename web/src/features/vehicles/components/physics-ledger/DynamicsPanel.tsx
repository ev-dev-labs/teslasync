import type {
  PhysicsLedger
} from '@/api/types';
import { Badge, Caption, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { unknownLabel, useT } from './helpers';
import { MotionCharts } from './MotionCharts';

export function DynamicsPanel({ ledger }: { ledger: PhysicsLedger }) {
  const t = useT();
  const { formatEnergy, formatSpeed } = useUnits();
  const d = ledger.dynamics;
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-dynamics">
      <PanelTitle>{t('physicsLedger.dynamics.title', 'Longitudinal dynamics')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {d.honesty}
      </Text>
      <div className="flex flex-wrap gap-2">
        <Badge variant={d.unknown ? 'warning' : 'success'} size="sm">
          {t('physicsLedger.massSource', 'mass')}: {d.mass_source}
          {d.mass_kg != null ? ` (${fmtNumber(d.mass_kg, 0)} kg)` : ''}
        </Badge>
        <Badge variant="neutral" size="sm">
          {t('physicsLedger.dynamics.regen', 'Regen')}: {d.regen_wh != null ? formatEnergy(d.regen_wh) : unknownLabel(t)}
        </Badge>
        <Badge variant="neutral" size="sm">
          {t('physicsLedger.dynamics.friction', 'Friction brake')}:{' '}
          {d.friction_brake_wh != null ? formatEnergy(d.friction_brake_wh) : unknownLabel(t)}
        </Badge>
      </div>
      {d.points.length > 1 ? (
        <MotionCharts points={d.points} />
      ) : (
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.dynamics.empty', 'No motion samples were recorded in this window.')}
        </Text>
      )}
      <Caption>
        {t('physicsLedger.dynamics.speedNote', 'Speed shown in display units')}: {formatSpeed(d.points[0]?.speed_mps)}
      </Caption>
    </GlassPanel>
  );
}
