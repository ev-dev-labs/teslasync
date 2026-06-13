// Pure, framework-free model + projection + diagnostics for the selectedVehicle misc surface — the native
// analogue of web/src/store/selectedVehicle.tsx (the persistent "currently-focused vehicle" store) composed
// with web/src/hooks/useSelectedVehicle.ts (the precedence + default-to-first hook). No Compose, no Android
// framework, no HTTP: every declaration here is exercised off-device in the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// The web source is a STORE, not a data-fetching view: `useSelectedVehicleStore` holds `vehicleId | null`
// (+ `setVehicleId`, localStorage-persisted, cross-tab synced, a valid id being finite & > 0), and the
// composed `useSelectedVehicle` layers precedence (URL > store > first vehicle) over `useVehicles()`,
// writing the resolved id back to the store so navigation stays "sticky" and defaulting to the first
// vehicle the moment the fleet loads. The native counterparts already exist (P1/S8): the
// `SelectedVehicleStore` (selectedId/select/clear/reconcile) and `VehiclesStore.vehicles()` (the
// `useVehicles` port). This file reproduces the store's resolution semantics as pure functions:
// [effectiveSelectedId] mirrors `SelectedVehicleStore.reconcile` + the web "default to the first vehicle"
// behaviour (native has no URL tier, so precedence collapses to store > first), and
// [projectSelectedVehicleResource] preserves the ADR-013 cache-then-network envelope so the downstream
// [io.teslasync.android.data.UiState] still drives loading / content / empty / stale / offline / error.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/misc-surfaces/selectedVehicle — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a camelCase leaf are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.miscsurfaces.selectedvehicle

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the selectedVehicle surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`selectedVehicle`).
 */
object SelectedVehicleRegistration {
    /** Stable surface id (also the `viewModel` key the host binds this surface with). */
    const val ID: String = "selected-vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "selectedVehicle"
}

/**
 * The Android string-resource names the surface resolves through the i18n facade (P1/S10). The web store
 * itself renders no copy, so a native picker over it needs presentation microcopy; rather than invent new
 * strings, the surface reuses the catalog keys the web `ActiveVehicleSegment` (the store's intended UI
 * consumer) and `NoVehicleSelected` already ship — every name below exists in `values/`, `values-ar/` and
 * `values-he/`, so each string localizes (asserted by name in the unit test; resource bytes are not read
 * off-device).
 */
object SelectedVehicleKeys {
    /** Header / active-vehicle title — web `t('statusBar.vehicle.tooltip', 'Active vehicle')`. */
    const val ACTIVE_TITLE: String = "translation_statusBar_vehicle_tooltip"

    /** Active-vehicle accessibility prefix — web `t('statusBar.vehicle.aria', 'Active vehicle')`. */
    const val ARIA: String = "translation_statusBar_vehicle_aria"

    /** Switcher control label — web `t('statusBar.vehicle.switch', 'Switch vehicle')`. */
    const val SWITCH: String = "translation_statusBar_vehicle_switch"

    /** Name fallback word — web `t('statusBar.vehicle.fallback', 'Vehicle')` (rendered as "Vehicle {id}"). */
    const val FALLBACK: String = "translation_statusBar_vehicle_fallback"

    /** No-active-vehicle label — web `t('statusBar.vehicle.none', 'No vehicle')`. */
    const val NONE: String = "translation_statusBar_vehicle_none"

    /** Empty-state title — web `t('common.noVehicleSelected.title', 'No vehicle selected')`. */
    const val EMPTY_TITLE: String = "translation_common_noVehicleSelected_title"

    /** Empty-state body — web `t('common.noVehicleSelected.desc', …)`. */
    const val EMPTY_DESC: String = "translation_common_noVehicleSelected_desc"

    /** Loading affordance — web `t('common.loading', 'Loading...')`. */
    const val LOADING: String = "translation_common_loading"

    /** Offline chip — web `t('common.offline', 'Offline')`. */
    const val OFFLINE: String = "translation_common_offline"

    /** Stale chip — web `t('mqtt.stale', 'Stale')`. */
    const val STALE: String = "translation_mqtt_stale"

    /** Refreshing chip — web `t('freshness.updating', 'updating…')`. */
    const val UPDATING: String = "translation_freshness_updating"
}

/** The English source strings the web `t(key, default)` calls fall back to (off-device contract). */
object SelectedVehicleDefaults {
    const val ACTIVE_TITLE: String = "Active vehicle"
    const val ARIA: String = "Active vehicle"
    const val SWITCH: String = "Switch vehicle"
    const val FALLBACK: String = "Vehicle"
    const val NONE: String = "No vehicle"
    const val EMPTY_TITLE: String = "No vehicle selected"
}

/**
 * One selectable vehicle row, projected framework-free so the adapter is asserted off-device. Mirrors the
 * fields the web `ActiveVehicleSegment` reads from a `Vehicle` (`display_name` / `vin` / `model`), plus the
 * [selected] flag derived from the effective selection.
 */
data class SelectedVehicleRow(
    val id: Long,
    val displayName: String,
    val vin: String,
    val model: String?,
    val selected: Boolean,
)

/**
 * The projected surface payload: the enrolled-vehicle [vehicles] (each tagged [SelectedVehicleRow.selected]),
 * the resolved [effectiveSelectedId] (web `useSelectedVehicle().vehicleId`), and whether the fleet is
 * [selectable] (more than one vehicle ⇒ show the switcher, exactly as the web segment hides the switcher for
 * single-vehicle owners).
 */
