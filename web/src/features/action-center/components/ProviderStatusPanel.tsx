import { useTranslation } from 'react-i18next';
import { Badge, Caption, GlassPanel, Icon, PanelTitle, Text } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { Icons } from '@/lib/icons';
import { typography } from '@/lib/tokens';
import type {
  ActionCenterProviderAvailability,
  ActionCenterProviderStatus,
} from '@/types/actionCenter';

interface ProviderStatusPanelProps {
  providers: ActionCenterProviderStatus[];
  loading: boolean;
}

const variantByStatus: Record<
  ActionCenterProviderAvailability,
  'success' | 'warning' | 'danger'
> = {
  available: 'success',
  degraded: 'warning',
  unavailable: 'danger',
};

export function ProviderStatusPanel({ providers, loading }: ProviderStatusPanelProps) {
  const { t } = useTranslation();
  const SourceIcon = Icons.database;
  return (
    <GlassPanel padding="md">
      <div className="flex items-center gap-2">
        <Icon icon={SourceIcon} size="lg" className={typography.color.secondary} />
        <PanelTitle>{t('actionCenter.providers.title', 'Source coverage')}</PanelTitle>
      </div>
      <Text as="p" variant="bodySm" className="mt-1">
        {t(
          'actionCenter.providers.description',
          'Unavailable sources are shown explicitly; the inbox never invents substitute findings.',
        )}
      </Text>
      {loading ? (
        <Skeleton lines={3} className="mt-4" />
      ) : providers.length === 0 ? (
        <Text as="p" variant="bodySm" className="mt-4">
          {t('actionCenter.providers.empty', 'No provider status was returned.')}
        </Text>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {providers.map((provider) => (
            <div
              key={provider.source_feature}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Text size="sm" weight="medium" color="primary">
                  {t(
                    `actionCenter.source.${provider.source_feature}`,
                    provider.source_feature.replace(/_/g, ' '),
                  )}
                </Text>
                <Badge variant={variantByStatus[provider.status]} dot>
                  {t(`actionCenter.providerStatus.${provider.status}`, provider.status)}
                </Badge>
              </div>
              <Caption as="p" className="mt-2">
                {t('actionCenter.providers.findings', '{{count}} findings', {
                  count: provider.item_count,
                })}
              </Caption>
              {provider.limitations.map((limitation) => (
                <Text as="p" key={limitation} variant="caption" className="mt-1">
                  {limitation}
                </Text>
              ))}
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
