// The data port the Drive Telemetry widget binds to (P1/S8 state-holder seam) — the native analogue of
// the web `useVehicles` + `useDrives` + `useDriveTelemetry` hook composition, vehicle + latest-drive
// resolution included (web/src/features/dashboard/widgets/DriveTelemetryWidget.tsx). The view never
// performs HTTP itself; the store-backed [driveTelemetrySource] (or a test fake) drives this seam.
// Cache-then-network freshness is preserved end to end (ADR-013): the drives feed drives the
// loading/cached/stale/offline/error surface, and the per-drive telemetry feed is folded in best-effort
// (never failing the surface, exactly as the web `useDriveTelemetry` is supplementary to `useDrives`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DriveTelemetryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivetelemetry

import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.DriveTelemetryReading
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.driving.DrivingStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * Streams the cache-then-network snapshots the widget renders: the newest drive plus its telemetry for
 * the primary (or explicit) vehicle. A single-method seam so the view-model depends on an abstraction
 * (real adapter ↔ test fake), never on a concrete store or the network.
 */
fun interface DriveTelemetrySource {
    /** The cache-then-network latest-drive feed (cached value first for an instant cold start, then refreshed). */
    fun stream(): Flow<Resource<DriveTelemetrySnapshot>>
}

/**
 * Binds the widget to the shared **S8** [VehiclesStore] + [DrivingStore] holders — the same memoized
 * cache-then-network feeds every Vehicles/Driving surface shares. It composes the web hook chain:
 * resolve the vehicle id (web `vehicleId ?? vehicles?.[0]?.id`), then the newest drive by `start_ts`
 * (web `latestDrive`), then fold that drive's telemetry (web `useDriveTelemetry`, supplementary) into
 * the drives feed which remains the primary freshness/error/empty source. When no vehicle or no drive
 * resolves, the stream yields a drive-less snapshot — the web `!latestDrive` empty gate. No HTTP touches
 * the view.
 *
 * @param vehicles the shared Vehicles holder (web `useVehicles`).
 * @param driving the shared Driving holder (web `useDrives`/`useDriveTelemetry`).
 * @param vehicleId an explicit vehicle id; when null the first enrolled vehicle is used.
 */
@OptIn(ExperimentalCoroutinesApi::class)
fun driveTelemetrySource(
    vehicles: VehiclesStore,
    driving: DrivingStore,
    vehicleId: Long? = null,
): DriveTelemetrySource =
    DriveTelemetrySource {
        vehicles.vehicles().flatMapLatest { vehiclesRes ->
            val vid = vehicleId ?: DriveTelemetryProjection.firstVehicleId(vehiclesRes.cached)
            if (vid == null || vid <= 0L) {
                flowOf(resolutionResource(vehiclesRes))
            } else {
                driving.drives(vid.toString()).flatMapLatest { drivesRes ->
                    when (val latest = DriveTelemetryProjection.latestDrive(drivesRes.cached)) {
                        null -> flowOf(mergeDrivesSnapshot(drivesRes, emptyList()))
                        else ->
                            driving.driveTelemetry(latest.id.toString()).map { telemetryRes ->
                                mergeDrivesSnapshot(drivesRes, telemetryRes.cached ?: emptyList())
                            }
                    }
                }
            }
        }
    }

/**
 * Map an upstream resolution feed (vehicles) onto the snapshot surface when no drive can be reached yet:
 * a genuine first load (loading with nothing cached) stays [Resource.Loading] so the skeleton shows; any
 * resolved state with no usable vehicle collapses to a drive-less [Resource.Success] — the web
 * `!latestDrive` empty gate — preserving the upstream freshness stamp.
 */
internal fun resolutionResource(resource: Resource<*>): Resource<DriveTelemetrySnapshot> =
    if (resource is Resource.Loading && resource.cached == null) {
        Resource.Loading(cached = null, fetchedAt = null, stale = false)
    } else {
        Resource.Success(
            data = DriveTelemetrySnapshot(drive = null),
            fetchedAt = resource.fetchedAtOrZero(),
            stale = false,
        )
    }

/**
 * Fold the primary drives feed (the newest drive + its freshness/error) with the supplementary
 * [telemetry] into one snapshot feed. The drives feed drives the [Resource] kind + freshness
 * (loading/cached/stale/offline/error); the telemetry is best-effort — its cached value rides along and
 * its own failures never fail the surface (web parity: an empty telemetry result simply yields no
 * chart). A resolved-but-empty drives list yields a drive-less snapshot — the web `!latestDrive` empty
 * gate.
 */
internal fun mergeDrivesSnapshot(
    drivesRes: Resource<List<Drive>>,
    telemetry: List<DriveTelemetryReading>,
): Resource<DriveTelemetrySnapshot> =
    when (drivesRes) {
        is Resource.Loading ->
            Resource.Loading(
                cached = drivesRes.cached?.let { snapshotOf(it, telemetry) },
                fetchedAt = drivesRes.fetchedAt,
                stale = drivesRes.stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = snapshotOf(drivesRes.data, telemetry),
                fetchedAt = drivesRes.fetchedAt,
                stale = drivesRes.stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = drivesRes.cached?.let { snapshotOf(it, telemetry) },
                fetchedAt = drivesRes.fetchedAt,
                stale = drivesRes.stale,
                error = drivesRes.error,
            )
    }

/** Build a snapshot from a drives list (newest by `start_ts`, or none) and its telemetry. */
private fun snapshotOf(
    drives: List<Drive>,
    telemetry: List<DriveTelemetryReading>,
): DriveTelemetrySnapshot = DriveTelemetrySnapshot(drive = DriveTelemetryProjection.latestDrive(drives), telemetry = telemetry)

private fun Resource<*>.fetchedAtOrZero(): Long =
    when (this) {
        is Resource.Loading -> fetchedAt ?: 0L
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt ?: 0L
    }
