// Pure, framework-free model + projection for the ThemeProvider shared surface — the native analogue of
// the state the web context provider derives (web/src/components/ui/ThemeProvider.tsx). No Compose, no
// Android UI, no HTTP: every type here is exercised by the :android:testReleaseUnitTest gate so the
// composable stays a thin render layer.
//
// The web `ThemeProvider` is the app-wide appearance context: it owns a colour-theme catalogue
// (neon-cyan / tesla-red / matrix-green / royal-purple / solar-amber / custom) and a mode catalogue
// (dark / light / oled / midnight / auto / sunset / nord), resolves the active pair (auto follows the
// system colour scheme), persists the choice to the backend settings document AND localStorage, applies
// the result as CSS variables, and exposes it to descendants through `useTheme()`. This model reproduces
// the catalogues verbatim (the exact web hex/rgba values), the hex→rgb helper, the custom-theme builder,
// the auto-resolution rule, and the settings-document parse/merge the web `useEffect` + `saveThemeToBackend`
// perform — all as side-effect-free functions.
//
// The backend settings document is the surface's async data source (web `GET/PUT /settings`), so its
// cache-then-network lifecycle — hydrating → resolved, resolved-without-a-saved-theme (the structurally
// "empty" branch), a refresh that fails over cached/last-known data — drives the prompt's
// loading/content/empty/error/stale/offline state matrix honestly.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier). `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.themeprovider

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.roundToInt

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug, the four persistence keys (web `localStorage` keys), the settings-document field names
 * (web `settings.theme` / `mode` / `custom_primary` / `custom_accent`), and the default selection (web
 * `'neon-cyan'` / `'dark'` + the `#00b4d8` / `#e63946` custom seeds) are pinned here so the native and web
 * shells stay in lockstep.
 */
object ThemeProviderRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ThemeProvider"

    /** SharedPreferences file backing the local selection (the web `localStorage` analogue). */
    const val STORAGE_NAME: String = "teslasync-theme-provider"

    /** Persisted colour-theme key (web `localStorage 'teslasync-theme'`). */
    const val THEME_KEY: String = "teslasync-theme"

    /** Persisted mode key (web `localStorage 'teslasync-mode'`). */
    const val MODE_KEY: String = "teslasync-mode"

    /** Persisted custom primary key (web `localStorage 'teslasync-custom-primary'`). */
    const val CUSTOM_PRIMARY_KEY: String = "teslasync-custom-primary"

    /** Persisted custom accent key (web `localStorage 'teslasync-custom-accent'`). */
    const val CUSTOM_ACCENT_KEY: String = "teslasync-custom-accent"

    /** Settings-document field for the colour theme (web `settings.theme`). */
    const val SETTINGS_THEME_FIELD: String = "theme"

    /** Settings-document field for the mode (web `settings.mode`). */
    const val SETTINGS_MODE_FIELD: String = "mode"

    /** Settings-document field for the custom primary (web `settings.custom_primary`). */
    const val SETTINGS_CUSTOM_PRIMARY_FIELD: String = "custom_primary"

    /** Settings-document field for the custom accent (web `settings.custom_accent`). */
    const val SETTINGS_CUSTOM_ACCENT_FIELD: String = "custom_accent"

    /** Default custom primary seed (web `defaultCustomPrimary`). */
    const val DEFAULT_CUSTOM_PRIMARY: String = "#00b4d8"

    /** Default custom accent seed (web `defaultCustomAccent`). */
    const val DEFAULT_CUSTOM_ACCENT: String = "#e63946"

    /** The default selection applied before/without a persisted value (web `'neon-cyan'` + `'dark'`). */
    val DEFAULTS: ThemeSelection =
        ThemeSelection(
            themeId = ThemeId.NeonCyan,
            modeId = ModeId.Dark,
            customPrimary = DEFAULT_CUSTOM_PRIMARY,
            customAccent = DEFAULT_CUSTOM_ACCENT,
        )
}

