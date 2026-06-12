// Pure, framework-free model + projection for the KioskOverlay feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/dashboard/components/KioskOverlay.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// KioskOverlay is a purely presentational surface — the web component takes its `config` (a subset of the
// localStorage-backed KioskConfig), `isDimmed`, `isCursorHidden`, `dashboardCount`, `currentIndex`, and an
// `onExit` callback as props from the owning Dashboard page (which owns `useKioskMode` + `useDateFormat`),
// so this surface binds NO data hook and issues NO network call. As in the sibling BatteryPill / StatusHeader
// ports, the cache-then-network lifecycle (loading / empty / error / stale / offline) lives on the owning
// page, not here; modelling those phases would invent behaviour the web spec does not have (drift). The
// branches the web source actually defines are the complete state set this surface renders, and each is
// projected here:
//   1. the dim layer (web `isDimmed && <div … style={{ opacity: 1 - config.dimLevel }}>`),
//   2. the cursor-hidden layer (web `isCursorHidden`; an invisible, aria-hidden CSS injection — it has no
//      visible surface on the web and none on Android, where there is no persistent pointer to hide),
//   3. the clock (web `config.showClock`) in one of four corners, ticking once per second,
//   4. the rotation dots (web `dashboardCount > 1 && config.rotateInterval > 0`) with the active dot wider,
//   5. the exit affordance (always present, revealed by interaction for ~3s).
//
// [KioskOverlayConfig] mirrors the persisted KioskConfig wire shape (camelCase keys, all defaulted to the
// web `DEFAULT_KIOSK_CONFIG`) so the projection can run straight off the cached/persisted JSON; only the
// five fields this surface consumes are modelled, and a decoder must ignore the remaining KioskConfig keys.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/KioskOverlay — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling BatteryPill / StatusHeader surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.kioskoverlay

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * The four clock anchors the web component supports — the native analogue of the
 * `config.clockPosition === 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'` ternary that picks
 * the Tailwind corner utility (`top-4 left-4`, …). The composable maps each onto a Compose `Alignment`.
 */
enum class KioskClockPosition {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
    ;

    companion object {
        /** The web default (`DEFAULT_KIOSK_CONFIG.clockPosition`). */
        val DEFAULT: KioskClockPosition = BottomRight

        /**
         * Parse the persisted wire value (web `'top-left'` / `'top-right'` / `'bottom-left'` /
         * `'bottom-right'`). An unknown or absent value falls back to [DEFAULT], mirroring the web spread
         * over `DEFAULT_KIOSK_CONFIG` that backfills any missing field.
         */
        fun fromWire(value: String?): KioskClockPosition =
            when (value?.trim()?.lowercase(Locale.ROOT)) {
                "top-left" -> TopLeft
                "top-right" -> TopRight
                "bottom-left" -> BottomLeft
                "bottom-right" -> BottomRight
                else -> DEFAULT
            }
    }
}

/**
 * The subset of the web `KioskConfig` this overlay reads, mirroring the persisted localStorage wire shape
 * (`useKioskMode.ts`). All fields default to the web `DEFAULT_KIOSK_CONFIG` values so a partial persisted
 * payload decodes without error and any missing field is backfilled exactly like the web spread.
 *
 * @property showClock web `config.showClock` — whether the corner clock renders + ticks.
 * @property clockPosition web `config.clockPosition` — the corner wire value, parsed by
 *   [KioskClockPosition.fromWire]; kept as the raw string so the projection runs straight off the JSON.
 * @property dimLevel web `config.dimLevel` — drives the dim-layer opacity (`1 - dimLevel`).
 * @property rotateInterval web `config.rotateInterval` — the rotation cadence in seconds; the dots only
 *   render when it is positive (web `config.rotateInterval > 0`).
 */
@Serializable
data class KioskOverlayConfig(
    val showClock: Boolean = true,
    val clockPosition: String = "bottom-right",
    val dimLevel: Double = DEFAULT_DIM_LEVEL,
    val rotateInterval: Int = DEFAULT_ROTATE_INTERVAL,
) {
    companion object {
        /** Web `DEFAULT_KIOSK_CONFIG.dimLevel`. */
        const val DEFAULT_DIM_LEVEL: Double = 0.5

        /** Web `DEFAULT_KIOSK_CONFIG.rotateInterval` (seconds). */
        const val DEFAULT_ROTATE_INTERVAL: Int = 30
    }
}

/**
 * The fully projected, render-ready view — the native analogue of every conditional the web component
 * evaluates before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a
 * UI host; each field is exactly one web render branch.
 *
 * @property dimAlpha the dim-layer opacity (web `1 - config.dimLevel`, clamped to 0..1) when the layer is
 *   shown, or `null` when `isDimmed` is false and the layer is omitted entirely (web `isDimmed && …`).
 * @property cursorHidden web `isCursorHidden`. The web renders an invisible, aria-hidden CSS-injection layer;
 *   Android has no persistent pointer to hide, so this carries the branch for completeness but drives no
 *   visible surface — faithfully matching the web layer, which is also invisible.
 * @property showClock web `config.showClock` — whether the corner clock renders.
 * @property clockPosition the parsed corner anchor (web `config.clockPosition`).
 * @property showDots web `dashboardCount > 1 && config.rotateInterval > 0` — whether the rotation dots show.
 * @property dotCount the number of dots (web `Array.from({ length: dashboardCount })`).
 * @property activeDotIndex the highlighted dot (web `currentIndex`); when out of range no dot is highlighted,
 *   exactly like the web `i === currentIndex` comparison.
 */
