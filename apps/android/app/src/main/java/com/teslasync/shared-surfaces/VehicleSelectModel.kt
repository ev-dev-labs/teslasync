// Pure, framework-free model + projection + diagnostics for the VehicleSelect shared surface — the native
// analogue of every value the web component derives before it returns JSX
// (web/src/components/forms/VehicleSelect.tsx composed with web/src/hooks/useSelectedVehicle.ts +
// web/src/store/selectedVehicle.tsx). No Compose, no Android framework, no HTTP: every declaration here is
// exercised off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a canonical per-page
// vehicle-scope picker — a drop-in `<Select>` wired to the global `useSelectedVehicle()` store. It maps each
// enrolled vehicle to an option (`value = String(id)`, `label = display_name || vin || 'Vehicle {id}'`),
// renders for any fleet of >= 1 vehicle (the always-show rule), writes the chosen id back through
// `setVehicleId`, and carries the accessible label `t('vehicleSelect.aria', 'Select vehicle')` with an
// optional leading car icon (`withIcon`). The web returns `null` for an empty fleet because the host page is
// already showing a `<NoVehicleSelected>` empty state in that case; a self-contained native surface instead
// renders that friendly empty state itself, so a region is never silently hidden (P3 state matrix).
//
// The fleet is a genuine cache-then-network async dependency (web `useVehicles`), so unlike a controlled-input
// surface this picker honestly drives the full loading / content / empty / stale / offline / error matrix:
// [projectVehicleSelectResource] preserves the ADR-013 envelope so the downstream
// [io.teslasync.android.data.UiState] resolves each state. The persisted selection (web
// `useSelectedVehicleStore`) is folded in via [effectiveSelectedId] — the pure mirror of
// `SelectedVehicleStore.reconcile` + the web "default to the first vehicle" effect (native has no URL tier, so
// the web URL > store > first precedence collapses to store > first).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/VehicleSelect — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling RangePicker / UserCell / selectedVehicle
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehicleselect

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the VehicleSelect surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`VehicleSelect`); [ID]
 * is the stable `viewModel` key the composable binds the surface with.
 */
object VehicleSelectRegistration {
    /** Stable surface id (also the `viewModel` key the host binds this surface with). */
    const val ID: String = "vehicle-select"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VehicleSelect"
}

/**
 * The Android string-resource names the surface resolves through the i18n facade (P1/S10). The web source's
 * only literal is the accessible label `t('vehicleSelect.aria', 'Select vehicle')`; the surrounding state
 * microcopy (loading / empty / stale / offline) the native surface needs for the states the web defers to the
 * host page is satisfied by reusing catalog keys that already ship in `values/`, `values-ar/` and
 * `values-he/` rather than inventing new ones (the same approach the sibling selectedVehicle surface takes).
 * Notably [ARIA] reuses `vehiclePicker.aria` — the web layout sibling `VehiclePicker` and this forms picker
 * both render the identical "Select vehicle" accessible label, so the one catalog entry serves both. Each
 * name is asserted by value in the unit test; resource bytes are not read off-device.
 */
object VehicleSelectKeys {
    /** Accessible label — web `t('vehicleSelect.aria', 'Select vehicle')` (shared text with `vehiclePicker.aria`). */
    const val ARIA: String = "translation_vehiclePicker_aria"

    /** Name fallback word — web `t('statusBar.vehicle.fallback', 'Vehicle')` (rendered as "Vehicle {id}"). */
    const val FALLBACK: String = "translation_statusBar_vehicle_fallback"

    /** Loading affordance label — web `t('common.loading', 'Loading...')`. */
    const val LOADING: String = "translation_common_loading"

    /** Error-surface resource noun — web `t('common.vehicle', 'Vehicle')`. */
    const val TITLE: String = "translation_common_vehicle"

    /** Empty-state title — web `t('common.noVehicleSelected.title', 'No vehicle selected')`. */
    const val EMPTY_TITLE: String = "translation_common_noVehicleSelected_title"

    /** Empty-state body — web `t('common.noVehicleSelected.desc', …)`. */
    const val EMPTY_DESC: String = "translation_common_noVehicleSelected_desc"

    /** Offline chip — web `t('common.offline', 'Offline')`. */
    const val OFFLINE: String = "translation_common_offline"

    /** Stale chip — web `t('mqtt.stale', 'Stale')`. */
    const val STALE: String = "translation_mqtt_stale"

    /** Refreshing chip — web `t('freshness.updating', 'updating…')`. */
    const val UPDATING: String = "translation_freshness_updating"
}

/** The English source strings the web `t(key, default)` calls fall back to (off-device contract). */
object VehicleSelectDefaults {
    const val ARIA: String = "Select vehicle"
    const val FALLBACK: String = "Vehicle"
    const val EMPTY_TITLE: String = "No vehicle selected"
}

/**
 * One selectable vehicle option, projected framework-free so the adapter is asserted off-device. Mirrors the
 * fields the web `VehicleSelect` reads from a `Vehicle` (`display_name` / `vin`) plus the [model] subtitle and
 * the [selected] flag derived from the effective selection. [id] is the option value (web `String(v.id)`).
 */
