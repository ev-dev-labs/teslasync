import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { AnimatedNumber, MetricBar } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { fmtNumber } from '@/lib/numberFormat';
import type { MotorSnapshot } from '@/api/types';
import type { MotorStats } from './helpers';
import { gForceColor } from './helpers';

interface GForcePanelProps {
  motorLatest: MotorSnapshot | null | undefined;
  motorStats: MotorStats | null;
}

export default function GForcePanel({ motorLatest, motorStats }: GForcePanelProps) {
  const { t } = useTranslation();

  return (
    <FadeIn delay={0.05}>
      <GlassPanel className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-white/90">
          {t('dynamics.gForce', 'Acceleration G-Force')}
        </h2>
        <Grid cols={{ default: 1, md: 3 }} gap={6}>
          {/* Lateral / Longitudinal values */}
          <div className="flex flex-col gap-4">
            <div>
              <span className="text-xs text-white/50">{t('dynamics.lateralG', 'Lateral G')}</span>
              <AnimatedNumber
                value={motorLatest?.lateral_accel ?? 0}
                decimals={3}
                suffix=" g"
                className="text-3xl font-bold text-white"
              />
            </div>
            <div>
              <span className="text-xs text-white/50">{t('dynamics.longitudinalG', 'Longitudinal G')}</span>
              <AnimatedNumber
                value={motorLatest?.longitudinal_accel ?? 0}
                decimals={3}
                suffix=" g"
                className="text-3xl font-bold text-white"
              />
            </div>
            <div className="mt-2 flex gap-4 text-xs text-white/40">
              <span>{t('dynamics.peakLat', 'Peak Lat')}: {fmtNumber(motorStats?.peakLateralG ?? 0, 3)} g</span>
              <span>{t('dynamics.peakLon', 'Peak Lon')}: {fmtNumber(motorStats?.peakLongitudinalG ?? 0, 3)} g</span>
            </div>
          </div>

          {/* G-Force vector dot visualization */}
          <div className="flex items-center justify-center">
            <svg viewBox="-1.5 -1.5 3 3" className="h-48 w-48">
              <line x1="-1.2" y1="0" x2="1.2" y2="0" stroke="rgba(255,255,255,0.1)" strokeWidth="0.02" />
              <line x1="0" y1="-1.2" x2="0" y2="1.2" stroke="rgba(255,255,255,0.1)" strokeWidth="0.02" />
              <circle cx="0" cy="0" r="0.3" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.02" />
              <circle cx="0" cy="0" r="0.6" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.02" />
              <circle cx="0" cy="0" r="0.9" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.02" />
              <circle cx="0" cy="0" r="1.2" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.02" />
              <circle
                cx={Math.max(-1.2, Math.min(1.2, motorLatest?.lateral_accel ?? 0))}
                cy={Math.max(-1.2, Math.min(1.2, -(motorLatest?.longitudinal_accel ?? 0)))}
                r="0.08"
                fill="#3b82f6"
                filter="drop-shadow(0 0 4px rgba(59,130,246,0.6))"
              />
              <text x="0" y="-1.35" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="0.12">{t('dynamics.accelLabel', 'ACCEL')}</text>
              <text x="0" y="1.45" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="0.12">{t('dynamics.brakeLabel', 'BRAKE')}</text>
              <text x="-1.35" y="0.04" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="0.12">{t('dynamics.leftLabel', 'L')}</text>
              <text x="1.35" y="0.04" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="0.12">{t('dynamics.rightLabel', 'R')}</text>
            </svg>
          </div>

          {/* Peak values from history */}
          <div className="flex flex-col gap-3">
            <MetricBar
              value={motorStats?.peakLateralG ?? 0}
              max={1.5}
              color={gForceColor(motorStats?.peakLateralG ?? 0)}
              label={t('dynamics.peakLateralG', 'Peak Lateral G')}
              sublabel={`${fmtNumber(motorStats?.peakLateralG ?? 0, 3)} g`}
            />
            <MetricBar
              value={motorStats?.peakLongitudinalG ?? 0}
              max={1.5}
              color={gForceColor(motorStats?.peakLongitudinalG ?? 0)}
              label={t('dynamics.peakLongG', 'Peak Longitudinal G')}
              sublabel={`${fmtNumber(motorStats?.peakLongitudinalG ?? 0, 3)} g`}
            />
          </div>
        </Grid>
      </GlassPanel>
    </FadeIn>
  );
}
