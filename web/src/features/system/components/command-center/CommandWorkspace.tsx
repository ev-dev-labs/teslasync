import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';
import { cn } from '@/lib/cn';
import { Badge, Button, GlassPanel, Heading, Icon, Text } from '@/components/ui';
import { AlertBanner, EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { FreshnessDot } from '@/components/data-display';
import type { DataState } from '@/api/dataState';
import type { isVehicleStateFieldCurrent } from '@/api/hooks/useVehicles';
import type { CommandLogEntry } from '@/api/hooks/useCommands';
import {
  CATEGORY_META,
  COMMANDS,
  type CommandDef,
  type Vehicle,
  type VehicleState,
} from '../../commands';
import { CommandSearch } from '../CommandSearch';
import { CommandBoardControl } from './CommandBoardControl';
import { CommandDialogs, type ActiveCommandDialog } from './CommandDialogs';
import { COMMAND_BOARD } from './commandBoard';
import { getCommandDefinition, getLatestCommandStatus } from './commandLabels';
import { useCommandFavorites } from './useCommandFavorites';

interface CommandWorkspaceProps {
  vehicle: Vehicle;
  state: VehicleState | null;
  stateTrust?: Parameters<typeof isVehicleStateFieldCurrent>[0];
  latestCommands: CommandLogEntry[];
  latestState?: DataState<CommandLogEntry[]>;
  loading: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onExecute: (command: string, params?: Record<string, unknown>) => void;
}

export function CommandWorkspace(props: CommandWorkspaceProps) {
  // A new vehicle or read-only scope must never inherit an old draft or PIN dialog.
  return <CommandWorkspaceSession key={`${props.vehicle.id}:${!!props.disabled}`} {...props} />;
}

function CommandWorkspaceSession({
  vehicle,
  state,
  stateTrust,
  latestCommands,
  latestState,
  loading,
  disabled = false,
  disabledReason,
  onExecute,
}: CommandWorkspaceProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [editingPins, setEditingPins] = useState(false);
  const [activeDialog, setActiveDialog] = useState<ActiveCommandDialog | null>(null);
  const { favorites, toggleFavorite } = useCommandFavorites(vehicle.id);

  const latestByCommand = useMemo(() => {
    const latest = new Map<string, CommandLogEntry>();
    for (const entry of latestCommands ?? []) {
      const command = getCommandDefinition(entry.command)?.command ?? entry.command;
      const previous = latest.get(command);
      const timestamp = Date.parse(entry.created_at);
      const previousTimestamp = previous ? Date.parse(previous.created_at) : Number.NEGATIVE_INFINITY;
      if (!previous || timestamp > previousTimestamp ||
          (timestamp === previousTimestamp && entry.id > previous.id)) {
        latest.set(command, entry);
      }
    }
    return latest;
  }, [latestCommands]);

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    const result = new Set<string>();
    for (const group of COMMAND_BOARD) {
      for (const command of group.commands) {
        const category = CATEGORY_META[command.category];
        const text = [
          t(command.labelKey, command.labelFallback),
          command.sublabelKey && t(command.sublabelKey, command.sublabelFallback ?? ''),
          t(category.labelKey, category.fallback), t(group.labelKey, group.fallback),
          command.id, command.command, command.commandOff,
        ].filter(Boolean).join(' ').toLowerCase();
        if (query.split(/\s+/).every(word => text.includes(word))) result.add(command.id);
      }
    }
    return result;
  }, [search, t]);
  const visibleGroups = COMMAND_BOARD.map(group => ({
    ...group,
    commands: group.commands.filter(command => !pinnedOnly || favorites.includes(command.id)),
  })).filter(group => group.commands.some(command => matches.has(command.id)));

  const requestDialog = useCallback((definition: CommandDef) => {
    if (disabled || loading) return;
    const kind = definition.selectConfig
      ? 'select'
      : definition.inputConfig
        ? 'input'
        : 'confirm';
    setActiveDialog({ kind, definition, vehicleId: vehicle.id });
  }, [disabled, loading, vehicle.id]);

  const renderControl = (definition: CommandDef) => {
    const latest = latestByCommand.get(definition.command);
    return (
      <CommandBoardControl
        key={definition.id}
        definition={definition}
        vehicle={vehicle}
        state={state}
        stateTrust={stateTrust}
        loading={loading}
        disabled={disabled}
        disabledReason={disabledReason}
        lastStatus={getLatestCommandStatus(latest)}
        favorite={favorites.includes(definition.id)}
        editingPins={editingPins}
        onToggleFavorite={() => toggleFavorite(definition.id)}
        matched={search.trim() !== '' && matches.has(definition.id)}
        onRequestDialog={requestDialog}
        onExecute={onExecute}
      />
    );
  };

  return (
    <>
      <div className="min-w-0 space-y-4" data-testid="command-workspace">
        {latestState && (
          <div data-testid="command-outcome-source" className="space-y-2">
            {latestState.fatalError ? (
              <QueryError error={latestState.fatalError} onRetry={latestState.retry ?? undefined} />
            ) : !latestState.hasData ? (
              <div data-app-part="status" role="status">
                <Text variant="bodySm">
                  {latestState.isRefreshBlocked
                    ? t('dataSources.status.paused', 'Refresh paused')
                    : t('commands.activity.loading', 'Loading command activity')}
                </Text>
                {!latestState.isRefreshBlocked && <Skeleton className="h-4 w-40" />}
                {latestState.isRefreshBlocked && latestState.retry && (
                  <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={latestState.retry}>
                    {t('common.refresh', 'Refresh')}
                  </Button>
                )}
              </div>
            ) : (
              <>
                <StaleRefreshWarning state={latestState} label={t('commands.activity.title', 'Recent command activity')} />
                <FreshnessDot
                  updatedAt={latestState.updatedAt}
                  isFetching={latestState.isRefreshing}
                  isStale={latestState.status !== 'ok'}
                  isError={latestState.refreshError != null}
                  source={t('commands.activity.title', 'Recent command activity')}
                />
                {latestCommands.length === 0 && (
                  <Text variant="bodySm">{t('commands.activity.emptyTitle', 'No commands sent yet')}</Text>
                )}
              </>
            )}
          </div>
        )}
        {disabled && (
          <AlertBanner
            variant="warning"
            title={t(
              'operationalMode.commandsDisabled.title',
              'Vehicle commands are read-only',
            )}
          >
            {disabledReason ??
              t(
                'operationalMode.writeBlocked',
                'Return to live mode before making operational changes.',
              )}
          </AlertBanner>
        )}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Heading level="section">
                {t('commands.board.title', 'Control board')}
              </Heading>
              <Badge variant="neutral">
                {t('commands.workspace.count', '{{count}} actions', {
                  count: COMMANDS.length,
                })}
              </Badge>
            </div>
            <Text as="p" variant="bodySm">
              {t(
                'commands.board.description',
                'Apply sends a draft. Requests do not confirm a change in vehicle state.',
              )}
            </Text>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 lg:max-w-md">
            <div className="min-w-0 flex-1 basis-48">
              <CommandSearch value={search} onChange={setSearch} />
            </div>
            <Button type="button" variant="secondary" wrapLabel className="min-h-11"
              aria-pressed={pinnedOnly} onClick={() => setPinnedOnly(value => !value)}>
              <Icon icon={Icons.star} />
              {t('commands.board.pinnedOnly', 'Pinned only')}
            </Button>
            <Button type="button" variant="ghost" wrapLabel className="min-h-11"
              aria-pressed={editingPins} onClick={() => setEditingPins(value => !value)}>
              {t('commands.board.editPins', 'Edit pins')}
            </Button>
            {search && <Button type="button" variant="ghost" className="min-h-11" onClick={() => setSearch('')}>
              {t('commands.search.clear', 'Clear search')}
            </Button>}
          </div>
        </div>

        {visibleGroups.length === 0 ? (
          <EmptyState
            icon={<Icon icon={Icons.search} size="xl" />}
            title={t('commands.search.emptyTitle', 'No matching commands')}
            message={t('commands.board.empty', 'Clear the filters to see all controls and edit pins.')}
            action={{
              label: t('commands.board.clearFilters', 'Clear filters'),
              onClick: () => { setSearch(''); setPinnedOnly(false); },
            }}
            className="py-8"
          />
        ) : (
          <div className="space-y-3">
            {[true, false].map(lead => (
              <div key={String(lead)} className={lead
                ? 'grid min-w-0 grid-cols-1 items-start gap-3 md:grid-cols-2 lg:grid-cols-3'
                : 'columns-1 gap-3 md:columns-2 lg:columns-3'}>
                {visibleGroups.filter(group => group.lead === lead).map(group => (
                  <GlassPanel key={group.id} role="region" aria-label={t(group.labelKey, group.fallback)}
                    id={group.id === 'climate' ? 'climate-controls' : undefined}
                    tabIndex={group.id === 'climate' ? -1 : undefined}
                    data-command-card={group.id}
                    className={cn('@container/controls min-w-0 space-y-3 p-3 sm:p-4',
                      group.id === 'access' && 'md:col-span-2 lg:col-span-1',
                      lead ? 'self-stretch bg-gradient-to-br from-[var(--surface-2)] to-[var(--surface-1)]'
                        : 'mb-3 inline-block w-full break-inside-avoid')}>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn('rounded-shape-sm p-2',
                        group.tone === 'accent' && 'bg-[var(--surface-2)] text-[var(--theme-primary)]',
                        group.tone === 'info' && 'bg-[var(--semantic-info-bg)] text-[var(--semantic-info)]',
                        group.tone === 'success' && 'bg-[var(--semantic-success-bg)] text-[var(--semantic-success)]',
                        group.tone === 'warning' && 'bg-[var(--semantic-warning-bg)] text-[var(--semantic-warning)]')}>
                        <Icon icon={group.icon} size="lg" />
                      </span>
                      <Heading level="panel" as="h3" className="min-w-0 flex-1 break-words">
                        {t(group.labelKey, group.fallback)}
                      </Heading>
                      <Text variant="caption" color="secondary">{group.commands.length}</Text>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {group.commands.map(renderControl)}
                    </div>
                  </GlassPanel>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <CommandDialogs
        active={activeDialog}
        vehicle={vehicle}
        loading={loading}
        onClose={() => setActiveDialog(null)}
        onExecute={onExecute}
      />
    </>
  );
}