data class VehicleSelectRow(
    val id: Long,
    val displayName: String,
    val vin: String,
    val model: String?,
    val selected: Boolean,
)

/**
 * The projected surface payload: the enrolled-vehicle [vehicles] (each tagged [VehicleSelectRow.selected]) and
 * the resolved [effectiveSelectedId] (web `useSelectedVehicle().vehicleId`). The web picker always renders for
 * a fleet of >= 1 vehicle (single-vehicle owners still get an explicit context indicator), so there is no
 * "selectable" gate here — the dropdown shows whenever the fleet is non-empty.
 */
data class VehicleSelectData(
    val vehicles: List<VehicleSelectRow>,
    val effectiveSelectedId: Long?,
) {
    /** The currently-active row (the one matching [effectiveSelectedId]), or `null` when the fleet is empty. */
    val selectedRow: VehicleSelectRow? get() = vehicles.firstOrNull { it.selected }

    /** True when there is no vehicle to select (empty fleet) — drives the friendly empty state. */
    val isEmpty: Boolean get() = vehicles.isEmpty()

    /** The enrolled-vehicle count. */
    val count: Int get() = vehicles.size

    companion object {
        /** The neutral payload used before any vehicle has loaded / when the fleet is empty. */
        val EMPTY: VehicleSelectData = VehicleSelectData(emptyList(), null)
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
 * Projects the enrolled [vehicles] + the persisted [storedSelectedId] onto the [VehicleSelectData] the view
 * renders. The effective selection is computed inline (web "computed inline so first-render reads don't wait
 * for the effect"); each row's [VehicleSelectRow.selected] is set against it.
 */
fun projectVehicleSelect(
    vehicles: List<Vehicle>,
    storedSelectedId: Long?,
): VehicleSelectData {
    val effective = effectiveSelectedId(storedSelectedId, vehicles.map(Vehicle::id))
    val rows =
        vehicles.map { vehicle ->
            VehicleSelectRow(
                id = vehicle.id,
                displayName = vehicle.displayName,
                vin = vehicle.vin,
                model = vehicle.model,
                selected = vehicle.id == effective,
            )
        }
    return VehicleSelectData(vehicles = rows, effectiveSelectedId = effective)
}

/**
 * Maps a raw `GET /vehicles` [Resource] onto a typed [Resource] of the projected [VehicleSelectData],
 * preserving the cache-then-network envelope (cached value, freshness stamp, staleness, error) so the
 * downstream [io.teslasync.android.data.UiState] projection still drives loading / content / empty / stale /
 * offline / error correctly. The persisted [storedSelectedId] is folded into every branch so the selection is
 * reflected even while showing a cached / last-known list.
 */
fun projectVehicleSelectResource(
    resource: Resource<List<Vehicle>>,
    storedSelectedId: Long?,
): Resource<VehicleSelectData> =
    when (resource) {
        is Resource.Loading ->
            Resource.Loading(
                cached = resource.cached?.let { projectVehicleSelect(it, storedSelectedId) },
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = projectVehicleSelect(resource.data, storedSelectedId),
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = resource.cached?.let { projectVehicleSelect(it, storedSelectedId) },
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
                error = resource.error,
            )
    }

/**
 * The option label for a row — the native mirror of the web `v.display_name || v.vin || `Vehicle ${v.id}``:
 * the display name, else the VIN, else "{fallbackWord} {id}". The localized [fallbackWord] is supplied by the
 * render boundary so this stays framework-free.
 */
fun vehicleOptionLabel(
    row: VehicleSelectRow,
    fallbackWord: String,
): String = row.displayName.ifBlank { row.vin.ifBlank { "$fallbackWord ${row.id}" } }

/**
 * Folds the accessible [ariaLabel] (web `t('vehicleSelect.aria')`) and the resolved [selectedLabel] of the
 * active option into a single TalkBack content description — "Select vehicle, {label}" — so the trigger is
 * never an unlabelled tap target and announces the current selection. When no option is selected (empty
 * fleet) it degrades to the bare [ariaLabel]. Pure so the a11y label is asserted off-device.
 */
fun vehicleSelectAccessibilityLabel(
    ariaLabel: String,
    selectedLabel: String,
): String = if (selectedLabel.isBlank()) ariaLabel else "$ariaLabel, $selectedLabel"

/**
 * Classifies a `/vehicles` failure into the recovery-oriented [QueryErrorKind] the error surface renders —
 * the same fold the sibling vehicle surfaces use: an offline/timeout failure is treated as not-online; a
 * circuit-open failure is the transient "waiting" state; otherwise the HTTP status selects the copy.
 */
fun vehicleSelectErrorKind(
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

/** Structured-log field key carrying the surface slug on every diagnostic. */
const val SURFACE_KEY: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [VehicleSelectRegistration.SLUG]
 * (P1/S11) — never a vehicle id or VIN, so a diagnostics line can never leak the fleet's posture. Kept free
 * of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordVehicleSelectOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(SURFACE_KEY to VehicleSelectRegistration.SLUG))
}
