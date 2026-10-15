import { useTranslation } from 'react-i18next';
import { Zap, Thermometer, Wind, TrendingUp } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Text } from '@/components/ui';

export function RangeTips() {
  const { t } = useTranslation();
  const tips = [
    { icon: Zap, text: t('range.tip.speed', 'Keep speed under 110 km/h for optimal efficiency.') },
    { icon: Thermometer, text: t('range.tip.precondition', 'Pre-condition the cabin while still plugged in.') },
    { icon: Wind, text: t('range.tip.seatHeaters', 'Use seat heaters instead of cabin heat in cold weather.') },
    { icon: TrendingUp, text: t('range.tip.elevation', 'Plan routes to minimize elevation changes.') },
  ];
  return (
    <LayoutCard title={t('range.tips', 'Tips to Maximize Range')}>
      <ul className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-4">
        {tips.map(({ icon: Icon, text }) => (
          <li key={text} className="flex min-w-0 items-start gap-2 rounded-lg bg-[var(--surface-2)] p-3">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
            <Text as="span" size="sm" color="secondary">{text}</Text>
          </li>
        ))}
      </ul>
    </LayoutCard>
  );
}
