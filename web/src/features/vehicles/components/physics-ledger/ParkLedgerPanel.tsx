import type {
  PhysicsLedger
} from '@/api/types';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { unknownLabel, useT } from './helpers';
import { TermRow } from './TermRow';

export function ParkLedgerPanel({ ledger }: { ledger: PhysicsLedger }) {
  const t = useT();
  const { formatEnergy, formatPower, formatDuration } = useUnits();
  const p = ledger.park;
  if (!p) {
    return (
      <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-park">
        <PanelTitle>{t('physicsLedger.park.title', 'Park / vampire physics')}</PanelTitle>
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.park.empty', 'No Park interval in this window.')}
        </Text>
      </GlassPanel>
    );
  }
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-park">
      <PanelTitle>{t('physicsLedger.park.title', 'Park / vampire physics')}</PanelTitle>
      <Text as="p" size="sm" color="secondary">
        {p.honesty}
      </Text>
      <div className="flex flex-wrap gap-2">
        <Badge variant={p.trusted ? 'success' : 'danger'} size="sm">
          {p.trusted ? t('physicsLedger.park.trusted', 'Park trusted') : t('physicsLedger.park.untrusted', 'Park untrusted')}
        </Badge>
        <Badge variant="neutral" size="sm">
          {formatDuration(p.duration_s)}
        </Badge>
        {p.plugged_at_limit ? (
          <Badge variant="info" size="sm">
            {t('physicsLedger.park.pluggedAtLimit', 'Plugged at limit')}
          </Badge>
        ) : null}
      </div>
      <div className="divide-y divide-[var(--border-default)]">
        <div className="flex items-baseline justify-between gap-3 py-1.5">
          <Text as="span" size="sm">
            {t('physicsLedger.park.avgWatts', 'Average drain')}
          </Text>
          <Text as="span" size="sm" className="tabular-nums">
            {p.avg_watts_w != null ? formatPower(p.avg_watts_w) : unknownLabel(t)}
          </Text>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-1.5">
          <Text as="span" size="sm">
            {t('physicsLedger.park.energy', 'Park energy')}
          </Text>
          <Text as="span" size="sm" className="tabular-nums">
            {p.energy_wh != null ? formatEnergy(p.energy_wh) : unknownLabel(t)}
          </Text>
        </div>
        <TermRow label={t('physicsLedger.park.sentry', 'Sentry')} term={p.sentry_wh} format={(v) => formatEnergy(v)} />
        <TermRow label={t('physicsLedger.park.cabin', 'Cabin overheat')} term={p.cabin_overheat_wh} format={(v) => formatEnergy(v)} />
        <TermRow label={t('physicsLedger.park.precondition', 'Preconditioning')} term={p.precondition_wh} format={(v) => formatEnergy(v)} />
        <TermRow label={t('physicsLedger.park.quiet', 'Quiet pack')} term={p.quiet_pack_wh} format={(v) => formatEnergy(v)} />
      </div>
    </GlassPanel>
  );
}
