const DEFAULT_RETRY_AFTER_S = 60

/** Retry-After is either integer seconds or an HTTP date, not parseInt input. */
export function retryAfterSeconds(
  value: string | null,
  serverDate: string | null = null,
  now = Date.now(),
): number {
  const text = value?.trim() ?? ''
  if (/^\d+$/.test(text)) {
    const seconds = Number(text)
    if (Number.isSafeInteger(seconds) && seconds <= (8.64e15 - now) / 1000) return seconds
    return DEFAULT_RETRY_AFTER_S
  }
  // Date.parse also accepts strings such as "2" and "-1"; those are not HTTP dates.
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*[, ]/i.test(text)) return DEFAULT_RETRY_AFTER_S
  const deadline = Date.parse(text)
  if (!Number.isFinite(deadline)) return DEFAULT_RETRY_AFTER_S
  const reference = serverDate != null && /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*[, ]/i.test(serverDate)
    ? Date.parse(serverDate) : Number.NaN
  return Math.max(0, Math.ceil((deadline - (Number.isFinite(reference) ? reference : now)) / 1000))
}
