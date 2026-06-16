// Pure, framework-free model + derivations for the AutomationsListPage surface — the native analogue of
// everything the web page computes before it returns JSX (web/src/features/automations/pages/AutomationsListPage.tsx,
// the automations hub). No Compose, no Android framework, no HTTP lives here: the stat rollup, the status /
// search filter predicate, the pin-aware ordering, the vehicle-name lookup, and the typed-import-envelope
// validation are all exercised off-device, keeping the composable a thin render layer.
//
// Values are plain counts / flags the backend already computed — none are unit-bearing — so there is no SI
// conversion here; locale formatting is applied at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/automations
// — the P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*`
// namespace uses, so the package intentionally diverges from the path — exactly as the sibling admin/analytics
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.automations

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.presentation.automations.Automation
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Canonical metadata for this surface. The web page is a top-level route, not a draggable dashboard widget,
 * so there is no web registry row to mirror — this object carries the cross-cutting concerns the surface owes:
 * the navigation [ROUTE_ID] / [WEB_PATH] the host wires, the diagnostics [SLUG] for the one-shot `view.opened`
 * event (P1/S11), the fixed [HISTORY_LIMIT] the web uses (`useAutomationHistory(20)`), and the deep-link the
 * Create / empty-state CTA targets (web `navigate('/automations/new')`).
 */
object AutomationsListPageRegistration {
    /** The navigation destination id (Destinations.kt `page("automations", "/automations", …)`). */
    const val ROUTE_ID: String = "automations"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/automations"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AutomationsListPage"

    /** History rows requested — the web `useAutomationHistory(20)`. */
    const val HISTORY_LIMIT: Int = 20

    /** Deep-link the Create button + empty-state CTA navigate to (web `/automations/new`). */
    const val BUILDER_DEEP_LINK: String = "teslasync://app/automations/new"
}

// ── Status filter (web `StatusFilter` union) ────────────────────────────────────────────────────────────────

/** The four status filters — the port of the web `'all' | 'active' | 'disabled' | 'auto-disabled'`. */
enum class AutomationStatusFilter(val wire: String) {
    All("all"),
    Active("active"),
    Disabled("disabled"),
    AutoDisabled("auto-disabled"),
    ;

    companion object {
        /** Resolve a wire value back to its filter, defaulting to [All] for any unknown token. */
        fun fromWire(wire: String): AutomationStatusFilter = entries.firstOrNull { it.wire == wire } ?: All
    }
}

// ── Stats (web `computeStats`) ───────────────────────────────────────────────────────────────────────────────

/** The four stat tiles' values — the port of the web `AutomationStats`. */
data class AutomationStats(
    val total: Int,
    val active: Int,
    val disabled: Int,
    val autoDisabled: Int,
)

/**
 * Rolls the automation list into the four tiles — the exact port of the web `computeStats`: an auto-disabled
 * row counts as auto-disabled (never active/disabled), an enabled row as active, everything else as disabled.
 */
fun computeAutomationStats(items: List<Automation>): AutomationStats {
    var active = 0
    var disabled = 0
    var autoDisabled = 0
    for (a in items) {
        when {
            a.autoDisabled -> autoDisabled++
            a.enabled -> active++
            else -> disabled++
        }
    }
    return AutomationStats(total = items.size, active = active, disabled = disabled, autoDisabled = autoDisabled)
}

// ── Combined page payload ────────────────────────────────────────────────────────────────────────────────────

/**
 * The combined automations payload the spine feed projects: the list itself, the id→name lookup folded in from
 * the best-effort vehicles feed (web `buildVehicleLookup`), the pin rows for ordering (web `usePinned`), and the
 * derived [stats]. The list drives the loading/empty/error phase; vehicles + pins fold in best-effort so a
 * still-loading or failed side feed never blanks the list.
 */
data class AutomationsData(
    val automations: List<Automation>,
    val vehicleNames: Map<Long, String>,
    val pins: List<PinnedItem>,
    val stats: AutomationStats,
) {
    /** True when there are no automations to render (drives the [io.teslasync.android.data.UiPhase.Empty] phase). */
    val isEmpty: Boolean get() = automations.isEmpty()

    companion object {
        /** The fully-empty payload used as the render fallback while the spine feed is still loading. */
        val EMPTY: AutomationsData = AutomationsData(emptyList(), emptyMap(), emptyList(), AutomationStats(0, 0, 0, 0))

        /** Fold the three cache-then-network reads into one payload, deriving the stats from the list. */
        fun from(
            automations: List<Automation>?,
            vehicles: List<Vehicle>?,
            pins: List<PinnedItem>?,
        ): AutomationsData {
            val list = automations ?: emptyList()
            return AutomationsData(
                automations = list,
                vehicleNames = buildVehicleLookup(vehicles ?: emptyList()),
                pins = pins ?: emptyList(),
                stats = computeAutomationStats(list),
            )
        }
    }
}

