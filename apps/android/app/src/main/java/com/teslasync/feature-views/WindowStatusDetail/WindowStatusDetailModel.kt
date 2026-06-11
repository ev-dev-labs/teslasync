// Pure, framework-free model + projection for the WindowStatusDetail feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/admin/components/security-access/WindowStatusDetail.tsx + its ./helpers window helpers).
// No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// WindowStatusDetail is a presentational surface — the web component takes `latest: SecurityEvent | undefined`
// as a prop from the SecurityAccessPage (which owns the polled `GET /security/latest?vehicle_id=` query), so
// this surface binds no data hooks of its own. The web body is a single always-visible `<h2>` heading above a
// responsive grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`) of four GlassPanel cards — one per window
// (Front Driver / Front Passenger / Rear Driver / Rear Passenger) — each tinted by, and labelled with, the
// parsed window state. There is no per-card loading/empty branch in the web source itself; it renders four
// "Unknown" cards when `latest` is undefined (never a blank box).
//
// This file owns the parts the web component computes from that prop: the `parseWindowState` value parser
// (security-access/helpers.ts), the state → color classification (web `windowColor` / `windowTextClass`,
// collapsed to a single semantic accent role since the native GlassPanel border + value color derive from the
// same role), the fixed four-window projection, and the responsive column count (the Tailwind grid). The host
// supplies the data through the shared P1/S8 state-holder layer as a [io.teslasync.android.data.UiState], so
// the surface ALSO renders every lifecycle state that layer can carry (loading / hard error / empty /
// stale-offline) around the web component's always-on four-card grid — the [WindowStatusSurface] classifier
// below is what the composable switches on.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/WindowStatusDetail — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.windowstatusdetail

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object WindowStatusDetailRegistration {
    /** Stable surface id. */
    const val ID: String = "window-status-detail"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "WindowStatusDetail"
}

// ── i18n key mirrors (P1/S10) ──
// The web `t('admin.security.*')` keys this surface reads, flattened to the generated Android catalog names.
// Referencing them in one place keeps the composable and the off-device test in lockstep with the catalog and
// documents the web → native key contract. Every key below resolves in res/values/strings.xml.

/** Panel heading — web `t('admin.security.windowDetail', 'Window Status Detail')`. */
const val KEY_TITLE: String = "translation_admin_security_windowDetail"

/** Front-driver window label — web `t('admin.security.window.fd', 'Front Driver')`. */
const val KEY_WINDOW_FD: String = "translation_admin_security_window_fd"

/** Front-passenger window label — web `t('admin.security.window.fp', 'Front Passenger')`. */
const val KEY_WINDOW_FP: String = "translation_admin_security_window_fp"

/** Rear-driver window label — web `t('admin.security.window.rd', 'Rear Driver')`. */
const val KEY_WINDOW_RD: String = "translation_admin_security_window_rd"

/** Rear-passenger window label — web `t('admin.security.window.rp', 'Rear Passenger')`. */
const val KEY_WINDOW_RP: String = "translation_admin_security_window_rp"

/** Closed state value — web `t('admin.security.windowState.closed', 'Closed')`. */
const val KEY_STATE_CLOSED: String = "translation_admin_security_windowState_closed"

/** Venting state value — web `t('admin.security.windowState.venting', 'Venting')`. */
const val KEY_STATE_VENTING: String = "translation_admin_security_windowState_venting"

/** Open state value — web `t('admin.security.windowState.open', 'Open')`. */
const val KEY_STATE_OPEN: String = "translation_admin_security_windowState_open"

/** Unknown state value — web `t('admin.security.windowState.unknown', 'Unknown')`. */
const val KEY_STATE_UNKNOWN: String = "translation_admin_security_windowState_unknown"

// ── Wire model (the cached `/security/latest` payload, narrowed) ──

/**
 * The four window-position signals this surface reads off the cached `/security/latest` response — the native
 * mirror of the web `SecurityEvent` window fields (`internal/api/security/handler.go` maps each `*Window`
 * signal to its snake_case `*_window` JSON field). The endpoint returns many more columns; only the four
 * windows are modelled here, so a decoder must ignore unknown keys when reading the cached API JSON.
 *
 * Each field is `string | boolean | null` on the wire (web `SecurityEvent.fdWindow: string | boolean | null`),
 * so it is held as a nullable [JsonElement] and interpreted by [WindowStatusDetailProjection.parseWindowState]
 * exactly as the web `parseWindowState(asNonEmptyString(val))` does — only a non-empty JSON *string* carries a
 * state; a boolean, number, JSON null, or absent field reads as `Unknown`. All fields default to `null` so a
 * partial or still-loading payload decodes without error.
 */
