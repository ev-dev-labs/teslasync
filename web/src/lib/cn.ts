import { extendTailwindMerge } from 'tailwind-merge'

interface ClassDictionary {
  [className: string]: unknown
}

type ClassArray = ClassValue[]

type ClassValue = string | number | boolean | null | undefined | ClassDictionary | ClassArray

function joinClassValues(values: readonly ClassValue[]): string {
  const classes: string[] = []

  const append = (value: ClassValue): void => {
    if (!value) return
    if (typeof value === 'string' || typeof value === 'number') {
      classes.push(String(value))
      return
    }
    if (Array.isArray(value)) {
      value.forEach(append)
      return
    }
    if (typeof value === 'object') {
      for (const [className, enabled] of Object.entries(value)) {
        if (enabled) classes.push(className)
      }
    }
  }

  values.forEach(append)
  return classes.join(' ')
}

/**
 * tailwind-merge only resolves conflicts between utilities it recognises. The
 * token-backed scales registered in tailwind.config.js (`rounded-shape-*`,
 * `rounded-panel`, `rounded-pill`, `shadow-e*`, `shadow-panel*`,
 * `duration-fast|normal|slow`, `ease-standard|accelerate|decelerate`) use
 * custom keys, so out of the box twMerge treats them as unrelated classes: a
 * caller passing `className="rounded-lg"` to a primitive whose base is
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
      'duration': [{ duration: ['fast', 'normal', 'slow'] }],
      'ease': [{ ease: ['standard', 'accelerate', 'decelerate'] }],
    },
  },
})

/**
 * Merge Tailwind classes with conflict resolution. Supports conditional
 * strings, arrays, and object maps before applying tailwind-merge's
 * last-conflicting-utility-wins behavior. Always returns a string.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(joinClassValues(inputs))
}
