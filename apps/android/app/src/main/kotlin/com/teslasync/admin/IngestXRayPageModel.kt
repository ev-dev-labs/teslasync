// Pure, framework-free model + projections for the IngestXRayPage admin surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/admin/pages/IngestXRayPage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it only references the
// framework-free UiState projection + the shared-core Resource), so the composable stays a thin render layer.
//
// The web page owns three concerns this file ports: (1) the local interaction state — the selected vehicle and
// the window/bucket dropdown values (web `useState`); (2) the fan-out of the single `useIngestXRay`
// `IngestXRayResponse` into the three slices the header / chart / fields sub-views consume (web passes
// `xray.data.total_samples`, `xray.data.buckets`, `xray.data.fields` down); and (3) the lifecycle bookkeeping
// (the cache-then-network `Resource`/`UiState` re-shaping + the PII-safe `view.opened` diagnostic). The three
// X-Ray window/bucket vocabularies (the controls' selection enums, the shared-core request enums, and the
// header's label enum) are reconciled here by their shared wire token so the page never hardcodes a mapping.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling admin pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.ingestxray

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.xraybucketchart.XRayBucketPoint
import io.teslasync.android.featureviews.xraycontrols.IngestXRayBucket as ControlsBucket
import io.teslasync.android.featureviews.xraycontrols.IngestXRayWindow as ControlsWindow
import io.teslasync.android.featureviews.xraycontrols.XRayVehicle
import io.teslasync.android.featureviews.xrayfieldstable.IngestXRayFieldStat as FieldStat
import io.teslasync.android.featureviews.xrayheader.IngestXRaySummary
import io.teslasync.android.featureviews.xrayheader.XRayWindow as HeaderWindow
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayResponse
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayBucket as RequestBucket
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayWindow as RequestWindow

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `IngestXRayPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("adminIngestXray", "/admin/ingest-xray", …)`, so [io.teslasync.android.navigation.PageHosts] binds this
 * surface to that destination (and its `/admin/ingest-xray` deep link) without the nav module depending on it.
 */
object IngestXRayPageRegistration {
    /** The navigation destination id (Destinations.kt `page("adminIngestXray", "/admin/ingest-xray", …)`). */
    const val ROUTE_ID: String = "adminIngestXray"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/admin/ingest-xray"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "IngestXRayPage"
}

/**
 * The page's local interaction snapshot — the union of the web component's three `useState` cells: the selected
 * [vehicleId] (`null` until the operator picks one, web `vehicleId`), the observation [window] (web `windowSel`,
 * default `1h`), and the bucket [bucket] (web `bucketSel`, default `1m`). The window/bucket are carried as the
 * controls' own selection enums so the `XRayControls` change callbacks bind to this snapshot with no adapter.
 */
data class XRayInteraction(
    val vehicleId: Long? = null,
    val window: ControlsWindow = ControlsWindow.W1H,
    val bucket: ControlsBucket = ControlsBucket.B1M,
) {
    /** True once a vehicle is selected — the web `vehicleId === null` gate that swaps the no-vehicle panel out. */
    val hasVehicle: Boolean get() = vehicleId != null && vehicleId > 0
}

// ── Window / bucket vocabulary reconciliation (shared wire token) ─────────────────────────────────────────────

/** The shared-core request window for this controls selection — matched by the wire token both enums carry. */
fun ControlsWindow.toRequestWindow(): RequestWindow = RequestWindow.entries.first { it.wire == wire }

/** The shared-core request bucket for this controls selection — matched by the wire token both enums carry. */
fun ControlsBucket.toRequestBucket(): RequestBucket = RequestBucket.entries.first { it.wire == wire }

/**
 * The header strip's window enum for this controls selection (web `windowSel` echoed into the summary card).
 * Matched by wire token; an unrecognised token folds to the header's `1h` default, mirroring its own contract.
 */
fun ControlsWindow.toHeaderWindow(): HeaderWindow = HeaderWindow.fromWire(wire)

// ── Vehicle → controls option ─────────────────────────────────────────────────────────────────────────────────

/**
 * The slice of the API [Vehicle] the controls dropdown reads — the native mirror of the fields the web
 * `vehicleOptions` map touches (`id`, `display_name`, `vin`). The label fold (`display_name || vin || Vehicle id`)
 * lives in the controls projection, so this only carries the raw fields.
 */
fun Vehicle.toXRayVehicle(): XRayVehicle = XRayVehicle(id = id, displayName = displayName, vin = vin)

// ── IngestXRayResponse → sub-view slices (web prop fan-out) ───────────────────────────────────────────────────

/** The aggregate-summary slice the header reads — web `xray.data.{total_samples, unique_fields}`. */
fun IngestXRayResponse.toSummary(): IngestXRaySummary =
    IngestXRaySummary(totalSamples = totalSamples, uniqueFields = uniqueFields)

/** The bucketed sample-count series the chart reads — web `xray.data.buckets ?? []`. */
fun IngestXRayResponse.toBucketPoints(): List<XRayBucketPoint> =
    buckets.map { XRayBucketPoint(bucketStart = it.bucketStart, count = it.count) }

/** The per-field stats the table reads — web `xray.data.fields ?? []`. */
fun IngestXRayResponse.toFieldStats(): List<FieldStat> =
    fields.map { FieldStat(field = it.field, sampleCount = it.sampleCount, lastSeenAt = it.lastSeenAt, valueKind = it.valueKind) }

/**
 * Whether the whole X-Ray response carries nothing to show — no samples, no fields, no buckets. Used as the
 * base feed's empty predicate; the per-slice empties (header `total_samples <= 0`, empty bucket list, empty
 * field list) are recomputed by [deriveData] so each panel can flag empty independently.
 */
fun IngestXRayResponse.isEmptyXRay(): Boolean = totalSamples <= 0L && fields.isEmpty() && buckets.isEmpty()

// ── Resource / UiState re-shaping ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The
 * cached value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both
 * transformed; the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the
 * view-model's `Vehicle → XRayVehicle` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * Projects a parent [UiState] onto a derived slice for one sub-view, recomputing only the content/empty split
 * from the mapped value while preserving the loading / hard-error / refreshing / stale / offline lifecycle. This
 * is how the single `useIngestXRay` feed fans out into the header / chart / fields surfaces: a still-loading or
 * failed parent stays loading/error for every slice, but a loaded response can be non-empty for one slice (e.g.
 * it has buckets) and empty for another (e.g. zero samples), exactly like the web sub-components' own guards.
 *
 * @param transform maps the parent payload to this slice's payload.
 * @param isEmpty decides whether the mapped slice is empty (the per-sub-view emptiness rule).
 */
fun <T, R> UiState<T>.deriveData(
    transform: (T) -> R,
    isEmpty: (R) -> Boolean,
): UiState<R> {
    val mapped = data?.let(transform)
    val derivedPhase =
        when {
            isLoading -> UiPhase.Loading
            isError -> UiPhase.Error
            mapped == null -> UiPhase.Empty
            isEmpty(mapped) -> UiPhase.Empty
            else -> UiPhase.Content
        }
    return UiState(
        phase = derivedPhase,
        data = mapped,
        fetchedAt = fetchedAt,
        stale = stale,
        refreshing = refreshing,
        errorKind = errorKind,
        httpStatus = httpStatus,
    )
}

// ── Diagnostics ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [IngestXRayPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no vehicle id, field name or sample value.
 */
fun recordIngestXRayPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to IngestXRayPageRegistration.SLUG))
}
