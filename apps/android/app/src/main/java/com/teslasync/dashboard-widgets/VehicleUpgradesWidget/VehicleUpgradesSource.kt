// The data port the VehicleUpgrades widget binds to + its shared-layer bindings and the upgrades-primary
// three-feed composition — the native analogue of the web hook composition in
// web/src/features/dashboard/widgets/VehicleUpgradesWidget.tsx (`useVehicles` + `useVehicleUpgrades` +
// `useDrives` → `useShareLinks`; see web/src/api/hooks/{useVehicles,useDriving,useSharing}.ts; P1/S8
// state-holder boundary). The view never performs HTTP itself, and a test fake stands in for the whole domain.
//
// The web reads the active vehicle id (`vehicleId ?? vehicles?.[0]?.id ?? 0`), then drives THREE queries:
// `useVehicleUpgrades(id)` (the PRIMARY feed — its loading / freshness / error flow to the `WidgetShell` via
// `shellProps`), `useDrives(id)` (to find the most-recent drive), and `useShareLinks(recentDriveId)` (enabled
// only once a drive resolves). The upgrades feed alone gates the surface state; the drives → share-links chain
// only enriches the share-links section, so a share-links failure never blanks the widget.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/VehicleUpgradesWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vehicleupgrades

import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SharingRepository
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.driving.DrivingStore
import io.teslasync.shared.core.presentation.sharing.ShareToken
import io.teslasync.shared.core.presentation.sharing.SharingStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * The single seam the [VehicleUpgradesWidgetViewModel] depends on so it binds to an abstraction (real adapter
 * ↔ test fake), never to a concrete store/repository or the network. [vehicles] resolves the default vehicle
 * (web `vehicles?.[0]?.id`); [vehicleUpgrades] is the cache-then-network upgrades envelope (web
 * `useVehicleUpgrades`, the PRIMARY feed); [drives] is the per-vehicle drive list used to find the most-recent
 * drive (web `useDrives`); [shareLinks] is that drive's share rows (web `useShareLinks`). No HTTP touches the
 * view.
 */
interface VehicleUpgradesSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network upgrades envelope (web `useVehicleUpgrades`). */
    fun vehicleUpgrades(vehicleId: String): Flow<Resource<JsonElement>>

    /** Stream one vehicle's cache-then-network drive list (web `useDrives`), newest first. */
    fun drives(vehicleId: String): Flow<Resource<List<Drive>>>

    /** Stream one drive's cache-then-network share links (web `useShareLinks`). */
    fun shareLinks(driveId: String): Flow<Resource<List<ShareToken>>>
}

/**
 * Binds the surface to the shared **S8** stores — the memoized, multi-observer holders every surface shares
 * app-wide. Use this when a host wants the widget to fold into the same shared collections as the rest of the
 * app; the live values (incl. each store's background refresh) flow through unchanged. No HTTP touches the view.
 */
fun vehicleUpgradesSource(
    vehicles: VehiclesStore,
    driving: DrivingStore,
    sharing: SharingStore,
): VehicleUpgradesSource =
    object : VehicleUpgradesSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun vehicleUpgrades(vehicleId: String): Flow<Resource<JsonElement>> = vehicles.vehicleUpgrades(vehicleId)

        override fun drives(vehicleId: String): Flow<Resource<List<Drive>>> = driving.drives(vehicleId)

        override fun shareLinks(driveId: String): Flow<Resource<List<ShareToken>>> = sharing.shareLinks(driveId)
    }

/**
 * Binds the surface to the shared **S7** repositories — the cold cache-then-network feeds the S8 stores also
 * wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which backs the widget's manual
 * refresh / error-retry affordance (the web `useVehicleUpgrades().refetch()`). No HTTP touches the view.
 */
