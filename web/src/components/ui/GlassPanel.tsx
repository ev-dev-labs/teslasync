import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  glow?: 'cyan' | 'green' | 'purple' | 'none';
  hover?: boolean;
  children: ReactNode;
  className?: string;
}

const glowClasses = {
  cyan: 'hover:border-cyan-400/30 hover:shadow-[0_0_15px_rgba(34,211,238,0.1)]',
  green: 'hover:border-green-400/30 hover:shadow-[0_0_15px_rgba(74,222,128,0.1)]',
  purple: 'hover:border-purple-400/30 hover:shadow-[0_0_15px_rgba(192,132,252,0.1)]',
  none: '',
} as const;

export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(
  ({ glow = 'none', hover = false, className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl',
        hover && 'transition-all duration-300',
        hover && glowClasses[glow],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);
GlassPanel.displayName = 'GlassPanel';
