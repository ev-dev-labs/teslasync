import { useTranslation } from 'react-i18next';
import { Button, Icon, Text } from '@/components/ui';
import { Icons } from '@/lib/icons';
import { cn } from '@/lib/cn';
import { isVehicleStateFieldCurrent, type VerifiedVehicleStateField } from '@/api/hooks/useVehicles';
import type { CommandDef, Vehicle, VehicleState } from '../../commands';
import { CommandInlineInput } from './CommandInlineInput';
import { supportsInlineInput } from './commandInput';

interface CommandBoardControlProps {
  definition: CommandDef;
  vehicle: Vehicle;
  state: VehicleState | null;
  stateTrust?: Parameters<typeof isVehicleStateFieldCurrent>[0];
  loading: boolean;
  disabled: boolean;
  disabledReason?: string;
  favorite: boolean;
  editingPins: boolean;
  matched: boolean;
  lastStatus?: string;
  onToggleFavorite: () => void;
  onRequestDialog: (definition: CommandDef) => void;
  onExecute: (command: string, params?: Record<string, unknown>) => void;
}

export function CommandBoardControl({
  definition: def, vehicle, state, stateTrust, loading, disabled, disabledReason,
  favorite, editingPins, matched, lastStatus, onToggleFavorite, onRequestDialog, onExecute,
}: CommandBoardControlProps) {
  const { t } = useTranslation();
  const label = t(def.labelKey, def.labelFallback);
  const blocked = disabled || loading;
  const inline = supportsInlineInput(def);
  const toggle = def.type === 'toggle';
  const reading = def.stateField ? state?.[def.stateField as keyof VehicleState] : undefined;
  const known = typeof reading === 'boolean' ? reading : null;
  const current = known !== null && !!def.stateField
    && isVehicleStateFieldCurrent(stateTrust, def.stateField as VerifiedVehicleStateField);
  const observed = current ? known : null;
  const onLabel = def.id === 'lock' ? t('commands.board.lockDoors', 'Lock doors') : t('commands.on', 'On');
  const offLabel = def.id === 'lock' ? t('commands.board.unlockDoors', 'Unlock doors') : t('commands.off', 'Off');

  function activate(on = true) {
    if (blocked) return;
    if (!on) {
      if (def.commandOff) onExecute(def.commandOff);
    } else if (def.dangerous || def.inputConfig || def.selectConfig) {
      onRequestDialog(def);
    } else {
      onExecute(def.command, def.params);
    }
  }

  return (
    <div data-command-id={def.id} data-command-match={matched || undefined}
      role="group" aria-label={label}
      className={cn('min-w-0 rounded-shape-sm',
        inline || toggle ? 'col-span-2 space-y-1' : 'border border-[var(--control-border)] bg-[var(--control-bg)]',
        editingPins && !inline && !toggle && 'col-span-2 @[360px]/controls:col-span-1',
        matched && 'ring-2 ring-[var(--focus-ring)] ring-offset-2 ring-offset-[var(--surface-1)]')}>
      <div className="flex min-w-0 items-start gap-1">
        {inline || toggle ? (
          <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2">
            <Icon icon={def.icon} size="lg" className="text-[var(--text-secondary)]" />
            <Text variant="bodySm" weight="medium" className="min-w-0 break-words">{label}</Text>
          </div>
        ) : (
          <Button type="button" variant={def.dangerous ? 'danger' : 'ghost'} wrapLabel
            aria-label={label} aria-disabled={blocked || undefined} aria-busy={loading || undefined}
            title={disabled ? disabledReason : undefined} disabled={blocked}
            className="min-h-11 min-w-0 flex-1 justify-start px-1 text-start"
            icon={<Icon icon={def.icon} size="lg" />} onClick={() => activate()}>
            <span className="min-w-0 break-words">{label}</span>
          </Button>
        )}
        {editingPins && <Button type="button" variant="ghost" size="sm" className="min-h-11 min-w-11 shrink-0 px-0"
          aria-label={t('commands.board.pin', 'Pin {{command}}', { command: label })}
          aria-pressed={favorite} onClick={onToggleFavorite}>
          <Icon icon={Icons.star} className={cn('text-[var(--text-muted)]', favorite && 'fill-current text-[var(--theme-primary)]')} />
        </Button>}
      </div>
      {def.sublabelKey && (
        <Text as="p" variant="caption" color="secondary" className="mb-1 break-words px-1">
          {t(def.sublabelKey, def.sublabelFallback ?? '')}
        </Text>
      )}
      {inline ? (
        <CommandInlineInput definition={def} vehicle={vehicle} blocked={blocked} onExecute={onExecute} />
      ) : toggle ? (
        <div className="space-y-2">
          <Text as="p" variant="caption" color="secondary" data-testid="command-toggle-reading">
            {observed !== null
              ? observed ? t('commands.on', 'On') : t('commands.off', 'Off')
              : known !== null
                ? t('commands.hero.lastKnownStatus', 'Last known: {{status}}', {
                    status: known ? t('commands.on', 'On') : t('commands.off', 'Off'),
                  })
                : t('commands.readiness.stateUnknown', 'State unknown')}
          </Text>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" wrapLabel className="min-h-11"
              disabled={blocked} aria-pressed={observed ?? undefined}
              icon={<Icon icon={def.icon} />} onClick={() => activate()}>{onLabel}</Button>
            {def.commandOff && (
              <Button type="button" variant="secondary" wrapLabel className="min-h-11"
                disabled={blocked} aria-pressed={observed === null ? undefined : !observed}
                icon={<Icon icon={def.iconOff ?? Icons.power} />} onClick={() => activate(false)}>{offLabel}</Button>
            )}
          </div>
        </div>
      ) : null}
      {lastStatus && <Text as="p" variant="caption" color="secondary" className="mt-2">
        {t('commands.board.lastRequest', 'Last request: {{status}}', { status: lastStatus })}
      </Text>}
    </div>
  );
}
