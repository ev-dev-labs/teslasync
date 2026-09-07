import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { DataProvenanceBadge } from '@/components/data-display';
import { fmtPercent } from '@/lib/numberFormat';
import { useUnits } from '@/hooks/useUnits';
import type { DriveFsdInsight } from '@/types/fsd';
import type { ChartDataPoint, DriveStats } from './types';
import { interpretDriveDebrief, type DebriefBeatId } from './drivePhysicsDebrief';

const BEAT_COPY: Record<DebriefBeatId, { key: string; fallback: string }> = {
  launch: {
    key: 'driveDetail.debrief.launch',
    fallback: 'Launch load showed up on the inverter. This is peak power, not a 0–60 claim.',
  },
  regen: {
    key: 'driveDetail.debrief.regen',
    fallback: 'Regen harvested energy back into the pack. One-pedal is not blended pads.',
  },
  blended: {
    key: 'driveDetail.debrief.blended',
    fallback: 'Friction-pad blend is not in this telemetry. Missing, not zero.',
  },
  thermal: {
    key: 'driveDetail.debrief.thermal',
    fallback: 'Stator derate was not measured on this drive. Missing, not cool.',
  },
  fsd: {
    key: 'driveDetail.debrief.fsd',
    fallback: 'Supervised-driving km come from the trip meter, not engagement segments.',
  },
  gap: {
    key: 'driveDetail.debrief.gap',
    fallback: 'This drive has no power samples. The story would be fanfic.',
  },
};

export function DrivePhysicsDebriefPanel({
  stats,
  chartData,
  fsdInsight,
}: {
  stats: DriveStats | null;
  chartData: ChartDataPoint[];
  fsdInsight: DriveFsdInsight | undefined;
}) {
  const { t } = useTranslation();
  const { formatPower } = useUnits();
  const debrief = interpretDriveDebrief(stats, chartData, fsdInsight);
  const provenance = debrief.beats.some((beat) => beat.honesty === 'missing' && beat.id === 'gap')
    ? 'unknown'
    : 'historical';

  return (
    <GlassPanel className="space-y-3 p-4 sm:p-5" data-testid="drive-physics-debrief">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="mb-0 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('driveDetail.debrief.title', 'Post-drive physics')}
        </PanelTitle>
        <DataProvenanceBadge provenance={provenance} />
      </div>
      <Text as="p" variant="caption">
        {t(
          'driveDetail.debrief.subtitle',
          'One story after the drive: launch vs regen vs pads vs thermal vs FSD km. Not more gauges.',
        )}
      </Text>
      <div className="flex flex-wrap gap-2">
        {debrief.peakPowerKw != null && (
          <Badge variant="info" size="sm">
            {t('driveDetail.debrief.peak', 'Peak {{power}}', {
              power: formatPower(debrief.peakPowerKw * 1000),
            })}
          </Badge>
        )}
        {debrief.regenShare != null && (
          <Badge variant="success" size="sm">
            {t('driveDetail.debrief.regenShare', 'Regen {{share}}', {
              share: fmtPercent(debrief.regenShare * 100, 0),
            })}
          </Badge>
        )}
        {debrief.fsdSharePct != null ? (
          <Badge variant="info" size="sm">
            {t('driveDetail.debrief.fsdShare', 'FSD {{share}}', {
              share: fmtPercent(debrief.fsdSharePct, 0),
            })}
          </Badge>
        ) : (
          <Badge variant="neutral" size="sm">
            {t('driveDetail.debrief.fsdUnknown', 'FSD km unknown')}
          </Badge>
        )}
        {debrief.resetAffected && (
          <Badge variant="warning" size="sm">
            {t('driveDetail.debrief.reset', 'Counter reset')}
          </Badge>
        )}
      </div>
      <ol className="space-y-2">
        {debrief.beats.map((beat) => (
          <li key={beat.id}>
            <Text as="p" variant="bodySm">
              {t(BEAT_COPY[beat.id].key, BEAT_COPY[beat.id].fallback)}
              {' '}
              <span className="text-[var(--text-muted)]">({beat.honesty})</span>
            </Text>
          </li>
        ))}
      </ol>
    </GlassPanel>
  );
}
