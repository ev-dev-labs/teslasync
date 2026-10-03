import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { DataProvenanceBadge } from '@/components/data-display';

import type { DriveFsdInsight } from '@/types/fsd';
import type { ChartDataPoint, DriveStats } from './types';
import { interpretDriveDebrief, type DebriefBeatId } from './drivePhysicsDebrief';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
    fallback: 'Supervised-driving distance comes from the trip meter, not engagement segments.',
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
  const { fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
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
          'Power, regen, brake, thermal and FSD evidence. Missing signals remain unknown.',
        )}
      </Text>
      <div className="flex flex-wrap gap-2">
        {debrief.regenShare != null && (
          <Badge variant="success" size="sm">
            {t('driveDetail.report.regenShareEstimate', 'Estimated regen ratio {{share}}', {
              share: fmtPercent(debrief.regenShare * 100),
            })}
          </Badge>
        )}
        {debrief.fsdSharePct == null ? (
          <Badge variant="neutral" size="sm">
            {t('driveDetail.debrief.fsdUnknown', 'FSD km unknown')}
          </Badge>
        ) : null}
        {debrief.resetAffected && (
          <Badge variant="warning" size="sm">
            {t('driveDetail.debrief.reset', 'Counter reset')}
          </Badge>
        )}
      </div>
      {debrief.regenShare != null ? (
        <Text as="p" variant="caption">{t('driveDetail.report.regenRatioMethod', 'Recovered / (consumed + recovered), using drive-summary energy sources. This ratio is not a metered braking-efficiency measurement.')}</Text>
      ) : null}
      <ol className="space-y-2">
        {debrief.beats.map((beat) => (
          <li key={beat.id}>
            <Text as="p" variant="bodySm">
              {t(BEAT_COPY[beat.id].key, BEAT_COPY[beat.id].fallback)}
              {' '}
              <span className="text-[var(--text-muted)]">({t(`driveDetail.report.honesty.${beat.honesty}`, {
                defaultValue: beat.honesty === 'live' ? 'Observed' : beat.honesty === 'stale' ? 'Limited evidence' : beat.honesty === 'guessed' ? 'Estimated' : 'Missing',
              })})</span>
            </Text>
          </li>
        ))}
      </ol>
      <Text as="p" variant="caption">
        <a href="#power-trace" className="underline underline-offset-4">{t('driveDetail.powerProfile', 'Power profile')}</a>
        {' · '}<a href="#fsd-evidence" className="underline underline-offset-4">{t('driveDetail.fsd.title', 'Supervised driving')}</a>
      </Text>
    </GlassPanel>
  );
}