/**
 * A decomposed 8-bit RGB triple — the native port of the web `primaryRGB` / `accentRGB` strings the
 * provider derives via `hexToRGB` for the `--theme-*-rgb` CSS variables. [css] renders the same
 * `"r, g, b"` form the web stores.
 */
data class Rgb(
    val r: Int,
    val g: Int,
    val b: Int,
) {
    /** The web `"r, g, b"` representation (e.g. `"0, 240, 255"`). */
    val css: String get() = "$r, $g, $b"
}

/**
 * The persisted colour-theme identity — the native port of the web `ThemeId` union. [wire] is the exact
 * string stored in localStorage and the settings document, so a value round-trips unchanged across web
 * and native.
 */
enum class ThemeId(
    val wire: String,
) {
    NeonCyan("neon-cyan"),
    TeslaRed("tesla-red"),
    MatrixGreen("matrix-green"),
    RoyalPurple("royal-purple"),
    SolarAmber("solar-amber"),
    Custom("custom"),
    ;

    companion object {
        /** Resolves a persisted/wire value to a [ThemeId], or `null` when it is unknown (web `in themes`). */
        fun fromWire(wire: String?): ThemeId? = entries.firstOrNull { it.wire == wire?.trim() }
    }
}

/**
 * The persisted mode identity — the native port of the web `ModeId` union. [wire] is the exact string
 * stored in localStorage and the settings document.
 */
enum class ModeId(
    val wire: String,
) {
    Dark("dark"),
    Light("light"),
    Oled("oled"),
    Midnight("midnight"),
    Auto("auto"),
    Sunset("sunset"),
    Nord("nord"),
    ;

    companion object {
        /** Resolves a persisted/wire value to a [ModeId], or `null` when it is unknown (web `in modes`). */
        fun fromWire(wire: String?): ModeId? = entries.firstOrNull { it.wire == wire?.trim() }
    }
}

/**
 * One colour theme — the native port of the web `ColorTheme`. Colours are carried as the exact web CSS
 * strings ([primary] / [accent] hex) so the catalogue is byte-for-byte parity; the render layer converts
 * them to platform colours via [ThemeProviderProjection.toArgb]. [primaryRgb] / [accentRgb] mirror the
 * web `primaryRGB` / `accentRGB`.
 */
data class ColorTheme(
    val id: ThemeId,
    val name: String,
    val primary: String,
    val primaryRgb: Rgb,
    val accent: String,
    val accentRgb: Rgb,
)

/**
 * One mode theme — the native port of the web `ModeTheme`. Every colour is the exact web CSS string (hex
 * for solids, `rgba(...)` for the glass layers) so the catalogue is parity-faithful; the render layer
 * converts them via [ThemeProviderProjection.toArgb]. [dark] is the web `colorScheme === 'dark'`.
 */
data class ModeTheme(
    val id: ModeId,
    val name: String,
    val bg: String,
    val surface1: String,
    val surface2: String,
    val surface3: String,
    val glassBg: String,
    val glassBorder: String,
    val textPrimary: String,
    val textSecondary: String,
    val textMuted: String,
    val dark: Boolean,
)

/**
 * The persisted appearance choice — the native union of the web provider's four pieces of state
 * (`themeId`, `modeId`, and the custom `{ primary, accent }` pair). It is what `useTheme()` ultimately
 * reflects and what the setters mutate.
 */
data class ThemeSelection(
    val themeId: ThemeId,
    val modeId: ModeId,
    val customPrimary: String,
    val customAccent: String,
)

/**
 * The resolved, ready-to-apply appearance — the native port of the web context's `{ theme, mode }` after
 * `currentThemes[themeId]` and the auto→system resolution. [themeId] / [modeId] are the original selection
 * (web exposes both the id and the resolved object); [theme] / [mode] are the concrete catalogue entries.
 */
data class ThemeResolution(
    val themeId: ThemeId,
    val modeId: ModeId,
    val theme: ColorTheme,
    val mode: ModeTheme,
) {
    /** A compact data label of the applied pair (e.g. `"Neon Cyan · Dark"`); theme names are data, not copy. */
    val label: String get() = "${theme.name} · ${mode.name}"
}

