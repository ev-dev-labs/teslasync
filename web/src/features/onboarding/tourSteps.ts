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

export const MAIN_TOUR_STEPS: TourStep[] = MAIN_TOUR.steps

