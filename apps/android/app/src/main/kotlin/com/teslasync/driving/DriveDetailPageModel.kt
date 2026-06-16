// Pure, framework-free model + page-local repository for the DriveDetailPage driving surface — the native
// analogue of the cross-cutting concerns the web page owns (web/src/features/driving/pages/DriveDetailPage.tsx,
// the `/drives/:id` detail route). No Compose and no Android framework lives here, so the route id + slug + the
// no-telemetry gate are all exercised off-device and the composable stays a thin render layer.
//
// The web page reads one drive by id (`useDrive(id)` ▸ `GET /drives/{id}`). The shared-core S7
// [io.teslasync.shared.core.data.repo.DriveRepository] only exposes the per-vehicle list, so this surface owns a
// narrow page-local [DriveDetailRepository] that reuses the SAME CachingRepository machinery (cache-then-network,
// SI-verbatim caching, ADR-013) over the shared resilient client + offline cache to fetch a single drive. It is
// keyed `detail:{id}` inside the existing `drives` cache domain so it never collides with the list feed's
// per-vehicle keys.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.drivedetail

import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.data.repo.CachingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.defaultApiJson
import io.teslasync.shared.core.net.request
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `DriveDetailPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `hidden("driveDetail", "/drives/:id", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface to
 * that destination (and its `/drives/{id}` deep link) without the nav module depending on it. [ARG_ID] is the
 * single route argument the web reads via `useParams().id`.
 */
object DriveDetailPageRegistration {
    /** The navigation destination id (Destinations.kt `hidden("driveDetail", "/drives/:id", …, ["id"])`). */
    const val ROUTE_ID: String = "driveDetail"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/drives/:id"

    /** The route-argument name carrying the drive id (web `useParams().id`). */
    const val ARG_ID: String = "id"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no drive id. */
    const val SLUG: String = "DriveDetailPage"
}

/**
 * Whether a loaded [drive] carries enough telemetry-derived aggregate to render its numeric-summary surfaces — the
 * native fold of the web page's `hasMeaningfulDriveStats` envelope check. A drive persisted from a signal slice
 * that held only gear transitions lands with all-zero distance / speed / energy; the page replaces the hero
 * gauges, stat cards, energy summary and more-details panels with a single no-telemetry banner in that case so
 * zero-valued metrics never read as a broken vehicle. The shared [Drive] DTO carries only aggregates (no
 * per-sample telemetry/positions arrays), so the gate keys off distance / max speed / energy used.
 */
fun hasMeaningfulDriveStats(drive: Drive): Boolean =
    drive.distanceM > 0.0 ||
        (drive.maxSpeedMps ?: 0.0) > 0.0 ||
        (drive.energyUsedWh ?: 0.0) > 0.0

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DriveDetailPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no drive id, vehicle id, address, or location figure.
 */
fun recordDriveDetailPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to DriveDetailPageRegistration.SLUG))
}

/**
 * Page-local cache-then-network access to a single drive by id (`GET /drives/{id}`), the read the web
 * `useDrive(id)` hook performs. Reuses the shared [CachingRepository] base — so the SI-verbatim cache + ADR-013
 * freshness contract are identical to every other repository — over the same resilient [api] client and offline
 * [store] the app already wires. Entries are keyed `detail:{id}` in the existing [CacheDomain.Drives] partition,
 * distinct from the list feed's per-vehicle keys.
 */
class DriveDetailRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = defaultApiJson,
) : CachingRepository<Drive>(store, clock, json, Drive.serializer()) {
    override val domain: CacheDomain = CacheDomain.Drives

    /** Streams the cached drive for [id] immediately (if any), then the refreshed `GET /drives/{id}` value. */
    fun drive(id: Long): Flow<Resource<Drive>> =
        observe(key = "$DETAIL_KEY_PREFIX$id") {
            api.request<Drive>(path = "$DRIVES_PATH/$id")
        }

    private companion object {
        const val DETAIL_KEY_PREFIX = "detail:"
        const val DRIVES_PATH = "/drives"
    }
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"
