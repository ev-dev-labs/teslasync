import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchX } from 'lucide-react';
import { Badge, GlassPanel, Heading, Text } from '@/components/ui';
import { AlertBanner, EmptyState } from '@/components/feedback';
import type { CommandLogEntry } from '@/api/hooks/useCommands';
import {
  CATEGORY_META,
  COMMANDS,
  type CommandDef,
  type Vehicle,
  type VehicleState,
} from '../../commands';
import { CommandSearch } from '../CommandSearch';
import { CommandTile } from '../CommandTile';
import { FavoritesBar } from '../FavoritesBar';
import { InputCommandTile } from '../InputCommandTile';
import { ToggleCommandTile } from '../ToggleCommandTile';
import { CommandDialogs, type ActiveCommandDialog } from './CommandDialogs';
import { CommandDomainBrowser } from './CommandDomainBrowser';
import type { CommandDomainId } from './commandDomains';
import { getLatestCommandStatus } from './commandLabels';
import { useCommandFavorites } from './useCommandFavorites';

interface CommandWorkspaceProps {
  vehicle: Vehicle;
  state: VehicleState | null;
  latestCommands: CommandLogEntry[];
  loading: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onExecute: (command: string, params?: Record<string, unknown>) => void;
}

export function CommandWorkspace({
  vehicle,
  state,
  latestCommands,
  loading,
  disabled = false,
  disabledReason,
  onExecute,
}: CommandWorkspaceProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [activeDomainId, setActiveDomainId] = useState<CommandDomainId>('access');
  const [activeDialog, setActiveDialog] = useState<ActiveCommandDialog | null>(null);
  const { favorites, toggleFavorite } = useCommandFavorites(vehicle.id);

  useEffect(() => {
    if (disabled) setActiveDialog(null);
  }, [disabled]);

  const latestByCommand = useMemo(
    () => new Map((latestCommands ?? []).map((entry) => [entry.command, entry])),
    [latestCommands],
  );

  const filteredCommands = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return null;
    return COMMANDS.filter((command) => {
      const category = CATEGORY_META[command.category];
      return (
        t(command.labelKey, command.labelFallback).toLowerCase().includes(query) ||
        t(category.labelKey, category.fallback).toLowerCase().includes(query) ||
        command.command.toLowerCase().includes(query)
      );
    });
  }, [search, t]);

  const requestDialog = useCallback((definition: CommandDef) => {
    const kind = definition.selectConfig
      ? 'select'
      : definition.inputConfig
        ? 'input'
        : 'confirm';
    setActiveDialog({ kind, definition });
  }, []);

  const renderTile = useCallback((definition: CommandDef) => {
    const latest =
      latestByCommand.get(definition.command) ??
      (definition.commandOff
        ? latestByCommand.get(definition.commandOff)
        : undefined);
    const common = {
      loading,
      disabled,
      disabledReason,
      lastStatus: getLatestCommandStatus(latest),
      isFavorite: favorites.includes(definition.id),
      onToggleFavorite: () => toggleFavorite(definition.id),
      onRequestDialog: requestDialog,
    };

    if (definition.type === 'toggle') {
      return (
        <ToggleCommandTile
          key={definition.id}
          {...common}
          def={definition}
          state={state}
          onExecute={onExecute}
        />
      );
    }
    if (definition.type === 'input') {
      return <InputCommandTile key={definition.id} {...common} def={definition} />;
    }
    return (
      <CommandTile
        key={definition.id}
        {...common}
        def={definition}
        onExecute={onExecute}
      />
    );
  }, [
    favorites,
    disabled,
    disabledReason,
    latestByCommand,
    loading,
    onExecute,
    requestDialog,
    state,
    toggleFavorite,
  ]);

  return (
    <>
      <GlassPanel className="space-y-5 p-4 sm:p-5" data-testid="command-workspace">
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
                {t('commands.workspace.title', 'Command workspace')}
              </Heading>
              <Badge variant="neutral">
                {t('commands.workspace.count', '{{count}} actions', {
                  count: COMMANDS.length,
                })}
              </Badge>
            </div>
            <Text as="p" variant="bodySm">
              {t(
                'commands.workspace.description',
                'Find an action by domain or search the complete command catalogue.',
              )}
            </Text>
          </div>
          <div className="w-full lg:max-w-sm">
            <CommandSearch value={search} onChange={setSearch} />
          </div>
        </div>

        {!filteredCommands && (
          <FavoritesBar
            favorites={favorites}
            commands={COMMANDS}
            renderTile={renderTile}
          />
        )}

        {filteredCommands ? (
          filteredCommands.length > 0 ? (
            <div
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
              aria-label={t('commands.search.results', 'Command search results')}
            >
              {filteredCommands.map(renderTile)}
            </div>
          ) : (
            <EmptyState
              icon={<SearchX className="h-8 w-8" aria-hidden="true" />}
              title={t('commands.search.emptyTitle', 'No matching commands')}
              message={t(
                'commands.search.noResults',
                'No commands match your search',
              )}
              action={{
                label: t('commands.search.clear', 'Clear search'),
                onClick: () => setSearch(''),
              }}
              className="py-8"
            />
          )
        ) : (
          <CommandDomainBrowser
            activeDomainId={activeDomainId}
            vehicleKey={vehicle.id}
            onDomainChange={setActiveDomainId}
            renderTile={renderTile}
          />
        )}
      </GlassPanel>

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
