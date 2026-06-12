// The data port the ConditionBuilder feature view binds to (P1/S8 state-holder seam) — the native
// analogue of the web component's single data hook (web/src/features/automations/pages/ConditionBuilder.tsx
// → `useGeofences()`). The view never performs HTTP itself; the [LocationsStore]-backed adapter (or a test
// fake) drives this. Cache-then-network freshness is preserved end to end (ADR-013): the geofences feed's
// cached/stale/error flags flow straight through so the view-model can render the full state matrix.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ConditionBuilder) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.conditionbuilder

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.locations.Geofence
import io.teslasync.shared.core.presentation.locations.LocationsStore
import kotlinx.coroutines.flow.Flow

/**
 * Streams the cache-then-network geofence list the condition builder offers in its geofence-condition
 * dropdown. A single-method seam so the view-model depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete store or the network.
 */
fun interface ConditionBuilderSource {
    /** The cache-then-network geofence feed (cached value first for an instant cold start, then refreshed). */
    fun stream(): Flow<Resource<List<Geofence>>>
}

/**
 * Binds the surface to the shared **S8** [LocationsStore.geofences] feed — the vehicle-agnostic
 * `GET /geofences` list every Locations surface shares (web `useGeofences`). Re-collecting it performs a
 * genuine cache-then-network re-fetch, backing the surface's manual refresh affordance (the web
 * `geofencesRefetch`). No HTTP touches the view — the store (S7/S8) owns it.
 */
fun conditionBuilderSource(locations: LocationsStore): ConditionBuilderSource = ConditionBuilderSource { locations.geofences() }
