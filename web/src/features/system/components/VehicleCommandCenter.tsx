import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { fmtNumber } from '@/lib/numberFormat';
import { GlassPanel, Badge, Text, Caption } from '@/components/ui';
import { useToast } from '@/components/feedback/Toast';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertTempFromSI } from '@/lib/unitConversion';
import { request } from '@/api/client';
import {
  Battery, Wifi, Thermometer, Power, CheckCircle, AlertTriangle, Clock,
} from 'lucide-react';
import {
  COMMANDS, CATEGORY_ORDER, type CommandDef, type CommandLogEntry,
  type Vehicle, type VehicleState,
} from '../commands';
import { CommandTile } from './CommandTile';
import { ToggleCommandTile } from './ToggleCommandTile';
import { InputCommandTile } from './InputCommandTile';
import { CollapsibleCommandGroup } from './CollapsibleCommandGroup';
import { CommandSearch } from './CommandSearch';
import { FavoritesBar } from './FavoritesBar';
import { FreshnessIndicator, useIsStale } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { CommandInputDialog } from './CommandInputDialog';
import { CommandConfirmDialog } from './CommandConfirmDialog';
import { CommandSelectDialog } from './CommandSelectDialog';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const parsed = new Date(dateStr).getTime();
  if (!Number.isFinite(parsed)) return '—';
  const diff = Date.now() - parsed;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface VehicleCommandCenterProps {
  vehicle: Vehicle;
  state: VehicleState | null;
}

