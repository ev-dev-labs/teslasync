// Pure, framework-free model + projection for the KioskSettingsModal modal/dialog surface — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/dashboard/components/KioskSettingsModal.tsx). No Compose, no Android, no HTTP: every declaration
// here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable (KioskSettingsModal.kt)
// stays a thin render layer over these pure functions.
//
// The web component is the dashboard kiosk-mode configuration dialog. It is a *controlled* form whose only data
// dependency is `useTranslation` (i18n, P1/S10) — it binds no fetch and owns no store: the `config` is handed in and
// every edit is pushed back through `onUpdateConfig`, exactly like the sibling ConfirmDialog / FeedbackModal surfaces.
// So the cache-then-network lifecycle (loading / empty / error / stale / offline) belongs to the OWNING dashboard
// surface that holds the kiosk config, never here; modelling those phases would invent behaviour the web spec does not
// have (drift). The branches the web source actually renders are the complete state set this surface has, and each is
// projected here:
//   1. the dashboard rotation checklist — shown only when `rotateInterval > 0 && dashboards.length > 1`
//      ([showDashboardList]); the toggle keeps at least one dashboard selected (web `if (next.size > 1) next.delete`),
//   2. the cursor auto-hide timeout select — shown only when `hideCursor` ([showCursorTimeout]),
//   3. the dimmed-brightness slider — shown only when `dimAfter > 0` ([showBrightness]),
//   4. the clock-position select — shown only when `showClock` ([showClockPosition]).
//
// Unit semantics (SI-at-rest is not in play — these are presentation knobs, not telemetry): `rotateInterval` and
// `cursorTimeout` are seconds, `dimAfter` is minutes, `dimLevel` / `widgetOpacity` / `backgroundOpacity` are 0..1
// fractions converted to whole-percent only at the display boundary ([toPercent] / [toFraction], web
// `Math.round(x * 100)` / `n / 100`). The duration option vocabularies ([ROTATION_SECONDS] / [CURSOR_SECONDS] /
// [DIM_MINUTES]) and the clock-position order ([CLOCK_POSITIONS]) reproduce the web `ROTATION_OPTIONS` /
// `CURSOR_TIMEOUT_OPTIONS` / `DIM_AFTER_OPTIONS` / `CLOCK_POSITION_OPTIONS` constants verbatim; each option's localized
// label is resolved at the Compose boundary from its [classifyRotation] / [classifyCursor] / [classifyDim]
// classification (the web hard-coded `'Off' | '10s' | '1 min' | 'Never'` literals become P1/S10 catalog strings).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/KioskSettingsModal — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling modal/dialog surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.kiosksettingsmodal

import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.roundToInt

/**
 * The clock-overlay corner the web component offers (web `clockPosition: 'top-left' | 'top-right' | 'bottom-left' |
 * 'bottom-right'`, default `'bottom-right'`). The [wire] string is the exact token persisted in the kiosk config and
 * sent to / from the owning surface, so it round-trips losslessly through [fromWire].
 */
enum class ClockPosition(
    val wire: String,
) {
    TopLeft("top-left"),
    TopRight("top-right"),
    BottomLeft("bottom-left"),
    BottomRight("bottom-right"),
    ;

    companion object {
        /** The web initial-state default (`DEFAULT_KIOSK_CONFIG.clockPosition`). */
        val DEFAULT: ClockPosition = BottomRight

        /** Resolves a persisted [wire] token back to a [ClockPosition], falling back to [DEFAULT] for unknown input. */
        fun fromWire(wire: String): ClockPosition = entries.firstOrNull { it.wire == wire } ?: DEFAULT
    }
}

/**
 * The kiosk configuration the dialog edits — a 1:1 mirror of the web `KioskConfig` shape (`hooks/useKioskMode`). It is
 * a pure presentation record (no Compose, no Android); the owning surface holds the authoritative instance and the
 * dialog pushes immutable [copy] updates back through `onUpdateConfig` (the idiomatic Kotlin analogue of the web
 * `onUpdateConfig(Partial<KioskConfig>)` merge). Defaults reproduce the web `DEFAULT_KIOSK_CONFIG`.
 *
 * @property rotateInterval dashboard rotation period in seconds; `0` disables rotation (web `Off`).
 * @property dashboardIds the dashboards included in the rotation (web `dashboardIds`).
 * @property hideCursor whether the cursor auto-hides after [cursorTimeout] (web `hideCursor`).
 * @property cursorTimeout cursor auto-hide delay in seconds (web `cursorTimeout`).
 * @property dimAfter screen-dim delay in minutes; `0` never dims (web `Never`).
 * @property dimLevel dimmed brightness as a 0..1 fraction (web `dimLevel`).
 * @property showClock whether the clock overlay is shown (web `showClock`).
 * @property clockPosition the clock overlay corner (web `clockPosition`).
 * @property widgetOpacity widget-panel opacity as a 0..1 fraction (web `widgetOpacity`).
 * @property backgroundOpacity dashboard-background opacity as a 0..1 fraction (web `backgroundOpacity`).
 */
