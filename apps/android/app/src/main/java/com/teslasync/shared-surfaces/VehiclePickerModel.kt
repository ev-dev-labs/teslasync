// Pure, framework-free model + projection + diagnostics for the VehiclePicker shared surface — the native
// analogue of every value the web component derives before it returns JSX
// (web/src/components/layout/VehiclePicker.tsx composed with web/src/hooks/useSelectedVehicle.ts +
// web/src/api/hooks/usePinned.ts). No Compose, no Android framework, no HTTP: every declaration here is
// exercised off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): the persistent,
// app-wide vehicle selector mounted in the sidebar header. It is a drop-in `<Select>` wired to the global
// `useSelectedVehicle()` store, made PIN-AWARE by `usePinned('vehicle')`: vehicles the user has pinned float
// to the top in pin-position order, the rest follow in their original API order, and a pinned row's label is
// prefixed with a 📌 marker. Each row maps to an option (`value = String(id)`,
// `label = display_name || vin || 'Vehicle {id}'`), the chosen id is written back through `setVehicleId`, and
// the control carries the accessible label `t('vehiclePicker.aria', 'Select vehicle')` behind a leading car
// icon. The web returns `null` for a fleet of <= 1 vehicle ("there's nothing meaningful to pick") — a
// self-contained native surface must never render a blank box (P3 state matrix), so it instead renders a
// friendly empty state for 0 vehicles and a compact, non-interactive single-vehicle indicator for exactly 1,
// honouring the web's "no picker noise for single-vehicle owners" intent without hiding the region.
//
// The fleet is a genuine cache-then-network async dependency (web `useVehicles`, the source of
// `useSelectedVehicle().vehicles`), so this picker honestly drives the full loading / content / single /
// empty / stale / offline / error matrix: [projectVehiclePickerResource] preserves the ADR-013 envelope so
// the downstream [io.teslasync.android.data.UiState] resolves each state. The pins are a SEPARATE best-effort
// feed (web `usePinned` defaults to `[]`): they only re-ORDER and mark the rows and NEVER gate the phase, so a
// slow or failed pin load still shows a fully usable picker (just unsorted), exactly as the web component does.
// The persisted selection (web `useSelectedVehicleStore`) is folded in via [effectiveSelectedId] — the pure
// mirror of `SelectedVehicleStore.reconcile` + the web "default to the first vehicle" effect — and is computed
// against the ORIGINAL API order (not the pin-sorted order), matching the web where the default-to-first reads
// `useVehicles()` order while the pin sort is a display-only copy.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/VehiclePicker — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling VehicleSelect / RangePicker / selectedVehicle
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehiclepicker

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.pinned.PinnedItem

/**
 * Canonical registry metadata for the VehiclePicker surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`VehiclePicker`); [ID]
 * is the stable `viewModel` key the composable binds the surface with.
 */
object VehiclePickerRegistration {
    /** Stable surface id (also the `viewModel` key the host binds this surface with). */
    const val ID: String = "vehicle-picker"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VehiclePicker"
}

/**
 * The pinned-row marker the web prefixes onto a pinned option's label (`📌 ${base}`). A glyph, not a
 * translatable string, so it is locale-stable and shared verbatim with the web source.
 */
const val PIN_MARKER: String = "📌"

/**
 * The smallest fleet for which the web renders the interactive picker. The web hides the control for
 * `vehicles.length <= 1`; the native surface renders the dropdown only at this threshold and shows the
 * single-vehicle indicator / empty state below it.
 */
const val MIN_SELECTABLE_FLEET: Int = 2

/**
 * The Android string-resource names the surface resolves through the i18n facade (P1/S10). The web source's
 * only literal is the accessible label `t('vehiclePicker.aria', 'Select vehicle')`; the surrounding state
 * microcopy (loading / empty / stale / offline) the native surface needs for the states the web defers to the
 * host page is satisfied by reusing catalog keys that already ship in `values/`, `values-ar/` and `values-he/`
 * rather than inventing new ones (the same approach the sibling VehicleSelect surface takes). Each name is
 * asserted by value in the unit test; resource bytes are not read off-device.
 */
