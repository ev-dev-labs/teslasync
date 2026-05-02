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
    target: '[data-tour="vehicles-list"]',
    title: 'Your vehicles',
    description:
      'Every Tesla linked to your account. The card shows live state — online, asleep, charging — and the colour ring matches the section icon set.',
    placement: 'bottom',
    onShow: () => navigate('/vehicles'),
  },
  {
    target: '[data-tour="vehicles-card"]',
    title: 'Open a vehicle for the deep dive',
    description:
      'Click a card for the full digital twin: battery, climate, doors, software updates, location, and the live signal stream.',
    placement: 'right',
  },
  {
    target: '[data-tour="vehicle-detail-tabs"]',
    title: 'Sectioned details',
    description:
      'Tabs split the dossier into Overview, History, Telemetry, and Maintenance so the page stays scannable on mobile.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="vehicle-access"]',
    title: 'Share access',
    description:
      'Invite a partner or family member with their own login. Role-based access controls what they can see and command.',
    placement: 'top',
  },
]

export const VEHICLES_TOUR: TourDefinition = {
  id: 'vehicles',
  routeMatch: /^\/vehicles/,
  titleKey: 'tour.tours.vehicles.title',
  titleFallback: 'Vehicles & sharing',
  descriptionKey: 'tour.tours.vehicles.description',
  descriptionFallback: 'Browse fleet, open a vehicle, share access.',
  version: 1,
  steps: STEPS,
}
