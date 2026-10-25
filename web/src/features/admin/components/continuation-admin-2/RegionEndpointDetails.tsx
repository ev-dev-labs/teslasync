import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Server } from 'lucide-react';
import type { RegionEndpointPanelProps } from '../tesla-region/RegionEndpointPanel';
import { LayoutCard } from '@/components/layout';
import { Badge, Text, Code, Label, CopyButton, Button, ErrorText, HelperText, Icon } from '@/components/ui';
import { KVList, TimeStamp } from '@/components/data-display';
import { Skeleton, QueryError, EmptyState } from '@/components/feedback';

export function RegionEndpointDetails(props: RegionEndpointPanelProps) {
  const { t } = useTranslation('settings');
  const [failedCopyUrl, setFailedCopyUrl] = useState<string | null>(null);
  const configured = Boolean(props.region || props.baseUrl);
  return (
    <LayoutCard title={t('region.endpoint.title', 'Fleet API endpoint')}
      description={t('region.endpoint.subtitle', 'The regional base URL TeslaSync uses for every Fleet API call.')}>
      {props.isPaused && props.isInitial ? <div className="space-y-3">
        <Text as="p" variant="bodySm" role="status">{t('dataSources.status.paused', { ns: 'translation', defaultValue: 'Refresh paused' })}</Text>
        <Button variant="secondary" wrapLabel className="min-h-11 md:min-h-9" onClick={props.onRetry}>
          {t('common.retry', { ns: 'translation', defaultValue: 'Retry' })}
        </Button>
      </div>
        : props.isLoading || props.isInitial ? <div className="space-y-3"><Skeleton height={64} /><Skeleton lines={5} height={16} /></div>
        : props.isError ? <QueryError error={props.error} onRetry={props.onRetry} resourceName={t('region.resource', 'Region')} />
        : !configured ? <div className="space-y-3">
          <EmptyState icon={<Icon icon={Server} size="xl" />} title={t('region.empty.title', 'No region on record')}
            message={t('region.empty.message', 'TeslaSync has not resolved your account region yet. Refresh to fetch it from Tesla.')}
            action={{ label: t('region.refresh', 'Refresh'), onClick: props.onRefresh, disabled: props.refreshDisabled || props.isRefreshing, loading: props.isRefreshing }}
          />
          {props.refreshBlockReason && <HelperText className="text-center">{props.refreshBlockReason}</HelperText>}
        </div>
        : <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Text size="base" weight="semibold">{props.regionLabel || props.region || t('region.kpi.regionUnknown', 'Not detected')}</Text>
            {props.regionKey && <Badge variant="info" size="sm">{props.regionKey.toUpperCase()}</Badge>}
          </div>
          <div className="space-y-1.5">
            <Label>{t('region.fleetApiUrl', 'Fleet API base URL')}</Label>
            <div className="flex min-w-0 items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <Code className="min-w-0 flex-1 select-text whitespace-pre-wrap break-all">{props.baseUrl || '—'}</Code>
              {props.baseUrl && <CopyButton key={props.baseUrl} text={props.baseUrl} iconOnly
                className="h-11 min-h-11 min-w-11 shrink-0 md:h-9 md:min-h-9 md:min-w-0"
                onCopy={() => setFailedCopyUrl(null)} onCopyError={() => setFailedCopyUrl(props.baseUrl)}
                ariaLabel={t('region.copyUrl', 'Copy Fleet API base URL')} />}
            </div>
            {props.baseUrl && failedCopyUrl === props.baseUrl && <div className="space-y-1">
              <ErrorText>{t('common.copyButton.errorToast', { ns: 'translation', defaultValue: 'Failed to copy' })}</ErrorText>
              <HelperText>{t('totp.copy.manualHint', 'Clipboard unavailable. Select the displayed text and copy it manually.')}</HelperText>
            </div>}
          </div>
          <KVList layout="responsive" items={[
            { id: 'region', label: t('region.regionName', 'Region'), value: props.region || '—' },
            { id: 'code', label: t('region.regionCode', 'Region code'), value: props.regionKey?.toUpperCase() ?? '—' },
            { id: 'protocol', label: t('region.protocol', 'Protocol'), value: props.scheme?.toUpperCase() ?? '—' },
            { id: 'host', label: t('region.host', 'Host'), value: props.host ?? '—' },
            { id: 'synced', label: t('region.lastSyncedFull', 'Last synced'), value: <TimeStamp value={props.fetchedAt} /> },
          ]} />
        </div>}
    </LayoutCard>
  );
}
