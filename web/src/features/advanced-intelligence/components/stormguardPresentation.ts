export function stormLevelVariant(level: unknown): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (level) {
    case 'warning':
      return 'danger';
    case 'watch':
      return 'warning';
    case 'none':
      return 'success';
    default:
      return 'neutral';
  }
}

export function stormLevelLabel(t: (key: string, fallback: string) => string, level: unknown): string {
  switch (level) {
    case 'warning':
      return t('stormguard.warning', 'Storm warning');
    case 'watch':
      return t('stormguard.watch', 'Storm watch');
    case 'none':
      return t('stormguard.clear', 'Clear');
    default:
      return t('common.unknown', 'Unknown');
  }
}