@Suppress("LongParameterList") // 1:1 mirror of the web KioskConfig shape — one field per kiosk knob the dialog edits.
data class KioskConfig(
    val rotateInterval: Int = 30,
    val dashboardIds: List<String> = emptyList(),
    val hideCursor: Boolean = true,
    val cursorTimeout: Int = 5,
    val dimAfter: Int = 0,
    val dimLevel: Double = 0.5,
    val showClock: Boolean = true,
    val clockPosition: ClockPosition = ClockPosition.DEFAULT,
    val widgetOpacity: Double = 1.0,
    val backgroundOpacity: Double = 1.0,
)

/**
 * One saved dashboard the rotation checklist offers — the native analogue of the web `SavedDashboard`
 * (`widgets/types`). Only the fields the dialog reads are modelled: the stable [id], the display [name], and the
 * [isDefault] marker that renders the "Default" chip (web `d.isDefault`).
 */
data class SavedDashboard(
    val id: String,
    val name: String,
    val isDefault: Boolean = false,
)

/**
 * The classified meaning of a duration option, resolved to a localized label at the Compose boundary. Replaces the
 * web's hard-coded option labels (`'Off' | '10s' | '1 min' | 'Never'`) with a structured value so the label vocabulary
 * lives in the P1/S10 catalog (`translation_common_off`, `translation_kiosk_never`, `translation_kiosk_seconds`,
 * `translation_kiosk_minutes`) and no English literal is baked into native code.
 */
sealed interface KioskDuration {
    /** Rotation disabled (web rotation label `'Off'`). */
    data object Off : KioskDuration

    /** Screen never dims (web dim label `'Never'`). */
    data object Never : KioskDuration

    /** A whole-[value] seconds duration (web `'10s'`). */
    data class Seconds(
        val value: Int,
    ) : KioskDuration

    /** A whole-[value] minutes duration (web `'1 min'`). */
    data class Minutes(
        val value: Int,
    ) : KioskDuration
}

/**
 * Pure projection from the dialog's inputs to its render decisions — a 1:1 port of the derivations the web component
 * performs (the `selectedIds` seeding + toggle, the four conditional-render guards, the percent/fraction conversions,
 * the preview-swatch alpha math, and the option vocabularies). No Compose, no side effects.
 */
object KioskSettingsModalProjection {
    /** Web `ROTATION_OPTIONS` values, in seconds (`0` == Off). */
    val ROTATION_SECONDS: List<Int> = listOf(0, 10, 15, 30, 60, 120, 300)

    /** Web `CURSOR_TIMEOUT_OPTIONS` values, in seconds. */
    val CURSOR_SECONDS: List<Int> = listOf(3, 5, 10, 15)

    /** Web `DIM_AFTER_OPTIONS` values, in minutes (`0` == Never). */
    val DIM_MINUTES: List<Int> = listOf(0, 5, 10, 15, 30, 60)

    /** Web `CLOCK_POSITION_OPTIONS` order. */
    val CLOCK_POSITIONS: List<ClockPosition> =
        listOf(ClockPosition.TopLeft, ClockPosition.TopRight, ClockPosition.BottomLeft, ClockPosition.BottomRight)

    /** Whole-percent ceiling for every opacity / brightness slider (web `max={100}` / `max={90}` upper bounds). */
    const val OPACITY_MAX_PERCENT: Int = 100

    /** Widget-opacity slider lower bound (web `min={30}`). */
    const val WIDGET_OPACITY_MIN_PERCENT: Int = 30

    /** Background-opacity slider lower bound (web `min={0}`). */
    const val BACKGROUND_OPACITY_MIN_PERCENT: Int = 0

    /** Dimmed-brightness slider lower bound (web `min={30}`). */
    const val BRIGHTNESS_MIN_PERCENT: Int = 30

    /** Dimmed-brightness slider upper bound (web `max={90}`). */
    const val BRIGHTNESS_MAX_PERCENT: Int = 90

    /** Opacity slider increment (web `step={5}`). */
    const val OPACITY_STEP_PERCENT: Int = 5