export function VehicleCommandCenter({ vehicle, state }: VehicleCommandCenterProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const { unitPrefs } = useUnits();

  const name = vehicle.display_name || vehicle.vin;
  const isAsleep = vehicle.state === 'asleep' || vehicle.state === 'offline';
  const { isStale, ageLabel } = useIsStale(vehicle.updated_at);

  // ─── Command state ──────────────────────────────────────────────────────

  const [lastResult, setLastResult] = useState<{ success: boolean; message: string } | null>(null);
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(`teslasync-cmd-favorites-${vehicle.id}`);
      if (stored) return JSON.parse(stored) as string[];
    } catch { /* noop */ }
    return COMMANDS.filter(c => c.defaultFavorite).map(c => c.id);
  });

  const toggleFavorite = useCallback((cmdId: string) => {
    setFavorites(prev => {
      const next = prev.includes(cmdId)
        ? prev.filter(id => id !== cmdId)
        : [...prev, cmdId];
      try { localStorage.setItem(`teslasync-cmd-favorites-${vehicle.id}`, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, [vehicle.id]);

  // ─── Latest command statuses ────────────────────────────────────────────

  const { data: latestCmds } = useQuery({
    queryKey: ['command-latest', vehicle.id],
    queryFn: () => request<CommandLogEntry[]>(`/vehicles/${vehicle.id}/commands/latest`),
    refetchInterval: 30_000,
  });

  const cmdMap = useMemo(
    () => new Map((latestCmds ?? []).map(c => [c.command, c])),
    [latestCmds],
  );

  const cmdStatus = useCallback((command: string): string | undefined => {
    const entry = cmdMap.get(command);
    if (!entry) return undefined;
    const ago = timeAgo(entry.created_at);
    return entry.status === 'success' ? `✓ ${ago}` : `✗ ${ago}`;
  }, [cmdMap]);

  // ─── Mutations ──────────────────────────────────────────────────────────

  const cmd = useMutation({
    mutationFn: ({ command, params }: { command: string; params?: Record<string, unknown> }) =>
      request<{ success: boolean; message: string }>(`/vehicles/${vehicle.id}/command/${command}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: params ? JSON.stringify(params) : undefined,
      }),
    onSuccess: (data) => {
      setLastResult(data);
      qc.invalidateQueries({ queryKey: ['command-vehicle-states'] });
      qc.invalidateQueries({ queryKey: ['vehicle-state'] });
      qc.invalidateQueries({ queryKey: ['command-latest', vehicle.id] });
      qc.invalidateQueries({ queryKey: ['command-history', String(vehicle.id)] });
      if (data.success) toast.success(`${t('Command sent to')} ${name}`);
      else toast.error(data.message || `${t('Command failed on')} ${name}`);
    },
    onError: (err: Error) => {
      setLastResult({ success: false, message: err.message });
      toast.error(`${t('Command failed')}: ${err.message}`);
    },
  });

  const wakeMut = useMutation({
    mutationFn: () => request<{ success: boolean }>(`/vehicles/${vehicle.id}/command/wake_up`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['command-vehicle-states'] });
      toast.success(`${name} ${t('is waking up')}`);
    },
    onError: (err: Error) => toast.error(`${t('Failed to wake')} ${name}: ${err.message}`),
  });

  const isLoading = cmd.isPending || wakeMut.isPending;

  const executeCommand = useCallback((command: string, params?: Record<string, unknown>) => {
    setLastResult(null);
    if (command === 'wake_up') {
      wakeMut.mutate();
    } else {
      cmd.mutate({ command, params });
    }
  }, []);

  // ─── Centralized dialog state ──────────────────────────────────────────

  interface DialogState {
    kind: 'input' | 'select' | 'confirm';
    def: CommandDef;
  }

  const [activeDialog, setActiveDialog] = useState<DialogState | null>(null);

  const requestDialog = useCallback((def: CommandDef) => {
    if (def.selectConfig) {
      setActiveDialog({ kind: 'select', def });
    } else if (def.inputConfig) {
      setActiveDialog({ kind: 'input', def });
    } else if (def.dangerous) {
      setActiveDialog({ kind: 'confirm', def });
    }
  }, []);

  const closeDialog = useCallback(() => {
    setActiveDialog(null);
  }, []);

  const handleInputSubmit = useCallback((values: Record<string, string>) => {
    if (!activeDialog) return;
    const { def } = activeDialog;
    const ic = def.inputConfig!;

    let params: Record<string, unknown>;
    if (ic.buildParams) {
      params = ic.buildParams(values);
    } else {
      const rawValue = values[ic.paramName];
      const finalValue = ic.transform ? ic.transform(rawValue) : rawValue;
      params = { ...def.params, [ic.paramName]: finalValue };
    }

    executeCommand(def.command, params);
    closeDialog();
  }, [activeDialog, executeCommand, closeDialog]);

  const handleSelectSubmit = useCallback((value: string) => {
    if (!activeDialog) return;
    const { def } = activeDialog;
    const sc = def.selectConfig!;
    executeCommand(def.command, { ...def.params, [sc.paramName]: value });
    closeDialog();
  }, [activeDialog, executeCommand, closeDialog]);

  const handleConfirmSubmit = useCallback(() => {
    if (!activeDialog) return;
    const { def } = activeDialog;
    executeCommand(def.command, def.params);
    closeDialog();
  }, [activeDialog, executeCommand, closeDialog]);

  // ─── Filtering ──────────────────────────────────────────────────────────

  const filteredCommands = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    return COMMANDS.filter(c =>
      t(c.labelKey, c.labelFallback).toLowerCase().includes(q) ||
      c.category.includes(q) ||
      c.command.includes(q)
    );
  }, [search, t]);

  const commandsByCategory = useMemo(() => {
    const groups = new Map<string, CommandDef[]>();
    for (const cmd of COMMANDS) {
      const list = groups.get(cmd.category) ?? [];
      list.push(cmd);
      groups.set(cmd.category, list);
    }
    return groups;
  }, []);

  // ─── Tile renderer ─────────────────────────────────────────────────────

  const renderTile = useCallback((def: CommandDef) => {
    const common = {
      lastStatus: cmdStatus(def.command) ?? (def.commandOff ? cmdStatus(def.commandOff) : undefined),
      loading: isLoading,
      isFavorite: favorites.includes(def.id),
      onToggleFavorite: () => toggleFavorite(def.id),
      onRequestDialog: requestDialog,
    };

    switch (def.type) {
      case 'toggle':
        return <ToggleCommandTile key={def.id} {...common} def={def} state={state} onExecute={executeCommand} />;
      case 'input':
        return <InputCommandTile key={def.id} {...common} def={def} />;
      default:
        return <CommandTile key={def.id} {...common} def={def} onExecute={executeCommand} />;
    }
  }, [cmdStatus, isLoading, favorites, toggleFavorite, state, executeCommand, requestDialog]);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <GlassPanel className="p-6">
      {/* Vehicle header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Text size="lg" weight="semibold" color="primary">{name}</Text>
            <Badge variant={isAsleep ? 'neutral' : 'success'} size="sm">{vehicle.state}</Badge>
            <FreshnessIndicator timestamp={vehicle.updated_at} />
          </div>
          <Caption>{vehicle.model} · {vehicle.vin}</Caption>
        </div>
        {state && (
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1">
              <Battery className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
              <Text weight="semibold" className={(state.battery_level ?? 0) > 50 ? 'text-emerald-300' : 'text-amber-300'}>
                {state.battery_level ?? 0}%
              </Text>
            </span>
            <span className="flex items-center gap-1">
              <Wifi className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
              <Text color="secondary">{fmtNumber(convertDistanceFromSI(state.rated_range ?? 0, unitPrefs.distance), 0)} {unitPrefs.distance}</Text>
            </span>
            {state.inside_temp != null && (
              <span className="flex items-center gap-1">
                <Thermometer className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                <Text color="secondary">{fmtNumber(convertTempFromSI(state.inside_temp, unitPrefs.temperature), 0)}{unitPrefs.temperature}</Text>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Status feedback */}
      {lastResult && (
        <GlassPanel className={cn('p-3 mb-4 flex items-center gap-2',
          lastResult.success ? 'bg-neon-green/5 border-neon-green/20' : 'bg-neon-red/5 border-neon-red/20',
        )}>
          {lastResult.success
            ? <CheckCircle className="h-4 w-4 text-neon-green" aria-hidden="true" />
            : <AlertTriangle className="h-4 w-4 text-neon-red" aria-hidden="true" />
          }
          <Text size="xs" className={lastResult.success ? 'text-emerald-300' : 'text-rose-300'}>
            {lastResult.message}
          </Text>
        </GlassPanel>
      )}

      {isAsleep && (
        <GlassPanel className="p-3 mb-4 flex items-center gap-2 bg-neon-amber/5 border-neon-amber/20">
          <Power className="h-4 w-4 text-neon-amber" aria-hidden="true" />
          <Text size="xs" className="text-amber-300">
            {t('Vehicle is')} {vehicle.state}. {t('Wake it up first to send commands.')}
          </Text>
        </GlassPanel>
      )}

      {isStale && !isAsleep && (
        <AlertBanner variant="warning" icon={<Clock className="h-4 w-4" aria-hidden="true" />}>
          {t('commands.staleData', 'Vehicle data is {{age}} old. The vehicle may be asleep or offline.', { age: ageLabel })}
        </AlertBanner>
      )}

      {/* Search */}
      <div className="mb-5">
        <CommandSearch value={search} onChange={setSearch} />
      </div>

      {/* Commands */}
      <div className="space-y-5">
        {/* Favorites — always visible when not searching */}
        {!filteredCommands && (
          <FavoritesBar
            favorites={favorites}
            commands={COMMANDS}
            renderTile={renderTile}
          />
        )}

        {/* Search results — flat grid */}
        {filteredCommands ? (
          filteredCommands.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredCommands.map(cmd => renderTile(cmd))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Text size="sm" color="muted">{t('commands.search.noResults', 'No commands match your search')}</Text>
            </div>
          )
        ) : (
          /* Category groups — collapsible */
          CATEGORY_ORDER.map(cat => {
            const cmds = commandsByCategory.get(cat);
            if (!cmds?.length) return null;
            return (
              <CollapsibleCommandGroup
                key={cat}
                category={cat}
                vehicleId={vehicle.id}
                count={cmds.length}
              >
                {cmds.map(cmd => renderTile(cmd))}
              </CollapsibleCommandGroup>
            );
          })
        )}
      </div>

      {/* Centralized command dialogs */}
      {activeDialog?.kind === 'input' && (
        <CommandInputDialog
          open
          onClose={closeDialog}
          onSubmit={handleInputSubmit}
          def={activeDialog.def}
          vehicle={vehicle}
          loading={isLoading}
        />
      )}
      {activeDialog?.kind === 'select' && (
        <CommandSelectDialog
          open
          onClose={closeDialog}
          onSelect={handleSelectSubmit}
          def={activeDialog.def}
          loading={isLoading}
        />
      )}
      {activeDialog?.kind === 'confirm' && (
        <CommandConfirmDialog
          open
          onClose={closeDialog}
          onConfirm={handleConfirmSubmit}
          def={activeDialog.def}
          loading={isLoading}
        />
      )}
    </GlassPanel>
  );
}
