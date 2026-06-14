// Pure, framework-free model + projection + diagnostics for the ThemePicker shared surface — the native
// analogue of everything the web source owns before it returns JSX (web/src/components/ui/ThemePicker.tsx,
// backed by web/src/components/ui/ThemeProvider.tsx). No Compose, no Android framework, no HTTP: every
// declaration here is exercised by the :android:testReleaseUnitTest gate, so the composable stays a thin
// render layer.
//
// What the web source is, and therefore the COMPLETE branch set this surface reproduces: a controlled
// picker over the `useTheme()` context. It renders a Display Mode selector (the seven `modes` — dark,
// light, oled, midnight, auto, sunset, nord — each previewed by its surface-colour strip), an Accent
// Color selector (the five brand `themes` — neon-cyan, tesla-red, matrix-green, royal-purple, solar-amber
// — plus an optional custom tile), and, when the custom theme is active, a primary/accent colour builder.
// Picking any option calls the matching `setTheme`/`setMode`/`setCustomColors` and raises a `toast.info`.
// The `showMode`, `showCustom`, and `compact` props gate the sections and density. The brand palette names
// (`Neon Cyan`, `Dark`, …) are data literals in the web `ThemeProvider`, never `t()` keys, so they are
// modelled as catalogue data here too; only the seven chrome strings the web routes through `t()`
// (`theme.theme`/`.mode`/`.displayMode`/`.accentColor`/`.custom`/`.primary`/`.accent`) resolve through the
// P1/S10 i18n catalogue at the render boundary.
//
// The persisted selection is the surface's single async dependency — the web `ThemeProvider` hydrates it
// from `GET /settings` (falling back to its defaults) behind an `initialized` gate and writes every change
// back. That cache-then-network lifecycle (hydrating → resolved, a read failure degrading to
// last-known/offline, a re-hydrate flagged stale) drives the prompt's loading/content/error/stale/offline
// matrix honestly, without inventing a remote feed the picker does not have. The catalogues are static
// brand data and never empty in production; the structurally-empty branch ([ThemePickerData.isEmpty]) is a
// defensive friendly state for a degenerate empty catalogue rather than a blank box.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ThemePicker — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment is illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.themepicker

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the ThemePicker surface — the native mirror of the web component's
 * contract. The diagnostics [SLUG] is emitted with the one-shot `view.opened` event (P1/S11), [STORAGE_KEY]
 * is the persisted-preference namespace (the web `teslasync-theme*` localStorage keys + the `/settings`
 * mirror), and the [DEFAULT_THEME_ID] / [DEFAULT_MODE_ID] / custom-colour defaults mirror the web
 * `ThemeProvider` fallbacks (`'neon-cyan'`, `'dark'`, `#00b4d8`, `#e63946`).
 */
object ThemePickerRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ThemePicker"

    /** Stable surface id (also the `viewModel` key a host binds the picker with). */
    const val ID: String = "theme-picker"

    /** Persistence namespace for the theme preference (web `teslasync-theme` / `teslasync-mode` keys). */
    const val STORAGE_KEY: String = "teslasync-theme-prefs"

    /** Default brand accent theme before/without a persisted value (web `'neon-cyan'`). */
    const val DEFAULT_THEME_ID: String = "neon-cyan"

    /** Default display mode before/without a persisted value (web `'dark'`). */
    const val DEFAULT_MODE_ID: String = "dark"

    /** The `custom` theme id, kept distinct from the five brand ids (web `'custom'`). */
    const val CUSTOM_THEME_ID: String = "custom"

    /** Default custom primary colour (web `defaultCustomPrimary = '#00b4d8'`), ARGB. */
    const val DEFAULT_CUSTOM_PRIMARY: Long = 0xFF00B4D8

    /** Default custom accent colour (web `defaultCustomAccent = '#e63946'`), ARGB. */
    const val DEFAULT_CUSTOM_ACCENT: Long = 0xFFE63946

    /** The default persisted selection applied before/without stored state (web `DEFAULTS`). */
    val DEFAULTS: ThemeSelection =
        ThemeSelection(
            themeId = DEFAULT_THEME_ID,
            modeId = DEFAULT_MODE_ID,
            customPrimary = DEFAULT_CUSTOM_PRIMARY,
            customAccent = DEFAULT_CUSTOM_ACCENT,
        )
}

