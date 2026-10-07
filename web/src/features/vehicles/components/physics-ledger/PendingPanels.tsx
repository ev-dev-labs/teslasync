import { EmptyState, Skeleton } from '@/components/feedback';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { useT } from './helpers';

const sections = [
  ['ledger-summary', 'physicsLedger.title', 'Physics Ledger'],
  ['ledger-dynamics', 'physicsLedger.dynamics.title', 'Longitudinal dynamics'],
  ['ledger-drive', 'physicsLedger.drive.title', 'Drive energy ledger'],
  ['ledger-charge', 'physicsLedger.charge.title', 'Charge physics'],
  ['ledger-park', 'physicsLedger.park.title', 'Park / vampire physics'],
  ['ledger-thermal', 'physicsLedger.thermal.title', 'Thermal'],
  ['ledger-range', 'physicsLedger.range.title', 'Range disagreement'],
  ['ledger-tires', 'physicsLedger.tires.title', 'Tires'],
  ['ledger-epochs', 'physicsLedger.epochs.title', 'Firmware epochs'],
  ['ledger-unknown', 'physicsLedger.unknown.title', 'Unknown budget'],
  ['ledger-blackbox', 'physicsLedger.blackBox.title', 'Black box: last 90 s'],
  ['ledger-markers', 'physicsLedger.markers.title', 'Chapter markers'],
] as const;

export function PendingPanels({ loading }: { loading: boolean }) {
  const t = useT();
  return (
    <div className="space-y-6" aria-busy={loading}>
      {sections.map(([id, key, title]) => (
        <GlassPanel key={id} padding="auto" className="space-y-4" data-testid={id}>
          <PanelTitle>{t(key, title)}</PanelTitle>
          {loading ? <Skeleton className="h-32" /> : (
            <EmptyState message={t('physicsLedger.empty', 'No ledger samples in this window. Drive, charge, or park with telemetry flowing.')} actionTo={{ label: t('physicsLedger.back', 'Tesla Physics'), to: '/tesla-physics' }} />
          )}
        </GlassPanel>
      ))}
    </div>
  );
}
