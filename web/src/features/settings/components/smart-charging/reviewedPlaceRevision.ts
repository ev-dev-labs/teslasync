import type { Geofence } from '@/api/types'

const wireTimestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.(\d{1,9}))?(?:Z|[+-]\d\d:\d\d)$/

export function matchesReviewedPlaceRevision(places: Geofence[], id: number | null, revision: string | null) {
  const updated = places.find(place => place.id === id)?.updated_at
  if (!updated || !revision) return false
  const left = wireTimestamp.exec(updated)
  const right = wireTimestamp.exec(revision)
  // Date alone loses the sub-millisecond precision of the stored revision.
  return left != null && right != null && Date.parse(updated) === Date.parse(revision) &&
    (left[1] ?? '').padEnd(9, '0') === (right[1] ?? '').padEnd(9, '0')
}
