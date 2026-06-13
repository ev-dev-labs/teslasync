// Pure, framework-free model + projection for the SignalConfigModal surface — the native analogue of everything the
// web component derives before it returns JSX (web/src/components/ui/SignalConfigModal.tsx). No Compose, no Android,
// no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable
// stays a thin render layer over these pure functions.
//
// The web component is a *pure presentational* Fleet-Telemetry signal picker. Its only state is local React `useState`
// (the working signal list, the search box, the master interval, and the expanded-category set) — it performs NO data
// fetch, owns NO store, and its only "hook" would be `useTranslation` except the web source does not even use that:
// it hardcodes its English copy. It receives the available `categories` (each a name + its field list), the initially
// selected field names, and the initial interval as props, lets the operator toggle/retune per signal / per category /
// globally (with eight one-tap presets), and on submit hands the selected `{ name, interval }[]` back to the parent's
// `onSubmit` callback. This file owns every derivation behind that surface: the working-list seed (web `useState`
// initializer flatMap), the case-insensitive name search (web `filtered` memo), the category grouping in first-seen
// order (web `grouped` memo), the per-signal / per-category / master mutations (web `updateSignal` / `toggleAll` /
// `toggleCategory` / `setCategoryInterval` / `setMasterIntervalAll`), the eight preset transforms (web `PRESETS`), the
// selected/total/at-interval counts (web footer), and the submit payload assembly (web `handleSubmit`). The interval
// *labels* ("500ms" … "24h") are duration tokens carried here as data; the human descriptions, preset names, and
// chrome copy are resolved at the Compose boundary (P1/S10), never here.
//
// Because the surface has no data source (no request, no cache, no freshness window), the cache lifecycle phases
// (loading / error / stale / offline) have NO analogue here — exactly like the sibling KeyboardShortcutsModal and
// ConfirmDialog surfaces. The complete state set the web source actually defines is reproduced: the populated list
// (one section per category) and the empty fallback (no categories, or the search cleared every row).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/SignalConfigModal — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling modal/dialog surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.signalconfigmodal

import io.teslasync.shared.core.diagnostics.Logger

/**
 * One available signal-category definition handed in by the parent — the native mirror of the web `CategoryDef`
 * (`{ category, fields }`). [category] is the already-resolved backend category name (e.g. `"Driving"`), and [fields]
 * are the Fleet-Telemetry signal names that belong to it. Pure data; the parent supplies it from the live signal
 * catalogue, so the values flow straight through to the working list.
 */
data class SignalCategoryDef(
    val category: String,
    val fields: List<String>,
)

/**
 * One working row in the picker — the native mirror of the web `SignalConfig`
 * (`{ name, category, selected, interval }`). [name] is the Fleet-Telemetry signal name, [category] its backend
 * category, [selected] whether it is subscribed, and [interval] the polling cadence in **seconds** (with `0` carrying
 * the web's special sub-second "500ms" cadence). Immutable: every mutation returns a fresh copy.
 */
data class SignalConfig(
    val name: String,
    val category: String,
    val selected: Boolean,
    val interval: Int,
)

/**
 * The payload handed back to the parent's `onSubmit` on a valid submit — the native mirror of the web
 * `onSubmit({ name, interval }[])` argument: one entry per selected signal, carrying its name + chosen [interval]
 * (seconds). The category / selected flag are intentionally dropped, exactly like the web `handleSubmit` projection.
 */
data class SubscribedSignal(
    val name: String,
    val interval: Int,
)

/**
 * A render-ready category section — a category name and the (already filtered) rows that belong to it, in the
 * first-seen order the web `grouped` Map preserves. The native analogue of the web component's grouped-entries map.
 * The selection roll-ups ([allSelected] / [someSelected] / [selectedCount]) drive the header's tri-state checkbox and
 * its `(n/total)` count without the view recomputing them.
 */
