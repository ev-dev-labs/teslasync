import type { TourDefinition } from '@/lib/tourRegistry'
import type { TourStep } from '@/hooks/useTour'

function navigate(href: string) {
  if (typeof window === 'undefined') return
  if (window.location.pathname === href) return
  window.history.pushState({}, '', href)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const STEPS: TourStep[] = [
  {
    target: '[data-tour="debugger-timeline"]',
    title: 'State machine timeline',
    description:
      'Every transition for the selected vehicle, ordered newest-first. Hover a row to peek at the inputs that drove the decision.',
    placement: 'bottom',
    onShow: () => navigate('/state-debugger'),
  },
  {
    target: '[data-tour="debugger-source-badges"]',
    title: 'Source-layer badges',
    description:
      'L1 = in-process Store, L2 = Redis, LOG = signal_log, STALE = stale Redis. The badge tells you which layer answered each read.',
    placement: 'right',
  },
  {
    target: '[data-tour="debugger-controls"]',
    title: 'Freeze, step, replay',
    description:
      'Pause the live stream so you can inspect a moment, then step through transitions one at a time. Useful when reproducing a flaky issue.',
    placement: 'top',
  },
  {
    target: '[data-tour="debugger-share"]',
    title: 'Permalink the moment (Prompt 58)',
    description:
      'Copy a deep link that pins the timeline to the exact transition you opened — perfect for bug reports and async hand-offs.',
    placement: 'left',
  },
]

export const DEBUGGER_TOUR: TourDefinition = {
  id: 'debugger',
  routeMatch: /^\/(state-debugger|live-monitor|signal-explorer|signal-diff|signal-gaps|mqtt-inspector|signal-log|redis-signals)/,
  titleKey: 'tour.tours.debugger.title',
  titleFallback: 'State machine debugger',
  descriptionKey: 'tour.tours.debugger.description',
  descriptionFallback: 'Timeline, layered sources, freeze/step, deep links.',
  version: 1,
  steps: STEPS,
}
