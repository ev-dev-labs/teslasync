import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge, Button, CopyButton, DataTable, GlassPanel, Input, Label, Select, Text, Caption,
  type Column, type SelectOption,
} from '@/components/ui';
import { DateTime, FormattedNumber } from '@/components/data-display';
import type { APICallLog } from '@/api/types';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';

type EvidenceVariant = 'success' | 'info' | 'warning' | 'danger' | 'neutral';
type Installation = { id: string; platform: string; shortId: string };

export type ApiLogsServerFilterKey = 'method' | 'status' | 'endpoint' | 'service' | 'client' | 'key';
export type ApiLogsServerFilters = Record<ApiLogsServerFilterKey, string>;

interface ApiLogsEvidenceTableProps {
  logs: APICallLog[];
  serviceConfig: (service: string) => { label: string; variant: EvidenceVariant };
  installationFor: (headers: APICallLog['request_headers']) => Installation | null;
  toolbarHeading: ReactNode;
  toolbarActions: ReactNode;
  filters: ApiLogsServerFilters;
  onFilterChange: (key: ApiLogsServerFilterKey, value: string) => void;
  onFiltersClear: () => void;
  methodOptions: SelectOption[];
  statusOptions: SelectOption[];
  serviceOptions: SelectOption[];
}

const METHOD_VARIANTS: Record<string, EvidenceVariant> = {
  GET: 'success',
  POST: 'info',
  PUT: 'warning',
  PATCH: 'warning',
  DELETE: 'danger',
};

function statusVariant(code: number | null): EvidenceVariant {
  if (code == null || code < 100) return 'neutral';
  if (code < 300) return 'success';
  if (code < 400) return 'info';
  if (code < 500) return 'warning';
  return 'danger';
}

/** Body copy is exactly the displayed JSON (or the unmodified raw payload). */
function JsonViewer({ data, label }: { data: string | null; label: string }) {
  const { t } = useTranslation();
  if (!data) {
    return (
      <div className="space-y-1">
        <Label>{label}</Label>
        <Text as="p" variant="caption" className="italic">
          {t('apiLogs.noData', { label: label.toLowerCase(), defaultValue: `No ${label.toLowerCase()}` })}
        </Text>
      </div>
    );
  }

  let formatted = data;
  try { formatted = JSON.stringify(JSON.parse(data), null, 2); } catch { /* raw diagnostic payload */ }
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <CopyButton
          text={formatted}
          iconOnly
          size="sm"
          ariaLabel={t('apiLogs.copyBody', 'Copy {{label}}', { label })}
        />
      </div>
      <GlassPanel className={cn('max-h-60 overflow-auto whitespace-pre-wrap break-all !p-3', typography.role.code)}>
        {formatted}
      </GlassPanel>
    </div>
  );
}

