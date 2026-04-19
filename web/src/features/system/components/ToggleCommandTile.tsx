import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { GlassPanel } from '@/components/ui';
import { Loader2, Star } from 'lucide-react';
import type { CommandDef, VehicleState } from '../commands';

interface ToggleCommandTileProps {
  def: CommandDef;
  state: VehicleState | null;
  onExecute: (command: string, params?: Record<string, unknown>) => void;
  loading: boolean;
  lastStatus?: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}

const onStyles = {
  default: { panel: 'border-neon-cyan/20 bg-neon-cyan/5', icon: 'bg-neon-cyan/20 text-neon-cyan', dot: 'bg-neon-cyan', text: 'text-neon-cyan' },
  danger:  { panel: 'border-neon-red/20 bg-neon-red/5',   icon: 'bg-neon-red/20 text-neon-red',   dot: 'bg-neon-red',  text: 'text-neon-red' },
  success: { panel: 'border-neon-green/20 bg-neon-green/5', icon: 'bg-neon-green/20 text-neon-green', dot: 'bg-neon-green', text: 'text-neon-green' },
} as const;

export function ToggleCommandTile({ def, state, onExecute, loading, lastStatus, isFavorite, onToggleFavorite }: ToggleCommandTileProps) {
  const { t } = useTranslation();
  const [localToggle, setLocalToggle] = useState(false);

  const isOn = def.stateField && state
    ? Boolean((state as unknown as Record<string, unknown>)[def.stateField])
    : localToggle;

  const variant = def.variant ?? 'default';
  const styles = onStyles[variant];
  const Icon = isOn ? def.icon : (def.iconOff ?? def.icon);

  const handleClick = () => {
    if (loading) return;

    if (isOn) {
      if (!def.stateField) setLocalToggle(false);
      onExecute(def.commandOff!);
    } else {
      // May need input when turning ON (e.g., valet mode PIN)
      if (def.inputConfig) {
        const value = window.prompt(
          t(def.inputConfig.promptKey, def.inputConfig.promptFallback),
          def.inputConfig.defaultValue,
        );
        if (value == null) return;
        if (def.inputConfig.validation === 'pin' && !/^\d{4}$/.test(value)) return;
        const finalParams: Record<string, unknown> = {
          ...def.params,
          [def.inputConfig.paramName]: value,
        };
        if (!def.stateField) setLocalToggle(true);
        onExecute(def.command, finalParams);
      } else {
        if (!def.stateField) setLocalToggle(true);
        onExecute(def.command, def.params);
      }
    }
  };

  return (
    <GlassPanel
      className={cn(
        'p-4 flex flex-col items-center gap-2 transition-all duration-300 text-center min-h-[100px] justify-center cursor-pointer relative group',
        isOn ? styles.panel : 'hover:border-white/10',
        loading && 'opacity-50',
      )}
      onClick={handleClick}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        className={cn(
          'absolute top-1.5 left-1.5 p-0.5 rounded transition-opacity',
          isFavorite ? 'opacity-100 text-neon-amber' : 'opacity-0 group-hover:opacity-50 text-white/30',
        )}
        aria-label={t('commands.toggleFavorite', 'Toggle favorite')}
      >
        <Star className={cn('h-3 w-3', isFavorite && 'fill-current')} />
      </button>

      <div className={cn('absolute top-2 right-2 h-2 w-2 rounded-full', isOn ? styles.dot : 'bg-white/10')} />

      <div className={cn('rounded-xl p-2.5 transition-colors', isOn ? styles.icon : 'bg-white/5 text-white/40')}>
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
      </div>
      <span className="text-xs font-medium text-white/90">{t(def.labelKey, def.labelFallback)}</span>
      <span className={cn('text-[10px] font-medium', isOn ? styles.text : 'text-white/40')}>
        {isOn ? t('commands.on', 'ON') : t('commands.off', 'OFF')}
      </span>
      {lastStatus && (
        <span className={cn('text-[9px]',
          lastStatus.startsWith('✓') ? 'text-neon-green/60' : 'text-neon-red/60',
        )}>{lastStatus}</span>
      )}
    </GlassPanel>
  );
}
