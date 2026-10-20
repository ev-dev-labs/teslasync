import type { ReactNode } from 'react';
import { Icons } from '@/lib/icons';

interface Tip {
  key: string;
  category: 'efficiency' | 'smoothness' | 'speed';
  icon: ReactNode;
}

export function buildTips(t: (key: string, fallback: string) => string): Tip[] {
  return [
    {
      key: t(
        'driveScore.tips.preCondition',
        'Pre-condition your cabin while plugged in to reduce HVAC battery drain.',
      ),
      category: 'efficiency',
      icon: <Icons.charging className="h-4 w-4 text-emerald-300" aria-hidden="true" />,
    },
    {
      key: t(
        'driveScore.tips.coastMore',
        'Coast more by lifting your foot earlier before stops.',
      ),
      category: 'efficiency',
      icon: <Icons.charging className="h-4 w-4 text-emerald-300" aria-hidden="true" />,
    },
    {
      key: t(
        'driveScore.tips.tirePressure',
        'Keep tire pressure at recommended levels for better efficiency.',
      ),
      category: 'efficiency',
      icon: <Icons.charging className="h-4 w-4 text-emerald-300" aria-hidden="true" />,
    },
    {
      key: t(
        'driveScore.tips.smoothAccel',
        'Accelerate gradually — aim for steady pedal pressure.',
      ),
      category: 'smoothness',
      icon: <Icons.efficiency className="h-4 w-4 text-cyan-300" aria-hidden="true" />,
    },
    {
      key: t(
        'driveScore.tips.regenBraking',
        'Use regenerative braking instead of the brake pedal when possible.',
      ),
      category: 'smoothness',
      icon: <Icons.efficiency className="h-4 w-4 text-cyan-300" aria-hidden="true" />,
    },
    {
      key: t(
        'driveScore.tips.followDistance',
        'Maintain a larger following distance to avoid sudden braking.',
      ),
      category: 'smoothness',
      icon: <Icons.efficiency className="h-4 w-4 text-cyan-300" aria-hidden="true" />,
    },
    {
      key: t(
        'driveScore.tips.speedLimit',
        'Stay within the speed limit — aerodynamic drag rises exponentially above 90 km/h.',
      ),
      category: 'speed',
      icon: <Icons.speed className="h-4 w-4 text-purple-300" aria-hidden="true" />,
    },
    {
      key: t(
        'driveScore.tips.cruiseControl',
        'Use Autopilot or cruise control on highways for consistent speed.',
      ),
      category: 'speed',
      icon: <Icons.speed className="h-4 w-4 text-purple-300" aria-hidden="true" />,
    },
    {
      key: t(
        'driveScore.tips.routePlanning',
        'Plan routes to avoid high-speed stretches when possible.',
      ),
      category: 'speed',
      icon: <Icons.speed className="h-4 w-4 text-purple-300" aria-hidden="true" />,
    },
  ];
}