data class SelectedVehicleData(
    val vehicles: List<SelectedVehicleRow>,
    val effectiveSelectedId: Long?,
    val selectable: Boolean,
) {
    /** The currently-active row (the one matching [effectiveSelectedId]), or `null` when the fleet is empty. */
    val selectedRow: SelectedVehicleRow? get() = vehicles.firstOrNull { it.selected }

    /** True when there is no vehicle to select (empty fleet) — drives the friendly empty state. */
    val isEmpty: Boolean get() = vehicles.isEmpty()

    /** The enrolled-vehicle count. */
    val count: Int get() = vehicles.size

    companion object {
        /** The neutral payload used before any vehicle has loaded / when the fleet is empty. */
        val EMPTY: SelectedVehicleData = SelectedVehicleData(emptyList(), null, false)
    }
}

/**
 * Whether [id] is a usable selection — the native mirror of the web `parseId` guard (`Number.isFinite(n) &&
 * n > 0`). A `null` or non-positive id is treated as "no explicit selection".
 */
fun isValidVehicleId(id: Long?): Boolean = id != null && id > 0

/**
 * Resolves the effective selected-vehicle id from the persisted [stored] choice against the currently
 * [availableIds] — the pure mirror of `SelectedVehicleStore.reconcile` and the web `useSelectedVehicle`
 * default: keep a valid choice that is still enrolled, otherwise fall to the first vehicle, otherwise (an
 * empty fleet) clear to `null`. Native has no URL tier, so the web URL > store > first precedence collapses
 * to store > first here.
 */
fun effectiveSelectedId(
    stored: Long?,
    availableIds: List<Long>,
): Long? =
    when {
        availableIds.isEmpty() -> null
        isValidVehicleId(stored) && stored in availableIds -> stored
        else -> availableIds.first()
    }

/**
 * Projects the enrolled [vehicles] + the persisted [storedSelectedId] onto the [SelectedVehicleData] the
 * view renders. The effective selection is computed inline (web "computed inline so first-render reads don't
 * wait for the effect"); each row's [SelectedVehicleRow.selected] is set against it.
 */
fun projectSelectedVehicle(
    vehicles: List<Vehicle>,
    storedSelectedId: Long?,
): SelectedVehicleData {
    val effective = effectiveSelectedId(storedSelectedId, vehicles.map(Vehicle::id))
    val rows =
        vehicles.map { vehicle ->
            SelectedVehicleRow(
                id = vehicle.id,
                displayName = vehicle.displayName,
                vin = vehicle.vin,
                model = vehicle.model,
                selected = vehicle.id == effective,
            )
        }
    return SelectedVehicleData(vehicles = rows, effectiveSelectedId = effective, selectable = vehicles.size > 1)
}

/**
 * Maps a raw `GET /vehicles` [Resource] onto a typed [Resource] of the projected [SelectedVehicleData],
 * preserving the cache-then-network envelope (cached value, freshness stamp, staleness, error) so the
 * downstream [io.teslasync.android.data.UiState] projection still drives loading / content / empty / stale /
 * offline / error correctly. The persisted [storedSelectedId] is folded into every branch so the selection
 * is reflected even while showing a cached / last-known list.
 */
fun projectSelectedVehicleResource(
    resource: Resource<List<Vehicle>>,
    storedSelectedId: Long?,
): Resource<SelectedVehicleData> =
    when (resource) {
        is Resource.Loading ->
            Resource.Loading(
                cached = resource.cached?.let { projectSelectedVehicle(it, storedSelectedId) },
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = projectSelectedVehicle(resource.data, storedSelectedId),
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = resource.cached?.let { projectSelectedVehicle(it, storedSelectedId) },
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
                error = resource.error,
            )
    }

/**
 * The display label for a row — the native mirror of the web `vehicle?.display_name || vehicle?.vin ||
 * `${t('statusBar.vehicle.fallback')} ${id}``: the display name, else the VIN, else "{fallbackWord} {id}".
 * The localized [fallbackWord] is supplied by the render boundary so this stays framework-free.
 */
fun rowDisplayLabel(
    row: SelectedVehicleRow,
    fallbackWord: String,
): String = row.displayName.ifBlank { row.vin.ifBlank { "$fallbackWord ${row.id}" } }

/**
 * Folds the active-vehicle [ariaLabel] (web `t('statusBar.vehicle.aria')`) and the resolved [vehicleLabel]
 * into a single TalkBack content description ("Active vehicle: {label}") — the native mirror of the web
 * `aria-label={\`${aria}: ${label}\`}`. Pure so the a11y label is asserted off-device.
 */
fun activeVehicleContentDescription(
    ariaLabel: String,
    vehicleLabel: String,
): String = "$ariaLabel: $vehicleLabel"

/**
 * Classifies a `/vehicles` failure into the recovery-oriented [QueryErrorKind] the error surface renders —
 * the same fold the sibling feature views use: an offline/timeout failure is treated as not-online; a
 * circuit-open failure is the transient "waiting" state; otherwise the HTTP status selects the copy.
 */
fun selectedVehicleErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SelectedVehicleRegistration.SLUG]
 * (P1/S11) — never a vehicle id or VIN, so a diagnostics line can never leak the fleet's posture. Kept free
 * of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordSelectedVehicleOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf("surface" to SelectedVehicleRegistration.SLUG))
}