@Serializable
data class SecurityWindows(
    @SerialName("fd_window") val fdWindow: JsonElement? = null,
    @SerialName("fp_window") val fpWindow: JsonElement? = null,
    @SerialName("rd_window") val rdWindow: JsonElement? = null,
    @SerialName("rp_window") val rpWindow: JsonElement? = null,
)

// ── Semantic window data (the web `./helpers` WindowState type + WINDOW_KEYS) ──

/**
 * The four window positions, in the web `WINDOW_KEYS` order (Front Driver, Front Passenger, Rear Driver, Rear
 * Passenger). [labelKey] is the flattened i18n key for the position label the web reads via
 * `t(win.i18nKey, win.fallback)`.
 */
enum class WindowPosition(
    val labelKey: String,
) {
    Fd(KEY_WINDOW_FD),
    Fp(KEY_WINDOW_FP),
    Rd(KEY_WINDOW_RD),
    Rp(KEY_WINDOW_RP),
}

/**
 * Parsed window state — the native analogue of the web `WindowState` union
 * (`'Closed' | 'Venting' | 'Open' | 'Unknown'`). [valueKey] is the flattened i18n key for the localized state
 * value the web reads via ``t(`admin.security.windowState.${state.toLowerCase()}`, state)``.
 */
enum class WindowState(
    val valueKey: String,
) {
    Closed(KEY_STATE_CLOSED),
    Venting(KEY_STATE_VENTING),
    Open(KEY_STATE_OPEN),
    Unknown(KEY_STATE_UNKNOWN),
}

/**
 * Semantic accent role for a window card — the native analogue of the web `windowColor` (the panel
 * background + border tint) and `windowTextClass` (the value text color), which always agree, so they collapse
 * to one role here. The composable maps each role to a design token (never raw hex), so light / dark /
 * high-contrast all stay correct: `Success` → green (Closed), `Warning` → amber (Venting), `Danger` → red
 * (Open), `Muted` → the neutral on-surface-variant (Unknown).
 */
enum class WindowAccentRole {
    Success,
    Warning,
    Danger,
    Muted,
}

/**
 * One fully projected, render-ready window card — the native analogue of a single rendered web `GlassPanel` in
 * the grid. Pure data (no Compose types); the composable resolves [position]/[state] to localized strings and
 * [accent] to a `Color`/`PanelAccent`.
 */
data class WindowStatusPanel(
    val position: WindowPosition,
    val state: WindowState,
    val accent: WindowAccentRole,
)

/**
 * The fully projected view — the four window cards the web component renders, in `WINDOW_KEYS` order. Pure
 * data (no Compose types) so the projection is unit-tested without a UI host. Always carries exactly four
 * panels (the fixed web grid); a missing payload yields four `Unknown` panels rather than a blank box.
 */
data class WindowStatusDisplay(
    val panels: List<WindowStatusPanel>,
)

/**
 * The localized microcopy the composable folds into the surface — the panel [title], the four position
 * labels, and the four state values the web reads through `useTranslation`. The composable builds this from
 * `stringResource`; tests pass a deterministic instance. [labelFor]/[valueFor] resolve a position/state to its
 * string the same way the web `t(win.i18nKey, …)` / ``t(`…windowState.${state}`, …)`` calls do.
 */
data class WindowStatusStrings(
    val title: String,
    val frontDriver: String,
    val frontPassenger: String,
    val rearDriver: String,
    val rearPassenger: String,
    val closed: String,
    val venting: String,
    val open: String,
    val unknown: String,
) {
    /** Resolves a [WindowPosition] to its localized label — web `t(win.i18nKey, win.fallback)`. */
    fun labelFor(position: WindowPosition): String =
        when (position) {
            WindowPosition.Fd -> frontDriver
            WindowPosition.Fp -> frontPassenger
            WindowPosition.Rd -> rearDriver
            WindowPosition.Rp -> rearPassenger
        }

    /** Resolves a [WindowState] to its localized value — web ``t(`…windowState.${state.toLowerCase()}`, state)``. */
    fun valueFor(state: WindowState): String =
        when (state) {
            WindowState.Closed -> closed
            WindowState.Venting -> venting
            WindowState.Open -> open
            WindowState.Unknown -> unknown
        }
}

/**
 * The pure projection the composable renders — the native mirror of the web component's render-time
 * derivations (`parseWindowState`, the state → color classification, and the fixed four-window map) plus the
 * responsive column count of the web grid. Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate.
 */
object WindowStatusDetailProjection {
    /** Tailwind `sm` breakpoint (640px) — at/above it the grid is at least two columns (web `sm:grid-cols-2`). */
    const val SM_BREAKPOINT_DP: Int = 640

    /** Tailwind `lg` breakpoint (1024px) — at/above it the grid is four columns (web `lg:grid-cols-4`). */
    const val LG_BREAKPOINT_DP: Int = 1024