/**
 * The freshness envelope the shell flags over its backend-settings feed — folded from the bound feed's
 * [UiState] so a last-known settings document is never presented as live. [Live] shows the in-sync chip;
 * [Stale] shows the stale chip while a re-fetch runs over cached settings; [Offline] shows the offline
 * chip + retry when a refresh failed but cached settings are still served.
 */
enum class ThemeSyncFreshness { Live, Stale, Offline }

/**
 * Localized chrome labels the surface folds into its sync-status output. Built from `stringResource` at
 * the render boundary (tests pass a deterministic instance), keeping [ThemeProviderProjection] a pure,
 * locale-stable object. The web provider renders no chrome of its own (it is anonymous), so these back
 * only the prompt-mandated state matrix; every one resolves through the P1/S10 catalogue.
 */
data class ThemeProviderStrings(
    val region: String,
    val syncing: String,
    val stale: String,
    val offline: String,
    val retry: String,
) {
    /** True when every accessibility-critical label is present (no blank region/action copy ships). */
    val hasAccessibilityLabels: Boolean
        get() = region.isNotBlank() && syncing.isNotBlank() && retry.isNotBlank()
}

/**
 * Pure projection + catalogue for the ThemeProvider surface — the native port of the web provider's
 * derivations (`hexToRGB`, the `themes`/`modes` tables, `buildCustomTheme`, `currentThemes`, the
 * `resolvedMode` auto rule, and the settings parse/merge in the mount `useEffect` + `saveThemeToBackend`).
 * Side-effect-free so the whole contract is unit-tested off-device.
 */
object ThemeProviderProjection {
    private const val RADIX_HEX = 16
    private const val MAX_CHANNEL = 255f
    private const val ALPHA_SHIFT = 24
    private const val RED_SHIFT = 16
    private const val GREEN_SHIFT = 8
    private const val OPAQUE_ALPHA = 1.0f
    private const val TRANSPARENT_ALPHA = 0.0f
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404
    private const val HEX_R_END = 2
    private const val HEX_G_END = 4
    private const val HEX_B_END = 6

    /** The static colour-theme catalogue — the exact web `themes` table (custom is built per-selection). */
    val themes: Map<ThemeId, ColorTheme> =
        mapOf(
            ThemeId.NeonCyan to colorTheme(ThemeId.NeonCyan, "Neon Cyan", "#00f0ff", "#4f46e5"),
            ThemeId.TeslaRed to colorTheme(ThemeId.TeslaRed, "Tesla Red", "#e31937", "#ff4060"),
            ThemeId.MatrixGreen to colorTheme(ThemeId.MatrixGreen, "Matrix Green", "#00ff41", "#10b981"),
            ThemeId.RoyalPurple to colorTheme(ThemeId.RoyalPurple, "Royal Purple", "#a855f7", "#7c3aed"),
            ThemeId.SolarAmber to colorTheme(ThemeId.SolarAmber, "Solar Amber", "#f59e0b", "#d97706"),
            ThemeId.Custom to
                buildCustomTheme(
                    ThemeProviderRegistration.DEFAULT_CUSTOM_PRIMARY,
                    ThemeProviderRegistration.DEFAULT_CUSTOM_ACCENT,
                ),
        )

