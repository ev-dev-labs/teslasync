import { type ReactNode, type HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'
import { X } from 'lucide-react'

interface AlertBannerProps extends HTMLAttributes<HTMLDivElement> {
  variant: 'info' | 'success' | 'warning' | 'danger'
  title?: string
  children: ReactNode
  onClose?: () => void
  icon?: ReactNode
}

const alertVariantMap: Record<string, { border: string; bg: string; text: string; titleText: string }> = {
  info:    { border: 'border-neon-cyan/20',   bg: 'bg-neon-cyan/5',   text: 'text-neon-cyan/80',   titleText: 'text-neon-cyan' },
  success: { border: 'border-neon-green/20',  bg: 'bg-neon-green/5',  text: 'text-neon-green/80',  titleText: 'text-neon-green' },
  warning: { border: 'border-neon-amber/20',  bg: 'bg-neon-amber/5',  text: 'text-neon-amber/80',  titleText: 'text-neon-amber' },
  danger:  { border: 'border-neon-red/20',    bg: 'bg-neon-red/5',    text: 'text-neon-red/80',    titleText: 'text-neon-red' },
}

/** Inline notification banner for info, success, warning, or error messages. */
export function AlertBanner({ variant, title, children, onClose, icon, className, ...props }: AlertBannerProps) {
  const v = alertVariantMap[variant]
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border p-4 backdrop-blur-sm', v.border, v.bg, className)} {...props}>
      {icon && <div className={cn('shrink-0 mt-0.5', v.titleText)}>{icon}</div>}
      <div className="flex-1 min-w-0">
        {title && <p className={cn('text-sm font-medium', v.titleText)}>{title}</p>}
        <div className={cn('text-xs', v.text, title && 'mt-0.5')}>{children}</div>
      </div>
      {onClose && (
        <button onClick={onClose} className={cn('shrink-0 rounded-lg p-1 transition-colors hover:bg-white/[0.06]', v.text)}>
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
