import { useMemo } from 'react';
import { ScrollText } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { Badge, Button, Caption, DataTable, Text, type Column } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { LOG_STREAM_MAX_EVENTS, type LogStreamEvent } from '@/api/hooks/useLogStream';
import { LogHighlightedText } from '../../continuation-admin-1/LogHighlightedText';
import type { useLiveLogsPage } from '../../../hooks/useLiveLogsPage';
import { levelBadgeVariant, formatTime, extractMessage, extractFields } from './helpers';

type Props = { controller: ReturnType<typeof useLiveLogsPage> };

export function LiveLogsStream({ controller }: Props) {
  const { fmtInt, t, levelLabel, enabled, setInspectedEvent, stream, grepPattern, filteredEvents, tableWrapRef, handleReconnect } = controller;
  const columns = useMemo<Column<LogStreamEvent>[]>(() => {
    return [
      {
        key: 'time',
        filterValue: (row) => row.receivedAt ?? null,
        filterValueLabel: (_value, row) => formatTime(row.receivedAt),
        header: t('liveLogs.table.time', 'Time'),
        defaultWidth: 110,
        render: (row) => (
          <Text mono size="xs" color="secondary">
            {formatTime(row.receivedAt)}
          </Text>
        ),
      },
      {
        key: 'level',
        filterValue: (row) => row.level ?? null,
        filterValueLabel: (_value, row) => levelLabel(row.level),
        header: t('liveLogs.table.level', 'Level'),
        defaultWidth: 80,
        render: (row) => (
          <Badge variant={levelBadgeVariant(row.level)} size="sm">
            {row.level ? levelLabel(row.level) : t('liveLogs.table.noLevel', '—')}
          </Badge>
        ),
      },
      {
        key: 'message',
        filterValue: (row) => extractMessage(row.parsed, row.payload),
        header: t('liveLogs.table.message', 'Message'),
        render: (row) => (
          <Text variant="code" className="block break-words">
            <LogHighlightedText
              text={extractMessage(row.parsed, row.payload)}
              pattern={grepPattern}
            />
          </Text>
        ),
      },
      {
        key: 'fields',
        header: t('liveLogs.table.fields', 'Fields'),
        defaultWidth: 320,
        render: (row) => {
          const fields = extractFields(row.parsed);
          if (fields.length === 0) return null;
          return (
              <span className="flex flex-wrap gap-1">
                {fields.slice(0, 6).map(([k, v]) => (
                  <Text
                    as="span"
                    key={k}
                    mono
                    size="2xs"
                    color="secondary"
                    className="rounded border border-[var(--border-subtle)] bg-[var(--surface-2)] px-1.5 py-0.5"
                    title={`${k}=${v}`}
                  >
                    <span className="text-[var(--text-muted)]">{k}=</span>
                    <span className="text-[var(--text-primary)]">
                      {v.length > 32 ? `${v.slice(0, 32)}…` : v}
                    </span>
                  </Text>
                ))}
                {fields.length > 6 ? (
                  <Text mono size="2xs" color="muted" className="px-1">
                    +{fields.length - 6}
                  </Text>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  wrapLabel
                  onClick={() => setInspectedEvent(row)}
                >
                  {t('liveLogs.table.fullEvent', 'Full log event')}
                </Button>
              </span>
          );
        },
      },
    ];
  }, [grepPattern, levelLabel, t]);


  return (
<div className="min-w-0" data-testid="livelogs-table-panel">
      <LayoutCard
        title={t('liveLogs.stream.title', 'Live stream')}
        actions={<Caption>
          {t('liveLogs.stats.buffered', {
            count: stream.events.length,
            defaultValue: 'Buffered: {{count}}',
          })}{' '}
          / {fmtInt(LOG_STREAM_MAX_EVENTS)}
        </Caption>}
      >
      <div ref={tableWrapRef}>
        {filteredEvents.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="h-10 w-10" aria-hidden />}
            title={t('liveLogs.title', 'Live logs')}
            message={t(
              'liveLogs.empty.noEvents',
              'No log events yet. Trigger activity (e.g. start a charging session) to see live output.',
            )}
            action={
              !enabled
                ? {
                    label: t('liveLogs.controls.reconnect', 'Reconnect'),
                    onClick: handleReconnect,
                  }
                : undefined
            }
          />
        ) : (
          <DataTable<LogStreamEvent>
            tableId="admin:live-logs"
            data={filteredEvents}
            enableValueFilters
            filterData={stream.events}
            columns={columns}
            mobileColumns={['time', 'level', 'message']}
            keyExtractor={(row) => row.seq}
            virtualized={filteredEvents.length > 200}
            rowHeight={36}
            maxHeight={560}
            density="compact"
            className="font-mono text-xs"
          />
        )}
      </div>
      </LayoutCard>
    </div>
  );
}
