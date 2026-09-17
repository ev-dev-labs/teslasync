import type {
  PhysicsLedger
} from '@/api/types';
import { Badge, Caption, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { formatEnergyPerDistance } from '@/lib/unitConversion';
import { unknownLabel, useT } from './helpers';

export function RangePanel({ ledger }: { ledger: PhysicsLedger }) {
  const t = useT();
  const { formatDistance, formatEnergy, unitPrefs } = useUnits();
  const r = ledger.range;
  const dist = (v: number | null | undefined) => (v != null ? formatDistance(v) : unknownLabel(t));
  if (!r) {
    return (
      <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-range">
        <PanelTitle>{t('physicsLedger.range.title', 'Range disagreement')}</PanelTitle>
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.range.empty', 'No range estimators were recorded in this window.')}
        </Text>
      </GlassPanel>
    );
  }
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-range">
      <PanelTitle>{t('physicsLedger.range.title', 'Range disagreement')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {r.honesty}
      </Text>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <Caption>{t('physicsLedger.range.rated', 'Rated')}</Caption>
          <Text as="p" size="sm" className="tabular-nums">
            {dist(r.rated_m)}
          </Text>
        </div>
        <div>
          <Caption>{t('physicsLedger.range.est', 'Typical')}</Caption>
          <Text as="p" size="sm" className="tabular-nums">
            {dist(r.est_m)}
          </Text>
        </div>
        <div>
          <Caption>{t('physicsLedger.range.ideal', 'Ideal')}</Caption>
          <Text as="p" size="sm" className="tabular-nums">
            {dist(r.ideal_m)}
          </Text>
        </div>
        <div>
          <Caption>{t('physicsLedger.range.energy', 'Energy remaining')}</Caption>
          <Text as="p" size="sm" className="tabular-nums">
            {r.energy_wh != null ? formatEnergy(r.energy_wh) : unknownLabel(t)}
          </Text>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant={r.disagree ? 'warning' : 'neutral'} size="sm">
          {t('physicsLedger.range.spread', 'Spread')}: {r.spread_m != null ? formatDistance(r.spread_m) : unknownLabel(t)}
        </Badge>
        {r.implied_wh_per_m != null ? (
          <Badge variant="neutral" size="sm">
            {t('physicsLedger.range.implied', 'Implied')}: {formatEnergyPerDistance(r.implied_wh_per_m, unitPrefs)}
          </Badge>
        ) : null}
      </div>
    </GlassPanel>
  );
}
