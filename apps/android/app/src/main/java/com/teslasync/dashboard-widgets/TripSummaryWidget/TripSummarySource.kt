// The data port the Trip Summary widget binds to — the native analogue of the single web hook the
// component composes: `useTrips({ limit: 5 })` (web/src/features/dashboard/widgets/TripSummaryWidget.tsx,
// web/src/api/hooks/useTrips.ts). Unlike the per-vehicle widgets, the trip-log list is fleet-wide (no
// `vehicle_id`), so there is no vehicle-resolution seam here — just the one cache-then-network list feed.
// The view never performs HTTP; a concrete adapter over the shared S7/S8 layer (or a test fake) drives
// this seam, and re-collecting it performs a genuine cache-then-network re-fetch (ADR-013), which is what
// backs the widget's manual refresh / error-retry affordance (the web `refetch()`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/TripSummaryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.tripsummary

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TripsRepository
import io.teslasync.shared.core.presentation.trips.Trip
import io.teslasync.shared.core.presentation.trips.TripsParams
import io.teslasync.shared.core.presentation.trips.TripsStore
import kotlinx.coroutines.flow.Flow

/**
 * Streams the cache-then-network `GET /trips?limit=5` list feed the widget renders (web `useTrips`):
 * the cached rows first for an instant cold start, then the refreshed rows. A single-method seam so the
 * view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store/repository
 * or the network.
 */
fun interface TripSummarySource {
    /** The cache-then-network trip-log list feed (web `useTrips({ limit: 5 })`). */
    fun trips(): Flow<Resource<List<Trip>>>
}

/**
 * The query the surface requests — the web `useTrips({ limit: 5 })` argument. The widget shows only the
 * three most-recent trips ([MAX_RECENT_TRIPS]) but, like the web, over-fetches a small page so the list
 * is stable as trips roll in.
 */
private val TRIP_SUMMARY_PARAMS = TripsParams(limit = TripSummaryRegistration.FETCH_LIMIT)

/**
 * Binds the widget to the shared **S8** [TripsStore] — the memoized, multi-observer feed every Trips
 * surface shares. Use this when a host wants the widget to fold into the same shared collection as the
 * rest of the app; the live values (incl. the store's refresh) flow through unchanged. No HTTP touches
 * the view.
 */
fun tripSummarySource(store: TripsStore): TripSummarySource = TripSummarySource { store.trips(TRIP_SUMMARY_PARAMS) }

/**
 * Binds the widget to the shared **S7** [TripsRepository] — the cold cache-then-network feed the S8
 * store also wraps. Re-collecting performs a genuine cache-then-network re-fetch (the web `refetch()`);
 * the view-model reproduces the standard trigger ▸ re-collect pipeline over this port. No HTTP touches
 * the view.
 */
fun tripSummarySource(repository: TripsRepository): TripSummarySource = TripSummarySource { repository.trips(TRIP_SUMMARY_PARAMS) }
