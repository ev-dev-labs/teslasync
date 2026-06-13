// Pure, framework-free model + projection for the WidgetSettingsModal surface — the native analogue of everything the
// web component derives before it returns JSX (web/src/features/dashboard/components/WidgetSettingsModal.tsx). No
// Compose, no Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest
// gate, so the composable stays a thin render layer over these pure functions.
//
// The web component is the per-widget settings dialog opened from a dashboard widget's overflow menu. It edits a
// single [WidgetConfig] in local React state seeded from `widget.config`, exposing up to four sections: a vehicle
// picker (shown only for vehicle-scoped widgets — `def.category` is neither `system` nor `analytics`), a refresh-rate
// picker, a time-range picker (shown only for chart widgets — `driving`/`charging`/`analytics`/`battery`), and a
// "show widget title" toggle, then hands the edited config back through `onSave` and closes. Its only data hook is
// `useVehicles`, used purely to populate the vehicle dropdown. This file owns every derivation behind that surface:
// the vehicle/refresh/time-range option assembly (web option-literal arrays), the select-value reads (web
// `config.x?.toString() ?? 'all'|'default'`), the per-field config mutations (web `setConfig`'s `val === 'all' ?
// undefined : Number(val)` spreads), the "show title" default (web `config.showTitle !== false`), the two category
// predicates (web `isVehicleWidget` / `isChartWidget`), and the vehicle label fallback (web `display_name ||
// `Vehicle ${id}``). Localized chrome copy is resolved at the Compose boundary (P1/S10), never here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/WidgetSettingsModal — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling modal/dialog surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.widgetsettingsmodal

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object WidgetSettingsModalRegistration {
    /** Stable surface id. */
    const val ID: String = "widget-settings-modal"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "WidgetSettingsModal"
}

/**
 * The widget-category union the dashboard registry assigns (web `WidgetCategory`). [wire] is the exact lowercase token
 * carried in the registry; the modal only needs it to decide which sections to show ([WidgetSettingsProjection]).
 */
enum class WidgetCategory(
    val wire: String,
) {
    Vehicle("vehicle"),
    Battery("battery"),
    Energy("energy"),
    Driving("driving"),
    Charging("charging"),
    Climate("climate"),
    Tires("tires"),
    Security("security"),
    Commands("commands"),
    Media("media"),
    Telemetry("telemetry"),
    Analytics("analytics"),
    Alerts("alerts"),
    Automations("automations"),
    System("system"),
    Maps("maps"),
    ;

    companion object {
        /** Resolves a [wire] token back to its case; unknown tokens fall back to [Vehicle] (the registry default). */
        fun fromWire(wire: String): WidgetCategory = entries.firstOrNull { it.wire == wire } ?: Vehicle
    }
}

/**
 * The minimal widget definition the modal reads — the native mirror of the web `WidgetDef` fields the dialog touches
 * (`name`, `category`). [name] titles the dialog (web `` `${def.name} Settings` ``); [category] drives which sections
 * render. The full registry [WidgetDef] (icon, sizes, component) is irrelevant to the settings surface.
 */
data class WidgetDefInfo(
    val id: String,
    val name: String,
    val category: WidgetCategory,
)

/**
 * The widget instance being configured — the native mirror of the web `WidgetInstance` the dialog edits. [config]
 * seeds the dialog's working state (web `widget.config ?? {}`).
 */
data class WidgetInstanceInfo(
    val id: String,
    val widgetId: String,
    val config: WidgetConfig = WidgetConfig(),
)

/**
 * The editable widget configuration — the native mirror of the web `WidgetConfig`. The dialog edits the four
 * first-class fields ([vehicleId], [refreshRate], [timeRange], [showTitle]); [chartType] and any further registry keys
 * ([extras]) are preserved verbatim across edits, exactly as the web `setConfig((prev) => ({ ...prev, ... }))` spread
 * keeps untouched keys. A `null` first-class field is the web `undefined` (the dropdown's "default"/"all" sentinel);
 * `showTitle` is tri-state (`null` ⇒ the web `!== false` default of ON).
 */
data class WidgetConfig(
    val vehicleId: Long? = null,
    val refreshRate: Int? = null,
    val chartType: String? = null,
    val showTitle: Boolean? = null,
    val timeRange: String? = null,
    val extras: Map<String, JsonElement> = emptyMap(),
)

/** One option for a settings dropdown — a stable wire [value] and its already-localized [label]. */
data class WidgetSettingsOption(
    val value: String,
    val label: String,
)

/**
 * The pure derivations the composable renders over — the native mirror of the web component's inline option arrays,
 * `setConfig` spreads, and section predicates. Stateless and side-effect-free, so it is fully covered by the
 * off-device unit gate.
 */
object WidgetSettingsProjection {
    /** The vehicle dropdown's "all vehicles" sentinel (web `value: 'all'`). */
    const val VEHICLE_ALL_VALUE: String = "all"

    /** The refresh dropdown's "use per-widget default" sentinel (web `value: 'default'`). */
    const val REFRESH_DEFAULT_VALUE: String = "default"

    /** The time-range the dialog falls back to when the config carries none (web `config.timeRange ?? '7d'`). */
    const val DEFAULT_TIME_RANGE: String = "7d"

    /** The refresh-rate seconds the dropdown offers, in presentation order (web `5`/`15`/`30`/`60`). */
    val REFRESH_RATE_VALUES: List<Int> = listOf(5, 15, 30, 60)