fun vehicleUpgradesSource(
    vehicles: VehiclesRepository,
    driving: DrivingRepository,
    sharing: SharingRepository,
): VehicleUpgradesSource =
    object : VehicleUpgradesSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun vehicleUpgrades(vehicleId: String): Flow<Resource<JsonElement>> = vehicles.vehicleUpgrades(vehicleId)

        override fun drives(vehicleId: String): Flow<Resource<List<Drive>>> = driving.drives(vehicleId)

        override fun shareLinks(driveId: String): Flow<Resource<List<ShareToken>>> = sharing.shareLinks(driveId)
    }

/** The first enrolled vehicle's positive id (web `vehicles?.[0]?.id` feeding `numericId > 0`), or `null`. */
internal fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }

/**
 * The most-recent drive's id as the share-links query key — the web `recentDriveId = drives.length > 0 ?
 * String(drives[0].id) : ''` (the `useShareLinks` query is disabled while this is blank). `null` when the list
 * is absent or empty.
 */
internal fun recentDriveId(drives: List<Drive>?): String? = drives?.firstOrNull()?.id?.toString()

/**
 * Composes the fleet list, the active vehicle's upgrades envelope, and its most-recent drive's share links
 * into one cache-then-network [Resource] stream of a [VehicleUpgradesSnapshot] — the native port of the web
 * `numericId = vehicleId ?? vehicles?.[0]?.id ?? 0` resolution feeding `useVehicleUpgrades` +
 * `useDrives` → `useShareLinks`. A positive [preferredVehicleId] short-circuits straight to its feeds (the web
 * vehicle list is not consulted when a prop id is supplied); otherwise the first enrolled vehicle drives them,
 * and when no vehicle resolves the fleet resource is folded onto a no-vehicle upgrades envelope + an empty
 * share-links list so the surface renders its loading / empty / offline state honestly.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun vehicleUpgradesResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    preferredVehicleId: Long?,
    upgradesFor: (String) -> Flow<Resource<JsonElement>>,
    drivesFor: (String) -> Flow<Resource<List<Drive>>>,
    shareLinksFor: (String) -> Flow<Resource<List<ShareToken>>>,
): Flow<Resource<VehicleUpgradesSnapshot>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        forVehicle(preferred.toString(), upgradesFor, drivesFor, shareLinksFor)
    } else {
        vehicles.flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(mergeUpgrades(vehiclesRes.toNoVehicleUpgrades(), emptyShareLinks()))
                else -> forVehicle(id.toString(), upgradesFor, drivesFor, shareLinksFor)
            }
        }
    }
}

/**
 * Combines one vehicle's upgrades feed (primary) with its share-links feed (derived from the most-recent
 * drive) into the merged snapshot stream. The upgrades feed alone drives the surface's loading / freshness /
 * error contract; the share-links feed only contributes its rows.
 */
@OptIn(ExperimentalCoroutinesApi::class)
private fun forVehicle(
    vehicleId: String,
    upgradesFor: (String) -> Flow<Resource<JsonElement>>,
    drivesFor: (String) -> Flow<Resource<List<Drive>>>,
    shareLinksFor: (String) -> Flow<Resource<List<ShareToken>>>,
): Flow<Resource<VehicleUpgradesSnapshot>> =
    combine(
        upgradesFor(vehicleId),
        shareLinksForVehicle(vehicleId, drivesFor, shareLinksFor),
    ) { upgrades, links -> mergeUpgrades(upgrades, links) }

/**
 * The active vehicle's most-recent drive's share links — the native port of `useDrives(id)` →
 * `useShareLinks(recentDriveId)`. While no drive resolves (web `recentDriveId === ''` disables the query) it
 * yields an already-resolved empty list, so the surface shows "No active share links" rather than spinning.
 */
@OptIn(ExperimentalCoroutinesApi::class)
private fun shareLinksForVehicle(
    vehicleId: String,
    drivesFor: (String) -> Flow<Resource<List<Drive>>>,
    shareLinksFor: (String) -> Flow<Resource<List<ShareToken>>>,
): Flow<Resource<List<ShareToken>>> =
    drivesFor(vehicleId).flatMapLatest { drivesRes ->
        when (val driveId = recentDriveId(drivesRes.cached)) {
            null -> flowOf(emptyShareLinks())
            else -> shareLinksFor(driveId)
        }
    }

