import type { ElementType } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';

export function CapBadge({ active, label, icon: Icon, size }: {
  active: boolean; label: string; icon?: ElementType; size?: 'sm' | 'md';
}) {
  const { t } = useTranslation();
  const state = active
    ? t('energy.products.capAvailable', 'available')
    : t('energy.products.capUnavailable', 'unavailable');
  return (
    <Badge variant={active ? 'success' : 'neutral'} size={size} aria-label={`${label}: ${state}`}>
      {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {label}: {state}
    </Badge>
  );
}