object VehiclePickerKeys {
    /** Accessible label — web `t('vehiclePicker.aria', 'Select vehicle')`. */
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
object VehiclePickerDefaults {
    const val ARIA: String = "Select vehicle"
    const val FALLBACK: String = "Vehicle"
    const val EMPTY_TITLE: String = "No vehicle selected"
}

/**
 * One selectable vehicle option, projected framework-free so the adapter is asserted off-device. Mirrors the
 * fields the web `VehiclePicker` reads from a `Vehicle` (`display_name` / `vin`) plus the [model] subtitle,
 * the [pinned] flag (web `pins.some(...)`, drives the 📌 label prefix + the pin-first sort), and the
 * [selected] flag derived from the effective selection. [id] is the option value (web `String(v.id)`).
 */
data class VehiclePickerRow(
    val id: Long,
    val displayName: String,
    val vin: String,
    val model: String?,
    val pinned: Boolean,
    val selected: Boolean,
)

/**
 * The projected surface payload: the enrolled-vehicle [vehicles] already sorted pinned-first (each tagged
 * [VehiclePickerRow.pinned] / [VehiclePickerRow.selected]) and the resolved [effectiveSelectedId] (web
 * `useSelectedVehicle().vehicleId`). The web hides the picker for a fleet of <= 1, so the surface distinguishes
 * three content shapes — empty (0), single (1), and the interactive dropdown ([isSelectable], >= 2) — while
 * never hiding the region.
 */
data class VehiclePickerData(
    val vehicles: List<VehiclePickerRow>,
    val effectiveSelectedId: Long?,
) {
    /** The currently-active row (the one matching [effectiveSelectedId]), or `null` when the fleet is empty. */
    val selectedRow: VehiclePickerRow? get() = vehicles.firstOrNull { it.selected }

    /** The enrolled-vehicle count. */
    val count: Int get() = vehicles.size

    /** True when there is no vehicle at all (empty fleet) — drives the friendly empty state. */
    val isEmpty: Boolean get() = vehicles.isEmpty()

    /** True when exactly one vehicle is enrolled — the web hides the picker; native shows a context indicator. */
    val isSingle: Boolean get() = vehicles.size == 1

    /** True when the interactive picker should render (web `vehicles.length > 1`). */
    val isSelectable: Boolean get() = vehicles.size >= MIN_SELECTABLE_FLEET

    companion object {
        /** The neutral payload used before any vehicle has loaded / when the fleet is empty. */
        val EMPTY: VehiclePickerData = VehiclePickerData(emptyList(), null)
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
 * to store > first here. [availableIds] is the ORIGINAL API order (not pin-sorted), matching the web where
 * the default-to-first reads `useVehicles()` order while the pin sort is a display-only copy.
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
 * Whether [vehicle] is pinned — the native mirror of the web `pins.some(p => String(p.item_id) === String(v.id))`.
 * The pin's [PinnedItem.itemId] is the stringified vehicle id (the wire contract), compared against
 * `vehicle.id.toString()`.
 */
fun isVehiclePinned(
    vehicle: Vehicle,
    pins: List<PinnedItem>,
): Boolean = pins.any { it.itemId == vehicle.id.toString() }

/**
 * Sorts [vehicles] pinned-first by pin position, leaving the rest in their original API order — the native
 * mirror of the web `VehiclePicker` `useMemo` sort. When [pins] is empty the list is returned UNCHANGED (web
 * `if (pins.length === 0) return vehicles`). The comparator reproduces the web tri-state exactly: both pinned
 * ⇒ by ascending position; one pinned ⇒ it sorts first; neither pinned ⇒ keep original order. [sortedWith] is
 * a STABLE sort, so the "neither pinned ⇒ 0" branch preserves API order just like the web `Array.sort`.
 */
fun sortVehiclesByPins(
    vehicles: List<Vehicle>,
    pins: List<PinnedItem>,
): List<Vehicle> {
    if (pins.isEmpty()) return vehicles
    val order: Map<String, Int> = pins.associate { it.itemId to it.position }
    return vehicles.sortedWith { a, b ->
        val ap = order[a.id.toString()]
        val bp = order[b.id.toString()]
        when {
            ap != null && bp != null -> ap.compareTo(bp)
            ap != null -> -1
            bp != null -> 1
            else -> 0
        }
    }
}

/**
 * Projects the enrolled [vehicles] + the current [pins] + the persisted [storedSelectedId] onto the
 * [VehiclePickerData] the view renders. The rows are pin-sorted for display ([sortVehiclesByPins]); each row's
 * [VehiclePickerRow.pinned] / [VehiclePickerRow.selected] is set against the pins and the effective selection;
 * and the effective selection is computed against the ORIGINAL [vehicles] order (web "computed inline so
 * first-render reads don't wait for the effect", from the un-sorted `useVehicles()` list).
 */
fun projectVehiclePicker(
    vehicles: List<Vehicle>,
    pins: List<PinnedItem>,
    storedSelectedId: Long?,
): VehiclePickerData {
    val effective = effectiveSelectedId(storedSelectedId, vehicles.map(Vehicle::id))
    val rows =
        sortVehiclesByPins(vehicles, pins).map { vehicle ->
            VehiclePickerRow(
                id = vehicle.id,
                displayName = vehicle.displayName,
                vin = vehicle.vin,
                model = vehicle.model,
                pinned = isVehiclePinned(vehicle, pins),
                selected = vehicle.id == effective,
            )
        }
    return VehiclePickerData(vehicles = rows, effectiveSelectedId = effective)
}

/**
 * Maps a raw `GET /vehicles` [Resource] onto a typed [Resource] of the projected [VehiclePickerData],
 * preserving the cache-then-network envelope (cached value, freshness stamp, staleness, error) so the
 * downstream [io.teslasync.android.data.UiState] projection still drives loading / content / empty / stale /
 * offline / error correctly. The best-available [pins] and the persisted [storedSelectedId] are folded into
 * every branch so the ordering + selection are reflected even while showing a cached / last-known list. Pins
 * are passed already resolved (web `usePinned` default `[]`), so a missing pin feed degrades to the
 * original-order, unmarked picker without affecting the phase.
 */
fun projectVehiclePickerResource(
    resource: Resource<List<Vehicle>>,
    pins: List<PinnedItem>,
    storedSelectedId: Long?,
): Resource<VehiclePickerData> =
    when (resource) {
        is Resource.Loading ->
            Resource.Loading(
                cached = resource.cached?.let { projectVehiclePicker(it, pins, storedSelectedId) },
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = projectVehiclePicker(resource.data, pins, storedSelectedId),
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = resource.cached?.let { projectVehiclePicker(it, pins, storedSelectedId) },
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
                error = resource.error,
            )
    }

/**
 * The base option label for a row — the native mirror of the web `v.display_name || v.vin || `Vehicle ${v.id}``:
 * the display name, else the VIN, else "{fallbackWord} {id}". The localized [fallbackWord] is supplied by the
 * render boundary so this stays framework-free.
 */
fun vehicleBaseLabel(
    row: VehiclePickerRow,
    fallbackWord: String,
): String = row.displayName.ifBlank { row.vin.ifBlank { "$fallbackWord ${row.id}" } }

/**
 * The full option label for a row — the [vehicleBaseLabel] prefixed with the [PIN_MARKER] when the row is
 * pinned, the native mirror of the web `isPinned ? `📌 ${base}` : base`.
 */
fun vehicleOptionLabel(
    row: VehiclePickerRow,
    fallbackWord: String,
): String {
    val base = vehicleBaseLabel(row, fallbackWord)
    return if (row.pinned) "$PIN_MARKER $base" else base
}

/**
 * Folds the accessible [ariaLabel] (web `t('vehiclePicker.aria')`) and the resolved [selectedLabel] of the
 * active option into a single TalkBack content description — "Select vehicle, {label}" — so the trigger is
 * never an unlabelled tap target and announces the current selection. When no option is selected (empty
 * fleet) it degrades to the bare [ariaLabel]. Pure so the a11y label is asserted off-device.
 */
fun vehiclePickerAccessibilityLabel(
    ariaLabel: String,
    selectedLabel: String,
): String = if (selectedLabel.isBlank()) ariaLabel else "$ariaLabel, $selectedLabel"

/**
 * Classifies a `/vehicles` failure into the recovery-oriented [QueryErrorKind] the error surface renders —
 * the same fold the sibling vehicle surfaces use: an offline/timeout failure is treated as not-online; a
 * circuit-open failure is the transient "waiting" state; otherwise the HTTP status selects the copy.
 */
fun vehiclePickerErrorKind(
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
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [VehiclePickerRegistration.SLUG]
 * (P1/S11) — never a vehicle id or VIN, so a diagnostics line can never leak the fleet's posture. Kept free
 * of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordVehiclePickerOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(SURFACE_KEY to VehiclePickerRegistration.SLUG))
}
