/**
 * @deprecated The tour-step definitions moved to per-feature files under
 * `web/src/features/onboarding/tours/`. The main dashboard walkthrough now
 * lives in `tours/mainTour.ts` (Phase-40 / Prompt 65).
 *
 * This file is kept temporarily so any external import of
 * `MAIN_TOUR_STEPS` continues to compile during the migration. It will be
 * removed in a follow-up cleanup.
 */
export { MAIN_TOUR } from './tours/mainTour'
import { MAIN_TOUR } from './tours/mainTour'
import type { TourStep } from '@/hooks/useTour'

// Defensive copy — never hand legacy importers a live reference to the
// canonical `MAIN_TOUR.steps`. That array is shared with the tour registry
// and `useTour`, so a stray `.push`/`.sort`/`.splice` from an old call site
// would corrupt the running walkthrough for every user. `?? []` also guards
// against a future edit leaving `steps` undefined before consumers iterate it.
export const MAIN_TOUR_STEPS: TourStep[] = [...(MAIN_TOUR.steps ?? [])]

