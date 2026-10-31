import { useTranslation } from 'react-i18next';
import { KVList } from '@/components/data-display';
import { Badge, Caption, Text } from '@/components/ui';

export interface GeofenceListRow {
  id: string;
  name: string;
  radius: number | null;
  enabled: boolean;
  inside: boolean;
  validMap: boolean;
}

interface GeofenceStatusListProps {
  fences: readonly GeofenceListRow[];
  hasCoords: boolean;
  formatRadius: (radius: number | null) => string;
}

export function GeofenceStatusList({ fences, hasCoords, formatRadius }: GeofenceStatusListProps) {
  const { t } = useTranslation('dashboard');
  return (
    <ul className="space-y-1.5">
      {fences.map((fence) => (
        <li key={fence.id} className="min-h-11 min-w-0 border-b border-[var(--border-subtle)] last:border-b-0">
          <KVList
            layout="responsive"
            wrap
            items={[{
              id: fence.id,
              label: <>
                <Text as="span" variant="bodySm" className="block break-words">{fence.name}</Text>
                <Caption className="block break-words">
                  {t('widget.geofence.radius', 'Radius')}: {formatRadius(fence.radius)}
                </Caption>
              </>,
              value: !fence.enabled
                ? <Badge variant="neutral" size="sm">{t('widget.geofence.disabled', 'Disabled')}</Badge>
                : fence.inside
                  ? <Badge variant="success" size="sm" dot>{t('widget.geofence.inside', 'Inside')}</Badge>
                  : <Badge variant="neutral" size="sm">
                    {hasCoords && fence.validMap ? t('widget.geofence.outside', 'Outside') : '—'}
                  </Badge>,
            }]}
          />
        </li>
      ))}
    </ul>
  );
}
