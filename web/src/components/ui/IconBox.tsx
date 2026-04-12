import { type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { type NeonColor, neonColorMap } from '../../lib/tokens'

interface IconBoxProps {
  children: ReactNode
  color?: NeonColor
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const iconBoxSize = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-10 w-10 rounded-xl',
  lg: 'h-12 w-12 rounded-xl',
}

/** Colored icon container with background ring. Replaces the repeated h-10 w-10 rounded-xl pattern. */
export function IconBox({ children, color = 'cyan', size = 'md', className }: IconBoxProps) {
  const c = neonColorMap[color]
  return (
    <div className={cn(
      'flex items-center justify-center ring-1 shrink-0',
      iconBoxSize[size],
      c.bg, c.ring, c.text,
      className,
    )}>
      {children}
    </div>
  )
}