    /** The mode catalogue — the exact web `modes` table. */
    val modes: Map<ModeId, ModeTheme> =
        mapOf(
            ModeId.Dark to
                ModeTheme(
                    id = ModeId.Dark,
                    name = "Dark",
                    bg = "#0a0a0f",
                    surface1 = "#0f1019",
                    surface2 = "#151621",
                    surface3 = "#1a1b2e",
                    glassBg = "rgba(255, 255, 255, 0.04)",
                    glassBorder = "rgba(255, 255, 255, 0.08)",
                    textPrimary = "#ffffff",
                    textSecondary = "#9ca3af",
                    textMuted = "#6b7280",
                    dark = true,
                ),
            ModeId.Light to
                ModeTheme(
                    id = ModeId.Light,
                    name = "Light",
                    bg = "#f8fafc",
                    surface1 = "#ffffff",
                    surface2 = "#f1f5f9",
                    surface3 = "#e2e8f0",
                    glassBg = "rgba(255, 255, 255, 0.8)",
                    glassBorder = "rgba(0, 0, 0, 0.08)",
                    textPrimary = "#0f172a",
                    textSecondary = "#475569",
                    textMuted = "#94a3b8",
                    dark = false,
                ),
            ModeId.Oled to
                ModeTheme(
                    id = ModeId.Oled,
                    name = "OLED Black",
                    bg = "#000000",
                    surface1 = "#050505",
                    surface2 = "#0a0a0a",
                    surface3 = "#111111",
                    glassBg = "rgba(255, 255, 255, 0.03)",
                    glassBorder = "rgba(255, 255, 255, 0.05)",
                    textPrimary = "#ffffff",
                    textSecondary = "#9ca3af",
                    textMuted = "#6b7280",
                    dark = true,
                ),
            ModeId.Midnight to
                ModeTheme(
                    id = ModeId.Midnight,
                    name = "Midnight Blue",
                    bg = "#0a0e1a",
                    surface1 = "#0f1425",
                    surface2 = "#141a30",
                    surface3 = "#1a2240",
                    glassBg = "rgba(100, 150, 255, 0.04)",
                    glassBorder = "rgba(100, 150, 255, 0.08)",
                    textPrimary = "#e0e7ff",
                    textSecondary = "#94a3c8",
                    textMuted = "#6875a0",
                    dark = true,
                ),
            ModeId.Auto to
                ModeTheme(
                    id = ModeId.Auto,
                    name = "Auto (System)",
                    bg = "#0a0a0f",
                    surface1 = "#0f1019",
                    surface2 = "#151621",
                    surface3 = "#1a1b2e",
                    glassBg = "rgba(255, 255, 255, 0.04)",
                    glassBorder = "rgba(255, 255, 255, 0.08)",
                    textPrimary = "#ffffff",
                    textSecondary = "#9ca3af",
                    textMuted = "#6b7280",
                    dark = true,
                ),
            ModeId.Sunset to
                ModeTheme(
                    id = ModeId.Sunset,
                    name = "Sunset",
                    bg = "#1a0e0a",
                    surface1 = "#241410",
                    surface2 = "#2e1a14",
                    surface3 = "#3a221a",
                    glassBg = "rgba(255, 160, 100, 0.04)",
                    glassBorder = "rgba(255, 160, 100, 0.10)",
                    textPrimary = "#fff0e0",
                    textSecondary = "#c8a894",
                    textMuted = "#a07860",
                    dark = true,
                ),
            ModeId.Nord to
                ModeTheme(
                    id = ModeId.Nord,
                    name = "Nord",
                    bg = "#2e3440",
                    surface1 = "#3b4252",
                    surface2 = "#434c5e",
                    surface3 = "#4c566a",
                    glassBg = "rgba(136, 192, 208, 0.04)",
                    glassBorder = "rgba(136, 192, 208, 0.10)",
                    textPrimary = "#eceff4",
                    textSecondary = "#d8dee9",
                    textMuted = "#81a1c1",
                    dark = true,
                ),
        )

    /** Decomposes a `#rrggbb` hex string into its [Rgb] channels — the native port of web `hexToRGB`. */
    fun hexToRgb(hex: String): Rgb {
        val h = hex.trim().removePrefix("#")
        val r = h.substring(0, HEX_R_END).toInt(RADIX_HEX)
        val g = h.substring(HEX_R_END, HEX_G_END).toInt(RADIX_HEX)
        val b = h.substring(HEX_G_END, HEX_B_END).toInt(RADIX_HEX)
        return Rgb(r, g, b)
    }

    /** Builds the dynamic custom theme from its colours — the native port of web `buildCustomTheme`. */
    fun buildCustomTheme(
        primary: String,
        accent: String,
    ): ColorTheme =
        ColorTheme(
            id = ThemeId.Custom,
            name = "Custom",
            primary = primary,
            primaryRgb = hexToRgb(primary),
            accent = accent,
            accentRgb = hexToRgb(accent),
        )

    /**
     * The selection-specific theme catalogue — the static [themes] with `custom` rebuilt from the
     * selection's colours (the native port of web `currentThemes`).
     */
    fun themesFor(selection: ThemeSelection): Map<ThemeId, ColorTheme> =
        themes + (ThemeId.Custom to buildCustomTheme(selection.customPrimary, selection.customAccent))

    /** Resolves the active [ColorTheme] for [selection] (web `currentThemes[themeId]`). */
    fun resolveTheme(selection: ThemeSelection): ColorTheme =
        themesFor(selection)[selection.themeId] ?: themes.getValue(ThemeProviderRegistration.DEFAULTS.themeId)

    /**
     * Resolves the active [ModeTheme] for [selection] — the native port of the web `resolvedMode` rule:
     * `auto` follows the system colour scheme ([systemDark] ⇒ dark, else light); every other mode maps
     * straight to its catalogue entry.
     */
    fun resolveMode(
        selection: ThemeSelection,
        systemDark: Boolean,
    ): ModeTheme =
        when (selection.modeId) {
            ModeId.Auto -> if (systemDark) modes.getValue(ModeId.Dark) else modes.getValue(ModeId.Light)
            else -> modes[selection.modeId] ?: modes.getValue(ThemeProviderRegistration.DEFAULTS.modeId)
        }

    /** Resolves the full applied appearance for [selection] at the current [systemDark]. */
    fun resolve(
        selection: ThemeSelection,
        systemDark: Boolean,
    ): ThemeResolution =
        ThemeResolution(
            themeId = selection.themeId,
            modeId = selection.modeId,
            theme = resolveTheme(selection),
            mode = resolveMode(selection, systemDark),
        )

    /**
     * Parses a settings document into a [ThemeSelection] — the native port of the web mount `useEffect`:
     * a recognised `theme`/`mode` overrides [fallback], and the custom colours apply only when BOTH
     * `custom_primary` and `custom_accent` are present (web `if (settings.custom_primary && ...)`).
     */
    fun parseSelection(
        settings: JsonElement?,
        fallback: ThemeSelection,
    ): ThemeSelection {
        val obj = settings as? JsonObject ?: return fallback
        val theme = obj.text(ThemeProviderRegistration.SETTINGS_THEME_FIELD)?.let(ThemeId::fromWire) ?: fallback.themeId
        val mode = obj.text(ThemeProviderRegistration.SETTINGS_MODE_FIELD)?.let(ModeId::fromWire) ?: fallback.modeId
        val primary = obj.text(ThemeProviderRegistration.SETTINGS_CUSTOM_PRIMARY_FIELD)
        val accent = obj.text(ThemeProviderRegistration.SETTINGS_CUSTOM_ACCENT_FIELD)
        val bothCustom = primary != null && accent != null
        return ThemeSelection(
            themeId = theme,
            modeId = mode,
            customPrimary = if (bothCustom) primary else fallback.customPrimary,
            customAccent = if (bothCustom) accent else fallback.customAccent,
        )
    }

    /**
     * The structurally-empty predicate for the settings feed — `true` when the resolved document carries a
     * recognised theme or mode preference. Its inverse (a document with no saved appearance) is the surface's
     * "empty" branch: the local/default theme is shown rather than a server-side choice.
     */
    fun hasThemeSettings(settings: JsonElement?): Boolean {
        val obj = settings as? JsonObject ?: return false
        val themeOk = obj.text(ThemeProviderRegistration.SETTINGS_THEME_FIELD)?.let(ThemeId::fromWire) != null
        val modeOk = obj.text(ThemeProviderRegistration.SETTINGS_MODE_FIELD)?.let(ModeId::fromWire) != null
        return themeOk || modeOk
    }

