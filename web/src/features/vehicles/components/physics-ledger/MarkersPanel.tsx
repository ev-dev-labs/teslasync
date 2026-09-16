import type {
  PhysicsLedger
} from '@/api/types';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import { useT } from './helpers';

export function MarkersPanel({ ledger }: { ledger: PhysicsLedger }) {
  const t = useT();
  const markers = ledger.markers ?? [];
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-markers">
      <PanelTitle>{t('physicsLedger.markers.title', 'Chapter markers')}</PanelTitle>
      {markers.length === 0 ? (
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.markers.empty', 'No drive or charge boundaries in this window.')}
        </Text>
      ) : (
        <ol className="space-y-1.5">
          {markers.map((m) => (
            <li key={`${m.kind}-${m.id}-${m.edge}-${m.at}`} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-[var(--text-muted)]">{formatDateTime(m.at)}</span>
              <Badge variant="neutral" size="sm">
                {m.kind} #{m.id}
              </Badge>
              <Badge variant="info" size="sm">
                {m.edge}
              </Badge>
            </li>
          ))}
        </ol>
      )}
    </GlassPanel>
  );
}
