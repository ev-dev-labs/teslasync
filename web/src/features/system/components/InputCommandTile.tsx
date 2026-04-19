import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { GlassPanel } from '@/components/ui';
import { Loader2, Star } from 'lucide-react';
import type { CommandDef, TranslateFn } from '../commands';

interface InputCommandTileProps {
  def: CommandDef;
  vehicle?: { display_name: string };
  onExecute: (command: string, params?: Record<string, unknown>) => void;
  loading: boolean;
  lastStatus?: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}

const hoverStyles = {
  default: 'hover:border-neon-cyan/30',
  danger: 'hover:border-neon-red/30',
  success: 'hover:border-neon-green/30',
} as const;

export function InputCommandTile({ def, vehicle, onExecute, loading, lastStatus, isFavorite, onToggleFavorite }: InputCommandTileProps) {
  const { t } = useTranslation();
  const Icon = def.icon;
  const variant = def.variant ?? 'default';

  const handleClick = () => {
    if (loading) return;

    if (def.customExecute) {
      def.customExecute(onExecute, t as TranslateFn, vehicle);
      return;
    }

    if (def.inputConfig) {
      const { promptKey, promptFallback, paramName, defaultValue, validation, min, max, transform } = def.inputConfig;
      const value = window.prompt(t(promptKey, promptFallback), defaultValue);
      if (value == null) return;

      if (validation === 'pin' && !/^\d{4}$/.test(value)) return;
      if (validation === 'number') {
        const num = parseInt(value, 10);
        if (isNaN(num)) return;
        if (min != null && num < min) return;
        if (max != null && num > max) return;
      }

      const finalValue = transform ? transform(value) : value;
      const params: Record<string, unknown> = { ...def.params, [paramName]: finalValue };
      onExecute(def.command, params);
    }
  };

  return (
    <GlassPanel
      className={cn(
        'p-4 flex flex-col items-center gap-2 transition-all duration-300 text-center min-h-[100px] justify-center cursor-pointer relative group',
        hoverStyles[variant],
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

      <div className="rounded-xl p-2.5 transition-colors bg-white/5 text-white/40">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
      </div>
      <div>
        <span className="text-xs font-medium text-white/90 block">{t(def.labelKey, def.labelFallback)}</span>
        {def.sublabelFallback && (
          <span className="text-[10px] mt-0.5 font-medium block text-white/40">
            {t(def.sublabelKey ?? '', def.sublabelFallback)}
          </span>
        )}
        {lastStatus && (
          <span className={cn('text-[9px] mt-0.5 block',
            lastStatus.startsWith('✓') ? 'text-neon-green/60' : 'text-neon-red/60',
          )}>{lastStatus}</span>
        )}
      </div>
    </GlassPanel>
  );
}
