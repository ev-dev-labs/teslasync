// Pure, framework-free model + projection + diagnostics for the ActiveVehicleSegment shared surface — the
// native analogue of every value the web component derives before it returns JSX
// (web/src/components/layout/status-bar/ActiveVehicleSegment.tsx composed with web/src/hooks/useSelectedVehicle.ts,
// web/src/api/hooks/useVehicles.ts useVehicleState, and web/src/hooks/useUnits.ts). No Compose, no Android
// framework, no HTTP: every declaration here is exercised off-device in the :android:testReleaseUnitTest gate,
// keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): the footer status-bar
// segment for the currently-selected vehicle. It maps each enrolled vehicle to a switchable row
// (label = display_name || vin || "Vehicle {id}"), shows the active vehicle's live metrics
// (`${battery_level}% · ${round(convertDistanceFromSI(rated_range, unit))} ${unit}`), and renders one of three
// shapes by fleet size: a single-vehicle static chip, a multi-vehicle switcher button that opens a vehicle
// listbox, and — for an empty fleet — the web returns `null`. Because the P3 state matrix forbids hidden
// surfaces, the native surface instead renders a friendly empty state for the empty fleet (the same divergence
// the sibling VehicleSelect surface documents), so a region is never silently dropped.
//
// The fleet is a genuine cache-then-network async dependency (web `useVehicles`), so this surface honestly
// drives the full loading / content / empty / stale / offline / error matrix: [projectActiveVehicleSegmentResource]
// preserves the ADR-013 envelope so the downstream [io.teslasync.android.data.UiState] resolves each state. The
// persisted selection (web `useSelectedVehicle`) and the active vehicle's last-known [VehicleState] (web
// `useVehicleState`) are folded into the projection; the metrics value converts SI metres at the display
// boundary via [convertDistanceFromSI] + the user's [DistanceUnitPref] (web `useUnits`), never mutating the SI
// source (Phase-48 SI-canonical rule).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ActiveVehicleSegment — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling VehicleSelect / VehicleCard surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.activevehiclesegment

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlin.math.floor

/**
 * Canonical registry metadata for the ActiveVehicleSegment surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`ActiveVehicleSegment`);
 * [ID] is the stable `viewModel` key the composable binds the surface with.
 */
object ActiveVehicleSegmentRegistration {
    /** Stable surface id (also the `viewModel` key the host binds this surface with). */
    const val ID: String = "active-vehicle-segment"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ActiveVehicleSegment"
}

/**
 * The Android string-resource names the surface resolves through the i18n facade (P1/S10). Each name maps to a
 * `translation_*` resource present in `values/`, `values-ar/` and `values-he/` (asserted by value in the unit
 * test; resource bytes are not read off-device). The five `statusBar.vehicle.*` keys are the web source's own
 * `t()` calls; the surrounding cache-then-network microcopy (loading / empty / stale / offline / updating)
 * reuses catalog keys that already ship, rather than inventing new ones (the same approach the sibling
 * VehicleSelect surface takes).
 */
object ActiveVehicleSegmentKeys {
    /** Name fallback word — web `t('statusBar.vehicle.fallback', 'Vehicle')` (rendered as "Vehicle {id}"). */
    const val FALLBACK: String = "translation_statusBar_vehicle_fallback"

    /** No-selection label — web `t('statusBar.vehicle.none', 'No vehicle')`. */
    const val NONE: String = "translation_statusBar_vehicle_none"

    /** Tooltip lead word — web `t('statusBar.vehicle.tooltip', 'Active vehicle')`. */
    const val TOOLTIP: String = "translation_statusBar_vehicle_tooltip"

    /** Accessible label / listbox label — web `t('statusBar.vehicle.aria', 'Active vehicle')`. */
    const val ARIA: String = "translation_statusBar_vehicle_aria"