data class SignalCategoryGroup(
    val category: String,
    val signals: List<SignalConfig>,
) {
    /** Whether every row in the section is selected (web `allCatSelected`) — the header checkbox's "on" state. */
    val allSelected: Boolean get() = signals.isNotEmpty() && signals.all { it.selected }

    /** Whether at least one row is selected (web `someCatSelected`) — the header checkbox's "indeterminate" state. */
    val someSelected: Boolean get() = signals.any { it.selected }

    /** How many rows in the section are selected (web `(n/total)` numerator). */
    val selectedCount: Int get() = signals.count { it.selected }
}

/**
 * One polling-cadence option — the native mirror of a web `INTERVAL_OPTIONS` entry's `{ value, label }`. [value] is
 * the cadence in seconds (`0` = the web's sub-second "500ms" sentinel); [label] is the compact duration token the
 * chips render. The token is a unit/number string (not translatable prose), so it lives here with the data; the human
 * description ("Real-time", "Default", …) is resolved at the Compose boundary.
 */
data class IntervalOption(
    val value: Int,
    val label: String,
)

/**
 * The fixed polling-cadence ladder the picker offers — a verbatim port of the web `INTERVAL_OPTIONS` value+label set.
 * The labels are duration tokens; their order is the order the selects present them.
 */
object SignalIntervals {
    /** The sub-second sentinel value (web `value: 0` → label `"500ms"`). */
    const val REALTIME_VALUE: Int = 0

    /** The default cadence the picker seeds new rows + the master control with (web `INTERVAL_OPTIONS[3]`, `10s`). */
    const val DEFAULT_VALUE: Int = 10

    /** The ten cadence options, in presentation order (web `INTERVAL_OPTIONS`). */
    val OPTIONS: List<IntervalOption> =
        listOf(
            IntervalOption(REALTIME_VALUE, "500ms"),
            IntervalOption(1, "1s"),
            IntervalOption(5, "5s"),
            IntervalOption(DEFAULT_VALUE, "10s"),
            IntervalOption(30, "30s"),
            IntervalOption(60, "60s"),
            IntervalOption(300, "5m"),
            IntervalOption(900, "15m"),
            IntervalOption(3600, "1h"),
            IntervalOption(86400, "24h"),
        )

    /** The duration token for [value], falling back to the default cadence's token (web `INTERVAL_OPTIONS[3]`). */
    fun labelFor(value: Int): String = OPTIONS.firstOrNull { it.value == value }?.label ?: defaultLabel()

    private fun defaultLabel(): String = OPTIONS.first { it.value == DEFAULT_VALUE }.label
}

/**
 * The backend category names the preset transforms key off — a verbatim copy of the literal category strings the web
 * `PRESETS` switch on. These are DATA identifiers (they must match the `categories` the parent supplies, themselves
 * the live signal catalogue's category names), never UI prose, so they stay here rather than in the i18n carrier.
 */
internal object SignalCategoryKeys {
    const val DRIVING = "Driving"
    const val POWERTRAIN = "Powertrain"
    const val LOCATION = "Location"
    const val CHARGING = "Charging"
    const val CLIMATE = "Climate"
    const val TIRES_SERVICE = "Tires & Service"
    const val VEHICLE_STATE = "Vehicle State"
    const val SAFETY = "Safety"
    const val MEDIA = "Media"
    const val VEHICLE_CONFIG = "Vehicle Config"
    const val USER_PREFERENCE = "User Preference"
}

/**
 * The eight one-tap configuration presets — a 1:1 port of the web `PRESETS` array's `apply` transforms. Each preset
 * rewrites the whole working list (selection + cadence per row) by its row's category, exactly as the web preset maps
 * `fields.map(f => ({ ...f, selected, interval }))`. [id] is a stable token used by the diagnostics + the view; the
 * preset's display name + description are resolved at the Compose boundary (P1/S10). Pure + unit-tested end to end.
 */
