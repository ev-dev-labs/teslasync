export type ContextQueryValue =
  | string
  | number
  | boolean
  | readonly string[]
  | null
  | undefined

/** Build a deep link while omitting unavailable context instead of serializing placeholders. */
export function buildContextHref(
  path: string,
  query: Readonly<Record<string, ContextQueryValue>> = {},
): string {
  const params = new URLSearchParams()

  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue == null || rawValue === '') continue
    const value = Array.isArray(rawValue) ? rawValue.filter(Boolean).join(',') : String(rawValue)
    if (value !== '') params.set(key, value)
  }

  const search = params.toString()
  return search ? `${path}?${search}` : path
}
