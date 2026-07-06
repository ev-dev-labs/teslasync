import { useCallback, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button as ControlButton, GlassPanel, Text } from '@/components/ui';
import { Loader2, Star } from 'lucide-react';
import type { CommandDef, VehicleState } from '../commands';

interface ToggleCommandTileProps {
  def: CommandDef;
  state: VehicleState | null;
  onExecute: (command: string, params?: Record<string, unknown>) => void;
  onRequestDialog: (def: CommandDef) => void;
  loading: boolean;
  lastStatus?: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}

const onStyles = {
  default: { panel: 'border-neon-cyan/20 bg-neon-cyan/5', icon: 'bg-neon-cyan/20 text-neon-cyan', dot: 'bg-neon-cyan', text: 'text-cyan-300' },
  danger:  { panel: 'border-neon-red/20 bg-neon-red/5',   icon: 'bg-neon-red/20 text-neon-red',   dot: 'bg-neon-red',  text: 'text-rose-300' },
  success: { panel: 'border-neon-green/20 bg-neon-green/5', icon: 'bg-neon-green/20 text-neon-green', dot: 'bg-neon-green', text: 'text-emerald-300' },
} as const;

export function ToggleCommandTile({ def, state, onExecute, onRequestDialog, loading, lastStatus, isFavorite, onToggleFavorite }: ToggleCommandTileProps) {
  const { t } = useTranslation();
  const [localToggle, setLocalToggle] = useState(false);

  const isOn = def.stateField && state
    ? Boolean((state as unknown as Record<string, unknown>)[def.stateField])
    : localToggle;

  const variant = def.variant ?? 'default';
  // An API-driven command list may carry a variant we don't have styles for;
  // fall back to the default palette rather than crashing on `styles.panel`.
  const styles = onStyles[variant] ?? onStyles.default;
  const Icon = isOn ? def.icon : (def.iconOff ?? def.icon);
  const label = t(def.labelKey, def.labelFallback);

  const handleActivate = useCallback(() => {
    if (loading) return;

    if (isOn) {
      // A toggle that is on but declares no `commandOff` has nothing to send;
      // bail instead of dispatching an undefined command to the fleet API.
      if (!def.commandOff) return;
      if (!def.stateField) setLocalToggle(false);
      onExecute(def.commandOff);
    } else if (def.inputConfig) {
      onRequestDialog(def);
    } else {
      if (!def.stateField) setLocalToggle(true);
      onExecute(def.command, def.params);
    }
  }, [loading, isOn, def, onExecute, onRequestDialog]);

  // Keyboard parity for the sanctioned role="button" tile (mirrors CommandTile).
  // Ignore key events bubbling up from the nested favorite <button> so pressing
  // Enter/Space while it is focused never also toggles the command.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleActivate();
      }
    },
    [handleActivate],
  );

  return (
    <GlassPanel
      role="button"
      tabIndex={loading ? -1 : 0}
      aria-label={label}
      aria-pressed={isOn}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      className={cn(
        'p-4 flex flex-col items-center gap-2 transition-all duration-normal text-center min-h-[100px] justify-center cursor-pointer relative group',
        'outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--theme-primary)]',
        isOn ? styles.panel : 'hover:border-[var(--border-subtle)]',
        loading && 'opacity-50 cursor-not-allowed',
      )}
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
    >
      <ControlButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        aria-pressed={isFavorite}
        className={cn(
          'absolute left-1.5 top-1.5 h-auto rounded p-0.5 transition-opacity hover:bg-transparent',
          isFavorite ? 'opacity-100 text-amber-300' : 'opacity-0 group-hover:opacity-50 text-[var(--text-muted)]',
        )}
        aria-label={t('commands.toggleFavorite', 'Toggle favorite')}
      >
        <Star aria-hidden="true" className={cn('h-3 w-3', isFavorite && 'fill-current')} />
      </ControlButton>

      <div aria-hidden="true" className={cn('absolute top-2 right-2 h-2 w-2 rounded-full', isOn ? styles.dot : 'bg-[var(--surface-2)]')} />

      <div className={cn('rounded-xl p-2.5 transition-colors', isOn ? styles.icon : 'bg-[var(--surface-2)] text-[var(--text-muted)]')}>
        {loading ? <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" /> : <Icon aria-hidden="true" className="h-5 w-5" />}
      </div>
      <Text size="xs" weight="medium" color="primary">{label}</Text>
      <Text size="2xs" weight="medium" className={isOn ? styles.text : 'text-[var(--text-muted)]'}>
        {isOn ? t('commands.on', 'ON') : t('commands.off', 'OFF')}
      </Text>
      {lastStatus && (
        <Text size="2xs" className={lastStatus.startsWith('✓') ? 'text-emerald-300' : 'text-rose-300'}>{lastStatus}</Text>
      )}
    </GlassPanel>
  );
}