enum class SignalPreset(
    val id: String,
) {
    /** Web "⚡ Real-time Driving": driving/powertrain/location 1s, charge/climate/tires 10s, config 24h, else 10s. */
    RealtimeDriving("realtimeDriving"),

    /** Web "⚖️ Balanced": every signal selected at 10s. */
    Balanced("balanced"),

    /** Web "🔋 Low Power": every signal selected at 60s. */
    LowPower("lowPower"),

    /** Web "🏎️ Track Mode": driving/powertrain/location 1s, config 1h, everything else 30s. */
    TrackMode("trackMode"),

    /** Web "💰 Cost Saver": only location/charging/vehicle-state/safety, vehicle-state 15m, the rest 5m. */
    CostSaver("costSaver"),

    /** Web "😴 Sleep Watch": safety/state/location/charging/climate only; safety/state/charging 60s, else 5m. */
    SleepWatch("sleepWatch"),

    /** Web "🔧 Diagnostics": powertrain/tires/climate 5s, drive group 10s, media 60s, else 1h. */
    Diagnostics("diagnostics"),

    /** Web "🗺️ Trip Logger": everything except media/prefs/config; location 1s, driving 5s, graduated otherwise. */
    TripLogger("tripLogger"),
    ;

    /** Applies the preset to every row, returning a fresh list (web `apply(fields)`). */
    fun apply(signals: List<SignalConfig>): List<SignalConfig> = signals.map { reconfigure(it) }

    private fun reconfigure(signal: SignalConfig): SignalConfig {
        val category = signal.category
        return when (this) {
            RealtimeDriving -> signal.copy(selected = true, interval = realtimeDrivingInterval(category))
            Balanced -> signal.copy(selected = true, interval = SignalIntervals.DEFAULT_VALUE)
            LowPower -> signal.copy(selected = true, interval = LOW_POWER_INTERVAL)
            TrackMode -> signal.copy(selected = true, interval = trackModeInterval(category))
            CostSaver -> signal.copy(selected = costSaverSelected(category), interval = costSaverInterval(category))
            SleepWatch -> signal.copy(selected = sleepWatchSelected(category), interval = sleepWatchInterval(category))
            Diagnostics -> signal.copy(selected = true, interval = diagnosticsInterval(category))
            TripLogger -> signal.copy(selected = tripLoggerSelected(category), interval = tripLoggerInterval(category))
        }
    }

    companion object {
        /** The presets in the order the web renders their buttons. */
        val ORDERED: List<SignalPreset> = entries.toList()

        /** Resolves a preset [id] back to its case (defaulting to [Balanced] for an unknown token). */
        fun fromId(id: String): SignalPreset = entries.firstOrNull { it.id == id } ?: Balanced
    }
}

// ── Preset cadence/selection tables (web PRESETS apply bodies, verbatim) ────────────────────────────────────────────

private const val LOW_POWER_INTERVAL = 60
private const val FAST_INTERVAL = 1
private const val DRIVING_LOG_INTERVAL = 5
private const val MEDIUM_INTERVAL = 30
private const val MEDIA_INTERVAL = 60
private const val SLEEP_ACTIVE_INTERVAL = 60
private const val ESSENTIAL_INTERVAL = 300
private const val STATE_WATCH_INTERVAL = 900
private const val CONFIG_HOUR_INTERVAL = 3600
private const val CONFIG_DAY_INTERVAL = 86400
private const val DIAGNOSTIC_FAST_INTERVAL = 5

private fun realtimeDrivingInterval(category: String): Int =
    when (category) {
        SignalCategoryKeys.DRIVING, SignalCategoryKeys.POWERTRAIN, SignalCategoryKeys.LOCATION -> FAST_INTERVAL
        SignalCategoryKeys.CHARGING, SignalCategoryKeys.CLIMATE, SignalCategoryKeys.TIRES_SERVICE ->
            SignalIntervals.DEFAULT_VALUE
        SignalCategoryKeys.VEHICLE_CONFIG, SignalCategoryKeys.USER_PREFERENCE -> CONFIG_DAY_INTERVAL
        else -> SignalIntervals.DEFAULT_VALUE
    }

private fun trackModeInterval(category: String): Int =
    when (category) {
        SignalCategoryKeys.DRIVING, SignalCategoryKeys.POWERTRAIN, SignalCategoryKeys.LOCATION -> FAST_INTERVAL
        SignalCategoryKeys.VEHICLE_CONFIG, SignalCategoryKeys.USER_PREFERENCE -> CONFIG_HOUR_INTERVAL
        else -> MEDIUM_INTERVAL
    }

