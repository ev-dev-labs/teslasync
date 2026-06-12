// Pure, framework-free model + projection for the AppearanceSettings feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/settings/components/AppearanceSettings.tsx). No Compose, no Android framework, no HTTP:
// every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component edits three server-backed appearance fields on the `/settings` document — `ui_density`,
// `time_format_default`, `chart_palette` — using the partial-merge `{ ...settings, key }` write because
// `PUT /settings` is full-replace; plus three device-local prefs (status bar, celebration, sidebar style) and
// the product-tours replay/reset actions. This file owns the parity-critical derivations: the four enum
// vocabularies with their wire tokens + web-faithful defaults, the settings-document parse, the partial-merge
// builders, the cache-then-network resource projection, and the two chart-palette swatch lists (web
// `CHART_COLORS_CB_SAFE` / `CHART_COLORS_NEON`, which are palette identity, not theme tokens).
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName` are suppressed because the mandated surface directory
// (com/teslasync/feature-views/AppearanceSettings — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package and hosts several co-located declarations, exactly as the sibling feature-view surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.appearancesettings

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object AppearanceSettingsRegistration {
    /** Stable surface id. */
    const val ID: String = "appearance-settings"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no user preference value. */
    const val SLUG: String = "AppearanceSettings"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AppearanceSettingsRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from
 * the composable's first-composition effect. Carries only the slug — never a density / palette / toggle value.
 */
fun recordAppearanceSettingsViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AppearanceSettingsRegistration.SLUG))
}

// ── Enum vocabularies (web string unions → type-safe, wire-token-pinned) ─────────────────────────────────────

/** The `ui_density` choices — the native mirror of the web `DensityId` union. Default `comfortable`. */
enum class DensityId(
    val wire: String,
) {
    Compact("compact"),
    Comfortable("comfortable"),
    Spacious("spacious"),
    ;

    companion object {
        /** Classifies a raw `ui_density`; an unknown/absent value falls back to [Comfortable] (web `?? 'comfortable'`). */
        fun from(raw: String?): DensityId = entries.firstOrNull { it.wire == raw } ?: Comfortable
    }
}

/** The `time_format_default` choices — the native mirror of the web `TimeFormatId` union. Default `relative`. */
enum class TimeFormatId(
    val wire: String,
) {
    Relative("relative"),
    Absolute("absolute"),
    ;

    companion object {
        /** Classifies a raw `time_format_default`; an unknown/absent value falls back to [Relative] (web `?? 'relative'`). */
        fun from(raw: String?): TimeFormatId = entries.firstOrNull { it.wire == raw } ?: Relative
    }
}

/** The `chart_palette` choices — the native mirror of the web `ChartPaletteId` union. Default `cb_safe`. */
enum class ChartPaletteId(
    val wire: String,
) {
    CbSafe("cb_safe"),
    Neon("neon"),
    ;

    companion object {
        /** Classifies a raw `chart_palette`; an unknown/absent value falls back to [CbSafe] (web `?? 'cb_safe'`). */
        fun from(raw: String?): ChartPaletteId = entries.firstOrNull { it.wire == raw } ?: CbSafe
    }
}

/** The device-local sidebar style — the native mirror of the web `SidebarStyle` union. Default `linear`. */
enum class SidebarStyle(
    val wire: String,
) {
    Linear("linear"),
    Notion("notion"),
    Legacy("legacy"),
    ;

    companion object {
        /** Classifies a raw stored value; an unknown/absent value falls back to [Linear] (web `DEFAULT_STYLE`). */
        fun from(raw: String?): SidebarStyle = entries.firstOrNull { it.wire == raw } ?: Linear
    }
}

/** The three onboarding tours the surface can replay — the native mirror of the web `startTour(id)` arguments. */
enum class ProductTour(
    val wire: String,
) {
    Main("main"),
    Debugger("debugger"),
    Automations("automations"),
}

// ── Device-local pref records (web localStorage shapes, web-faithful defaults) ───────────────────────────────

/**
 * The footer status-bar prefs — the native mirror of the web `StatusBarPrefs`. Defaults: shown, labels visible
 * (web `DEFAULTS = { enabled: true, iconOnly: false }`).
 */
data class StatusBarPrefs(
    val enabled: Boolean = true,
    val iconOnly: Boolean = false,
)

/**
 * The achievement-celebration prefs — the native mirror of the web `AchievementCelebrationPrefs`. Defaults:
 * toasts on, sound off, dashboard widget on, push on (web `defaultPrefs`).
 */
data class CelebrationPrefs(
    val showToasts: Boolean = true,
    val playSound: Boolean = false,
    val showOnDashboard: Boolean = true,
    val pushOnUnlock: Boolean = true,
)

// ── Server-backed appearance prefs (projected from the `/settings` document) ────────────────────────────────

/**
 * The three server-backed appearance selections the surface edits, projected from the `/settings` document.
 * Always derivable (each field falls back to its web default), so the value is never `null` once settings
 * resolve. [present] is `true` when the document carried at least one of the three keys — the content/empty
 * boundary: a brand-new account whose document has none yet renders the editor showing the defaults.
 */
data class AppearanceServerPrefs(
    val density: DensityId = DensityId.Comfortable,
    val timeFormat: TimeFormatId = TimeFormatId.Relative,
    val chartPalette: ChartPaletteId = ChartPaletteId.CbSafe,
    val present: Boolean = false,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's settings derivation +
 * partial-merge write. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object AppearanceSettingsProjection {
    /** The `/settings` field the web reads/writes for the density picker (web `settings.ui_density`). */
    const val KEY_DENSITY: String = "ui_density"

    /** The `/settings` field for the time-format default (web `settings.time_format_default`). */
    const val KEY_TIME_FORMAT: String = "time_format_default"

    /** The `/settings` field for the chart palette (web `settings.chart_palette`). */
    const val KEY_CHART_PALETTE: String = "chart_palette"

    /**
     * The CB-safe Okabe-Ito swatches (web `CHART_COLORS_CB_SAFE`). Palette identity, not theme tokens, so the
     * hex values are pinned here verbatim and parsed to a render color at the Compose boundary.
     */
    val CB_SAFE_SWATCHES: List<String> =
        listOf("#0072B2", "#E69F00", "#009E73", "#F0E442", "#56B4E9", "#D55E00", "#CC79A7", "#4B4B4B")

    /** The stylistic neon swatches (web `CHART_COLORS_NEON`). */
    val NEON_SWATCHES: List<String> =
        listOf("#00f0ff", "#10b981", "#a855f7", "#f59e0b", "#4f46e5", "#ef4444", "#ec4899", "#14b8a6")

    /** The swatch row shown beneath a palette choice (web `choice.swatches`). */
    fun swatchesFor(palette: ChartPaletteId): List<String> =
        when (palette) {
            ChartPaletteId.CbSafe -> CB_SAFE_SWATCHES
            ChartPaletteId.Neon -> NEON_SWATCHES
        }

    /** Parses the three appearance selections from the raw `/settings` document (web `settings?.field ?? default`). */
    fun parseServerPrefs(settings: JsonElement?): AppearanceServerPrefs {
        val obj = settings as? JsonObject
        return AppearanceServerPrefs(
            density = DensityId.from(obj.stringField(KEY_DENSITY)),
            timeFormat = TimeFormatId.from(obj.stringField(KEY_TIME_FORMAT)),
            chartPalette = ChartPaletteId.from(obj.stringField(KEY_CHART_PALETTE)),
            present = obj != null && KEYS.any { obj.containsKey(it) },
        )
    }

    /** Projects a settings-document [Resource] onto the server-prefs resource, preserving the freshness contract. */
    fun projectResource(resource: Resource<JsonElement>): Resource<AppearanceServerPrefs> =
        when (resource) {
            is Resource.Loading ->
                Resource.Loading(resource.cached?.let(::parseServerPrefs), resource.fetchedAt, resource.stale)
            is Resource.Success ->
                Resource.Success(parseServerPrefs(resource.data), resource.fetchedAt, resource.stale)
            is Resource.Error ->
                Resource.Error(resource.cached?.let(::parseServerPrefs), resource.fetchedAt, resource.stale, resource.error)
        }

    /** Builds the merged document for a density change (web `{ ...settings, ui_density: next }`). */
    fun withDensity(
        settings: JsonElement?,
        next: DensityId,
    ): JsonObject = merge(settings, KEY_DENSITY, next.wire)

    /** Builds the merged document for a time-format change (web `{ ...settings, time_format_default: next }`). */
    fun withTimeFormat(
        settings: JsonElement?,
        next: TimeFormatId,
    ): JsonObject = merge(settings, KEY_TIME_FORMAT, next.wire)

    /** Builds the merged document for a chart-palette change (web `{ ...settings, chart_palette: next }`). */
    fun withChartPalette(
        settings: JsonElement?,
        next: ChartPaletteId,
    ): JsonObject = merge(settings, KEY_CHART_PALETTE, next.wire)

    private val KEYS = listOf(KEY_DENSITY, KEY_TIME_FORMAT, KEY_CHART_PALETTE)

    /** Partial-merge: copy the existing document (or an empty object) and overwrite a single string [key]. */
    private fun merge(
        settings: JsonElement?,
        key: String,
        value: String,
    ): JsonObject {
        val base = (settings as? JsonObject)?.toMutableMap() ?: mutableMapOf()
        base[key] = JsonPrimitive(value)
        return JsonObject(base)
    }

    private fun JsonObject?.stringField(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull
}

/**
 * By-name resource keys for the strings the P1/S10 catalog does not yet define — the sidebar-style section
 * (added to the web source after the last catalog extraction) and the two chart-palette help lines. A
 * compile-time `R.string` reference cannot express "resolve if present, else fall back", so the view resolves
 * these by-name and falls back to the web `t(key, default)` English default in [AppearanceSettingsDefaults].
 * When the catalog later adds them they resolve from it automatically, exactly the i18next contract.
 */
object AppearanceSettingsKeys {
    const val SIDEBAR_LABEL: String = "translation_theme_sidebarStyle_label"
    const val SIDEBAR_LINEAR: String = "translation_theme_sidebarStyle_linear"
    const val SIDEBAR_LINEAR_HELP: String = "translation_theme_sidebarStyle_linearHelp"
    const val SIDEBAR_NOTION: String = "translation_theme_sidebarStyle_notion"
    const val SIDEBAR_NOTION_HELP: String = "translation_theme_sidebarStyle_notionHelp"
    const val SIDEBAR_LEGACY: String = "translation_theme_sidebarStyle_legacy"
    const val SIDEBAR_LEGACY_HELP: String = "translation_theme_sidebarStyle_legacyHelp"
    const val SIDEBAR_HELP: String = "translation_theme_sidebarStyle_help"
    const val PALETTE_CB_SAFE_HELP: String = "translation_theme_chartPalette_cbSafeHelp"
    const val PALETTE_NEON_HELP: String = "translation_theme_chartPalette_neonHelp"
}

/**
 * The web `t(key, default)` English defaults for the catalog-absent strings ([AppearanceSettingsKeys]),
 * reproduced verbatim from the web source so the surface still carries the exact microcopy while routing
 * through the i18n facade. Reproduces i18next's "return the default when the key is absent" behaviour.
 */
object AppearanceSettingsDefaults {
    const val SIDEBAR_LABEL: String = "Sidebar style"
    const val SIDEBAR_LINEAR: String = "Minimal"
    const val SIDEBAR_LINEAR_HELP: String =
        "Single column with section headers and a 2px accent bar on the active row. Recommended."
    const val SIDEBAR_NOTION: String = "Compact"
    const val SIDEBAR_NOTION_HELP: String =
        "Tighter rows with collapsible sections. Best for fitting many pages on screen."
    const val SIDEBAR_LEGACY: String = "Classic"
    const val SIDEBAR_LEGACY_HELP: String =
        "Colorful icon tiles with a pill on the active item. The most visual option."
    const val SIDEBAR_HELP: String =
        "Applies instantly. Saved per device — your other devices keep their own choice."
    const val PALETTE_CB_SAFE_HELP: String = "Okabe-Ito palette — distinguishable for all CVD types."
    const val PALETTE_NEON_HELP: String = "Bright cyan/magenta — best when colour vision is unimpaired."
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a thin
 * seam over the Android string catalog in production (an optional by-name resource read) and a map in tests, so
 * the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback
