// Pure, framework-free model + projection for the VehicleMultiSelect shared surface — the native analogue of
// the data + selection algebra the web component derives before returning JSX
// (web/src/components/forms/VehicleMultiSelect.tsx). No Compose, no Android UI, no HTTP: every type here is
// exercised by the :android:testReleaseUnitTest gate so the composable stays a thin render layer.
//
// The web `VehicleMultiSelect` is a controlled Alert-Studio multi-vehicle picker over a discriminated value
//   { kind: 'all_sticky' }                       — the whole fleet (current + future), and
//   { kind: 'specific', vehicle_ids: number[] }  — an explicit subset,
// with the sentinel mutually exclusive with per-vehicle selection, unknown ids (selected on a stored rule but
// not in the live `useVehicles()` list) preserved + badged, and a per-count trigger summary. This model
// reproduces that selection logic, the trigger-summary derivation, the option-row labelling, and the
// hydrate/build wire helpers EXACTLY, and folds in the cache-then-network lifecycle of the genuine async
// dependency a self-contained surface binds — the enrolled-vehicle feed (`useVehicles`) — so the surface can
// honestly render the prompt's loading / content / empty / error / stale / offline matrix without ever hiding
// a region.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/VehicleMultiSelect — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehiclemultiselect

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug, the structured-log field key, the event names, and the VIN-tail length are pinned here so
 * the native and web surfaces stay in lockstep.
 */
object VehicleMultiSelectRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VehicleMultiSelect"

    /** Structured-log field key carrying the surface slug. */
    const val SURFACE_KEY: String = "surface"

    /** The one PII-safe diagnostic emitted on first composition (P1/S11). */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** Emitted when the enrolled-vehicle feed is re-fetched (retry / stale auto-refresh). */
    const val EVENT_REFRESH: String = "vehicleMultiSelect.refresh"

    /** Trailing VIN digits surfaced on an option row (web `vin.slice(-4)`). */
    const val VIN_TAIL_LENGTH: Int = 4
}

/**
 * The editor's selection value — the native port of the web discriminated union. [AllSticky] is the
 * "all vehicles (current + future)" sentinel; [Specific] is an explicit subset by enrolled id. The two are
 * mutually exclusive exactly as the web value is.
 */
sealed interface VehicleSelection {
    /** Applies to the entire fleet, including vehicles enrolled later (web `{ kind: 'all_sticky' }`). */
    object AllSticky : VehicleSelection

    /** An explicit subset of enrolled vehicle ids (web `{ kind: 'specific', vehicle_ids }`). */
    data class Specific(
        val vehicleIds: List<Long>,
    ) : VehicleSelection
}

/** The explicitly-selected ids, or empty for the all-sticky sentinel — the web `value.vehicle_ids ?? []`. */
val VehicleSelection.specificIds: List<Long>
    get() = (this as? VehicleSelection.Specific)?.vehicleIds ?: emptyList()

/**
 * Dedups + sorts the [ids] ascending, dropping non-positive ids — the native port of the web `dedupSort`
 * (Decision D14). A `Set` collapses duplicates; the result is sorted so the wire payload is stable.
 */
fun dedupSort(ids: List<Long>): List<Long> = ids.filter { it > 0 }.toSet().sorted()

/**
 * Toggles a single [vehicleId] in the [current] selection — the native port of the web `handleToggleVehicle`.
 * Removing the last id leaves an empty [VehicleSelection.Specific] (the web "No vehicles selected" state),
 * never silently flipping to all-sticky. Adding re-dedups + re-sorts.
 */
fun toggleVehicle(
    current: VehicleSelection,
    vehicleId: Long,
): VehicleSelection {
    val ids = current.specificIds
    val next =
        if (vehicleId in ids) {
            ids.filterNot { it == vehicleId }
        } else {
            dedupSort(ids + vehicleId)
        }
    return VehicleSelection.Specific(next)
}

/**
 * Toggles the all-sticky sentinel — the native port of the web `handleToggleAll`. Turning it OFF restores the
 * [previousSpecific] subset (Decision D13; empty when none was remembered); turning it ON moves to
 * [VehicleSelection.AllSticky].
 */
fun toggleAll(
    current: VehicleSelection,
    previousSpecific: List<Long>,
): VehicleSelection =
    if (current is VehicleSelection.AllSticky) {
        VehicleSelection.Specific(previousSpecific)
    } else {
        VehicleSelection.AllSticky
    }

/**
 * The selected ids that are not in the live [knownIds] — vehicles selected on a stored rule but missing from
 * the current `useVehicles()` result (deleted / re-VINed). They are preserved in the selection and rendered
 * with an "Unknown" badge, never silently dropped (web `unknownIds`).
 */
fun unknownSelectedIds(
    selection: VehicleSelection,
    knownIds: Set<Long>,
): List<Long> = selection.specificIds.filterNot { it in knownIds }

/**
 * The localized strings the surface folds into its output, built from `stringResource` at the render boundary
 * (tests pass a deterministic instance) so [VehicleMultiSelectProjection] stays a pure, locale-stable
 * function. The `*Template` fields carry positional `%1$s` / `%2$s` arguments the helper methods fill in. Every
 * value resolves through the P1/S10 catalog (`translation_notifications_alertStudio_editor_vehicles*`).
 */
data class VehicleMultiSelectStrings(
    val summaryAll: String,
    val summaryNone: String,
    val summaryOneTemplate: String,
    val summaryPartialTemplate: String,
    val summaryCountTemplate: String,
    val allOption: String,
    val emptyFleetHelp: String,
    val unknownLabelTemplate: String,
    val unknownBadge: String,
    val triggerLabel: String,
    val loadingLabel: String,
    val staleLabel: String,
    val offlineLabel: String,
    val updatingLabel: String,
) {
    /** The single-vehicle summary with [name] interpolated (web `vehiclesSummaryOne` → `{{name}}`). */
    fun summaryOne(name: String): String = summaryOneTemplate.format(name)

    /** The partial summary "{count} of {total} vehicles" (web `vehiclesSummaryPartial`). */
    fun summaryPartial(
        count: Int,
        total: Int,
    ): String = summaryPartialTemplate.format(count, total)

    /** The count summary "{count} vehicles" (web `vehiclesSummaryCount`). */
    fun summaryCount(count: Int): String = summaryCountTemplate.format(count)

    /** The "Vehicle #{id}" label for an unknown / unnamed vehicle (web `vehiclesUnknownLabel`). */
    fun unknownLabel(id: Long): String = unknownLabelTemplate.format(id)
}

/**
 * The mutually-exclusive render surface the picker draws. [Content] is the enabled trigger + popover;
 * [Empty] is the disabled trigger + "add a vehicle" help (web `isFleetEmpty`); [Loading] and [Error] surface
 * the cold-start and hard-failure states of the enrolled-vehicle feed the surface binds.
 */
enum class VehicleMultiSelectPhase {
    /** First fleet load with nothing cached — render skeleton chrome (never a blank box). */
    Loading,

    /** The fleet resolved with at least one vehicle — render the trigger + the selectable popover. */
    Content,

    /** The fleet resolved empty (web `isFleetEmpty`) — render a disabled trigger + the empty-fleet help. */
    Empty,

    /** The fleet load failed with nothing cached to fall back on — render a classified error with retry. */
    Error,
}

/**
 * One render-ready option row — the native projection of a web popover `<button role="checkbox">`. [known]
 * is false for an unknown (selected-but-not-enrolled) id so the composable can badge it; [subtitle] carries
 * the model + VIN tail the web packs into the single option label.
 */
data class VehicleOption(
    val id: Long,
    val label: String,
    val subtitle: String?,
    val checked: Boolean,
    val known: Boolean,
)

/**
 * The immutable, render-ready projection the composable draws — the trigger [summary], whether the sentinel is
 * active ([selectionIsAll]), the enrolled [options] + the preserved [unknownOptions], and the cache-then-
 * network freshness envelope ([stale]/[offline]/[refreshing] + [errorKind]) so the surface honestly flags
 * last-known data instead of presenting it as live. Pure data so [VehicleMultiSelectProjection] is unit-tested
 * without a UI host.
 */
data class VehicleMultiSelectDisplay(
    val phase: VehicleMultiSelectPhase,
    val summary: String,
    val selectionIsAll: Boolean,
    val options: List<VehicleOption> = emptyList(),
    val unknownOptions: List<VehicleOption> = emptyList(),
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val freshnessStamp: Long? = null,
) {
    /** True when a freshness chip (stale / offline / refreshing) should be shown over cached data. */
    val showFreshnessChip: Boolean get() = stale || offline || refreshing

    /** True when a retry affordance should be offered (the hard-error surface). */
    val canRetry: Boolean get() = phase == VehicleMultiSelectPhase.Error

    /** True when the fleet is empty (the disabled-trigger + help branch). */
    val isFleetEmpty: Boolean get() = phase == VehicleMultiSelectPhase.Empty

    /** True when there are preserved unknown selections to render under their own divider. */
    val hasUnknown: Boolean get() = unknownOptions.isNotEmpty()
}

/**
 * Wire-shape sub-payload for an `AlertRuleInput` — the native port of the web `buildVehiclePayload`. Always
 * carries BOTH flags; never the legacy `vehicle_id` (Decision D11). Ids are deduped + sorted (Decision D14).
 */
data class VehiclePayload(
    val allVehicles: Boolean,
    val vehicleIds: List<Long>,
)

/**
 * Hydrates a server-stored rule into the editor's [VehicleSelection] — the native port of the web
 * `hydrateVehicleSelection`. Honours the new [allVehicles] flag when present, deduping [vehicleIds], and falls
 * back to the legacy single [vehicleId] for transitional compat (Decision D12): a null legacy id means the
 * rule applied fleet-wide, so it hydrates to [VehicleSelection.AllSticky].
 */
fun hydrateVehicleSelection(
    allVehicles: Boolean?,
    vehicleIds: List<Long>?,
    vehicleId: Long?,
): VehicleSelection {
    if (allVehicles != null) {
        return if (allVehicles) {
            VehicleSelection.AllSticky
        } else {
            VehicleSelection.Specific(dedupSort(vehicleIds ?: emptyList()))
        }
    }
    return if (vehicleId == null) VehicleSelection.AllSticky else VehicleSelection.Specific(listOf(vehicleId))
}

/**
 * Builds the wire payload from a [selection] — the native port of the web `buildVehiclePayload`. The sentinel
 * emits `all_vehicles = true` with no ids; a subset emits `all_vehicles = false` with the deduped + sorted ids.
 */
fun buildVehiclePayload(selection: VehicleSelection): VehiclePayload =
    when (selection) {
        is VehicleSelection.AllSticky -> VehiclePayload(allVehicles = true, vehicleIds = emptyList())
        is VehicleSelection.Specific -> VehiclePayload(allVehicles = false, vehicleIds = dedupSort(selection.vehicleIds))
    }

/**
 * Pure projection + labelling logic for the VehicleMultiSelect surface — the native port of the web
 * component's `triggerSummary` memo, its `vehicleLabel` helper, the unknown-id fold, and the option-row
 * derivation, plus the settings-document-style freshness fold the sibling surfaces use.
 */
object VehicleMultiSelectProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /**
     * The primary option-row label — the native port of the web `vehicleLabel` base (`display_name || model ||
     * 'Vehicle #id'`). A blank display name falls through to the model, then to the localized "Vehicle #{id}".
     */
    fun optionLabel(
        vehicle: Vehicle,
        strings: VehicleMultiSelectStrings,
    ): String =
        vehicle.displayName.ifBlank {
            vehicle.model?.takeIf(String::isNotBlank) ?: strings.unknownLabel(vehicle.id)
        }

    /**
     * The muted secondary line for an option row — the model (when distinct from the display name) and/or the
     * VIN tail the web packs into the label's "— {model} (VIN ...{last4})" suffix. Returns null when neither is
     * available, so the row collapses to just its primary label.
     */
    fun optionSubtitle(vehicle: Vehicle): String? {
        val model = vehicle.model?.takeIf { it.isNotBlank() && it != vehicle.displayName }
        val vin = vinSuffix(vehicle.vin)
        return listOfNotNull(model, vin).joinToString(SUBTITLE_SEPARATOR).ifEmpty { null }
    }

    /** The "…1234" VIN-tail suffix (web `...{vin.slice(-4)}`), or null when the VIN is too short. */
    fun vinSuffix(vin: String): String? =
        vin
            .takeIf { it.length >= VehicleMultiSelectRegistration.VIN_TAIL_LENGTH }
            ?.takeLast(VehicleMultiSelectRegistration.VIN_TAIL_LENGTH)
            ?.let { "$VIN_ELLIPSIS$it" }

    /**
     * The trigger summary — the native port of the web `triggerSummary` memo: the all-vehicles label for the
     * sentinel; otherwise "No vehicles selected" (0), the single vehicle's name (1), "{count} of {total}
     * vehicles" (a partial subset), or "{count} vehicles" (everything explicitly).
     */
    fun summary(
        selection: VehicleSelection,
        vehicles: List<Vehicle>,
        strings: VehicleMultiSelectStrings,
    ): String {
        if (selection is VehicleSelection.AllSticky) return strings.summaryAll
        val ids = selection.specificIds
        val total = vehicles.size
        val count = ids.size
        return when {
            count == 0 -> strings.summaryNone
            count == 1 -> strings.summaryOne(singleName(ids.first(), vehicles, strings))
            total > 0 && count < total -> strings.summaryPartial(count, total)
            else -> strings.summaryCount(count)
        }
    }

    private fun singleName(
        id: Long,
        vehicles: List<Vehicle>,
        strings: VehicleMultiSelectStrings,
    ): String {
        val vehicle = vehicles.firstOrNull { it.id == id } ?: return strings.unknownLabel(id)
        return optionLabel(vehicle, strings)
    }

    /** The enrolled options, each tagged with its checked state against the [selection] (web vehicle rows). */
    fun options(
        vehicles: List<Vehicle>,
        selection: VehicleSelection,
        strings: VehicleMultiSelectStrings,
    ): List<VehicleOption> {
        val selectedIds = selection.specificIds.toSet()
        return vehicles.map { vehicle ->
            VehicleOption(
                id = vehicle.id,
                label = optionLabel(vehicle, strings),
                subtitle = optionSubtitle(vehicle),
                checked = selection is VehicleSelection.Specific && vehicle.id in selectedIds,
                known = true,
            )
        }
    }

    /** The preserved unknown options — selected ids absent from the live fleet, always checked (web badge). */
    fun unknownOptions(
        vehicles: List<Vehicle>,
        selection: VehicleSelection,
        strings: VehicleMultiSelectStrings,
    ): List<VehicleOption> {
        val knownIds = vehicles.mapTo(mutableSetOf(), Vehicle::id)
        return unknownSelectedIds(selection, knownIds).map { id ->
            VehicleOption(id = id, label = strings.unknownLabel(id), subtitle = null, checked = true, known = false)
        }
    }

    /**
     * Folds the enrolled-vehicle [state] (the genuine async dependency) and the controlled [selection] into the
     * render-ready [VehicleMultiSelectDisplay]. Phase resolution honours both the web's branches and the feed's
     * async lifecycle: a hard failure with no cache → [VehicleMultiSelectPhase.Error]; a first load with nothing
     * cached → [VehicleMultiSelectPhase.Loading]; an empty fleet → [VehicleMultiSelectPhase.Empty] (web
     * `isFleetEmpty`); otherwise the selectable [VehicleMultiSelectPhase.Content]. The stale/offline envelope
     * honours the ADR-013 freshness contract so cached options shown after a failed refresh are flagged.
     */
    fun project(
        state: UiState<List<Vehicle>>,
        selection: VehicleSelection,
        strings: VehicleMultiSelectStrings,
    ): VehicleMultiSelectDisplay {
        val vehicles = state.data ?: emptyList()
        val phase =
            when {
                state.isError -> VehicleMultiSelectPhase.Error
                state.isLoading -> VehicleMultiSelectPhase.Loading
                vehicles.isEmpty() -> VehicleMultiSelectPhase.Empty
                else -> VehicleMultiSelectPhase.Content
            }
        val showsOptions = phase == VehicleMultiSelectPhase.Content
        return VehicleMultiSelectDisplay(
            phase = phase,
            summary = summary(selection, vehicles, strings),
            selectionIsAll = selection is VehicleSelection.AllSticky,
            options = if (showsOptions) options(vehicles, selection, strings) else emptyList(),
            unknownOptions = if (showsOptions) unknownOptions(vehicles, selection, strings) else emptyList(),
            stale = state.stale && state.errorKind == null,
            offline = state.stale && state.hasData && state.errorKind != null,
            refreshing = state.refreshing,
            errorKind = state.errorKind,
            httpStatus = state.httpStatus,
            freshnessStamp = state.fetchedAt,
        )
    }

    /**
     * Maps the hard-error [display] onto the shared [QueryErrorKind] recovery bucket so the error surface shows
     * the right copy: an open breaker → [QueryErrorKind.Waiting]; a connectivity failure →
     * [QueryErrorKind.Network]; a 401/403 → [QueryErrorKind.Unauthorized]; a 404 → [QueryErrorKind.NotFound];
     * every other HTTP/decode/unknown failure → [QueryErrorKind.ServerError] with a retry affordance.
     */
    fun queryErrorKind(display: VehicleMultiSelectDisplay): QueryErrorKind =
        when (display.errorKind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http ->
                when (display.httpStatus) {
                    HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    else -> QueryErrorKind.ServerError
                }
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }

    private const val SUBTITLE_SEPARATOR = "  ·  "
    private const val VIN_ELLIPSIS = "…"
}
