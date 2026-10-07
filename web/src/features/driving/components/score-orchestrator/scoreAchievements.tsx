import type { ReactNode } from 'react';
import type { Drive } from '@/types/driving';
import { Icons } from '@/lib/icons';
import type { ComputedScore } from './scoreDomain';

interface Achievement {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  check: (scores: ComputedScore[], drives: Drive[]) => boolean;
}

export function buildAchievements(
  t: (key: string, fallback: string) => string,
): Achievement[] {
  return [
    {
      id: 'first-drive',
      label: t('driveScore.achievements.firstDrive', 'First Drive'),
      description: t(
        'driveScore.achievements.firstDriveDesc',
        'Complete your first scored drive.',
      ),
      icon: <Icons.drive className="h-5 w-5" aria-hidden="true" />,
      check: (_scores, drives) => drives.length >= 1,
    },
    {
      id: 'ten-drives',
      label: t('driveScore.achievements.tenDrives', 'Road Regular'),
      description: t(
        'driveScore.achievements.tenDrivesDesc',
        'Complete 10 scored drives.',
      ),
      icon: <Icons.star className="h-5 w-5" aria-hidden="true" />,
      check: (_scores, drives) => drives.length >= 10,
    },
    {
      id: 'fifty-drives',
      label: t('driveScore.achievements.fiftyDrives', 'Highway Hero'),
      description: t(
        'driveScore.achievements.fiftyDrivesDesc',
        'Complete 50 scored drives.',
      ),
      icon: <Icons.trophy className="h-5 w-5 text-amber-300" aria-hidden="true" />,
      check: (_scores, drives) => drives.length >= 50,
    },
    {
      id: 'perfect-score',
      label: t('driveScore.achievements.perfectScore', 'Perfect Score'),
      description: t(
        'driveScore.achievements.perfectScoreDesc',
        'Achieve a 100/100 on any drive.',
      ),
      icon: <Icons.award className="h-5 w-5 text-amber-300" aria-hidden="true" />,
      check: (scores) => scores.some((s) => s.total >= 100),
    },
    {
      id: 'a-plus-streak',
      label: t('driveScore.achievements.aPlusStreak', 'A+ Streak'),
      description: t(
        'driveScore.achievements.aPlusStreakDesc',
        'Get A+ grade on 5 consecutive drives.',
      ),
      icon: <Icons.trophy className="h-5 w-5 text-emerald-300" aria-hidden="true" />,
      check: (scores) => {
        let streak = 0;
        for (const s of scores) {
          if (s.grade === 'A+') {
            streak += 1;
            if (streak >= 5) return true;
          } else {
            streak = 0;
          }
        }
        return false;
      },
    },
    {
      id: 'efficiency-master',
      label: t('driveScore.achievements.efficiencyMaster', 'Efficiency Master'),
      description: t(
        'driveScore.achievements.efficiencyMasterDesc',
        'Score 38+ in efficiency on 3 drives.',
      ),
      icon: <Icons.charging className="h-5 w-5 text-emerald-300" aria-hidden="true" />,
      check: (scores) => scores.filter((s) => s.efficiency >= 38).length >= 3,
    },
    {
      id: 'smooth-operator',
      label: t('driveScore.achievements.smoothOperator', 'Smooth Operator'),
      description: t(
        'driveScore.achievements.smoothOperatorDesc',
        'Score 28+ in smoothness on 3 drives.',
      ),
      icon: <Icons.securityCheck className="h-5 w-5 text-cyan-300" aria-hidden="true" />,
      check: (scores) => scores.filter((s) => s.smoothness >= 28).length >= 3,
    },
    {
      id: 'speed-saint',
      label: t('driveScore.achievements.speedSaint', 'Speed Saint'),
      description: t(
        'driveScore.achievements.speedSaintDesc',
        'Score 28+ in speed discipline on 5 drives.',
      ),
      icon: <Icons.target className="h-5 w-5 text-purple-300" aria-hidden="true" />,
      check: (scores) => scores.filter((s) => s.speed >= 28).length >= 5,
    },
  ];
}
