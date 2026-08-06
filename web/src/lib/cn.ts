import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge only resolves conflicts between utilities it recognises. The
 * token-backed scales registered in tailwind.config.js (`rounded-shape-*`,
 * `rounded-panel`, `rounded-pill`, `shadow-e*`, `shadow-panel*`) use custom
 * keys, so out of the box twMerge treats them as unrelated classes: a caller
 * passing `className="rounded-lg"` to a primitive whose base is
 * `rounded-panel` would end up with BOTH classes surviving, leaving the CSS
 * source order to silently pick the winner.
 *
 * Registering them in their proper class groups restores last-wins semantics,
 * so `<GlassPanel className="rounded-lg" />` overrides the panel radius exactly
 * the way every other Tailwind utility behaves.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      rounded: [
        {
          rounded: [
            'shape-xs',
            'shape-sm',
            'shape-md',
            'shape-lg',
            'shape-xl',
            'pill',
            'panel',
          ],
        },
      ],
      'shadow': [{ shadow: ['e1', 'e2', 'e3', 'panel', 'panel-hover'] }],
    },
  },
})

/**
 * Merge Tailwind classes with conflict resolution. Combines clsx (conditional
 * composition of strings/arrays/objects with falsy pruning) + tailwind-merge
 * (last conflicting utility wins). Always returns a string.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
