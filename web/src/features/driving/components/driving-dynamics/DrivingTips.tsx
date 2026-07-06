import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Lightbulb, ShieldCheck, type LucideIcon } from 'lucide-react';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { MotorStats } from './helpers';

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
  motorStats: MotorStats | null;
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

export default function DrivingTips({ motorStats }: DrivingTipsProps) {
  const { t } = useTranslation();

  const tips = useMemo<Tip[]>(() => {
    const list: Tip[] = [];

    if (!motorStats) {
      list.push({
        id: 'no-data',
        tone: 'info',
        text: t('dynamics.tipNoData', 'Drive your vehicle to start collecting dynamics data.'),
      });
      return list;
    }

    const avgPower = motorStats.avgPower ?? 0;
    const maxMotorTemp = motorStats.maxMotorTemp ?? 0;

    if (avgPower > 80) {
      list.push({
        id: 'ease-accel',
        tone: 'caution',
        text: t('dynamics.tipEaseAccel', 'Ease into the accelerator — gradual inputs save energy and tire wear.'),
      });
      list.push({
        id: 'brake-early',
        tone: 'caution',
        text: t('dynamics.tipBrakeEarly', 'Brake earlier and lighter to improve regen capture.'),
      });
    } else if (avgPower > 20) {
      list.push({
        id: 'smooth-throttle',
        tone: 'caution',
        text: t('dynamics.tipSmoothThrottle', 'Smooth throttle transitions can improve efficiency by 10–15%.'),
      });
      list.push({
        id: 'coast',
        tone: 'caution',
        text: t('dynamics.tipCoast', 'Lift off the pedal earlier to let regen do the work.'),
      });
    } else {
      list.push({
        id: 'great',
        tone: 'positive',
        text: t('dynamics.tipGreat', 'Excellent driving style! Maintaining this maximizes range and comfort.'),
      });
      list.push({
        id: 'keep',
        tone: 'positive',
        text: t('dynamics.tipKeep', 'Keep monitoring your scores — consistency is key.'),
      });
    }

    if (maxMotorTemp > 120) {
      list.push({
        id: 'thermal',
        tone: 'caution',
        text: t('dynamics.tipThermal', 'Motor temps are running high — consider easing off sustained high power.'),
      });
    }

    return list;
  }, [motorStats, t]);

  return (
    <GlassPanel className="h-full p-4 sm:p-5">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {t('dynamics.recommendations', 'Driving Style Recommendations')}
      </PanelTitle>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tips.map((tip) => {
          const Icon = TONE_ICON[tip.tone];
          return (
            <li
              key={tip.id}
              data-tone={tip.tone}
              className={cn(
                'flex items-start gap-3 rounded-lg p-3',
                'bg-white/[0.03] border border-white/[0.06]',
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
    </GlassPanel>
  );
}
