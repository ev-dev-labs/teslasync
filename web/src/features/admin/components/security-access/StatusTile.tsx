import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Caption, Text } from '@/components/ui';
import type { TileTone } from './helpers';
/**
 * Token-driven status tile used by the Security & Access status/window
 * grids. The icon chip carries the semantic tone while the value text uses
 * a toned 300-level accent — status is always conveyed by icon + text, never
 * color alone. `muted` renders a neutral chip for unknown/inactive states.
 */
const toneClasses: Record<TileTone, { chip: string; value: string }> = {
  green: { chip: 'bg-neon-green/10 ring-neon-green/20 text-emerald-300', value: 'text-emerald-300' },
  red: { chip: 'bg-neon-red/10 ring-neon-red/20 text-rose-300', value: 'text-rose-300' },
  amber: { chip: 'bg-neon-amber/10 ring-neon-amber/20 text-amber-300', value: 'text-amber-300' },
  blue: { chip: 'bg-neon-blue/10 ring-neon-blue/20 text-indigo-300', value: 'text-indigo-300' },
  purple: { chip: 'bg-neon-purple/10 ring-neon-purple/20 text-purple-300', value: 'text-purple-300' },
  cyan: { chip: 'bg-neon-cyan/10 ring-neon-cyan/20 text-cyan-300', value: 'text-cyan-300' },
  muted: { chip: 'bg-white/[0.04] ring-white/[0.08] text-[var(--text-muted)]', value: 'text-[var(--text-secondary)]' },
};

export interface StatusTileProps {
  icon: ReactNode;
  label: string;
  value: string;
  description?: string;
  tone: TileTone;
  /** Prominence of the value line. Status cards use `lg`, dense grids `base`. */
  size?: 'base' | 'lg';
  className?: string;
}

export function StatusTile({ icon, label, value, description, tone, size = 'base', className }: StatusTileProps) {
  // Fail closed to the neutral chip if an unrecognized tone leaks past the
  // TS union at runtime (e.g. a widened value from an untyped caller) so the
  // tile stays legible instead of throwing on `c.chip`.
  const c = toneClasses[tone] ?? toneClasses.muted;
  return (
    <div
      className={cn(
        'rounded-xl border border-white/[0.04] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.08]',
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1', c.chip)}
        >
          {icon}
        </span>
        <Caption className="min-w-0 truncate">{label}</Caption>
      </div>
      <Text
        as="p"
        size={size === 'lg' ? 'lg' : 'base'}
        weight="semibold"
        className={cn('mt-2 truncate', c.value)}
      >
        {value ?? '—'}
      </Text>
      {description && (
        <Text as="p" variant="caption" className="mt-0.5 block truncate">
          {description}
        </Text>
      )}
    </div>
  );
}