/**
 * One brand accent theme — the native mirror of the web `ColorTheme`. [primary]/[accent] are ARGB colour
 * longs (the web hex strings parsed once) so the pure model carries no Compose `Color`. [name] is brand
 * data, identical to the web `ThemeProvider`'s literal `name`, not a localizable chrome string.
 *
 * @property id the stable theme id (web `ThemeId`), e.g. `neon-cyan`.
 * @property name the brand display name (web `name`), e.g. `Neon Cyan`.
 * @property primary the primary brand colour (ARGB).
 * @property accent the secondary brand colour (ARGB), paired with [primary] in the swatch gradient.
 */
data class ThemeOption(
    val id: String,
    val name: String,
    val primary: Long,
    val accent: Long,
)

/**
 * One display mode — the native mirror of the web `ModeTheme`. The four surface colours ([bg], [surface1],
 * [surface2], [surface3]) back the web per-mode swatch strip; [textPrimary] tints the mode glyph and
 * [glassBorder] outlines its icon box. [dark] mirrors the web `colorScheme` so a host can resolve the
 * Material 3 scheme. All colours are ARGB longs.
 *
 * @property id the stable mode id (web `ModeId`), e.g. `dark`.
 * @property name the brand display name (web `name`), e.g. `OLED Black`.
 */
data class ModeOption(
    val id: String,
    val name: String,
    val bg: Long,
    val surface1: Long,
    val surface2: Long,
    val surface3: Long,
    val textPrimary: Long,
    val glassBorder: Long,
    val dark: Boolean,
) {
    /** The four-swatch palette strip the web previews per mode (`[bg, surface1, surface2, surface3]`). */
    val swatches: List<Long> get() = listOf(bg, surface1, surface2, surface3)
}

/**
 * The persisted theme preference — the native port of what the web `ThemeProvider` owns and mirrors to
 * `localStorage` + `GET/PUT /settings` (`theme`, `mode`, `custom_primary`, `custom_accent`). Defaults via
 * [ThemePickerRegistration.DEFAULTS] so a missing/corrupt value never blanks the picker.
 *
 * @property themeId the selected brand or `custom` theme id (web `themeId`).
 * @property modeId the selected display mode id (web `modeId`).
 * @property customPrimary the user's custom primary colour (ARGB; web `custom_primary`).
 * @property customAccent the user's custom accent colour (ARGB; web `custom_accent`).
 */
data class ThemeSelection(
    val themeId: String,
    val modeId: String,
    val customPrimary: Long,
    val customAccent: Long,
)

/**
 * The fully-folded render data the composable paints — the catalogues plus the current [selection]. The
 * catalogues are static brand data ([ThemeCatalog.THEMES] / [ThemeCatalog.MODES]); folding them with the
 * persisted selection is the native analogue of the web component reading `themes`, `modes`, `themeId`,
 * and `modeId` off `useTheme()`. Pure data (no Compose) so the whole contract is unit-tested without a UI.
 *
 * @property selection the current persisted preference.
 * @property themes the brand accent themes to render in the Accent Color grid (web `themes`, minus custom).
 * @property modes the display modes to render in the Display Mode grid (web `modes`).
 */
data class ThemePickerData(
    val selection: ThemeSelection,
    val themes: List<ThemeOption>,
    val modes: List<ModeOption>,
) {
    /** True when both catalogues are empty — the defensive structurally-empty branch (never in production). */
    val isEmpty: Boolean get() = themes.isEmpty() && modes.isEmpty()

    /** True when the custom theme is the active selection (web `themeId === 'custom'`). */
    val isCustomSelected: Boolean get() = selection.themeId == ThemePickerRegistration.CUSTOM_THEME_ID

    /** True when [themeId] is the active brand/custom selection (web `themeId === thm.id`). */
    fun isThemeSelected(themeId: String): Boolean = selection.themeId == themeId

    /** True when [modeId] is the active mode (web `modeId === m.id`). */
    fun isModeSelected(modeId: String): Boolean = selection.modeId == modeId

    /** The synthetic custom theme built from the persisted custom colours (web `buildCustomTheme`). */
    fun customTheme(name: String): ThemeOption =
        ThemeOption(
            id = ThemePickerRegistration.CUSTOM_THEME_ID,
            name = name,
            primary = selection.customPrimary,
            accent = selection.customAccent,
        )
}

