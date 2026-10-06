import type { StormLevel } from '@/api/hooks/useStormguard';

export function stormLevelVariant(level: StormLevel): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (level) {
    case 'warning':
      return 'danger';
    case 'watch':
      return 'warning';
    default:
      return 'success';
  }
}

export function stormLevelLabel(t: (key: string, fallback: string) => string, level: StormLevel): string {
  switch (level) {
    case 'warning':
      return t('stormguard.warning', 'Storm warning');
    case 'watch':
      return t('stormguard.watch', 'Storm watch');
    default:
      return t('stormguard.clear', 'Clear');
  }
}
