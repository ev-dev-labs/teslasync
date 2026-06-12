// The data port the TriggerConfigurator feature view binds to (P1/S8 state-holder seam) — the native
// analogue of the web component's only data hook, `useGeofences`
// (web/src/api/hooks/useLocations.ts → web/src/features/automations/pages/TriggerConfigurator.tsx). The view
// never performs HTTP itself; the shared LocationsStore adapter (or a test fake) drives this. Cache-then-
// network freshness is preserved end to end (ADR-013): every emission's cached/stale/error flags flow
// through unchanged so the view-model can render the full state matrix on the geofence dropdown.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TriggerConfigurator) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.triggerconfigurator

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.locations.Geofence
import io.teslasync.shared.core.presentation.locations.LocationsStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [TriggerConfiguratorViewModel] depends on so it binds to an abstraction (real adapter
 * ↔ test fake), never to a concrete store or the network. [geofences] is the vehicle-agnostic
 * cache-then-network `GET /geofences` feed the web `useGeofences` hook serves; it populates the geofence
 * dropdown. No HTTP touches the view.
 */
public fun interface TriggerConfiguratorSource {
    /** Stream the shared cache-then-network geofence list (web `useGeofences`). */
    public fun geofences(): Flow<Resource<List<Geofence>>>
}

/**
 * Binds the surface to the shared **S8** [LocationsStore] — the memoized, multi-observer geofence feed every
 * Locations surface shares app-wide (web `useGeofences`). Re-collecting it performs a genuine
 * cache-then-network re-fetch, which backs the surface's retry affordance. No HTTP touches the view — the
 * store (S7/S8) owns it.
 */
public fun LocationsStore.asTriggerConfiguratorSource(): TriggerConfiguratorSource = TriggerConfiguratorSource { geofences() }
