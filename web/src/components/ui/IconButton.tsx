import { forwardRef, type AriaAttributes, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router-dom';
import { Button, BUTTON_BASE, BUTTON_VARIANTS } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { Tooltip } from './Tooltip';
import { useConfirm, type ConfirmOptions } from '@/hooks/useConfirm';
import { cn } from '@/lib/cn';

export type IconButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface IconButtonProps {
  icon: ReactNode;
  label: string;
  /**
   * Repeated actions (Refresh, More, View history, Export …) stay `ghost`:
   * no border or background at rest, a subtle hover fill and the accent
   * focus ring. Only a page's primary action (e.g. Customize) is filled.
   */
  variant?: IconButtonVariant;
  onClick?: () => void;
  /**
   * Destructive icon-only actions (Delete, Remove, Reset, Clear) confirm
   * first: `onClick` runs only after the shared ConfirmDialog is accepted.
   */
  confirm?: ConfirmOptions;
  href?: string;
  busy?: boolean;
  disabled?: boolean;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  /**
   * Long labels (freshness sentences) wrap instead of forcing a
   * viewport-wide nowrap bubble that overflows narrow panels.
   */
  tooltipMultiline?: boolean;
  'aria-label'?: string;
  'aria-haspopup'?: AriaAttributes['aria-haspopup'];
  'aria-expanded'?: boolean;
  'aria-pressed'?: boolean;
  'aria-describedby'?: string;
  'data-testid'?: string;
  'data-tour'?: string;
  className?: string;
}

const ICON_ONLY = 'h-9 w-9 shrink-0 justify-center p-0';
// The shared disabled style fills the control; an icon-only ghost action
// stays bare at rest even when unavailable.
const GHOST_AT_REST = 'disabled:border-transparent disabled:bg-transparent aria-disabled:bg-transparent';

/** A consistently named icon-only action with the shared hover/focus tooltip. */
export const IconButton = forwardRef<HTMLButtonElement | HTMLAnchorElement, IconButtonProps>(function IconButton({
  icon,
  label,
  variant = 'ghost',
  onClick,
  confirm: confirmOptions,
  href,
  busy = false,
  disabled = false,
  tooltipSide = 'top',
  tooltipMultiline = false,
  'aria-label': ariaLabelOverride,
  className,
  ...ariaProps
}, ref) {
  const restClass = variant === 'ghost' ? GHOST_AT_REST : undefined;
  const { confirm, dialogProps } = useConfirm();
  const activate = confirmOptions && onClick
    ? () => { void confirm({ variant: 'danger', ...confirmOptions }).then((ok) => { if (ok) onClick(); }); }
    : onClick;
  const control = href ? (
    <Link
      ref={ref as Ref<HTMLAnchorElement>}
      to={href}
      aria-label={ariaLabelOverride ?? label}
      aria-busy={busy || undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={event => {
        if (disabled) event.preventDefault();
        else activate?.();
      }}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], ICON_ONLY, restClass, className)}
      {...ariaProps}
    >
      {icon}
    </Link>
  ) : (
    <Button
      ref={ref as Ref<HTMLButtonElement>}
      type="button"
      aria-label={ariaLabelOverride ?? label}
      variant={variant}
      icon={icon}
      loading={busy}
      disabled={disabled}
      onClick={activate}
      className={cn(ICON_ONLY, restClass, className)}
      {...ariaProps}
    />
  );

  return (
    <>
      <Tooltip content={label} side={tooltipSide} multiline={tooltipMultiline}>{control}</Tooltip>
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </>
  );
});