function ApiLogDetails({ log, serviceLabel, installation }: {
  log: APICallLog;
  serviceLabel: string;
  installation: Installation | null;
}) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const keyName = log.request_headers?.['App-Key-Name'];
  const keyId = log.request_headers?.['App-Key-ID'];
  const verifiedKey = keyName && /^\d+$/.test(keyId ?? '');
  return (
    <div className="min-w-0 space-y-3 bg-[var(--surface-2)] p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>{t('apiLogs.requestUrl', 'Request URL')}</Label>
        <CopyButton
          text={`${log.http_method} ${log.endpoint ?? ''}`}
          iconOnly
          size="sm"
          ariaLabel={t('apiLogs.copyRequestUrl', 'Copy request URL')}
        />
      </div>
      <GlassPanel className={cn('overflow-x-auto whitespace-pre-wrap break-all !p-3', typography.role.code)}>
        {log.http_method} {log.endpoint ?? '—'}
      </GlassPanel>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Text as="span" variant="bodySm">
          {t('apiLogs.time', 'Time')}: <DateTime value={log.ts} in="utc" />
        </Text>
        <Text as="span" variant="bodySm">{t('apiLogs.service', 'Service')}: {serviceLabel}</Text>
        <Text as="span" variant="bodySm">{t('apiLogs.status', 'Status')}: {log.status_code ?? t('apiLogs.na', 'N/A')}</Text>
        <Text as="span" variant="bodySm">
          {t('apiLogs.duration', 'Duration')}: {log.duration_ms != null
            ? t('apiLogs.durationValue', '{{value}}ms', { value: fmtInt(log.duration_ms) })
            : '—'}
        </Text>
        <Text as="span" variant="bodySm">{t('apiLogs.vehicleId', 'Vehicle ID')}: {log.vehicle_id ?? '—'}</Text>
        <Text as="span" variant="bodySm">{t('apiLogs.rateLimited', 'Rate limited')}: {log.rate_limited ? t('apiLogs.yes', 'Yes') : t('apiLogs.no', 'No')}</Text>
        {verifiedKey && (
          <Text as="span" variant="bodySm">{t('apiLogs.key', 'App key')}: {keyName} (#{keyId})</Text>
        )}
        {verifiedKey && installation && (
          <div className="flex min-w-0 items-center gap-2">
            <Text as="span" variant="bodySm" className="break-all">
              {t('apiLogs.client', 'App installation')}: {installation.id}
            </Text>
            <CopyButton text={installation.id} iconOnly size="sm" ariaLabel={t('apiLogs.copyClient', 'Copy app installation ID')} />
          </div>
        )}
      </div>
      {log.error_message && (
        <div className="space-y-1">
          <Label>{t('apiLogs.error', 'Error')}</Label>
          <GlassPanel className={cn('overflow-x-auto whitespace-pre-wrap break-all !p-3', typography.role.error, typography.family.mono)}>
            {log.error_message}
          </GlassPanel>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <JsonViewer
          data={log.request_headers ? JSON.stringify(log.request_headers) : null}
          label={t('apiLogs.requestHeaders', 'Request headers')}
        />
        <JsonViewer
          data={log.response_headers ? JSON.stringify(log.response_headers) : null}
          label={t('apiLogs.responseHeaders', 'Response headers')}
        />
        <JsonViewer data={log.request_body} label={t('apiLogs.requestBody', 'Request body')} />
        <JsonViewer data={log.response_body} label={t('apiLogs.responseBody', 'Response body')} />
      </div>
      <Caption className="block">
        {t('apiLogs.captureNote', 'Bodies are recorded only when API_LOG_CAPTURE_BODIES is enabled; payloads are capped at 10 KB. Header values are limited to safe diagnostic fields; credentials are redacted. Missing fields on older records cannot be recovered.')}
      </Caption>
    </div>
  );
}

/** Server-owned page: never infer complete value-filter candidates from these 25 rows. */
export function ApiLogsEvidenceTable({
  logs, serviceConfig, installationFor, toolbarHeading, toolbarActions,
  filters, onFilterChange, onFiltersClear, methodOptions, statusOptions, serviceOptions,
}: ApiLogsEvidenceTableProps) {
  const { fmtInt, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation();
  const [expandedKeys, setExpandedKeys] = useState<(string | number)[]>([]);
  const columns = useMemo<Column<APICallLog>[]>(() => {
    const selectFilter = (key: ApiLogsServerFilterKey, label: string, options: SelectOption[]) => ({
      filterActive: filters[key] !== '',
      onFilterClear: () => onFilterChange(key, ''),
      filter: (
        <Select
          label={label}
          value={filters[key]}
          onChange={(event) => onFilterChange(key, event.target.value)}
          options={options}
          size="sm"
        />
      ),
    });
    const textFilter = (key: ApiLogsServerFilterKey, label: string, placeholder: string) => ({
      filterActive: filters[key] !== '',
      onFilterClear: () => onFilterChange(key, ''),
      filter: (
        <Input
          label={label}
          type="text"
          placeholder={placeholder}
          value={filters[key]}
          onChange={(event) => onFilterChange(key, event.target.value)}
          size="sm"
        />
      ),
    });
    return [
    {
      key: 'time',
      header: t('apiLogs.time', 'Time'),
      defaultWidth: 185,
      minWidth: 150,
      render: (log) => <DateTime value={log.ts} in="utc" className="whitespace-nowrap text-xs tabular-nums" />,
    },
    {
      key: 'method',
      header: t('apiLogs.method', 'Method'),
      ...selectFilter('method', t('apiLogs.method', 'Method'), methodOptions),
      defaultWidth: 125,
      minWidth: 115,
      render: (log) => <Badge variant={METHOD_VARIANTS[log.http_method] ?? 'neutral'} size="sm">{log.http_method}</Badge>,
    },
    {
      key: 'endpoint',
      header: t('apiLogs.endpoint', 'Endpoint'),
      ...textFilter('endpoint', t('apiLogs.endpoint', 'Endpoint'), t('apiLogs.filterEndpoint', 'Filter by endpoint...')),
      defaultWidth: 340,
      minWidth: 180,
      className: 'max-md:!w-auto max-md:!min-w-0',
      render: (log) => (
        <div className="min-w-0 space-y-1">
          <Text as="span" size="xs" mono title={log.endpoint ?? undefined} className="block max-w-[55vw] truncate md:max-w-none">
            {log.endpoint ?? '—'}
          </Text>
          <div className="flex flex-wrap items-center gap-1 md:hidden">
            <Badge variant={METHOD_VARIANTS[log.http_method] ?? 'neutral'} size="sm">{log.http_method}</Badge>
            <Caption>{serviceConfig(log.service).label}</Caption>
            <Caption className="tabular-nums">
              <DateTime value={log.ts} in="utc" />
            </Caption>
            <Caption className="tabular-nums">
              {log.duration_ms != null
                ? t('apiLogs.durationValue', '{{value}}ms', { value: fmtInt(log.duration_ms) })
                : '—'}
            </Caption>
          </div>
          {log.error_message && (
            <Text as="p" variant="error" className="max-w-[55vw] truncate md:hidden" title={log.error_message}>
              {log.error_message}
            </Text>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('apiLogs.status', 'Status'),
      ...selectFilter('status', t('apiLogs.status', 'Status'), statusOptions),
      defaultWidth: 125,
      minWidth: 95,
      align: 'center',
      render: (log) => (
        <div className="space-y-1">
          <Badge variant={statusVariant(log.status_code)} size="sm">{log.status_code ?? t('apiLogs.na', 'N/A')}</Badge>
          {log.rate_limited && <Caption className="block">{t('apiLogs.rateLimited', 'Rate limited')}</Caption>}
        </div>
      ),
    },
    {
      key: 'service',
      header: t('apiLogs.service', 'Service'),
      ...selectFilter('service', t('apiLogs.service', 'Service'), serviceOptions),
      defaultWidth: 175,
      minWidth: 120,
      render: (log) => {
        const config = serviceConfig(log.service);
        return <Badge variant={config.variant} size="sm">{config.label}</Badge>;
      },
    },
    {
      key: 'duration',
      header: t('apiLogs.latency', 'Latency (ms)'),
      defaultWidth: 120,
      minWidth: 100,
      align: 'right',
      render: (log) => <FormattedNumber value={log.duration_ms} precision={displayPrecision} className="tabular-nums" />,
    },
    {
      key: 'client',
      header: t('apiLogs.client', 'App installation'),
      ...textFilter('client', t('apiLogs.client', 'App installation'), t('apiLogs.filterClient', 'Platform or installation ID...')),
      defaultWidth: 220,
      minWidth: 150,
      render: (log) => {
        const keyName = log.request_headers?.['App-Key-Name'];
        const keyId = log.request_headers?.['App-Key-ID'];
        const verified = keyName && /^\d+$/.test(keyId ?? '');
        const installation = verified ? installationFor(log.request_headers) : null;
        return (
          <div className="min-w-0 space-y-1">
            <Text as="span" size="xs" className="block truncate" title={verified ? `${keyName} (#${keyId})` : undefined}>
              {verified ? `${keyName} #${keyId}` : '—'}
            </Text>
            {installation && (
              <Caption className="block truncate" title={installation.id}>
                {t(`apiLogs.platform.${installation.platform}`, installation.platform)} · {installation.shortId}
              </Caption>
            )}
          </div>
        );
      },
    },
    {
      key: 'key',
      header: t('apiLogs.key', 'App key'),
      ...textFilter('key', t('apiLogs.key', 'App key'), t('apiLogs.filterKey', 'Key name or ID...')),
      defaultVisible: false,
      defaultWidth: 180,
      minWidth: 140,
      render: (log) => {
        const name = log.request_headers?.['App-Key-Name'];
        const id = log.request_headers?.['App-Key-ID'];
        const verified = name && /^\d+$/.test(id ?? '');
        return (
          <Text as="span" size="xs" className="block truncate" title={verified ? `${name} (#${id})` : undefined}>
            {verified ? `${name} #${id}` : '—'}
          </Text>
        );
      },
    },
    {
      key: 'error',
      header: t('apiLogs.error', 'Error'),
      defaultWidth: 240,
      minWidth: 140,
      render: (log) => <Text as="span" variant="error" className="block truncate" title={log.error_message ?? undefined}>{log.error_message || '—'}</Text>,
    },
    ];
  }, [t, serviceConfig, installationFor, filters, onFilterChange, methodOptions, statusOptions, serviceOptions, fmtInt, displayPrecision, displayLocale]);

  return (
    <DataTable
      tableId="admin:api-logs"
      name={t('apiLogs.logTitle', 'API call log')}
      caption={t('apiLogs.logTitle', 'API call log')}
      columns={columns}
      data={logs}
      keyExtractor={(log) => log.id}
      rowLabel={(log) => `${log.http_method} ${log.endpoint ?? '—'}`}
      density="compact"
      mobileColumns={['method', 'endpoint', 'status', 'service', 'client', 'key']}
      resizable
      columnReorder
      columnVisibility
      pagination={false}
      enableValueFilters={false}
      emptyMessage="—"
      expandable
      expandedKeys={expandedKeys}
      onExpandedChange={(keys) => setExpandedKeys(keys.slice(-1))}
      renderExpanded={(log) => (
        <ApiLogDetails
          log={log}
          serviceLabel={serviceConfig(log.service).label}
          installation={installationFor(log.request_headers)}
        />
      )}
      toolbarHeading={toolbarHeading}
      toolbarActions={
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!Object.values(filters).some(Boolean)}
            onClick={onFiltersClear}
          >
            {t('apiLogs.clear', 'Clear')}
          </Button>
          {toolbarActions}
        </>
      }
    />
  );
}