private fun costSaverSelected(category: String): Boolean =
    category in
        setOf(
            SignalCategoryKeys.LOCATION,
            SignalCategoryKeys.CHARGING,
            SignalCategoryKeys.VEHICLE_STATE,
            SignalCategoryKeys.SAFETY,
        )

private fun costSaverInterval(category: String): Int =
    if (category == SignalCategoryKeys.VEHICLE_STATE) STATE_WATCH_INTERVAL else ESSENTIAL_INTERVAL

private fun sleepWatchSelected(category: String): Boolean =
    category in
        setOf(
            SignalCategoryKeys.SAFETY,
            SignalCategoryKeys.VEHICLE_STATE,
            SignalCategoryKeys.LOCATION,
            SignalCategoryKeys.CHARGING,
            SignalCategoryKeys.CLIMATE,
        )

private fun sleepWatchInterval(category: String): Int =
    when (category) {
        SignalCategoryKeys.SAFETY, SignalCategoryKeys.VEHICLE_STATE, SignalCategoryKeys.CHARGING ->
            SLEEP_ACTIVE_INTERVAL
        else -> ESSENTIAL_INTERVAL
    }

private fun diagnosticsInterval(category: String): Int =
    when (category) {
        SignalCategoryKeys.POWERTRAIN, SignalCategoryKeys.TIRES_SERVICE, SignalCategoryKeys.CLIMATE ->
            DIAGNOSTIC_FAST_INTERVAL
        SignalCategoryKeys.DRIVING, SignalCategoryKeys.CHARGING, SignalCategoryKeys.VEHICLE_STATE,
        SignalCategoryKeys.SAFETY, SignalCategoryKeys.LOCATION,
        -> SignalIntervals.DEFAULT_VALUE
        SignalCategoryKeys.MEDIA -> MEDIA_INTERVAL
        else -> CONFIG_HOUR_INTERVAL
    }

private fun tripLoggerSelected(category: String): Boolean =
    category !in
        setOf(
            SignalCategoryKeys.MEDIA,
            SignalCategoryKeys.USER_PREFERENCE,
            SignalCategoryKeys.VEHICLE_CONFIG,
        )

private fun tripLoggerInterval(category: String): Int =
    when (category) {
        SignalCategoryKeys.LOCATION -> FAST_INTERVAL
        SignalCategoryKeys.DRIVING -> DRIVING_LOG_INTERVAL
        SignalCategoryKeys.POWERTRAIN, SignalCategoryKeys.CHARGING -> MEDIUM_INTERVAL
        SignalCategoryKeys.CLIMATE, SignalCategoryKeys.VEHICLE_STATE, SignalCategoryKeys.SAFETY -> SLEEP_ACTIVE_INTERVAL
        else -> ESSENTIAL_INTERVAL
    }

/**
 * The pure derivations the composable renders + mutates over — the native mirror of the web component's `useState`
 * initializer, its `filtered` / `grouped` memos, and its mutation handlers. Stateless and side-effect-free, so it is
 * fully covered by the off-device unit gate; the composable holds the resulting list in `remember` + calls back here.
 */
object SignalConfigProjection {
    /**
     * Seeds the working list from the parent props — the web `useState` initializer
     * (`categories.flatMap(cat => cat.fields.map(...))`): one row per field, marked selected when its name is in
     * [initialSelected], all seeded at [initialInterval].
     */
    fun seed(
        categories: List<SignalCategoryDef>,
        initialSelected: Collection<String>,
        initialInterval: Int,
    ): List<SignalConfig> {
        val selected = initialSelected.toHashSet()
        return categories.flatMap { def ->
            def.fields.map { field ->
                SignalConfig(
                    name = field,
                    category = def.category,
                    selected = field in selected,
                    interval = initialInterval,
                )
            }
        }
    }