/** Build the id→display-name lookup (web `buildVehicleLookup`). */
fun buildVehicleLookup(vehicles: List<Vehicle>): Map<Long, String> = vehicles.associate { it.id to it.displayName }

// ── Filtering + pin ordering (web `filteredItems` + `sortedItems`) ───────────────────────────────────────────

/**
 * The web `filteredItems` memo: narrow by [statusFilter] (unless `all`) then by a case-insensitive [search] over
 * name + description. The order of the source list is preserved for everything that passes.
 */
fun filterAutomations(
    items: List<Automation>,
    statusFilter: AutomationStatusFilter,
    search: String,
): List<Automation> {
    var result = items
    if (statusFilter != AutomationStatusFilter.All) {
        result =
            result.filter { a ->
                when (statusFilter) {
                    AutomationStatusFilter.Active -> a.enabled && !a.autoDisabled
                    AutomationStatusFilter.Disabled -> !a.enabled && !a.autoDisabled
                    AutomationStatusFilter.AutoDisabled -> a.autoDisabled
                    AutomationStatusFilter.All -> true
                }
            }
    }
    val query = search.trim()
    if (query.isNotEmpty()) {
        val lower = query.lowercase()
        result =
            result.filter { a ->
                a.name.lowercase().contains(lower) || (a.description ?: "").lowercase().contains(lower)
            }
    }
    return result
}

/**
 * The web `sortedItems` memo: float pinned automations to the top in their stored pin position, leaving the
 * relative order of unpinned rows untouched. A stable sort preserves the (already filtered) order among ties.
 */
fun sortByPins(
    items: List<Automation>,
    pins: List<PinnedItem>,
): List<Automation> {
    if (pins.isEmpty()) return items
    val order: Map<String, Int> = pins.associate { it.itemId to it.position }
    return items.sortedWith(compareBy(nullsLast()) { order[it.id.toString()] })
}

// ── Typed import envelope (web `isAutomationImportEnvelope`) ──────────────────────────────────────────────────

private val IMPORT_JSON = Json {
    ignoreUnknownKeys = true
    isLenient = true
}

/** The outcome of validating a picked import file against the typed-envelope contract. */
sealed interface ImportParse {
    /** A well-formed typed export: [payload] is the verbatim parsed JSON, re-sent to the backend unchanged. */
    data class Valid(val payload: JsonElement) : ImportParse

    /** Parsed JSON, but not a `{ version: number, automations: [] }` typed envelope (web throws → required msg). */
    data object NotTypedEnvelope : ImportParse

    /** The file could not be read or parsed; [reason] is the underlying message when one exists. */
    data class Unreadable(val reason: String?) : ImportParse
}

/**
 * The port of the web `isAutomationImportEnvelope` guard applied to a picked file's text: a value is a typed
 * envelope iff it is a JSON object whose `version` is a JSON number AND whose `automations` is a JSON array.
 * Anything else is [ImportParse.NotTypedEnvelope]; an unparseable file is [ImportParse.Unreadable].
 */
fun parseImportEnvelope(text: String): ImportParse {
    val element =
        try {
            IMPORT_JSON.parseToJsonElement(text)
        } catch (e: SerializationException) {
            return ImportParse.Unreadable(e.message)
        }
    val obj = element as? JsonObject ?: return ImportParse.NotTypedEnvelope
    val version = obj["version"]
    val versionIsNumber = version is JsonPrimitive && !version.isString && version.doubleOrNull != null
    val automationsIsArray = obj["automations"] is JsonArray
    return if (versionIsNumber && automationsIsArray) ImportParse.Valid(element) else ImportParse.NotTypedEnvelope
}

/**
 * The page-level import failure surfaced after a pick — the web funnels every failure into the
 * `importFailedWithReason` wrapper with a `message`, so this carries which reason to format with it.
 */
sealed interface AutomationImportError {
    /** The picked file was not a typed envelope (reason = `automations.importTypedEnvelopeRequired`). */
    data object TypedEnvelopeRequired : AutomationImportError

    /** Read / parse / network failure (reason = [reason] when present, else `automations.importUnknownError`). */
    data class Failed(val reason: String?) : AutomationImportError
}