    /** Switcher action label — web `t('statusBar.vehicle.switch', 'Switch vehicle')`. */
    const val SWITCH: String = "translation_statusBar_vehicle_switch"

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
object ActiveVehicleSegmentDefaults {
    const val FALLBACK: String = "Vehicle"
    const val NONE: String = "No vehicle"
    const val TOOLTIP: String = "Active vehicle"
    const val ARIA: String = "Active vehicle"
    const val SWITCH: String = "Switch vehicle"
}

/**
 * One switchable vehicle row, projected framework-free so the adapter is asserted off-device. Mirrors the
 * fields the web component reads from a `Vehicle` (`display_name` / `vin` / `model`) plus the [selected] flag
 * derived from the effective selection. [id] is the row value (web `v.id`).
 */
data class ActiveVehicleRow(
    val id: Long,
    val displayName: String,
    val vin: String,
    val model: String?,
    val selected: Boolean,
)

/**
 * The projected surface payload: the enrolled-vehicle [vehicles] (each tagged [ActiveVehicleRow.selected]), the
 * resolved [effectiveSelectedId] (web `useSelectedVehicle().vehicleId`), and the active vehicle's [metricsLabel]
 * (web `${battery}% · ${range} ${unit}`, or `null` when no live state is available). The fleet size selects the
 * render shape: an empty fleet shows the friendly empty state, a single vehicle a static chip, two-or-more the
 * switcher.
 */
data class ActiveVehicleSegmentData(
    val vehicles: List<ActiveVehicleRow>,
    val effectiveSelectedId: Long?,
    val metricsLabel: String?,
) {
    /** The currently-active row (the one matching [effectiveSelectedId]), or `null` when the fleet is empty. */
    val selectedRow: ActiveVehicleRow? get() = vehicles.firstOrNull { it.selected }

    /** True when there is no vehicle to show (empty fleet) — drives the friendly empty state. */
    val isEmpty: Boolean get() = vehicles.isEmpty()

    /** The enrolled-vehicle count. */
    val count: Int get() = vehicles.size

    /** True for a single-vehicle fleet — the web static, non-interactive chip. */
    val isSingle: Boolean get() = vehicles.size == 1

    /** True once there is more than one vehicle to switch between — the web interactive switcher. */
    val isSwitchable: Boolean get() = vehicles.size > 1

    companion object {
        /** The neutral payload used before any vehicle has loaded / when the fleet is empty. */
        val EMPTY: ActiveVehicleSegmentData = ActiveVehicleSegmentData(emptyList(), null, null)
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
 * default: keep a valid choice that is still enrolled, otherwise fall to the first vehicle, otherwise (an empty
 * fleet) clear to `null`. Native has no URL tier, so the web URL > store > first precedence collapses to
 * store > first here.
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
 * The display label for a row — the native mirror of the web `v.display_name || v.vin || `Vehicle ${v.id}``:
 * the display name, else the VIN, else "{fallbackWord} {id}". The localized [fallbackWord] is supplied by the
 * render boundary so this stays framework-free.
 */
fun vehicleRowLabel(
    row: ActiveVehicleRow,
    fallbackWord: String,
): String = row.displayName.ifBlank { row.vin.ifBlank { "$fallbackWord ${row.id}" } }

/**
 * The active-vehicle label — the native mirror of the web
 * `vehicle?.display_name || vehicle?.vin || (vehicleId != null ? `${fallback} ${vehicleId}` : none)`: the
 * selected row's name/VIN/"{fallback} {id}", else (no row resolved) "{fallback} {selectedId}" when a selection
 * exists, else the localized [noneWord].
 */
fun activeVehicleLabel(
    selectedRow: ActiveVehicleRow?,
    selectedId: Long?,
    fallbackWord: String,
    noneWord: String,
): String =
    selectedRow?.let { vehicleRowLabel(it, fallbackWord) }
        ?: if (selectedId != null) "$fallbackWord $selectedId" else noneWord

/** The active vehicle's model subtitle — the native mirror of the web `vehicle?.model || ''` (blank ⇒ ""). */
fun activeVehicleSubLabel(selectedRow: ActiveVehicleRow?): String {
    val model = selectedRow?.model
    return if (model.isNullOrBlank()) "" else model
}

/**
 * The active-vehicle metrics chip — the native mirror of the web
 * `${battery_level ?? 0}% · ${Math.round(convertDistanceFromSI(rated_range ?? 0, unit))} ${unit}`. Returns
 * `null` when there is no live [state] (the web `liveState ? … : null`), so the chip is simply withheld. The
 * SI metres in [VehicleState.ratedRange] are converted at the display boundary via [convertDistanceFromSI] +
 * the user's [distancePref], rounded like JS `Math.round`, and suffixed with the unit label.
 */
fun formatMetricsLabel(
    state: VehicleState?,
    distancePref: DistanceUnitPref,
): String? {
    if (state == null) return null
    val range = jsRound(convertDistanceFromSI(state.ratedRange, distancePref))
    return "${state.batteryLevel}% \u00B7 $range ${distancePref.label}"
}

/** Rounds like JavaScript `Math.round` (round half toward +∞ = `floor(x + 0.5)`); ranges are non-negative. */
private fun jsRound(value: Double): Long = floor(value + 0.5).toLong()

/**
 * Folds the tooltip lead word (web `t('statusBar.vehicle.tooltip')`) with the [label], optional [subLabel], and
 * optional [metricsLabel] into the single web tooltip string: "{tooltip} · {label}[ · {subLabel}][ · {metrics}]".
 */
fun activeVehicleTooltip(
    tooltipWord: String,
    label: String,
    subLabel: String,
    metricsLabel: String?,
): String =
    buildString {
        append(tooltipWord)
        append(" \u00B7 ")
        append(label)
        if (subLabel.isNotBlank()) append(" \u00B7 ").append(subLabel)
        if (!metricsLabel.isNullOrBlank()) append(" \u00B7 ").append(metricsLabel)
    }

/** The single-chip TalkBack label — web `${t('statusBar.vehicle.aria','Active vehicle')}: ${label}`. */
fun activeVehicleAccessibilityLabel(
    ariaWord: String,
    label: String,
): String = "$ariaWord: $label"

/** The switcher-button TalkBack label — web `${t('statusBar.vehicle.switch','Switch vehicle')} (${label})`. */
fun switchVehicleAccessibilityLabel(
    switchWord: String,
    label: String,
): String = "$switchWord ($label)"

/**
 * Projects the enrolled [vehicles] + the persisted [storedSelectedId] + the active vehicle's last-known [state]
 * onto the [ActiveVehicleSegmentData] the view renders. The effective selection is computed inline (web
 * "computed inline so first-render reads don't wait for the effect"); each row's [ActiveVehicleRow.selected] is
 * set against it, and the metrics chip is formatted through the user's [distancePref].
 */
fun projectActiveVehicleSegment(
    vehicles: List<Vehicle>,
    storedSelectedId: Long?,
    state: VehicleState?,
    distancePref: DistanceUnitPref,
): ActiveVehicleSegmentData {
    val effective = effectiveSelectedId(storedSelectedId, vehicles.map(Vehicle::id))
    val rows =
        vehicles.map { vehicle ->
            ActiveVehicleRow(
                id = vehicle.id,
                displayName = vehicle.displayName,
                vin = vehicle.vin,
                model = vehicle.model,
                selected = vehicle.id == effective,
            )
        }
    return ActiveVehicleSegmentData(
        vehicles = rows,
        effectiveSelectedId = effective,
        metricsLabel = formatMetricsLabel(state, distancePref),
    )
}

/**
 * Maps a raw `GET /vehicles` [Resource] onto a typed [Resource] of the projected [ActiveVehicleSegmentData],
 * preserving the cache-then-network envelope (cached value, freshness stamp, staleness, error) so the
 * downstream [io.teslasync.android.data.UiState] projection still drives loading / content / empty / stale /
 * offline / error correctly. The persisted [storedSelectedId], the active [state], and the [distancePref] are
 * folded into every branch so the selection + metrics are reflected even while showing a cached / last-known
 * list.
 */
fun projectActiveVehicleSegmentResource(
    resource: Resource<List<Vehicle>>,
    storedSelectedId: Long?,
    state: VehicleState?,
    distancePref: DistanceUnitPref,
): Resource<ActiveVehicleSegmentData> =
    when (resource) {
        is Resource.Loading ->
            Resource.Loading(
                cached = resource.cached?.let { projectActiveVehicleSegment(it, storedSelectedId, state, distancePref) },
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = projectActiveVehicleSegment(resource.data, storedSelectedId, state, distancePref),
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = resource.cached?.let { projectActiveVehicleSegment(it, storedSelectedId, state, distancePref) },
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
                error = resource.error,
            )
    }

/**
 * Classifies a `/vehicles` failure into the recovery-oriented [QueryErrorKind] the error surface renders — the
 * same fold the sibling vehicle surfaces use: an offline/timeout failure is treated as not-online; a
 * circuit-open failure is the transient "waiting" state; otherwise the HTTP status selects the copy.
 */
fun activeVehicleSegmentErrorKind(
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
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface
 * [ActiveVehicleSegmentRegistration.SLUG] (P1/S11) — never a vehicle id or VIN, so a diagnostics line can never
 * leak the fleet's posture. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel
 * calls it once per surface open.
 */
fun recordActiveVehicleSegmentOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(SURFACE_KEY to ActiveVehicleSegmentRegistration.SLUG))
}
