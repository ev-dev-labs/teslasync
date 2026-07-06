import { useTranslation } from 'react-i18next'
import { Server } from 'lucide-react'
import {
  GlassPanel,
  Badge,
  IconBox,
  PanelTitle,
  Text,
  Code,
  Label,
  CopyButton,
} from '@/components/ui'
import { KVList, TimeStamp } from '@/components/data-display'
import { Skeleton, QueryError, EmptyState } from '@/components/feedback'
import type { RegionZoneKey } from './helpers'

export interface RegionEndpointPanelProps {
  region: string | null
  baseUrl: string | null
  host: string | null
  scheme: string | null
  regionKey: RegionZoneKey | null
  regionLabel: string | null
  fetchedAt: string | null
  isLoading: boolean
  isError: boolean
  error: unknown
  onRetry: () => void
  onRefresh: () => void
}

/**
 * Hero panel: the resolved Fleet API endpoint. Handles loading, error and empty
 * independently of the rest of the page and null-safes every field so a partial
 * response never blanks the surface.
 */
export function RegionEndpointPanel({
  region,
  baseUrl,
  host,
  scheme,
  regionKey,
  regionLabel,
  fetchedAt,
  isLoading,
  isError,
  error,
  onRetry,
  onRefresh,
}: RegionEndpointPanelProps) {
  const { t } = useTranslation('settings')
  const configured = Boolean(region || baseUrl)

  return (
    <GlassPanel className="h-full space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <IconBox color="green">
          <Server className="h-5 w-5" aria-hidden="true" />
        </IconBox>
        <div className="min-w-0">
          <PanelTitle>{t('region.endpoint.title', 'Fleet API endpoint')}</PanelTitle>
          <Text as="p" variant="caption">
            {t(
              'region.endpoint.subtitle',
              'The regional base URL TeslaSync uses for every Fleet API call.',
            )}
          </Text>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton height={64} />
          <Skeleton lines={5} height={16} />
        </div>
      ) : isError ? (
        <QueryError
          error={error}
          onRetry={onRetry}
          resourceName={t('region.resource', 'Region')}
        />
      ) : !configured ? (
        <EmptyState
          icon={<Server className="h-10 w-10" aria-hidden="true" />}
          title={t('region.empty.title', 'No region on record')}
          message={t(
            'region.empty.message',
            'TeslaSync has not resolved your account region yet. Refresh to fetch it from Tesla.',
          )}
          action={{ label: t('region.refresh', 'Refresh'), onClick: onRefresh }}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Text size="base" weight="semibold" color="primary">
              {regionLabel || region || t('region.kpi.regionUnknown', 'Not detected')}
            </Text>
            {regionKey && (
              <Badge variant="info" size="sm">
                {regionKey.toUpperCase()}
              </Badge>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{t('region.fleetApiUrl', 'Fleet API base URL')}</Label>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-3">
              <Code className="min-w-0 flex-1 break-all">{baseUrl || '—'}</Code>
              {baseUrl && (
                <CopyButton
                  text={baseUrl}
                  iconOnly
                  ariaLabel={t('region.copyUrl', 'Copy Fleet API base URL')}
                />
              )}
            </div>
          </div>

          <KVList
            items={[
              { label: t('region.regionName', 'Region'), value: region || '—' },
              {
                label: t('region.regionCode', 'Region code'),
                value: regionKey ? regionKey.toUpperCase() : '—',
              },
              {
                label: t('region.protocol', 'Protocol'),
                value: scheme ? scheme.toUpperCase() : '—',
              },
              { label: t('region.host', 'Host'), value: host ?? '—' },
              {
                label: t('region.lastSyncedFull', 'Last synced'),
                value: <TimeStamp value={fetchedAt} />,
              },
            ]}
          />
        </div>
      )}
    </GlassPanel>
  )
}
