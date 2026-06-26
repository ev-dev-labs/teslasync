/**
 * Class-name merge helper — React Native parity port of `web/src/lib/cn.ts`.
 *
 * ## Web original
 *
 * On the web the source file is two imports plus a one-line wrapper:
 *
 * ```ts
 * import { clsx, type ClassValue } from 'clsx'
 * import { twMerge } from 'tailwind-merge'
 * export function cn(...inputs: ClassValue[]) {
 *   return twMerge(clsx(inputs))
 * }
 * ```
 *
 * `clsx` flattens the variadic inputs (strings, numbers, arrays and
 * `{ class: condition }` dictionaries, dropping falsy values) into a single
 * space-separated class string, and `tailwind-merge` then resolves Tailwind
 * utility conflicts so the *last* conflicting class wins
 * (`cn('p-2', 'p-4') === 'p-4'`).
 *
 * ## Native adaptation
 *
 * React Native has no `className` / Tailwind pipeline: styling is done with
 * `StyleSheet` objects and `style` arrays, so neither `clsx` nor
 * `tailwind-merge` is installed in the native app, and every component port in
 * this tree intentionally drops the `cn` import in favour of native style
 * arrays.
 *
 * To keep this file a faithful, drop-in, dependency-free port we:
 *   - Re-implement the `clsx` flattening algorithm verbatim (same truthiness
 *     filtering, same recursion over arrays, same dictionary-key emission,
 *     same "first non-empty wins the leading space" joining) so `cn(...)` still
 *     returns the identical space-separated string clsx would produce.
 *   - Treat `tailwind-merge`'s Tailwind-conflict resolution as **unavailable**
 *     on native (there is no Tailwind engine to consume the result), so the
 *     clsx-joined string is returned as-is. This is the only behavioural
 *     difference from web — and it is immaterial because no native consumer
 *     feeds the output to a Tailwind processor.
 *
 * The public surface (`cn(...inputs: ClassValue[]): string`) and the accepted
 * input shapes match the web original exactly.
 */

type ClassDictionary = Record<string, unknown>;
type ClassArray = ClassValue[];
type ClassValue =
  | ClassArray
  | ClassDictionary
  | string
  | number
  | null
  | boolean
  | undefined;

/**
 * Mirror of clsx's internal `toVal`: resolve a single input into its class
 * string. Strings/numbers stringify directly, arrays recurse (skipping falsy
 * entries), and dictionaries emit each key whose value is truthy.
 */
function toClassString(value: ClassValue): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (item) {
        const resolved = toClassString(item);
        if (resolved) {
          parts.push(resolved);
        }
      }
    }
    return parts.join(' ');
  }
  if (typeof value === 'object' && value !== null) {
    const parts: string[] = [];
    for (const key of Object.keys(value)) {
      if (value[key]) {
        parts.push(key);
      }
    }
    return parts.join(' ');
  }
  return '';
}

/**
 * Merge class-name inputs into a single space-separated string.
 *
 * Native parity note: Tailwind conflict resolution (the web `tailwind-merge`
 * pass) is unavailable on React Native — there is no Tailwind engine — so the
 * clsx-flattened string is returned unmodified.
 */
export function cn(...inputs: ClassValue[]): string {
  const parts: string[] = [];
  for (const input of inputs) {
    if (input) {
      const resolved = toClassString(input);
      if (resolved) {
        parts.push(resolved);
      }
    }
  }
  return parts.join(' ');
}