/**
 * The static brand catalogues — the native port of the web `ThemeProvider`'s `themes` and `modes` records.
 * Defined once, in SI-free ARGB, so the picker is vehicle- and locale-stable and fully unit-tested.
 */
object ThemeCatalog {
    /** The five brand accent themes (web `themes`, excluding the synthetic `custom`). */
    val THEMES: List<ThemeOption> =
        listOf(
            ThemeOption("neon-cyan", "Neon Cyan", primary = 0xFF00F0FF, accent = 0xFF4F46E5),
            ThemeOption("tesla-red", "Tesla Red", primary = 0xFFE31937, accent = 0xFFFF4060),
            ThemeOption("matrix-green", "Matrix Green", primary = 0xFF00FF41, accent = 0xFF10B981),
            ThemeOption("royal-purple", "Royal Purple", primary = 0xFFA855F7, accent = 0xFF7C3AED),
            ThemeOption("solar-amber", "Solar Amber", primary = 0xFFF59E0B, accent = 0xFFD97706),
        )

    /** The seven display modes (web `modes`), with their surface-colour previews. */
    val MODES: List<ModeOption> =
        listOf(
            ModeOption(
                "dark",
                "Dark",
                bg = 0xFF0A0A0F,
                surface1 = 0xFF0F1019,
                surface2 = 0xFF151621,
                surface3 = 0xFF1A1B2E,
                textPrimary = 0xFFFFFFFF,
                glassBorder = 0x14FFFFFF,
                dark = true,
            ),
            ModeOption(
                "light",
                "Light",
                bg = 0xFFF8FAFC,
                surface1 = 0xFFFFFFFF,
                surface2 = 0xFFF1F5F9,
                surface3 = 0xFFE2E8F0,
                textPrimary = 0xFF0F172A,
                glassBorder = 0x14000000,
                dark = false,
            ),
            ModeOption(
                "oled",
                "OLED Black",
                bg = 0xFF000000,
                surface1 = 0xFF050505,
                surface2 = 0xFF0A0A0A,
                surface3 = 0xFF111111,
                textPrimary = 0xFFFFFFFF,
                glassBorder = 0x0DFFFFFF,
                dark = true,
            ),
            ModeOption(
                "midnight",
                "Midnight Blue",
                bg = 0xFF0A0E1A,
                surface1 = 0xFF0F1425,
                surface2 = 0xFF141A30,
                surface3 = 0xFF1A2240,
                textPrimary = 0xFFE0E7FF,
                glassBorder = 0x146496FF,
                dark = true,
            ),
            ModeOption(
                "auto",
                "Auto (System)",
                bg = 0xFF0A0A0F,
                surface1 = 0xFF0F1019,
                surface2 = 0xFF151621,
                surface3 = 0xFF1A1B2E,
                textPrimary = 0xFFFFFFFF,
                glassBorder = 0x14FFFFFF,
                dark = true,
            ),
            ModeOption(
                "sunset",
                "Sunset",
                bg = 0xFF1A0E0A,
                surface1 = 0xFF241410,
                surface2 = 0xFF2E1A14,
                surface3 = 0xFF3A221A,
                textPrimary = 0xFFFFF0E0,
                glassBorder = 0x1AFFA064,
                dark = true,
            ),
            ModeOption(
                "nord",
                "Nord",
                bg = 0xFF2E3440,
                surface1 = 0xFF3B4252,
                surface2 = 0xFF434C5E,
                surface3 = 0xFF4C566A,
                textPrimary = 0xFFECEFF4,
                glassBorder = 0x1A88C0D0,
                dark = true,
            ),
        )

    /** Folds the persisted [selection] with the static catalogues into render-ready [ThemePickerData]. */
    fun project(selection: ThemeSelection): ThemePickerData = ThemePickerData(selection, THEMES, MODES)
}

