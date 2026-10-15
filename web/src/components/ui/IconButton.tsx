import type { AriaAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, BUTTON_BASE, BUTTON_VARIANTS } from './Button';
import { Tooltip } from './Tooltip';
import { cn } from '@/lib/cn';

export type IconButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface IconButtonProps {
  icon: ReactNode;
  label: string;
  variant?: IconButtonVariant;
  onClick?: () => void;
  href?: string;
  busy?: boolean;
  disabled?: boolean;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  'aria-haspopup'?: AriaAttributes['aria-haspopup'];
  'aria-expanded'?: boolean;
  className?: string;
}

const ICON_ONLY = 'h-9 w-9 shrink-0 justify-center p-0';

/** A consistently named icon-only action with the shared hover/focus tooltip. */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  onClick,
  href,
  busy = false,
  disabled = false,
  tooltipSide = 'top',
  className,
  ...ariaProps
}: IconButtonProps) {
  const control = href ? (
    <Link
      to={href}
      aria-label={label}
      aria-busy={busy || undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={event => {
        if (disabled) event.preventDefault();
        else onClick?.();
      }}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], ICON_ONLY, className)}
      {...ariaProps}
    >
      {icon}
    </Link>
  ) : (
    <Button
      type="button"
      aria-label={label}
      variant={variant}
      icon={icon}
      loading={busy}
      disabled={disabled}
      onClick={onClick}
      className={cn(ICON_ONLY, className)}
      {...ariaProps}
    />
  );

  return <Tooltip content={label} side={tooltipSide}>{control}</Tooltip>;
}