    /** Case-insensitive name-substring filter (web `filtered` memo over `search.toLowerCase()`). */
    fun filter(
        signals: List<SignalConfig>,
        search: String,
    ): List<SignalConfig> {
        val needle = search.trim().lowercase()
        if (needle.isEmpty()) return signals
        return signals.filter { it.name.lowercase().contains(needle) }
    }

    /**
     * Groups [signals] by category in first-seen order (web `grouped` memo, which preserves Map insertion order). Pass
     * the already-[filter]ed list so empty sections collapse exactly as the web `grouped.entries` does.
     */
    fun group(signals: List<SignalConfig>): List<SignalCategoryGroup> {
        val byCategory = LinkedHashMap<String, MutableList<SignalConfig>>()
        for (signal in signals) byCategory.getOrPut(signal.category) { mutableListOf() }.add(signal)
        return byCategory.map { (category, rows) -> SignalCategoryGroup(category, rows) }
    }

    /** How many rows are selected (web `selectedCount`). */
    fun selectedCount(signals: List<SignalConfig>): Int = signals.count { it.selected }

    /** Whether every row is selected (web `allSelected`); `false` for an empty list so "Select all" stays offered. */
    fun allSelected(signals: List<SignalConfig>): Boolean = signals.isNotEmpty() && signals.all { it.selected }

    /** How many *selected* rows poll at [interval] (web footer `… at 500ms` / `… at 10s`). */
    fun countAtInterval(
        signals: List<SignalConfig>,
        interval: Int,
    ): Int = signals.count { it.selected && it.interval == interval }

    /** Rewrites the row named [name] with [transform], leaving the rest untouched (web `updateSignal`). */
    fun updateSignal(
        signals: List<SignalConfig>,
        name: String,
        transform: (SignalConfig) -> SignalConfig,
    ): List<SignalConfig> = signals.map { if (it.name == name) transform(it) else it }

    /** Sets `selected` on every row (web `toggleAll`). */
    fun setAllSelected(
        signals: List<SignalConfig>,
        selected: Boolean,
    ): List<SignalConfig> = signals.map { it.copy(selected = selected) }

    /** Sets `interval` on every row (web `setMasterIntervalAll`). */
    fun setAllInterval(
        signals: List<SignalConfig>,
        interval: Int,
    ): List<SignalConfig> = signals.map { it.copy(interval = interval) }

    /**
     * Toggles a whole category's selection (web `toggleCategory`): if every row in [category] is already selected they
     * are all deselected, otherwise they are all selected. Rows outside the category are untouched.
     */
    fun toggleCategory(
        signals: List<SignalConfig>,
        category: String,
    ): List<SignalConfig> {
        val categoryRows = signals.filter { it.category == category }
        val allCatSelected = categoryRows.isNotEmpty() && categoryRows.all { it.selected }
        return signals.map { if (it.category == category) it.copy(selected = !allCatSelected) else it }
    }

    /** Sets `interval` on every row in [category] (web `setCategoryInterval`). */
    fun setCategoryInterval(
        signals: List<SignalConfig>,
        category: String,
        interval: Int,
    ): List<SignalConfig> = signals.map { if (it.category == category) it.copy(interval = interval) else it }

    /**
     * Assembles the `onSubmit` payload from the selected rows — the web `handleSubmit` projection
     * (`signals.filter(selected).map(s => ({ name, interval }))`). Empty when nothing is selected (the view disables
     * the submit in that case, mirroring the web disabled button).
     */
    fun buildSubmission(signals: List<SignalConfig>): List<SubscribedSignal> =
        signals.filter { it.selected }.map { SubscribedSignal(it.name, it.interval) }
}

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object SignalConfigModalRegistration {
    /** Stable surface id. */
    const val ID: String = "signal-config-modal"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SignalConfigModal"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface
 * [SignalConfigModalRegistration.SLUG] — never a signal name, the category list, or the chosen cadences — so a
 * diagnostics line can never leak which signals the operator is subscribing to. Kept free of Compose so it is
 * unit-tested with a recording [Logger]; the composable calls it from its first-composition effect.
 */
object SignalConfigModalDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SignalConfigModalRegistration.SLUG))
    }
}
