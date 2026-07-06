import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind classes with conflict resolution. Combines clsx (conditional
 * composition of strings/arrays/objects with falsy pruning) + tailwind-merge
 * (last conflicting utility wins). Always returns a string.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