/**
 * Merges the cache-then-network upgrades + share-links resources into one [Resource] of a
 * [VehicleUpgradesSnapshot], keeping the contract **upgrades-primary** exactly as the web `WidgetShell` does
 * (`loading`/`updatedAt`/`isFetching`/`isStale`/`isError`/`onRefresh` all come from `useVehicleUpgrades`; the
 * share-links feed only supplies its rows). Precedence: an upgrades first-load (no cache) is the bare loading
 * skeleton; an upgrades failure keeps the cached snapshot visible as offline (else a hard error); an upgrades
 * refetch over cache is refreshing; otherwise success.
 */
fun mergeUpgrades(
    upgrades: Resource<JsonElement>,
    shareLinks: Resource<List<ShareToken>>,
): Resource<VehicleUpgradesSnapshot> {
    val snapshot = upgradesSnapshotOrNull(upgrades, shareLinks)
    val fetchedAt = upgrades.fetchedAtOrNull()
    return when (upgrades) {
        is Resource.Loading ->
            if (upgrades.cached == null) {
                Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = upgrades.stale)
            } else {
                Resource.Loading(snapshot, fetchedAt, stale = upgrades.stale)
            }

        is Resource.Error -> upgradesErrorResource(snapshot, fetchedAt, upgrades)
        is Resource.Success ->
            Resource.Success(snapshot ?: VehicleUpgradesSnapshot.EMPTY, fetchedAt ?: 0L, stale = false)
    }
}

/** Builds a snapshot whenever EITHER feed has a cached value, so cached share links survive an upgrades reload. */
private fun upgradesSnapshotOrNull(
    upgrades: Resource<JsonElement>,
    shareLinks: Resource<List<ShareToken>>,
): VehicleUpgradesSnapshot? =
    if (upgrades.cached != null || shareLinks.cached != null) {
        VehicleUpgradesSnapshot(
            upgradesData = upgradesData(upgrades.cached),
            shareLinks = shareLinks.cached ?: emptyList(),
        )
    } else {
        null
    }

/** An upgrades failure keeps the cached snapshot visible as offline (stale); with no cache it is a hard error. */
private fun upgradesErrorResource(
    snapshot: VehicleUpgradesSnapshot?,
    fetchedAt: Long?,
    error: Resource.Error<JsonElement>,
): Resource<VehicleUpgradesSnapshot> =
    if (error.cached != null) {
        Resource.Error(snapshot, fetchedAt, stale = true, error = error.error)
    } else {
        Resource.Error(cached = null, fetchedAt = fetchedAt, stale = error.stale, error = error.error)
    }

/**
 * Folds a fleet-list [Resource] that yields no usable vehicle id onto a no-data upgrades envelope: a still
 * loading fleet stays loading; a resolved fleet becomes an empty success ([JsonNull]); a hard fleet error
 * becomes a cached empty with `stale = true`, so the surface shows its friendly empty content behind an
 * offline chip rather than the hard error screen (web: a disabled upgrades query never raises the error
 * surface).
 */
private fun Resource<List<Vehicle>>.toNoVehicleUpgrades(): Resource<JsonElement> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(JsonNull, fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = JsonNull, fetchedAt = fetchedAt, stale = true, error = error)
    }

/** An already-resolved empty share-links list (web `useShareLinks('')` disabled ⇒ no rows). */
private fun emptyShareLinks(): Resource<List<ShareToken>> = Resource.Success(emptyList(), fetchedAt = 0L, stale = false)

/** The freshness stamp of any [Resource] variant (web `dataUpdatedAt`). */
private fun Resource<*>.fetchedAtOrNull(): Long? =
    when (this) {
        is Resource.Loading -> fetchedAt
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt
    }
