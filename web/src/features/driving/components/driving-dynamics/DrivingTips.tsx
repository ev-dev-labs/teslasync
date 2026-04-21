import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbulb, ShieldCheck, AlertTriangle } from 'lucide-react';

import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { cn } from '@/lib/cn';
import type { MotorStats, ThrottleStyle } from './helpers';

interface DrivingTipsProps {
  motorStats: MotorStats | null;
  throttleStyle: ThrottleStyle | null;
}

export default function DrivingTips({ motorStats, throttleStyle }: DrivingTipsProps) {
  const { t } = useTranslation();

  const tips = useMemo(() => {
    const list: string[] = [];
    if (!motorStats) {
      list.push(t('dynamics.tipNoData', 'Drive your vehicle to start collecting dynamics data.'));
      return list;
    }
    if (motorStats.avgPedalPosition > 55) {
      list.push(t('dynamics.tipEaseAccel', 'Ease into the accelerator — gradual inputs save energy and tire wear.'));
      list.push(t('dynamics.tipBrakeEarly', 'Brake earlier and lighter to improve regen capture.'));
    } else if (motorStats.avgPedalPosition > 25) {
      list.push(t('dynamics.tipSmoothThrottle', 'Smooth throttle transitions can improve efficiency by 10–15%.'));
      list.push(t('dynamics.tipCoast', 'Lift off the pedal earlier to let regen do the work.'));
    } else {
      list.push(t('dynamics.tipGreat', 'Excellent driving style! Maintaining this maximizes range and comfort.'));
      list.push(t('dynamics.tipKeep', 'Keep monitoring your scores — consistency is key.'));
    }
    if (motorStats.maxStatorTemp > 120) {
      list.push(t('dynamics.tipThermal', 'Motor temps are running high — consider easing off sustained high power.'));
    }
    return list;
  }, [motorStats, t]);

  return (
    <FadeIn delay={0.6}>
      <GlassPanel className="p-6">
        <div className="mb-4 flex items-center gap-3">
          <Lightbulb className="h-5 w-5 text-yellow-400" />
          <h2 className="text-lg font-semibold text-white/90">
            {t('dynamics.recommendations', 'Driving Style Recommendations')}
          </h2>
        </div>
        <div className="space-y-3">
          {tips.map((tip, i) => (
            <div
              key={i}
              className={cn(
                'flex items-start gap-3 rounded-lg p-3',
                'bg-white/[0.03] border border-white/[0.06]',
              )}
            >
              {throttleStyle === 'conservative' ? (
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
              )}
              <span className="text-sm text-white/70">{tip}</span>
            </div>
          ))}
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
