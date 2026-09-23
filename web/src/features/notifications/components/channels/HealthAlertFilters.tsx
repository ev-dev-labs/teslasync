import { useTranslation } from 'react-i18next';
import { SearchInput } from '@/components/forms';
import { Badge, Heading, Select, Text } from '@/components/ui';

export type HealthFilter = 'all' | 'enabled' | 'disabled';

interface Props {
  enabledCount: number;
  total: number;
  channelEnabled: boolean;
  search: string;
  onSearch: (value: string) => void;
  filter: HealthFilter;
  onFilter: (value: HealthFilter) => void;
}

export function HealthAlertFilters({
  enabledCount, total, channelEnabled, search, onSearch, filter, onFilter,
}: Props) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Heading level="sub" as="h4">{t('notifications.healthAlerts.routingTitle', 'Delivery settings')}</Heading>
          <Text as="p" variant="caption" className="mt-1">
            {t('notifications.healthAlerts.enabledCount', '{{enabled}} of {{total}} events enabled', {
              enabled: enabledCount, total,
            })}
          </Text>
        </div>
        <Badge variant={channelEnabled ? 'success' : 'neutral'} size="sm">
          {channelEnabled
            ? t('notifications.healthAlerts.channelActive', 'Channel active')
            : t('notifications.healthAlerts.channelInactive', 'Channel disabled')}
        </Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <SearchInput value={search} onChange={onSearch} debounceMs={0}
          ariaLabel={t('notifications.healthAlerts.search', 'Search components')}
          placeholder={t('notifications.healthAlerts.search', 'Search components')} />
        <Select
          label={t('notifications.healthAlerts.filterLabel', 'Show')}
          value={filter}
          onChange={(event) => onFilter(event.target.value as HealthFilter)}
          options={[
            { value: 'all', label: t('notifications.healthAlerts.all', 'All components') },
            { value: 'enabled', label: t('notifications.healthAlerts.someEnabled', 'Sending alerts') },
            { value: 'disabled', label: t('notifications.healthAlerts.someDisabled', 'Needs attention') },
          ]}
        />
      </div>
    </>
  );
}