    private const val SECONDS_PER_MINUTE: Int = 60
    private const val PERCENT: Double = 100.0
    private const val PREVIEW_WIDGET_BASE_ALPHA: Double = 0.03
    private const val PREVIEW_WIDGET_ALPHA_RANGE: Double = 0.17

    /**
     * Seeds the rotation selection — web `new Set(config.dashboardIds.length > 0 ? config.dashboardIds :
     * dashboards.map(d => d.id))`. When the config already names dashboards they are used as-is; otherwise every saved
     * dashboard starts selected.
     */
    fun initialSelection(
        dashboardIds: List<String>,
        dashboards: List<SavedDashboard>,
    ): Set<String> = if (dashboardIds.isNotEmpty()) dashboardIds.toSet() else dashboards.map { it.id }.toSet()

    /**
     * Toggles a dashboard in the selection — web `toggleDashboard`. Removing is refused when it would empty the
     * selection (web `if (next.size > 1) next.delete(id)`), so at least one dashboard always stays in the rotation.
     */
    fun toggleSelection(
        current: Set<String>,
        id: String,
    ): Set<String> =
        when {
            !current.contains(id) -> current + id
            current.size > 1 -> current - id
            else -> current
        }

    /** Whether the dashboard checklist is shown — web `config.rotateInterval > 0 && dashboards.length > 1`. */
    fun showDashboardList(
        rotateInterval: Int,
        dashboardCount: Int,
    ): Boolean = rotateInterval > 0 && dashboardCount > 1

    /** Whether the cursor-timeout select is shown — web `config.hideCursor`. */
    fun showCursorTimeout(hideCursor: Boolean): Boolean = hideCursor

    /** Whether the dimmed-brightness slider is shown — web `config.dimAfter > 0`. */
    fun showBrightness(dimAfter: Int): Boolean = dimAfter > 0

    /** Whether the clock-position select is shown — web `config.showClock`. */
    fun showClockPosition(showClock: Boolean): Boolean = showClock

    /** Classifies a rotation-interval value (seconds) into its label meaning (web `ROTATION_OPTIONS` labels). */
    fun classifyRotation(seconds: Int): KioskDuration =
        when {
            seconds <= 0 -> KioskDuration.Off
            seconds < SECONDS_PER_MINUTE -> KioskDuration.Seconds(seconds)
            else -> KioskDuration.Minutes(seconds / SECONDS_PER_MINUTE)
        }

    /** Classifies a cursor-timeout value (seconds) — every web `CURSOR_TIMEOUT_OPTIONS` entry is sub-minute. */
    fun classifyCursor(seconds: Int): KioskDuration = KioskDuration.Seconds(seconds)

    /** Classifies a dim-after value (minutes) into its label meaning (web `DIM_AFTER_OPTIONS` labels). */
    fun classifyDim(minutes: Int): KioskDuration = if (minutes <= 0) KioskDuration.Never else KioskDuration.Minutes(minutes)

    /** Converts a 0..1 fraction to whole percent for the slider position + label (web `Math.round(x * 100)`). */
    fun toPercent(fraction: Double): Int = (fraction * PERCENT).roundToInt()

    /** Converts a whole-percent slider position back to a 0..1 fraction (web `n / 100`). */
    fun toFraction(percent: Int): Double = percent / PERCENT

    /**
     * The preview widget-swatch alpha — web `0.03 + (widgetOpacity ?? 1) * 0.17`. Reproduces the swatch's translucent
     * fill so the preview tracks the configured widget opacity.
     */
    fun previewWidgetAlpha(widgetOpacity: Double): Double = PREVIEW_WIDGET_BASE_ALPHA + widgetOpacity * PREVIEW_WIDGET_ALPHA_RANGE

    /**
     * The number of discrete Material slider stops between [minPercent] and [maxPercent] for a [stepPercent] increment
     * (web `step`). Material counts the stops *between* the endpoints, so a 30..100 / step-5 slider has 13 stops.
     */
    fun sliderSteps(
        minPercent: Int,
        maxPercent: Int,
        stepPercent: Int,
    ): Int = ((maxPercent - minPercent) / stepPercent) - 1
}

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object KioskSettingsModalRegistration {
    /** Stable surface id. */
    const val ID: String = "kiosk-settings-modal"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "KioskSettingsModal"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface
 * [KioskSettingsModalRegistration.SLUG] — never the kiosk config, the dashboard names, or the chosen options — so a
 * diagnostics line can never leak what the user is configuring. Kept free of Compose so it is unit-tested with a
 * recording [Logger]; the composable calls it from its first-composition effect.
 */
object KioskSettingsModalDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to KioskSettingsModalRegistration.SLUG))
    }
}
