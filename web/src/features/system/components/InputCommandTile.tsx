import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button as ControlButton, GlassPanel, Text } from '@/components/ui';
import { Loader2, Star } from 'lucide-react';
import type { CommandDef } from '../commands';

interface InputCommandTileProps {
  def: CommandDef;
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

export function InputCommandTile({ def, onRequestDialog, loading, lastStatus, isFavorite, onToggleFavorite }: InputCommandTileProps) {
  const { t } = useTranslation();
  const Icon = def.icon;
  const variant = def.variant ?? 'default';

  const handleClick = () => {
    if (loading) return;
    onRequestDialog(def);
  };

  return (
    <GlassPanel
      className={cn(
        'p-4 flex flex-col items-center gap-2 transition-all duration-normal text-center min-h-[100px] justify-center cursor-pointer relative group',
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
          isFavorite ? 'opacity-100 text-amber-300' : 'opacity-0 group-hover:opacity-50 text-[var(--text-muted)]',
        )}
        aria-label={t('commands.toggleFavorite', 'Toggle favorite')}
      >
        <Star className={cn('h-3 w-3', isFavorite && 'fill-current')} />
      </ControlButton>

      <div className="rounded-xl p-2.5 transition-colors bg-[var(--surface-2)] text-[var(--text-muted)]">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
      </div>
      <div>
        <Text size="xs" weight="medium" color="primary" className="block">{t(def.labelKey, def.labelFallback)}</Text>
        {def.sublabelFallback && (
          <Text size="2xs" weight="medium" color="muted" className="mt-0.5 block">
            {t(def.sublabelKey ?? '', def.sublabelFallback)}
          </Text>
        )}
        {lastStatus && (
          <Text size="2xs" className={cn('mt-0.5 block',
            lastStatus.startsWith('✓') ? 'text-emerald-300' : 'text-rose-300',
          )}>{lastStatus}</Text>
        )}
      </div>
    </GlassPanel>
  );
}