data class KioskOverlayDisplay(
    val dimAlpha: Float?,
    val cursorHidden: Boolean,
    val showClock: Boolean,
    val clockPosition: KioskClockPosition,
    val showDots: Boolean,
    val dotCount: Int,
    val activeDotIndex: Int,
)

/**
 * Pure projection from the surface's props to its render-ready [KioskOverlayDisplay] — a 1:1 port of the
 * conditionals the web component performs: the `1 - config.dimLevel` dim opacity gated by `isDimmed`, the
 * `config.showClock` + `config.clockPosition` clock, and the `dashboardCount > 1 && config.rotateInterval > 0`
 * dots. No formatting or Compose here — only the boolean/numeric derivations.
 */
object KioskOverlayProjection {
    private const val DIM_ALPHA_MIN: Double = 0.0
    private const val DIM_ALPHA_MAX: Double = 1.0

    /** The web threshold `dashboardCount > 1`: a single dashboard shows no rotation indicator. */
    private const val MIN_DASHBOARDS_FOR_DOTS: Int = 1

    /**
     * Select the render-ready view for the given props.
     *
     * @param config the overlay slice of the kiosk config (web `config`).
     * @param isDimmed web `isDimmed` — gates the dim layer.
     * @param isCursorHidden web `isCursorHidden` — carried through (no visible Android surface).
     * @param dashboardCount web `dashboardCount` — the number of rotation dashboards.
     * @param currentIndex web `currentIndex` — the active dashboard index.
     */
    fun project(
        config: KioskOverlayConfig,
        isDimmed: Boolean,
        isCursorHidden: Boolean,
        dashboardCount: Int,
        currentIndex: Int,
    ): KioskOverlayDisplay {
        val dimAlpha =
            if (isDimmed) {
                (DIM_ALPHA_MAX - config.dimLevel).coerceIn(DIM_ALPHA_MIN, DIM_ALPHA_MAX).toFloat()
            } else {
                null
            }
        return KioskOverlayDisplay(
            dimAlpha = dimAlpha,
            cursorHidden = isCursorHidden,
            showClock = config.showClock,
            clockPosition = KioskClockPosition.fromWire(config.clockPosition),
            showDots = dashboardCount > MIN_DASHBOARDS_FOR_DOTS && config.rotateInterval > 0,
            dotCount = dashboardCount.coerceAtLeast(0),
            activeDotIndex = currentIndex,
        )
    }
}

/**
 * Pure, locale- and zone-aware clock formatting — the native analogue of the two `useDateFormat` helpers the
 * web clock calls, `formatTime(now)` and `formatDateWithDay(now)` (web/src/lib/dateFormat.ts). Both run off
 * `java.time` with an injected [Locale] + [ZoneId] so they are deterministic in off-device unit tests; the
 * composable supplies the platform locale (web `useSettings().locale`) and the device zone (the native
 * wall-clock idiom — the web tz preference is a settings concern owned by the page).
 */
object KioskClockFormat {
    // Web `formatDateWithDay` renders `{ weekday: 'short', month: 'short', day: 'numeric' }` — e.g.
    // "Thu, Jun 11". The fixed field order matches the web's explicit Intl options; the names localise.
    private const val DATE_WITH_DAY_PATTERN: String = "EEE, MMM d"

    /**
     * The time text the web renders, `formatTime(now)` — `toLocaleTimeString` with
     * `{ hour: '2-digit', minute: '2-digit' }`. Maps to the platform's localized SHORT time, which honours
     * the locale's 12-/24-hour convention exactly as `toLocaleTimeString` does (e.g. "10:47 PM" in en-US).
     */
    fun time(
        epochMillis: Long,
        locale: Locale,
        zone: ZoneId,
    ): String =
        DateTimeFormatter
            .ofLocalizedTime(FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(Instant.ofEpochMilli(epochMillis))

    /**
     * The date text the web renders, `formatDateWithDay(now)` — short weekday + short month + numeric day
     * ("Thu, Jun 11"), locale-aware through [DATE_WITH_DAY_PATTERN].
     */
    fun dateWithDay(
        epochMillis: Long,
        locale: Locale,
        zone: ZoneId,
    ): String =
        DateTimeFormatter
            .ofPattern(DATE_WITH_DAY_PATTERN, locale)
            .withZone(zone)
            .format(Instant.ofEpochMilli(epochMillis))
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * clock time, the dashboard index, or the dim level — so a diagnostics line can never leak a user's
 * dashboard posture or local time.
 */
object KioskOverlayDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "KioskOverlay"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