/**
 * Pure colour helpers shared by the model, the persistence seam, and the (separately-tested) render layer
 * — kept Compose-free so the round-trip is unit-tested off-device. Colours are 32-bit ARGB longs; the view
 * wraps them in a Compose `Color` at the boundary.
 */
object ThemeColor {
    private const val ARGB_MASK = 0xFFFFFFFFL
    private const val OPAQUE_ALPHA = 0xFF000000L
    private const val BYTE = 0xFF
    private const val RED_SHIFT = 16
    private const val GREEN_SHIFT = 8
    private const val HEX_RADIX = 16

    /** The red channel (0–255) of an ARGB colour. */
    fun red(argb: Long): Int = ((argb shr RED_SHIFT) and BYTE.toLong()).toInt()

    /** The green channel (0–255) of an ARGB colour. */
    fun green(argb: Long): Int = ((argb shr GREEN_SHIFT) and BYTE.toLong()).toInt()

    /** The blue channel (0–255) of an ARGB colour. */
    fun blue(argb: Long): Int = (argb and BYTE.toLong()).toInt()

    /** Builds an opaque ARGB colour from 0–255 [r]/[g]/[b] channels (each coerced into range). */
    fun fromRgb(
        r: Int,
        g: Int,
        b: Int,
    ): Long {
        val rr = r.coerceIn(0, BYTE).toLong()
        val gg = g.coerceIn(0, BYTE).toLong()
        val bb = b.coerceIn(0, BYTE).toLong()
        return OPAQUE_ALPHA or (rr shl RED_SHIFT) or (gg shl GREEN_SHIFT) or bb
    }

    /** Formats the RGB part of an ARGB colour as an uppercase `#RRGGBB` string (web hex label). */
    fun hex(argb: Long): String = "#%02X%02X%02X".format(red(argb), green(argb), blue(argb))

    /** Parses a `#RRGGBB` (or `#AARRGGBB`) hex string to an opaque ARGB long, or [fallback] if malformed. */
    fun parseHex(
        value: String,
        fallback: Long,
    ): Long {
        val cleaned = value.trim().removePrefix("#")
        val rgb =
            when (cleaned.length) {
                6 -> cleaned.toLongOrNull(HEX_RADIX)
                8 -> cleaned.toLongOrNull(HEX_RADIX)?.and(ARGB_MASK)
                else -> null
            } ?: return fallback
        return OPAQUE_ALPHA or (rgb and 0xFFFFFFL)
    }
}

/** The freshness envelope the picker flags over its persisted selection — honest last-known/offline. */
enum class ThemePickerFreshness {
    /** Selection is fresh; no chip is shown. */
    Live,

    /** A re-hydrate is running over the cached selection; the stale chip shows. */
    Stale,

    /** A persistence read failed but the cached selection is still served; the offline chip shows. */
    Offline,
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostic emitted when the user picks a brand/custom theme (carries the slug only — PII-safe). */
const val EVENT_THEME_SELECTED: String = "themePicker.themeSelected"

/** The diagnostic emitted when the user picks a display mode (carries the slug only — PII-safe). */
const val EVENT_MODE_SELECTED: String = "themePicker.modeSelected"

/** The diagnostic emitted when the user commits custom colours (carries the slug only — PII-safe). */
const val EVENT_CUSTOM_COLORS: String = "themePicker.customColors"

/** The diagnostic emitted when the picker re-hydrates after an error (backs the retry affordance). */
const val EVENT_REFRESH: String = "themePicker.refresh"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/** The single structured field every ThemePicker diagnostic carries — the surface slug, never a colour. */
val SURFACE_FIELD: Map<String, String> = mapOf(FIELD_SURFACE to ThemePickerRegistration.SLUG)

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [ThemePickerRegistration.SLUG]
 * (P1/S11) — never a theme id, colour, or hex value, so a diagnostics line can never leak a user's palette.
 * Kept Compose-free so it is unit-tested with a recording [Logger]; the ViewModel calls it once per open.
 */
fun recordThemePickerOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, SURFACE_FIELD)
}
