import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button as ControlButton, GlassPanel, Text } from '@/components/ui';
import { Loader2, Star, AlertTriangle } from 'lucide-react';
import type { CommandDef } from '../commands';

interface CommandTileProps {
  def: CommandDef;
  onExecute: (command: string, params?: Record<string, unknown>) => void;
  onRequestDialog: (def: CommandDef) => void;
  loading: boolean;
  disabled?: boolean;
  disabledReason?: string;
  lastStatus?: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}

const hoverStyles = {
  default: 'hover:border-[var(--semantic-info-border)]',
  danger: 'hover:border-[var(--semantic-danger-border)]',
  success: 'hover:border-[var(--semantic-success-border)]',
} as const;

export function CommandTile({ def, onExecute, onRequestDialog, loading, disabled = false, disabledReason, lastStatus, isFavorite, onToggleFavorite }: CommandTileProps) {
  const { t } = useTranslation();
  const Icon = def.icon;
  const variant = def.variant ?? 'default';
  const label = t(def.labelKey, def.labelFallback);

  const handleActivate = useCallback(() => {
    if (loading || disabled) return;
    if (def.dangerous) {
      onRequestDialog(def);
      return;
    }
    onExecute(def.command, def.params);
  }, [loading, disabled, def, onRequestDialog, onExecute]);

  return (
    <GlassPanel
      title={disabled ? disabledReason : undefined}
      className="p-0 flex flex-col min-w-0 min-h-[116px] relative group"
    >
      <ControlButton
        type="button"
        variant="ghost"
        disabled={loading || disabled}
        tabIndex={loading || disabled ? -1 : 0}
        aria-label={label}
        aria-busy={loading || undefined}
        aria-disabled={loading || disabled || undefined}
        title={disabled ? disabledReason : undefined}
        className={cn(
          // Reserve the favorite's entire 44px row so the sibling hit areas never overlap.
          'mt-11 h-auto min-h-11 w-full min-w-0 flex-col gap-2 p-3 sm:p-4 whitespace-normal break-words text-center border border-transparent',
          hoverStyles[variant] ?? hoverStyles.default,
        )}
        onClick={handleActivate}
      >
        <span className="rounded-xl p-2.5 transition-colors bg-[var(--surface-2)] text-[var(--text-muted)]">
          {loading ? <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin motion-reduce:animate-none" /> : <Icon aria-hidden="true" className="h-5 w-5" />}
        </span>
        <span className="min-w-0">
          <Text size="xs" weight="medium" color="primary" className="block">{label}</Text>
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
        </span>
      </ControlButton>

      <ControlButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={onToggleFavorite}
        aria-pressed={isFavorite}
        className={cn(
          'absolute left-0 top-0 min-h-11 min-w-11 rounded p-0 transition-opacity hover:bg-transparent',
          isFavorite
            ? 'opacity-100 text-amber-300'
            : 'opacity-60 text-[var(--text-muted)] focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-60',
        )}
        aria-label={t('commands.toggleFavorite', 'Toggle favorite')}
      >
        <Star aria-hidden="true" className={cn('h-3.5 w-3.5', isFavorite && 'fill-current')} />
      </ControlButton>

      {def.dangerous && (
        <div className="absolute top-1.5 right-1.5">
          <AlertTriangle aria-hidden="true" className="h-3 w-3 text-[var(--semantic-danger)]" />
        </div>
      )}
    </GlassPanel>
  );
}