    /**
     * Merges [selection] into the current settings document — the native port of web `saveThemeToBackend`'s
     * `{ ...current, theme, mode, custom_primary, custom_accent }`: every other settings key is preserved so
     * the full-replace `PUT /settings` never drops unrelated preferences.
     */
    fun mergeSelection(
        settings: JsonElement?,
        selection: ThemeSelection,
    ): JsonObject {
        val base = (settings as? JsonObject)?.toMutableMap() ?: mutableMapOf()
        base[ThemeProviderRegistration.SETTINGS_THEME_FIELD] = JsonPrimitive(selection.themeId.wire)
        base[ThemeProviderRegistration.SETTINGS_MODE_FIELD] = JsonPrimitive(selection.modeId.wire)
        base[ThemeProviderRegistration.SETTINGS_CUSTOM_PRIMARY_FIELD] = JsonPrimitive(selection.customPrimary)
        base[ThemeProviderRegistration.SETTINGS_CUSTOM_ACCENT_FIELD] = JsonPrimitive(selection.customAccent)
        return JsonObject(base)
    }

    /**
     * Converts a web CSS colour string (`#rrggbb` or `rgba(r, g, b, a)` / `rgb(r, g, b)`) to a packed
     * `0xAARRGGBB` value the render layer wraps in a platform colour. Pure so the catalogue's colour fidelity
     * is unit-tested off-device.
     */
    fun toArgb(css: String): Long {
        val value = css.trim()
        return if (value.startsWith("#")) argb(hexToRgb(value), OPAQUE_ALPHA) else rgbaToArgb(value)
    }

    /**
     * Maps the bound feed's [state] to the shell's [ThemeSyncFreshness] chip — honest freshness so a cached
     * settings document served after a stale TTL or a failed refresh is flagged, never shown as live.
     */
    fun freshness(state: UiState<*>): ThemeSyncFreshness =
        when {
            state.isOffline && state.errorKind != null -> ThemeSyncFreshness.Offline
            state.stale -> ThemeSyncFreshness.Stale
            else -> ThemeSyncFreshness.Live
        }

    /**
     * Maps the bound feed's hard-error [state] onto the shared [QueryErrorKind] recovery bucket so the
     * sync-status error branch shows the right copy: an open breaker → [QueryErrorKind.Waiting]; a
     * connectivity failure → [QueryErrorKind.Network]; a 401/403 → [QueryErrorKind.Unauthorized]; a 404 →
     * [QueryErrorKind.NotFound]; every other failure → [QueryErrorKind.ServerError] with a retry.
     */
    fun queryErrorKind(state: UiState<*>): QueryErrorKind =
        when (state.errorKind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http ->
                when (state.httpStatus) {
                    HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    else -> QueryErrorKind.ServerError
                }
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }

    private fun colorTheme(
        id: ThemeId,
        name: String,
        primary: String,
        accent: String,
    ): ColorTheme = ColorTheme(id, name, primary, hexToRgb(primary), accent, hexToRgb(accent))

    private fun rgbaToArgb(css: String): Long {
        val inner = css.substringAfter('(').substringBefore(')')
        val parts = inner.split(',').map { it.trim() }
        val r = parts.getOrNull(0)?.toIntOrNull() ?: 0
        val g = parts.getOrNull(1)?.toIntOrNull() ?: 0
        val b = parts.getOrNull(2)?.toIntOrNull() ?: 0
        val alpha = parts.getOrNull(3)?.toFloatOrNull() ?: OPAQUE_ALPHA
        return argb(Rgb(r, g, b), alpha)
    }

    private fun argb(
        rgb: Rgb,
        alpha: Float,
    ): Long {
        val a = (alpha.coerceIn(TRANSPARENT_ALPHA, OPAQUE_ALPHA) * MAX_CHANNEL).roundToInt().toLong()
        return (a shl ALPHA_SHIFT) or (rgb.r.toLong() shl RED_SHIFT) or (rgb.g.toLong() shl GREEN_SHIFT) or rgb.b.toLong()
    }

    private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content
}