    /**
     * The web `asNonEmptyString(val)` guard for a wire value: returns the string only when the value is a JSON
     * *string* (web `typeof v === 'string'`) of non-zero length, else `null`. A JSON boolean, number, `null`,
     * or absent field is not a string, so it reads as `null` — exactly as `asNonEmptyString` rejects non-string
     * inputs.
     */
    fun rawWindowString(value: JsonElement?): String? {
        val primitive = value as? JsonPrimitive
        return if (primitive != null && primitive.isString) {
            primitive.content.ifEmpty { null }
        } else {
            null
        }
    }

    /**
     * Parses a wire window value into a [WindowState] — a 1:1 port of the web `parseWindowState`
     * (security-access/helpers.ts). A non-string / empty / absent value is `Unknown`; `"closed"` or `"0"`
     * (case-insensitive) is `Closed`; anything containing `"vent"` is `Venting`; every other non-empty string
     * is `Open` (the web's final `lower.includes('open') || lower !== '0'` is always true at that point, so it
     * collapses to `Open`).
     */
    fun parseWindowState(value: JsonElement?): WindowState {
        val raw = rawWindowString(value) ?: return WindowState.Unknown
        val lower = raw.lowercase(Locale.ROOT)
        return when {
            lower == "closed" || lower == "0" -> WindowState.Closed
            lower.contains("vent") -> WindowState.Venting
            else -> WindowState.Open
        }
    }

    /**
     * Maps a [WindowState] to its accent role — the web `windowColor` / `windowTextClass` switch: `Closed` →
     * green success, `Venting` → amber warning, `Open` → red danger, `Unknown` → muted.
     */
    fun accentFor(state: WindowState): WindowAccentRole =
        when (state) {
            WindowState.Closed -> WindowAccentRole.Success
            WindowState.Venting -> WindowAccentRole.Warning
            WindowState.Open -> WindowAccentRole.Danger
            WindowState.Unknown -> WindowAccentRole.Muted
        }

    /**
     * Projects the (optional) cached window payload into the four render-ready cards in `WINDOW_KEYS` order.
     * A `null` payload (web `latest === undefined`) yields four `Unknown` cards — never an empty list — so the
     * surface always renders the full grid, matching the web's "four cards, possibly Unknown" contract.
     */
    fun project(windows: SecurityWindows?): WindowStatusDisplay {
        val panels =
            WindowPosition.entries.map { position ->
                val state = parseWindowState(windows?.let { valueAt(it, position) })
                WindowStatusPanel(position = position, state = state, accent = accentFor(state))
            }
        return WindowStatusDisplay(panels)
    }

    /**
     * The number of grid columns for a panel of [widthDp] — the native expression of the web
     * `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` responsive grid: one column below the `sm` breakpoint, two
     * from `sm` up to `lg`, and four at/above `lg`.
     */
    fun columnsFor(widthDp: Int): Int =
        when {
            widthDp < SM_BREAKPOINT_DP -> 1
            widthDp < LG_BREAKPOINT_DP -> 2
            else -> 4
        }

    private fun valueAt(
        windows: SecurityWindows,
        position: WindowPosition,
    ): JsonElement? =
        when (position) {
            WindowPosition.Fd -> windows.fdWindow
            WindowPosition.Fp -> windows.fpWindow
            WindowPosition.Rd -> windows.rdWindow
            WindowPosition.Rp -> windows.rpWindow
        }
}

// ── Lifecycle classifier (per-state coverage) ──

/**
 * The mutually-exclusive top-level surface the composable switches on — the native lifecycle chrome the host's
 * cache-then-network feed implies around the web component's always-on four-card grid. [Ready] renders the
 * grid (web parity); [Loading] the first-load skeleton grid; [Error] the retry surface; [Empty] a friendly
 * empty state when the host resolved with no security signal at all (`UiPhase.Empty`).
 */
enum class WindowStatusSurface {
    Loading,
    Error,
    Empty,
    Ready,
}

/**
 * Classifies the lifecycle flags of a `UiState` into the surface to render. A first load with nothing cached
 * shows [Loading]; a hard error with no cached fallback shows [Error]; a resolved-but-empty feed shows [Empty];
 * everything else (content, and stale/offline "last known") is [Ready] and renders the four-card grid (with a
 * freshness chip). Loading takes precedence over error so a refresh-with-skeleton never flashes the error
 * surface, and over empty so the skeleton shows on the very first load.
 */
fun windowStatusSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
    isEmpty: Boolean,
): WindowStatusSurface =
    when {
        isLoading -> WindowStatusSurface.Loading
        isError -> WindowStatusSurface.Error
        isEmpty -> WindowStatusSurface.Empty
        else -> WindowStatusSurface.Ready
    }

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never any window
 * state — so a diagnostics line can never leak the vehicle's physical posture.
 */
object WindowStatusDetailDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = WindowStatusDetailRegistration.SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
