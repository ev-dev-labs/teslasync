/**
 * Filters Go nil string representations from API data.
 * Go's fmt.Sprintf("%v", nil) produces "<nil>" which gets stored in DB
 * and returned by the API as a literal string.
 */
export function cleanNil(v?: string | null): string | undefined {
  if (!v || v === '<nil>' || v === 'nil' || v === 'null') return undefined
  return v
}
