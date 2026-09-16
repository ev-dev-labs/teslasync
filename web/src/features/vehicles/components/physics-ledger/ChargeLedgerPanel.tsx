import type {
  PhysicsLedger
} from '@/api/types';
import { Badge, Caption, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { unknownLabel, useT } from './helpers';
import { TermRow } from './TermRow';

export function ChargeLedgerPanel({ ledger }: { ledger: PhysicsLedger }) {
  const t = useT();
  const { formatEnergy, formatDuration } = useUnits();
  const c = ledger.charge;
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-charge">
      <PanelTitle>{t('physicsLedger.charge.title', 'Charge physics')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {c.honesty}
      </Text>
      <div className="flex flex-wrap gap-2">
        <Badge variant={c.unplugged ? 'success' : 'neutral'} size="sm">
          {c.unplugged ? t('physicsLedger.charge.unplugged', 'Unplugged') : t('physicsLedger.charge.stillPlugged', 'Still plugged / unknown')}
        </Badge>
        {c.dwell_complete_s != null ? (
          <Badge variant="neutral" size="sm">
            {t('physicsLedger.charge.dwell', 'Complete dwell')}: {formatDuration(c.dwell_complete_s)}
          </Badge>
        ) : null}
      </div>
      <div className="divide-y divide-[var(--border-default)]">
        <div className="flex items-baseline justify-between gap-3 py-1.5">
          <Text as="span" size="sm">
            {t('physicsLedger.charge.added', 'Energy added')}
          </Text>
          <Text as="span" size="sm" className="tabular-nums">
            {c.energy_added_wh != null ? formatEnergy(c.energy_added_wh) : unknownLabel(t)}
          </Text>
        </div>
        <TermRow label={t('physicsLedger.charge.wall', 'Wall energy')} term={c.wall_wh} format={(v) => formatEnergy(v)} />
        <TermRow label={t('physicsLedger.charge.precondition', 'Preconditioning')} term={c.precondition_wh} format={(v) => formatEnergy(v)} />
      </div>
      <Caption>
        {t('physicsLedger.charge.efficiency', 'Efficiency')}:{' '}
        {c.efficiency_known && c.efficiency_pct != null ? `${fmtNumber(c.efficiency_pct, 1)} %` : unknownLabel(t)}
        {' · '}
        {t('physicsLedger.drive.session', 'Session')}: {c.session_wh != null ? formatEnergy(c.session_wh) : unknownLabel(t)}
      </Caption>
    </GlassPanel>
  );
}
