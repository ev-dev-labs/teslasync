import { useCallback, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button as ControlButton, GlassPanel, Text } from '@/components/ui';
import { Loader2, Star } from 'lucide-react';
import type { CommandDef } from '../commands';

interface InputCommandTileProps {
  def: CommandDef;
  onRequestDialog: (def: CommandDef) => void;
  loading: boolean;
  disabled?: boolean;
  disabledReason?: string;
  lastStatus?: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}

const hoverStyles = {
  default: 'hover:border-neon-cyan/30',
  danger: 'hover:border-neon-red/30',
  success: 'hover:border-neon-green/30',
} as const;

export function InputCommandTile({ def, onRequestDialog, loading, disabled = false, disabledReason, lastStatus, isFavorite, onToggleFavorite }: InputCommandTileProps) {
  const { t } = useTranslation();
  const Icon = def.icon;
  const variant = def.variant ?? 'default';
  const label = t(def.labelKey, def.labelFallback);

  const handleActivate = useCallback(() => {
    if (loading || disabled) return;
    onRequestDialog(def);
  }, [loading, disabled, onRequestDialog, def]);

  // The tile is a clickable surface, so mirror native button keyboard
  // semantics (Enter/Space) — otherwise the command is mouse-only.
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleActivate();
      }
    },
    [handleActivate],
  );

  const handleToggleFavorite = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      onToggleFavorite();
    },
    [onToggleFavorite],
  );

  return (
    <GlassPanel
      role="button"
      tabIndex={loading || disabled ? -1 : 0}
      aria-label={label}
      aria-busy={loading || undefined}
      aria-disabled={loading || disabled || undefined}
      title={disabled ? disabledReason : undefined}
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
      className={cn(
        'p-3 sm:p-4 flex flex-col items-center gap-2 transition-all duration-normal text-center min-h-[116px] justify-center cursor-pointer relative group select-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]',
        hoverStyles[variant] ?? hoverStyles.default,
        (loading || disabled) && 'opacity-50 cursor-not-allowed',
      )}
    >
      <ControlButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleToggleFavorite}
        aria-pressed={isFavorite}
        className={cn(
          'absolute left-0 top-0 min-h-11 min-w-11 rounded p-0 transition-opacity hover:bg-transparent',
          isFavorite
            ? 'opacity-100 text-amber-300'
            : 'opacity-60 text-[var(--text-muted)] focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-60',
        )}
        aria-label={t('commands.toggleFavorite', 'Toggle favorite')}
      >
        <Star className={cn('h-3.5 w-3.5', isFavorite && 'fill-current')} aria-hidden="true" />
      </ControlButton>

      <div className="rounded-xl p-2.5 transition-colors bg-[var(--surface-2)] text-[var(--text-muted)]">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : Icon ? (
          // Guard a missing icon reference: CommandDef is config-driven, and one
          // undefined `icon` would otherwise throw "Element type is invalid" and
          // blank the whole command grid rather than just this tile.
          <Icon className="h-5 w-5" aria-hidden="true" />
        ) : null}
      </div>
      <div>
        <Text size="xs" weight="medium" color="primary" className="block">{label}</Text>
        {def.sublabelFallback && (
          <Text size="2xs" weight="medium" color="muted" className="mt-0.5 block">
            {t(def.sublabelKey ?? '', def.sublabelFallback)}
          </Text>
        )}
        {lastStatus && (
          <Text
            size="2xs"
            aria-live="polite"
            className={cn(
              'mt-0.5 block',
              lastStatus.startsWith('✓') ? 'text-emerald-300' : 'text-rose-300',
            )}
          >
            {lastStatus}
          </Text>
        )}
      </div>
    </GlassPanel>
  );
}