    /** The time-range tokens the dropdown offers, in presentation order (web `24h`/`7d`/`30d`/`90d`). */
    val TIME_RANGE_VALUES: List<String> = listOf("24h", "7d", "30d", "90d")

    private val CHART_CATEGORIES: Set<WidgetCategory> =
        setOf(WidgetCategory.Driving, WidgetCategory.Charging, WidgetCategory.Analytics, WidgetCategory.Battery)

    /** Whether the vehicle picker is shown (web `def.category !== 'system' && def.category !== 'analytics'`). */
    fun isVehicleWidget(category: WidgetCategory): Boolean = category != WidgetCategory.System && category != WidgetCategory.Analytics

    /** Whether the time-range picker is shown (web `isChartWidget`: driving/charging/analytics/battery). */
    fun isChartWidget(category: WidgetCategory): Boolean = category in CHART_CATEGORIES

    /** The vehicle dropdown's selected value (web `config.vehicleId?.toString() ?? 'all'`). */
    fun vehicleSelectValue(config: WidgetConfig): String = config.vehicleId?.toString() ?: VEHICLE_ALL_VALUE

    /** Applies a vehicle-dropdown choice (web `val === 'all' ? undefined : Number(val)`). */
    fun withVehicleId(
        config: WidgetConfig,
        rawValue: String,
    ): WidgetConfig = config.copy(vehicleId = if (rawValue == VEHICLE_ALL_VALUE) null else rawValue.toLongOrNull())

    /** The refresh dropdown's selected value (web `config.refreshRate?.toString() ?? 'default'`). */
    fun refreshSelectValue(config: WidgetConfig): String = config.refreshRate?.toString() ?: REFRESH_DEFAULT_VALUE

    /** Applies a refresh-dropdown choice (web `val === 'default' ? undefined : Number(val)`). */
    fun withRefreshRate(
        config: WidgetConfig,
        rawValue: String,
    ): WidgetConfig = config.copy(refreshRate = if (rawValue == REFRESH_DEFAULT_VALUE) null else rawValue.toIntOrNull())

    /** The time-range dropdown's selected value (web `config.timeRange ?? '7d'`). */
    fun timeRangeSelectValue(config: WidgetConfig): String = config.timeRange ?: DEFAULT_TIME_RANGE

    /** Applies a time-range choice (web `setConfig((prev) => ({ ...prev, timeRange: e.target.value }))`). */
    fun withTimeRange(
        config: WidgetConfig,
        rawValue: String,
    ): WidgetConfig = config.copy(timeRange = rawValue)

    /** Whether the "show widget title" toggle is on (web `config.showTitle !== false`). */
    fun showTitleChecked(config: WidgetConfig): Boolean = config.showTitle != false

    /** Applies a "show widget title" toggle (web `setConfig((prev) => ({ ...prev, showTitle: checked }))`). */
    fun withShowTitle(
        config: WidgetConfig,
        checked: Boolean,
    ): WidgetConfig = config.copy(showTitle = checked)

    /** A vehicle's dropdown label (web `v.display_name || `Vehicle ${v.id}``); [vehicleWord] localizes the fallback. */
    fun vehicleLabel(
        vehicle: Vehicle,
        vehicleWord: String,
    ): String = vehicle.displayName.ifBlank { "$vehicleWord ${vehicle.id}" }

    /**
     * Assembles the vehicle dropdown options — the "all vehicles" sentinel first, then one option per enrolled
     * vehicle (web `[{ value: 'all', ... }, ...vehicleList.map(...)]`). [allLabel] is the localized "all" copy and
     * [vehicleWord] the localized fallback prefix for an unnamed vehicle.
     */
    fun vehicleOptions(
        vehicles: List<Vehicle>,
        allLabel: String,
        vehicleWord: String,
    ): List<WidgetSettingsOption> =
        buildList {
            add(WidgetSettingsOption(VEHICLE_ALL_VALUE, allLabel))
            vehicles.forEach { vehicle ->
                add(WidgetSettingsOption(vehicle.id.toString(), vehicleLabel(vehicle, vehicleWord)))
            }
        }
}

/**
 * The narrow read seam the dialog binds to for the vehicle dropdown — the native analogue of the web `useVehicles`
 * hook. A production binding routes to the shared **S8** [VehiclesStore] (see [widgetSettingsVehiclesSource]); tests
 * pass a fake. Keeping the seam this small means the dialog never sees the store, the cache, or HTTP.
 */
fun interface WidgetSettingsVehiclesSource {
    /** The cache-then-network enrolled-vehicle feed (cached value first for an instant open, then refreshed). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>
}

/**
 * Binds the dialog's vehicle read seam to the shared **S8** [VehiclesStore] (web `useVehicles`). The store's memoized,
 * multi-observer `GET /vehicles` feed flows through unchanged, so the dialog folds into the same shared collection as
 * every other Vehicles surface; re-collecting it (the modal's retry affordance) performs a genuine cache-then-network
 * re-fetch. No HTTP touches the view.
 */
fun widgetSettingsVehiclesSource(store: VehiclesStore): WidgetSettingsVehiclesSource = WidgetSettingsVehiclesSource { store.vehicles() }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [WidgetSettingsModalRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect. Carries no widget id or config value, so a diagnostics line can never leak which widget an
 * operator is configuring or how.
 */
fun recordWidgetSettingsModalOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to WidgetSettingsModalRegistration.SLUG))
}
