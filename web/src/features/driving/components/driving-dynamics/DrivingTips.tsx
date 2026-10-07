import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Lightbulb, ShieldCheck, type LucideIcon } from 'lucide-react';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';
import type { MotorHistoryQuery } from '@/api/hooks/useVehicles';
import { useMotorStats } from './useMotorStats';

/**
 * Tone drives the per-tip icon. It is derived from the tip itself so the
 * glyph always matches the message: a caution tip never shows a reassuring
 * shield and the "no data yet" prompt never shows a warning triangle.
 */
type TipTone = 'info' | 'positive' | 'caution';

interface Tip {
  id: string;
  text: string;
  tone: TipTone;
}

interface DrivingTipsProps {
  vehicleId: number | null | undefined;
  historyQuery?: MotorHistoryQuery;
}

const TONE_ICON: Record<TipTone, LucideIcon> = {
  info: Lightbulb,
  positive: ShieldCheck,
  caution: AlertTriangle,
};

const TONE_ICON_CLASS: Record<TipTone, string> = {
  info: 'text-sky-300',
  positive: 'text-emerald-300',
  caution: 'text-amber-300',
};

export default function DrivingTips({ vehicleId, historyQuery }: DrivingTipsProps) {
  const { t } = useTranslation();
  const query = useMotorStats(vehicleId, historyQuery);
  const { motorStats } = query;

  const tips = useMemo<Tip[]>(() => {
    const list: Tip[] = [];

    if (!motorStats) {
      return list;
    }

    if (motorStats.avgPower != null) {
      list.push({
        id: 'power-context',
        tone: 'info',
        text: t('dynamics.guidance.power', 'Compare power peaks with the trip’s speed and road conditions. Average motor power alone cannot tell whether acceleration was smooth or efficient.'),
      });
    }
    if (motorStats.peakRegen != null) {
      list.push({
        id: 'regen-context',
        tone: 'info',
        text: t('dynamics.guidance.regen', 'Review energy recovered alongside energy used. A peak regen reading is not a measure of braking quality, and friction-brake use cannot be reconstructed from motor power.'),
      });
    }
    if (motorStats.maxTorque != null) {
      list.push({
        id: 'torque-context',
        tone: 'info',
        text: t('dynamics.guidance.torque', 'Use the front and rear torque traces to see which axle reported load. Gaps are missing telemetry, not evidence that an axle was inactive.'),
      });
    }
    if (motorStats.maxMotorTemp != null) {
      list.push({
        id: 'thermal-context',
        tone: 'info',
        text: t('dynamics.guidance.thermal', 'Temperature adds context to sustained motor load. Without the vehicle’s limiting signals, these samples do not prove overheating or reduced power.'),
      });
    }

    return list;
  }, [motorStats, t]);

  return (
    <GlassPanel className="h-full p-4 sm:p-5">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {t('dynamics.guidance.title', 'How to read this ride')}
      </PanelTitle>
      {query.isLoading ? <Skeleton className="h-20" /> : query.isError ? (
        <QueryError error={query.error} onRetry={query.refetch} />
      ) : tips.length === 0 ? (
        <EmptyState /* no-action: historical evidence is unavailable for this selection */
          message={t('dynamics.guidance.empty', 'No measured motor evidence available for trip-specific guidance.')}
        />
      ) : (
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tips.map((tip) => {
          const Icon = TONE_ICON[tip.tone];
          return (
            <li
              key={tip.id}
              data-tone={tip.tone}
              className={cn(
                'flex items-start gap-3 rounded-lg p-3',
                'bg-[var(--surface-2)] border border-[var(--border-default)]',
              )}
            >
              <Icon
                className={cn('mt-0.5 h-4 w-4 shrink-0', TONE_ICON_CLASS[tip.tone])}
                aria-hidden="true"
              />
              <Text as="span" size="sm" color="secondary">{tip.text}</Text>
            </li>
          );
        })}
      </ul>
      )}
    </GlassPanel>
  );
}
