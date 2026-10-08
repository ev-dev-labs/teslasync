import { type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { type NeonColor, neonColorMap } from '../../lib/tokens'

interface IconBoxProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  color?: NeonColor
  size?: 'sm' | 'md' | 'lg'
}

const iconBoxSize = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
}

/** Semantic glyph container; historical color IDs retain their token mappings. */
export function IconBox({ children, color = 'cyan', size = 'md', className, ...props }: IconBoxProps) {
  // Runtime inputs can bypass the union, including inherited object keys.
  const c = Object.prototype.hasOwnProperty.call(neonColorMap, color) ? neonColorMap[color] : neonColorMap.cyan
  return (
    <div {...props} className={cn(
      'flex items-center justify-center ring-1 shrink-0 rounded-shape-sm',
      'forced-colors:outline forced-colors:outline-1 forced-colors:outline-current',
      Object.prototype.hasOwnProperty.call(iconBoxSize, size) ? iconBoxSize[size] : iconBoxSize.md,
      c.bg, c.ring, c.text,
      className,
    )}>
      {children}
    </div>
  )
}
