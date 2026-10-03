import { useMemo } from 'react'
import { CHANGELOG, type ChangelogEntry } from '@/generated/changelog'
import {
  compareVersions,
  useChangelogStatus,
  type UseChangelogStatusResult,
} from './useChangelogStatus'

export {
  compareVersions,
  openChangelogModal,
  OPEN_CHANGELOG_MODAL_EVENT,
  SEEN_VERSION_KEY,
  LAST_SHOWN_KEY,
} from './useChangelogStatus'

export interface UseChangelogResult extends Omit<UseChangelogStatusResult, 'unseenCount'> {
  entries: readonly ChangelogEntry[]
  newEntries: readonly ChangelogEntry[]
}

/** Full release content stays with lazy release-note surfaces, not shell badges. */
export function useChangelog(): UseChangelogResult {
  const status = useChangelogStatus()
  const newEntries = useMemo(() => {
    const seenVersion = status.seenVersion
    if (!seenVersion) return CHANGELOG
    return CHANGELOG.filter((entry) => compareVersions(entry.version, seenVersion) > 0)
  }, [status.seenVersion])

  return { ...status, entries: CHANGELOG, newEntries }
}
