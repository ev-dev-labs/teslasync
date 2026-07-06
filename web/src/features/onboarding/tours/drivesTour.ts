import type { TourDefinition } from '@/lib/tourRegistry'
import type { TourStep } from '@/hooks/useTour'

/**
 * Drives tour — walks through the drives history table and the drive-replay
 * experience. The first step calls `navigate('/drives')` from its `onShow`
 * hook so the list is mounted before the spotlight measures its target; the
 * remaining steps assume the user is already on the drives or replay route the
 * launcher recommended them from (see `routeMatch` below).
 */

function navigate(href: string) {
  if (typeof window === 'undefined') return
  if (window.location.pathname === href) return
  window.history.pushState({}, '', href)
  // history.pushState does not emit a popstate on its own; dispatch a
  // synthetic one so the SPA router observes the change and re-renders.
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const STEPS: TourStep[] = [
  {
    target: '[data-tour="drives-list"]',
    title: 'Drives history',
    description:
      'Every drive — distance, energy, average speed. Sort, filter, and Save Views from the toolbar to keep the comparisons you reuse.',
    placement: 'bottom',
    onShow: () => navigate('/drives'),
  },
  {
    target: '[data-tour="drives-saved-views"]',
    title: 'Saved Views',
    description:
      'Any filter/sort combination can be pinned as a Saved View and shared via deep link. Set one as default to land there next time.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="drive-replay-scrubber"]',
    title: 'Replay any drive',
    description:
      'Open a drive and switch to Replay — the scrubber plays the route back in real time. Markers (Prompt 57) flag charging stops, regen events, and alerts. Use ←/→ to step and Space to play/pause.',
    placement: 'top',
  },
  {
    target: '[data-tour="drive-replay-share"]',
    title: 'Share or print the playback',
    description:
      'Copy a deep link to a specific moment, or print the page (Prompt 54) for a clean PDF that hides chrome and keeps charts crisp.',
    placement: 'left',
  },
]

export const DRIVES_TOUR: TourDefinition = {
  id: 'drives',
  routeMatch: /^\/drives/,
  titleKey: 'tour.tours.drives.title',
  titleFallback: 'Drives & replay',
  descriptionKey: 'tour.tours.drives.description',
  descriptionFallback: 'Browse drives, replay the route, share moments.',
  version: 1,
  steps: STEPS,
}
