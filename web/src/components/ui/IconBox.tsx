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
  // Fall back to the defaults when an out-of-union `color`/`size` slips in at
  // runtime (e.g. a value coming from untyped JSON or dynamic data cast to
  // NeonColor). Without the guard an unmapped key makes `neonColorMap[color]`
  // undefined and the `c.bg` access throws, crashing the whole surrounding
  // panel instead of degrading to the default tint.
  const c = neonColorMap[color] ?? neonColorMap.cyan
  return (
    <div className={cn(
      'flex items-center justify-center ring-1 shrink-0',
      iconBoxSize[size] ?? iconBoxSize.md,
      c.bg, c.ring, c.text,
      className,
    )}>
      {children}
    </div>
  )
}
