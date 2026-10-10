import type { ElementType } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';

export function CapBadge({ active, label, icon: Icon }: { active: boolean; label: string; icon: ElementType }) {
  const { t } = useTranslation();
  const state = active
    ? t('energy.products.capAvailable', 'available')
    : t('energy.products.capUnavailable', 'unavailable');
  return (
    <Badge variant={active ? 'success' : 'neutral'} aria-label={`${label}: ${state}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}
