/**
 * TripReplayPage relocation shim.
 *
 * The full TripReplayPage implementation moved to
 * `@/features/trips/pages/TripReplayPage` so it can sit alongside the
 * other trip-scoped pages (TripList, TripDetail) and house the new
 * trip-replay sub-components (TripReplayMap, TripReplayCharts).
 *
 * This module is preserved as a thin re-export so any external import
 * paths keep working without a wide-blast rename. App.tsx and
 * lazyRoutes.list.ts both point at the new location directly.
 */
export { default } from '@/features/trips/pages/TripReplayPage';
