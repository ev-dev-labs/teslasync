import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button as ControlButton, GlassPanel } from '@/components/ui';
import { Loader2, Star, AlertTriangle } from 'lucide-react';
import type { CommandDef } from '../commands';

interface CommandTileProps {
  def: CommandDef;
  onExecute: (command: string, params?: Record<string, unknown>) => void;
  onRequestDialog: (def: CommandDef) => void;
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

export function CommandTile({ def, onExecute, onRequestDialog, loading, lastStatus, isFavorite, onToggleFavorite }: CommandTileProps) {
  const { t } = useTranslation();
  const Icon = def.icon;
  const variant = def.variant ?? 'default';

  const handleClick = () => {
    if (loading) return;
    if (def.dangerous) {
      onRequestDialog(def);
      return;
    }
    onExecute(def.command, def.params);
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
      <ControlButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        className={cn(
          'absolute left-1.5 top-1.5 h-auto rounded p-0.5 transition-opacity hover:bg-transparent',
          isFavorite ? 'opacity-100 text-amber-300' : 'opacity-0 group-hover:opacity-50 text-white/30',
        )}
        aria-label={t('commands.toggleFavorite', 'Toggle favorite')}
      >
        <Star className={cn('h-3 w-3', isFavorite && 'fill-current')} />
      </ControlButton>

      {def.dangerous && (
        <div className="absolute top-1.5 right-1.5">
          <AlertTriangle className="h-3 w-3 text-neon-red/50" />
        </div>
      )}

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
